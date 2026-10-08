-- TAMÃO — Exact immutable refund recovery allocation v1.100
-- Recovery obligations are economic facts. Their amount is not merely capped:
-- it must equal the exact recoverable exposure remaining when the obligation
-- is created, and its economic identity cannot be rewritten afterwards.

do $$
declare
  v_bad record;
begin
  with ordered as (
    select
      rr.id,
      rr.refund_id,
      rr.original_payment_request_id,
      rr.amount_cents,
      rr.created_at,
      r.amount_cents as refund_amount_cents,
      r.original_payment_amount_cents,
      coalesce(
        sum(rr.amount_cents) over(
          partition by rr.original_payment_request_id
          order by rr.created_at,rr.id
          rows between unbounded preceding and 1 preceding
        ),
        0
      )::bigint as prior_allocated_cents
    from public.merchant_billing_refund_recoveries rr
    join public.merchant_billing_payment_refunds r
      on r.id=rr.refund_id
  ),
  invalid as (
    select
      id,
      amount_cents,
      least(
        refund_amount_cents,
        greatest(original_payment_amount_cents-prior_allocated_cents,0)
      )::bigint as expected_cents
    from ordered
    where amount_cents is distinct from least(
      refund_amount_cents,
      greatest(original_payment_amount_cents-prior_allocated_cents,0)
    )::bigint
  )
  select *
  into v_bad
  from invalid
  limit 1;

  if found then
    raise exception
      'V1100_EXISTING_REFUND_RECOVERY_ALLOCATION_INVALID:%:%:%',
      v_bad.id,v_bad.amount_cents,v_bad.expected_cents
      using errcode='40001';
  end if;
end $$;

create or replace function public.guard_refund_recovery_exposure_cap()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_allocated bigint:=0;
  v_remaining bigint:=0;
  v_expected bigint:=0;
begin
  if tg_op='UPDATE'
     and (
       new.refund_id is distinct from old.refund_id
       or new.merchant_id is distinct from old.merchant_id
       or new.original_payment_request_id is distinct from old.original_payment_request_id
       or new.amount_cents is distinct from old.amount_cents
       or new.currency is distinct from old.currency
     ) then
    raise exception 'REFUND_RECOVERY_FACT_IMMUTABLE'
      using errcode='23514';
  end if;

  select *
  into v_refund
  from public.merchant_billing_payment_refunds
  where id=new.refund_id
  for share;

  if not found
     or v_refund.payment_request_id is distinct from new.original_payment_request_id
     or v_refund.merchant_id is distinct from new.merchant_id
     or v_refund.original_payment_amount_cents is null
     or v_refund.original_payment_amount_cents<=0
     or v_refund.currency is distinct from new.currency then
    raise exception 'REFUND_RECOVERY_EXPOSURE_FACT_MISMATCH'
      using errcode='40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-recovery-exposure:'||new.original_payment_request_id::text,
      0
    )
  );

  select coalesce(sum(rr.amount_cents),0)
  into v_allocated
  from public.merchant_billing_refund_recoveries rr
  where rr.original_payment_request_id=new.original_payment_request_id
    and rr.id is distinct from new.id;

  v_remaining:=greatest(v_refund.original_payment_amount_cents-v_allocated,0);
  v_expected:=least(v_refund.amount_cents,v_remaining);

  if new.amount_cents is distinct from v_expected then
    raise exception 'REFUND_RECOVERY_EXACT_ALLOCATION_REQUIRED:%:%',
      new.amount_cents,v_expected
      using errcode='23514';
  end if;

  if v_expected<=0 then
    raise exception 'REFUND_RECOVERY_NO_REMAINING_EXPOSURE'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_refund_recovery_exposure_cap()
from public,anon,authenticated;
grant execute on function public.guard_refund_recovery_exposure_cap()
to postgres,service_role;

drop trigger if exists guard_refund_recovery_exposure_cap_trg
on public.merchant_billing_refund_recoveries;
create trigger guard_refund_recovery_exposure_cap_trg
before insert or update of
  refund_id,merchant_id,original_payment_request_id,amount_cents,currency
on public.merchant_billing_refund_recoveries
for each row execute function public.guard_refund_recovery_exposure_cap();
