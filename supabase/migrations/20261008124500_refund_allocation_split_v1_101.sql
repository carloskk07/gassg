-- TAMÃO — Explicit refund allocation split v1.101
-- A provider refund can be larger than the remaining merchant exposure.
-- Persist the economic decomposition on the immutable refund fact itself:
--   amount = recoverable exposure + non-recoverable excess.
-- The split is derived by PostgreSQL under the same exposure lock and is
-- cross-checked against the recovery obligation at COMMIT time.

alter table public.merchant_billing_payment_refunds
  add column if not exists recoverable_amount_cents bigint,
  add column if not exists excess_amount_cents bigint;

do $$
begin
  if exists(
    select 1
    from public.merchant_billing_payment_refunds r
    where r.payment_request_id is not null
      and not exists(
        select 1
        from public.merchant_billing_refund_recoveries rr
        where rr.refund_id=r.id
      )
      and not (
        r.match_reason='refund_total_exceeds_original'
        and coalesce(r.original_payment_amount_cents,0)>0
      )
  ) then
    raise exception 'V1101_LINKED_REFUND_ALLOCATION_SOURCE_MISSING'
      using errcode='40001';
  end if;
end $$;

update public.merchant_billing_payment_refunds r
set recoverable_amount_cents=coalesce((
      select rr.amount_cents
      from public.merchant_billing_refund_recoveries rr
      where rr.refund_id=r.id
    ),0),
    excess_amount_cents=r.amount_cents-coalesce((
      select rr.amount_cents
      from public.merchant_billing_refund_recoveries rr
      where rr.refund_id=r.id
    ),0)
where r.payment_request_id is not null;

alter table public.merchant_billing_payment_refunds
  drop constraint if exists merchant_billing_payment_refunds_allocation_values_check,
  drop constraint if exists merchant_billing_payment_refunds_allocation_shape,
  drop constraint if exists merchant_billing_payment_refunds_resolution_allocation_check;

alter table public.merchant_billing_payment_refunds
  add constraint merchant_billing_payment_refunds_allocation_values_check
  check (
    (recoverable_amount_cents is null or recoverable_amount_cents>=0)
    and (excess_amount_cents is null or excess_amount_cents>=0)
  ),
  add constraint merchant_billing_payment_refunds_allocation_shape
  check (
    (
      payment_request_id is null
      and recoverable_amount_cents is null
      and excess_amount_cents is null
    )
    or
    (
      payment_request_id is not null
      and recoverable_amount_cents is not null
      and excess_amount_cents is not null
      and recoverable_amount_cents+excess_amount_cents=amount_cents
    )
  ),
  add constraint merchant_billing_payment_refunds_resolution_allocation_check
  check (
    (status<>'resolved_recovered' or recoverable_amount_cents>0)
    and (
      status<>'resolved_excess'
      or (
        recoverable_amount_cents=0
        and excess_amount_cents=amount_cents
      )
    )
  );

create or replace function public.derive_provider_refund_allocation_split()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_allocated_elsewhere bigint:=0;
  v_remaining bigint:=0;
  v_recoverable bigint:=0;
begin
  if new.payment_request_id is null then
    new.recoverable_amount_cents:=null;
    new.excess_amount_cents:=null;
    return new;
  end if;

  if new.merchant_id is null
     or new.original_payment_amount_cents is null
     or new.original_payment_amount_cents<=0 then
    raise exception 'REFUND_ALLOCATION_ORIGINAL_EXPOSURE_MISSING'
      using errcode='40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-recovery-exposure:'||new.payment_request_id::text,
      0
    )
  );

  select coalesce(sum(rr.amount_cents),0)
  into v_allocated_elsewhere
  from public.merchant_billing_refund_recoveries rr
  where rr.original_payment_request_id=new.payment_request_id
    and rr.refund_id is distinct from new.id;

  v_remaining:=greatest(
    new.original_payment_amount_cents-v_allocated_elsewhere,
    0
  );
  v_recoverable:=least(new.amount_cents,v_remaining);

  new.recoverable_amount_cents:=v_recoverable;
  new.excess_amount_cents:=new.amount_cents-v_recoverable;

  return new;
end;
$$;

revoke all on function public.derive_provider_refund_allocation_split()
from public,anon,authenticated;
grant execute on function public.derive_provider_refund_allocation_split()
to postgres,service_role;

drop trigger if exists derive_provider_refund_allocation_split_trg
on public.merchant_billing_payment_refunds;
create trigger derive_provider_refund_allocation_split_trg
before insert or update
on public.merchant_billing_payment_refunds
for each row execute function public.derive_provider_refund_allocation_split();

