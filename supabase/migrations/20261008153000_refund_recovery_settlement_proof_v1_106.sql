-- TAMÃO — Refund recovery settlement proof v1.106
-- The recovery workflow is already atomically finalized by the Finance payment
-- authority. This migration makes that relationship an invariant at COMMIT:
--
--   recovery=recovered
--     <=> recovery payment request=approved
--     <=> refund=resolved_recovered
--
-- A payment_pending recovery must point to a pending refund_recovery request.
-- An open recovery has no current payment request and its refund remains under
-- review. Stale cancelled/rejected payment requests may remain historically,
-- but can never prove settlement.

do $$
begin
  if exists(
    select 1
    from public.merchant_billing_refund_recoveries rr
    join public.merchant_billing_payment_refunds r
      on r.id=rr.refund_id
    left join public.merchant_billing_payment_requests pr
      on pr.id=rr.recovery_payment_request_id
    where
      (
        rr.status='open'
        and (
          rr.recovery_payment_request_id is not null
          or r.status<>'review_required'
        )
      )
      or
      (
        rr.status='payment_pending'
        and (
          r.status<>'review_required'
          or pr.id is null
          or pr.request_kind<>'refund_recovery'
          or pr.refund_recovery_id is distinct from rr.id
          or pr.merchant_id is distinct from rr.merchant_id
          or pr.expected_amount_cents is distinct from rr.amount_cents
          or pr.status<>'pending'
        )
      )
      or
      (
        rr.status='recovered'
        and (
          r.status<>'resolved_recovered'
          or pr.id is null
          or pr.request_kind<>'refund_recovery'
          or pr.refund_recovery_id is distinct from rr.id
          or pr.merchant_id is distinct from rr.merchant_id
          or pr.expected_amount_cents is distinct from rr.amount_cents
          or pr.received_amount_cents is distinct from rr.amount_cents
          or pr.status<>'approved'
          or rr.recovered_by is distinct from pr.resolved_by
          or r.resolved_by is distinct from pr.resolved_by
          or r.resolution_reference is distinct from
            'recovery-payment-request:'||pr.id::text
        )
      )
  ) then
    raise exception 'V1106_EXISTING_RECOVERY_SETTLEMENT_REVIEW_REQUIRED'
      using errcode='40001';
  end if;

  if exists(
    select 1
    from public.merchant_billing_payment_refunds r
    left join public.merchant_billing_refund_recoveries rr
      on rr.refund_id=r.id
    left join public.merchant_billing_payment_requests pr
      on pr.id=rr.recovery_payment_request_id
    where r.status='resolved_recovered'
      and (
        rr.id is null
        or rr.status<>'recovered'
        or pr.id is null
        or pr.status<>'approved'
        or pr.request_kind<>'refund_recovery'
        or pr.refund_recovery_id is distinct from rr.id
        or pr.merchant_id is distinct from rr.merchant_id
        or pr.expected_amount_cents is distinct from rr.amount_cents
        or pr.received_amount_cents is distinct from rr.amount_cents
        or r.resolution_reference is distinct from
          'recovery-payment-request:'||pr.id::text
      )
  ) then
    raise exception 'V1106_EXISTING_RESOLVED_REFUND_REVIEW_REQUIRED'
      using errcode='40001';
  end if;
end $$;

create or replace function public.require_refund_recovery_settlement_consistency()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_recovery_id uuid;
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_changed_request_id uuid;
  v_changed_request_kind text;
  v_changed_request_status text;
