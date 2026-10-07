-- TAMÃO — Unique payment reconciliation authority v1.80
-- Prevents one real-world payment/receipt from being reused to approve multiple billing requests.

alter table public.merchant_billing_payment_requests
  add column if not exists reconciliation_key text;

alter table public.merchant_billing_payment_requests
  add constraint merchant_billing_payment_requests_reconciliation_key_check
    check (
      reconciliation_key is null
      or (
        char_length(trim(reconciliation_key)) between 6 and 160
        and reconciliation_key !~ '[[:cntrl:]]'
      )
    ),
  add constraint merchant_billing_payment_requests_approved_reconciliation_key
    check (
      status<>'approved'
      or reconciliation_key is not null
    );

create unique index if not exists merchant_billing_payment_requests_approved_reconciliation_key_uq
  on public.merchant_billing_payment_requests(lower(trim(reconciliation_key)))
  where status='approved';

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
  v_constraint text;
begin
  if v_kind not in ('approve','reject') then
    raise exception 'INVALID_PAYMENT_REQUEST_ACTION' using errcode='22023';
  end if;

  if v_kind='approve' then
    if p_received_amount_cents is null or p_received_amount_cents<=0 then
      raise exception 'RECEIVED_AMOUNT_REQUIRED' using errcode='22023';
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

    select *
    into v_request
    from public.merchant_billing_payment_requests
    where id=p_payment_request_id
    for update;

    if not found then
      raise exception 'PAYMENT_REQUEST_NOT_FOUND' using errcode='P0002';
    end if;

    if v_request.expected_amount_cents<>p_received_amount_cents then
      raise exception 'PAYMENT_AMOUNT_MISMATCH'
        using errcode='40001',
              detail='expected='||v_request.expected_amount_cents::text
                ||',received='||p_received_amount_cents::text;
    end if;

    if exists(
      select 1
      from public.merchant_billing_payment_requests other
      where other.status='approved'
        and other.id<>p_payment_request_id
        and lower(trim(other.reconciliation_key))=lower(v_key)
    ) then
      raise exception 'PAYMENT_RECONCILIATION_KEY_ALREADY_USED'
        using errcode='23505';
    end if;

    update public.merchant_billing_payment_requests
    set reconciliation_key=v_key,
        updated_at=clock_timestamp()
    where id=p_payment_request_id;
  end if;

  begin
    return public.admin_merchant_billing_payment_request_action(
      p_actor_user_id,
      p_payment_request_id,
      v_kind,
      p_reference,
      p_received_amount_cents,
      v_method,
      p_idempotency_key,
      p_request_hash
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint=constraint_name;
      if v_constraint='merchant_billing_payment_requests_approved_reconciliation_key_uq' then
        raise exception 'PAYMENT_RECONCILIATION_KEY_ALREADY_USED'
          using errcode='23505';
      end if;
      raise;
  end;
end;
$$;

revoke all on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,bigint,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,bigint,text,text,text,text
) to service_role, postgres;