create or replace function public.guard_provider_refund_fact_immutable()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.provider is distinct from old.provider
     or new.provider_event_id is distinct from old.provider_event_id
     or new.original_reconciliation_key is distinct from old.original_reconciliation_key
     or new.refund_reconciliation_key is distinct from old.refund_reconciliation_key
     or new.amount_cents is distinct from old.amount_cents
     or new.currency is distinct from old.currency
     or new.occurred_at is distinct from old.occurred_at
     or new.raw_payload_sha256 is distinct from old.raw_payload_sha256 then
    raise exception 'PROVIDER_REFUND_FACT_IMMUTABLE' using errcode='23514';
  end if;

  -- Ingestion may enrich a previously unlinked immutable PSP fact exactly once.
  if old.status='review_required'
     and old.payment_event_id is null
     and old.payment_request_id is null
     and old.merchant_id is null
     and old.original_payment_amount_cents is null
     and old.cumulative_refunded_cents is null
     and old.recoverable_amount_cents is null
     and old.excess_amount_cents is null
     and old.match_reason='original_payment_not_found'
     and new.status='review_required'
     and new.resolved_at is null
     and new.resolved_by is null
     and new.resolution_reference is null then
    return new;
  end if;

  if new.payment_event_id is distinct from old.payment_event_id
     or new.payment_request_id is distinct from old.payment_request_id
     or new.merchant_id is distinct from old.merchant_id
     or new.original_payment_amount_cents is distinct from old.original_payment_amount_cents
     or new.cumulative_refunded_cents is distinct from old.cumulative_refunded_cents
     or new.recoverable_amount_cents is distinct from old.recoverable_amount_cents
     or new.excess_amount_cents is distinct from old.excess_amount_cents
     or new.match_reason is distinct from old.match_reason then
    raise exception 'PROVIDER_REFUND_FACT_IMMUTABLE' using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_provider_refund_fact_immutable()
from public,anon,authenticated;
grant execute on function public.guard_provider_refund_fact_immutable()
to postgres,service_role;

create or replace function public.require_refund_recovery_allocation_consistency()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_refund_id uuid;
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
begin
  v_refund_id:=case
    when tg_table_name='merchant_billing_payment_refunds'
      then nullif(to_jsonb(new)->>'id','')::uuid
    else nullif(to_jsonb(new)->>'refund_id','')::uuid
  end;

  select *
  into v_refund
  from public.merchant_billing_payment_refunds
  where id=v_refund_id;

  if not found then
    raise exception 'REFUND_ALLOCATION_REFUND_NOT_FOUND'
      using errcode='P0002';
  end if;

  select *
  into v_recovery
  from public.merchant_billing_refund_recoveries
  where refund_id=v_refund.id;

  if v_refund.payment_request_id is null then
    if found then
      raise exception 'REFUND_ALLOCATION_UNLINKED_HAS_RECOVERY'
        using errcode='23514';
    end if;
    return new;
  end if;

  if v_refund.recoverable_amount_cents is null
     or v_refund.excess_amount_cents is null
     or v_refund.recoverable_amount_cents+v_refund.excess_amount_cents
        <>v_refund.amount_cents then
    raise exception 'REFUND_ALLOCATION_SPLIT_INVALID'
      using errcode='23514';
  end if;

  if v_refund.recoverable_amount_cents>0 then
    if not found
       or v_recovery.merchant_id is distinct from v_refund.merchant_id
       or v_recovery.original_payment_request_id is distinct from v_refund.payment_request_id
       or v_recovery.amount_cents is distinct from v_refund.recoverable_amount_cents
       or v_recovery.currency is distinct from v_refund.currency then
      raise exception 'REFUND_ALLOCATION_RECOVERY_MISMATCH'
        using errcode='23514';
    end if;
  elsif found then
    raise exception 'REFUND_ALLOCATION_ZERO_EXPOSURE_HAS_RECOVERY'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.require_refund_recovery_allocation_consistency()
from public,anon,authenticated;
grant execute on function public.require_refund_recovery_allocation_consistency()
to postgres,service_role;

drop trigger if exists require_refund_allocation_consistency_on_refund_trg
on public.merchant_billing_payment_refunds;
create constraint trigger require_refund_allocation_consistency_on_refund_trg
after insert or update
on public.merchant_billing_payment_refunds
deferrable initially deferred
for each row execute function public.require_refund_recovery_allocation_consistency();

drop trigger if exists require_refund_allocation_consistency_on_recovery_trg
on public.merchant_billing_refund_recoveries;
create constraint trigger require_refund_allocation_consistency_on_recovery_trg
after insert or update
on public.merchant_billing_refund_recoveries
deferrable initially deferred
for each row execute function public.require_refund_recovery_allocation_consistency();