begin
  if tg_table_name='merchant_billing_refund_recoveries' then
    v_recovery_id:=new.id;

  elsif tg_table_name='merchant_billing_payment_refunds' then
    select rr.id
    into v_recovery_id
    from public.merchant_billing_refund_recoveries rr
    where rr.refund_id=new.id;

    if not found then
      if new.status='resolved_recovered' then
        raise exception 'REFUND_RECOVERY_SETTLEMENT_RECOVERY_MISSING'
          using errcode='23514';
      end if;
      return new;
    end if;

  elsif tg_table_name='merchant_billing_payment_requests' then
    v_changed_request_kind:=new.request_kind;
    v_changed_request_status:=new.status;
    v_changed_request_id:=new.id;

    if v_changed_request_kind<>'refund_recovery'
       or new.refund_recovery_id is null then
      return new;
    end if;

    v_recovery_id:=new.refund_recovery_id;

  else
    raise exception 'REFUND_RECOVERY_SETTLEMENT_UNSUPPORTED_TABLE'
      using errcode='23514';
  end if;

  select *
  into v_recovery
  from public.merchant_billing_refund_recoveries
  where id=v_recovery_id;

  if not found then
    raise exception 'REFUND_RECOVERY_SETTLEMENT_RECOVERY_NOT_FOUND'
      using errcode='23514';
  end if;

  select *
  into v_refund
  from public.merchant_billing_payment_refunds
  where id=v_recovery.refund_id;

  if not found then
    raise exception 'REFUND_RECOVERY_SETTLEMENT_REFUND_NOT_FOUND'
      using errcode='23514';
  end if;

  if v_refund.merchant_id is distinct from v_recovery.merchant_id
     or v_refund.payment_request_id is distinct from
        v_recovery.original_payment_request_id
     or v_refund.currency is distinct from v_recovery.currency
     or v_refund.recoverable_amount_cents is distinct from
        v_recovery.amount_cents then
    raise exception 'REFUND_RECOVERY_SETTLEMENT_EXPOSURE_MISMATCH'
      using errcode='23514';
  end if;

  if v_recovery.recovery_payment_request_id is not null then
    select *
    into v_request
    from public.merchant_billing_payment_requests
    where id=v_recovery.recovery_payment_request_id;

    if not found then
      raise exception 'REFUND_RECOVERY_SETTLEMENT_REQUEST_NOT_FOUND'
        using errcode='23514';
    end if;

    if v_request.request_kind<>'refund_recovery'
       or v_request.refund_recovery_id is distinct from v_recovery.id
       or v_request.merchant_id is distinct from v_recovery.merchant_id
       or v_request.expected_amount_cents is distinct from
          v_recovery.amount_cents then
      raise exception 'REFUND_RECOVERY_SETTLEMENT_REQUEST_MISMATCH'
        using errcode='23514';
    end if;
  end if;

  if v_recovery.status='open' then
    if v_recovery.recovery_payment_request_id is not null
       or v_refund.status<>'review_required' then
      raise exception 'REFUND_RECOVERY_OPEN_STATE_INCONSISTENT'
        using errcode='23514';
    end if;

  elsif v_recovery.status='payment_pending' then
    if v_recovery.recovery_payment_request_id is null
       or v_request.status<>'pending'
       or v_refund.status<>'review_required' then
      raise exception 'REFUND_RECOVERY_PENDING_STATE_INCONSISTENT'
        using errcode='23514';
    end if;

  elsif v_recovery.status='recovered' then
    if v_recovery.recovery_payment_request_id is null
       or v_request.status<>'approved'
       or v_request.received_amount_cents is distinct from
          v_recovery.amount_cents
       or v_request.resolved_by is null
       or v_request.resolved_at is null
       or v_recovery.recovered_by is distinct from v_request.resolved_by
       or v_recovery.recovered_at is null
       or v_refund.status<>'resolved_recovered'
       or v_refund.resolved_by is distinct from v_request.resolved_by
       or v_refund.resolved_at is null
       or v_refund.resolution_reference is distinct from
          'recovery-payment-request:'||v_request.id::text then
      raise exception 'REFUND_RECOVERY_RECOVERED_STATE_INCONSISTENT'
        using errcode='23514';
    end if;

  else
    raise exception 'REFUND_RECOVERY_SETTLEMENT_STATUS_INVALID'
      using errcode='23514';
  end if;

  -- A direct/stale attempt to approve any refund-recovery request must also
  -- prove that the recovery/refund pair reached the terminal state in the
  -- same transaction. Historical rejected/cancelled requests are allowed.
  if tg_table_name='merchant_billing_payment_requests'
     and v_changed_request_status='approved'
     and (
       v_recovery.recovery_payment_request_id is distinct from
         v_changed_request_id
       or v_recovery.status<>'recovered'
       or v_refund.status<>'resolved_recovered'
     ) then
    raise exception 'REFUND_RECOVERY_APPROVED_REQUEST_NOT_SETTLED'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.require_refund_recovery_settlement_consistency()
from public,anon,authenticated;
grant execute on function public.require_refund_recovery_settlement_consistency()
to postgres,service_role;

drop trigger if exists require_refund_recovery_settlement_on_refund_trg
on public.merchant_billing_payment_refunds;
create constraint trigger require_refund_recovery_settlement_on_refund_trg
after insert or update
on public.merchant_billing_payment_refunds
deferrable initially deferred
for each row execute function public.require_refund_recovery_settlement_consistency();

drop trigger if exists require_refund_recovery_settlement_on_recovery_trg
on public.merchant_billing_refund_recoveries;
create constraint trigger require_refund_recovery_settlement_on_recovery_trg
after insert or update
on public.merchant_billing_refund_recoveries
deferrable initially deferred
for each row execute function public.require_refund_recovery_settlement_consistency();

drop trigger if exists require_refund_recovery_settlement_on_request_trg
on public.merchant_billing_payment_requests;
create constraint trigger require_refund_recovery_settlement_on_request_trg
after insert or update
on public.merchant_billing_payment_requests
deferrable initially deferred
for each row execute function public.require_refund_recovery_settlement_consistency();
