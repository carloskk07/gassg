-- TAMÃO — Merchant fee-credit balance equation v1.111
-- Converts the reconciliation checks for prepaid fee credit into commit-time
-- structural invariants:
--
--   credit_balance_cents =
--     package_credit + fee_consumption + fee_reversal_credit + admin_adjustment
--
--   credit_reserved_cents =
--     sum(prepaid_fee_reserved_cents_snapshot) for live, unconsumed,
--     unreleased, non-cancelled orders.
--
-- reservation_release is intentionally excluded from the balance equation,
-- matching the canonical admin reconciliation authority.

create or replace function public.merchant_fee_credit_expected_balance(
  p_merchant_id uuid
)
returns bigint
language sql
security definer
set search_path=pg_catalog
as $function$
  select coalesce(
    sum(
      case
        when l.entry_type in (
          'package_credit',
          'fee_consumption',
          'fee_reversal_credit',
          'admin_adjustment'
        )
          then l.amount_cents
        else 0
      end
    ),
    0
  )::bigint
  from public.merchant_fee_credit_ledger l
  where l.merchant_id=p_merchant_id;
$function$;

revoke all on function public.merchant_fee_credit_expected_balance(uuid)
from public,anon,authenticated;
grant execute on function public.merchant_fee_credit_expected_balance(uuid)
to postgres,service_role;

create or replace function public.merchant_fee_credit_expected_reserved(
  p_merchant_id uuid
)
returns bigint
language sql
security definer
set search_path=pg_catalog
as $function$
  select coalesce(sum(o.prepaid_fee_reserved_cents_snapshot),0)::bigint
  from public.orders o
  where o.merchant_id=p_merchant_id
    and o.prepaid_fee_reserved_cents_snapshot>0
    and o.prepaid_fee_credit_consumed_at is null
    and o.prepaid_fee_credit_released_at is null
    and o.status<>'CANCELLED';
$function$;

revoke all on function public.merchant_fee_credit_expected_reserved(uuid)
from public,anon,authenticated;
grant execute on function public.merchant_fee_credit_expected_reserved(uuid)
to postgres,service_role;

