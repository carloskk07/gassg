-- TAMÃO — Payment approval provenance v1.83
-- Approved billing requests must record whether Finance confirmed them manually
-- or from one exact provider event. Provider-backed approvals are structurally
-- bound to the event and verified again at COMMIT time.

alter table public.merchant_billing_payment_requests
  add column if not exists approval_source text,
  add column if not exists provider_payment_event_id uuid
    references public.merchant_billing_payment_events(id) on delete restrict;

update public.merchant_billing_payment_requests
set approval_source='manual'
where status='approved'
  and approval_source is null;

alter table public.merchant_billing_payment_requests
  add constraint merchant_billing_payment_requests_approval_source_check
    check (
      approval_source is null
      or approval_source in ('manual','provider_event')
    ),
  add constraint merchant_billing_payment_requests_approved_source_required
    check (
      status<>'approved'
      or approval_source is not null
    ),
  add constraint merchant_billing_payment_requests_provider_source_shape
    check (
      approval_source is null
      or (approval_source='manual' and provider_payment_event_id is null)
      or (approval_source='provider_event' and provider_payment_event_id is not null)
    );

create unique index if not exists merchant_billing_payment_requests_provider_event_uq
  on public.merchant_billing_payment_requests(provider_payment_event_id)
  where provider_payment_event_id is not null;

create or replace function public.require_provider_event_approval_consistency()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_event public.merchant_billing_payment_events%rowtype;
begin
  if new.status='approved'
     and new.approval_source='provider_event' then
    select *
    into v_event
    from public.merchant_billing_payment_events
    where id=new.provider_payment_event_id;

    if not found
       or v_event.status<>'applied'
       or v_event.payment_request_id is distinct from new.id
       or v_event.merchant_id is distinct from new.merchant_id
       or v_event.amount_cents is distinct from new.received_amount_cents
       or v_event.payment_method is distinct from new.payment_method
       or lower(trim(v_event.reconciliation_key))
          is distinct from lower(trim(new.reconciliation_key)) then
      raise exception 'PROVIDER_PAYMENT_EVENT_APPROVAL_INCONSISTENT'
        using errcode='42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.require_provider_event_approval_consistency()
from public, anon, authenticated;
grant execute on function public.require_provider_event_approval_consistency()
to postgres, service_role;

drop trigger if exists require_provider_event_approval_consistency_trg
on public.merchant_billing_payment_requests;
create constraint trigger require_provider_event_approval_consistency_trg
after insert or update of
  status,approval_source,provider_payment_event_id,
  received_amount_cents,payment_method,reconciliation_key
on public.merchant_billing_payment_requests
deferrable initially deferred
for each row execute function public.require_provider_event_approval_consistency();

create or replace function public.audit_exact_billing_payment_confirmation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if old.status='pending' and new.status='approved' then
    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      new.resolved_by,
      'merchant_billing_payment_exact_confirmed',
      'merchant_billing_payment_request',
      new.id::text,
      jsonb_build_object(
        'merchantId',new.merchant_id,
        'requestKind',new.request_kind,
        'expectedAmountCents',new.expected_amount_cents,
        'receivedAmountCents',new.received_amount_cents,
        'paymentMethod',new.payment_method,
        'reconciliationKey',new.reconciliation_key,
        'approvalSource',new.approval_source,
        'providerPaymentEventId',new.provider_payment_event_id,
        'reference',new.admin_reference
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_exact_billing_payment_confirmation()
from public, anon, authenticated;
grant execute on function public.audit_exact_billing_payment_confirmation()
to postgres, service_role;

create or replace function public.admin_merchant_billing_payment_request_action(
  p_actor_user_id uuid,
  p_payment_request_id uuid,
  p_action text,
  p_reference text,
  p_received_amount_cents bigint,
  p_payment_method text,
  p_reconciliation_key text,
  p_payment_event_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_method text:=lower(trim(coalesce(p_payment_method,'')));
  v_key text:=nullif(trim(p_reconciliation_key),'');
  v_request public.merchant_billing_payment_requests%rowtype;
  v_event public.merchant_billing_payment_events%rowtype;
begin
  if v_kind not in ('approve','reject') then
    raise exception 'INVALID_PAYMENT_REQUEST_ACTION' using errcode='22023';
  end if;

  select *
  into v_request
  from public.merchant_billing_payment_requests
  where id=p_payment_request_id
  for update;

  if not found then
    raise exception 'PAYMENT_REQUEST_NOT_FOUND' using errcode='P0002';
  end if;

  if v_kind='approve' then
    if p_received_amount_cents is null
       or p_received_amount_cents<>v_request.expected_amount_cents then
      raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode='40001';
    end if;

    if v_method not in ('pix','bank_transfer','cash','card','other') then
      raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
    end if;

    if v_key is null
       or char_length(v_key)<6
       or char_length(v_key)>160
       or v_key~'[[:cntrl:]]' then
      raise exception 'INVALID_RECONCILIATION_KEY' using errcode='22023';
    end if;

    if p_payment_event_id is not null then
      select *
      into v_event
      from public.merchant_billing_payment_events
      where id=p_payment_event_id
      for update;

      if not found then
        raise exception 'PAYMENT_EVENT_NOT_FOUND' using errcode='P0002';
      end if;

      if v_event.status<>'matched_exact'
         or v_event.payment_request_id is distinct from v_request.id
         or v_event.merchant_id is distinct from v_request.merchant_id then
        raise exception 'PAYMENT_EVENT_NOT_MATCHED_TO_REQUEST'
          using errcode='40001';
      end if;

      if v_event.amount_cents is distinct from p_received_amount_cents
         or v_event.payment_method is distinct from v_method
         or lower(trim(v_event.reconciliation_key))
            is distinct from lower(v_key) then
        raise exception 'PAYMENT_EVENT_APPROVAL_MISMATCH'
          using errcode='40001';
      end if;

      update public.merchant_billing_payment_requests
      set approval_source='provider_event',
          provider_payment_event_id=v_event.id,
          updated_at=clock_timestamp()
      where id=v_request.id;

    else
      update public.merchant_billing_payment_requests
      set approval_source='manual',
          provider_payment_event_id=null,
          updated_at=clock_timestamp()
      where id=v_request.id;
    end if;
  end if;

  return public.admin_merchant_billing_payment_request_action(
    p_actor_user_id,
    p_payment_request_id,
    v_kind,
    p_reference,
    p_received_amount_cents,
    v_method,
    v_key,
    p_idempotency_key,
    p_request_hash
  );
end;
$$;

revoke all on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,bigint,text,text,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,bigint,text,text,uuid,text,text
) to service_role, postgres;
