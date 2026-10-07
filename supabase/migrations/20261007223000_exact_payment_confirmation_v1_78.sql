-- TAMÃO — Exact merchant billing payment confirmation v1.78
-- Financial approval must record the amount actually received and the payment method.
-- The previous six-argument authority becomes structurally unable to approve a request
-- because approved rows now require exact confirmation metadata.

alter table public.merchant_billing_payment_requests
  add column if not exists received_amount_cents bigint,
  add column if not exists payment_method text;

alter table public.merchant_billing_payment_requests
  add constraint merchant_billing_payment_requests_received_amount_check
    check (received_amount_cents is null or received_amount_cents>0),
  add constraint merchant_billing_payment_requests_payment_method_check
    check (
      payment_method is null
      or payment_method in ('pix','bank_transfer','cash','card','other')
    ),
  add constraint merchant_billing_payment_requests_approved_exact_payment
    check (
      status<>'approved'
      or (
        received_amount_cents=expected_amount_cents
        and payment_method is not null
        and resolved_by is not null
        and resolved_at is not null
        and admin_reference is not null
        and char_length(trim(admin_reference)) between 3 and 240
      )
    );

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

drop trigger if exists audit_exact_billing_payment_confirmation_trg
on public.merchant_billing_payment_requests;
create trigger audit_exact_billing_payment_confirmation_trg
after update of status on public.merchant_billing_payment_requests
for each row execute function public.audit_exact_billing_payment_confirmation();

create or replace function public.admin_merchant_billing_payment_request_action(
  p_actor_user_id uuid,
  p_payment_request_id uuid,
  p_action text,
  p_reference text,
  p_received_amount_cents bigint,
  p_payment_method text,
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
  v_request public.merchant_billing_payment_requests%rowtype;
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

    update public.merchant_billing_payment_requests
    set received_amount_cents=p_received_amount_cents,
        payment_method=v_method,
        updated_at=clock_timestamp()
    where id=p_payment_request_id;
  end if;

  return public.admin_merchant_billing_payment_request_action(
    p_actor_user_id,
    p_payment_request_id,
    v_kind,
    p_reference,
    p_idempotency_key,
    p_request_hash
  );
end;
$$;

revoke all on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,bigint,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,bigint,text,text,text
) to service_role, postgres;