create or replace function public.assert_merchant_fee_credit_account_equation(
  p_merchant_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_account public.merchant_billing_accounts%rowtype;
  v_expected_balance bigint;
  v_expected_reserved bigint;
begin
  if p_merchant_id is null then
    return;
  end if;

  v_expected_balance:=
    public.merchant_fee_credit_expected_balance(p_merchant_id);
  v_expected_reserved:=
    public.merchant_fee_credit_expected_reserved(p_merchant_id);

  select *
  into v_account
  from public.merchant_billing_accounts
  where merchant_id=p_merchant_id;

  if not found then
    if v_expected_balance=0 and v_expected_reserved=0 then
      return;
    end if;

    raise exception 'MERCHANT_FEE_CREDIT_ACCOUNT_MISSING:%:%:%',
      p_merchant_id,v_expected_balance,v_expected_reserved
      using errcode='23514';
  end if;

  if v_expected_balance<0
     or v_expected_reserved<0
     or v_expected_reserved>v_expected_balance then
    raise exception 'MERCHANT_FEE_CREDIT_EQUATION_RANGE:%:%:%',
      p_merchant_id,v_expected_balance,v_expected_reserved
      using errcode='23514';
  end if;

  if v_account.credit_balance_cents is distinct from v_expected_balance
     or v_account.credit_reserved_cents is distinct from v_expected_reserved then
    raise exception 'MERCHANT_FEE_CREDIT_EQUATION_MISMATCH:%:%:%:%:%',
      p_merchant_id,
      v_account.credit_balance_cents,
      v_expected_balance,
      v_account.credit_reserved_cents,
      v_expected_reserved
      using errcode='23514';
  end if;
end;
$function$;

revoke all on function public.assert_merchant_fee_credit_account_equation(uuid)
from public,anon,authenticated;
grant execute on function public.assert_merchant_fee_credit_account_equation(uuid)
to postgres,service_role;

create or replace function public.require_merchant_fee_credit_account_equation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_old_merchant uuid;
  v_new_merchant uuid;
begin
  if tg_op<>'INSERT' then
    v_old:=to_jsonb(old);
    v_old_merchant:=nullif(v_old->>'merchant_id','')::uuid;
  end if;

  if tg_op<>'DELETE' then
    v_new:=to_jsonb(new);
    v_new_merchant:=nullif(v_new->>'merchant_id','')::uuid;
  end if;

  if tg_op='UPDATE' then
    if tg_table_name='merchant_billing_accounts'
       and (v_old->>'credit_balance_cents')
           is not distinct from (v_new->>'credit_balance_cents')
       and (v_old->>'credit_reserved_cents')
           is not distinct from (v_new->>'credit_reserved_cents')
       and v_old_merchant is not distinct from v_new_merchant then
      return new;

    elsif tg_table_name='merchant_fee_credit_ledger'
       and (v_old->>'entry_type')
           is not distinct from (v_new->>'entry_type')
       and (v_old->>'amount_cents')
           is not distinct from (v_new->>'amount_cents')
       and v_old_merchant is not distinct from v_new_merchant then
      return new;

    elsif tg_table_name='orders'
       and (v_old->>'prepaid_fee_reserved_cents_snapshot')
           is not distinct from (v_new->>'prepaid_fee_reserved_cents_snapshot')
       and (v_old->>'prepaid_fee_credit_consumed_at')
           is not distinct from (v_new->>'prepaid_fee_credit_consumed_at')
       and (v_old->>'prepaid_fee_credit_released_at')
           is not distinct from (v_new->>'prepaid_fee_credit_released_at')
       and (v_old->>'status')
           is not distinct from (v_new->>'status')
       and v_old_merchant is not distinct from v_new_merchant then
      return new;
    end if;
  end if;

  if v_old_merchant is not null then
    perform public.assert_merchant_fee_credit_account_equation(v_old_merchant);
  end if;

  if v_new_merchant is not null
     and v_new_merchant is distinct from v_old_merchant then
    perform public.assert_merchant_fee_credit_account_equation(v_new_merchant);
  elsif tg_op='INSERT' and v_new_merchant is not null then
    perform public.assert_merchant_fee_credit_account_equation(v_new_merchant);
  end if;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

revoke all on function public.require_merchant_fee_credit_account_equation()
from public,anon,authenticated;
grant execute on function public.require_merchant_fee_credit_account_equation()
to postgres,service_role;

drop trigger if exists require_merchant_fee_credit_equation_on_account_trg
on public.merchant_billing_accounts;
create constraint trigger require_merchant_fee_credit_equation_on_account_trg
after insert or update or delete
on public.merchant_billing_accounts
deferrable initially deferred
for each row execute function public.require_merchant_fee_credit_account_equation();

drop trigger if exists require_merchant_fee_credit_equation_on_ledger_trg
on public.merchant_fee_credit_ledger;
create constraint trigger require_merchant_fee_credit_equation_on_ledger_trg
after insert or update or delete
on public.merchant_fee_credit_ledger
deferrable initially deferred
for each row execute function public.require_merchant_fee_credit_account_equation();

drop trigger if exists require_merchant_fee_credit_equation_on_order_trg
on public.orders;
create constraint trigger require_merchant_fee_credit_equation_on_order_trg
after insert or update or delete
on public.orders
deferrable initially deferred
for each row execute function public.require_merchant_fee_credit_account_equation();

-- Existing production state must already agree with both canonical equations.
-- This intentionally fails closed before the migration can be accepted.
do $function$
declare
  v_merchant_id uuid;
begin
  for v_merchant_id in
    select distinct merchant_id
    from (
      select a.merchant_id
      from public.merchant_billing_accounts a

      union

      select l.merchant_id
      from public.merchant_fee_credit_ledger l

      union

      select o.merchant_id
      from public.orders o
      where o.merchant_id is not null
        and o.prepaid_fee_reserved_cents_snapshot>0
        and o.prepaid_fee_credit_consumed_at is null
        and o.prepaid_fee_credit_released_at is null
        and o.status<>'CANCELLED'
    ) x
    where merchant_id is not null
    order by merchant_id
  loop
    begin
      perform public.assert_merchant_fee_credit_account_equation(v_merchant_id);
    exception
      when others then
        raise exception 'MERCHANT_FEE_CREDIT_EXISTING_DRIFT:%:%',
          v_merchant_id,sqlerrm
          using errcode='23514';
    end;
  end loop;
end;
$function$;
