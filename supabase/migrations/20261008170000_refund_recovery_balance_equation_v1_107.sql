-- TAMÃO — Refund recovery balance equation v1.107
-- Proves the mutable recovery balance from immutable/append-only evidence:
--   outstanding = historical allocation
--               - approved recovery-payment requests
--               + provider refunds of those recovery payments.
-- Any committed drift, overpayment or over-reopen is rejected.

create or replace function public.refund_recovery_expected_outstanding(
  p_recovery_id uuid
)
returns bigint
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_approved bigint:=0;
  v_reopened bigint:=0;
begin
  select *
  into v_recovery
  from public.merchant_billing_refund_recoveries
  where id=p_recovery_id;

  if not found then
    raise exception 'REFUND_RECOVERY_NOT_FOUND'
      using errcode='P0002';
  end if;

  select coalesce(sum(r.expected_amount_cents),0)
  into v_approved
  from public.merchant_billing_payment_requests r
  where r.request_kind='refund_recovery'
    and r.refund_recovery_id=v_recovery.id
    and r.status='approved';

  select coalesce(sum(f.recoverable_amount_cents),0)
  into v_reopened
  from public.merchant_billing_payment_refunds f
  where f.reopened_refund_recovery_id=v_recovery.id
    and f.status='resolved_recovery_reopened'
    and f.recoverable_amount_cents is not null;

  return v_recovery.amount_cents-v_approved+v_reopened;
end;
$function$;

revoke all on function public.refund_recovery_expected_outstanding(uuid)
from public,anon,authenticated;
grant execute on function public.refund_recovery_expected_outstanding(uuid)
to postgres,service_role;

create or replace function public.require_refund_recovery_balance_equation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_recovery_id uuid;
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_expected bigint;
  v_approved bigint:=0;
  v_reopened bigint:=0;
begin
  if tg_table_name='merchant_billing_refund_recoveries' then
    v_recovery_id:=case when tg_op='DELETE' then old.id else new.id end;

  elsif tg_table_name='merchant_billing_payment_requests' then
    v_recovery_id:=case
      when tg_op='DELETE' then old.refund_recovery_id
      else new.refund_recovery_id
    end;

    if v_recovery_id is null then
      if tg_op='DELETE' then return old; else return new; end if;
    end if;

  elsif tg_table_name='merchant_billing_payment_refunds' then
    v_recovery_id:=case
      when tg_op='DELETE' then old.reopened_refund_recovery_id
      else new.reopened_refund_recovery_id
    end;

    if v_recovery_id is null then
      if tg_op='DELETE' then return old; else return new; end if;
    end if;

  else
    raise exception 'REFUND_RECOVERY_BALANCE_UNSUPPORTED_TRIGGER_TABLE:%',
      tg_table_name
      using errcode='23514';
  end if;

  select *
  into v_recovery
  from public.merchant_billing_refund_recoveries
  where id=v_recovery_id;

  if not found then
    -- Deleting a recovery is already prohibited by the immutable-fact guard.
    -- For any other path, a referenced recovery must still exist at COMMIT.
    if tg_table_name='merchant_billing_refund_recoveries'
       and tg_op='DELETE' then
      if tg_op='DELETE' then return old; else return new; end if;
    end if;

    raise exception 'REFUND_RECOVERY_BALANCE_RECOVERY_MISSING'
      using errcode='23514';
  end if;

  select coalesce(sum(r.expected_amount_cents),0)
  into v_approved
  from public.merchant_billing_payment_requests r
  where r.request_kind='refund_recovery'
    and r.refund_recovery_id=v_recovery.id
    and r.status='approved';

  select coalesce(sum(f.recoverable_amount_cents),0)
  into v_reopened
  from public.merchant_billing_payment_refunds f
  where f.reopened_refund_recovery_id=v_recovery.id
    and f.status='resolved_recovery_reopened'
    and f.recoverable_amount_cents is not null;

  v_expected:=v_recovery.amount_cents-v_approved+v_reopened;

  if v_expected<0 or v_expected>v_recovery.amount_cents then
    raise exception 'REFUND_RECOVERY_BALANCE_EQUATION_RANGE:%:%:%:%',
      v_recovery.amount_cents,v_approved,v_reopened,v_expected
      using errcode='23514';
  end if;

  if v_recovery.outstanding_cents is distinct from v_expected then
    raise exception 'REFUND_RECOVERY_BALANCE_EQUATION_MISMATCH:%:%:%:%:%',
      v_recovery.amount_cents,
      v_approved,
      v_reopened,
      v_recovery.outstanding_cents,
      v_expected
      using errcode='23514';
  end if;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

revoke all on function public.require_refund_recovery_balance_equation()
from public,anon,authenticated;
grant execute on function public.require_refund_recovery_balance_equation()
to postgres,service_role;

drop trigger if exists require_refund_recovery_balance_on_recovery_trg
on public.merchant_billing_refund_recoveries;
create constraint trigger require_refund_recovery_balance_on_recovery_trg
after insert or update
on public.merchant_billing_refund_recoveries
deferrable initially deferred
for each row execute function public.require_refund_recovery_balance_equation();

drop trigger if exists require_refund_recovery_balance_on_request_trg
on public.merchant_billing_payment_requests;
create constraint trigger require_refund_recovery_balance_on_request_trg
after insert or update or delete
on public.merchant_billing_payment_requests
deferrable initially deferred
for each row execute function public.require_refund_recovery_balance_equation();

drop trigger if exists require_refund_recovery_balance_on_refund_trg
on public.merchant_billing_payment_refunds;
create constraint trigger require_refund_recovery_balance_on_refund_trg
after insert or update or delete
on public.merchant_billing_payment_refunds
deferrable initially deferred
for each row execute function public.require_refund_recovery_balance_equation();

-- Existing rows must already satisfy the equation before this migration can
-- be considered valid. This is intentionally fail-closed.
do $function$
declare
  v_bad public.merchant_billing_refund_recoveries%rowtype;
  v_expected bigint;
begin
  for v_bad in
    select *
    from public.merchant_billing_refund_recoveries
    order by id
  loop
    v_expected:=public.refund_recovery_expected_outstanding(v_bad.id);

    if v_expected<0
       or v_expected>v_bad.amount_cents
       or v_bad.outstanding_cents is distinct from v_expected then
      raise exception 'REFUND_RECOVERY_EXISTING_BALANCE_DRIFT:%:%:%',
        v_bad.id,v_bad.outstanding_cents,v_expected
        using errcode='23514';
    end if;
  end loop;
end;
$function$;
