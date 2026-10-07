-- TAMÃO — Prepaid plan transition policy v1.75
-- Keeps existing prepaid credit attached to coherent pricing terms:
-- same-plan top-ups and upgrades (lower/equal fee) are allowed;
-- downgrades wait until prior prepaid balance/reservations are exhausted.

create or replace function public.validate_billing_package_request_transition()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_account public.merchant_billing_accounts%rowtype;
  v_current public.merchant_billing_plans%rowtype;
  v_target public.merchant_billing_plans%rowtype;
begin
  if new.request_kind<>'package_purchase' then
    return new;
  end if;

  select *
  into v_target
  from public.merchant_billing_plans
  where plan_key=new.plan_key
    and active
    and billing_mode='prepaid_credit';

  if not found then
    raise exception 'INVALID_PREPAID_PLAN' using errcode='22023';
  end if;

  select *
  into v_account
  from public.merchant_billing_accounts
  where merchant_id=new.merchant_id
  for update;

  if not found
     or (coalesce(v_account.credit_balance_cents,0)=0
         and coalesce(v_account.credit_reserved_cents,0)=0)
     or v_account.plan_key=v_target.plan_key then
    return new;
  end if;

  select *
  into v_current
  from public.merchant_billing_plans
  where plan_key=v_account.plan_key;

  if found
     and v_current.billing_mode='prepaid_credit'
     and v_target.platform_fee_bps>v_current.platform_fee_bps then
    raise exception 'PREPAID_PLAN_DOWNGRADE_WITH_ACTIVE_CREDIT'
      using errcode='40001';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_billing_package_request_transition()
from public, anon, authenticated;
grant execute on function public.validate_billing_package_request_transition()
to postgres, service_role;

drop trigger if exists validate_billing_package_request_transition_trg
on public.merchant_billing_payment_requests;
create trigger validate_billing_package_request_transition_trg
before insert or update of plan_key
on public.merchant_billing_payment_requests
for each row execute function public.validate_billing_package_request_transition();

create or replace function public.enforce_billing_account_plan_transition()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_current public.merchant_billing_plans%rowtype;
  v_target public.merchant_billing_plans%rowtype;
begin
  if new.plan_key is not distinct from old.plan_key then
    return new;
  end if;

  select * into v_target
  from public.merchant_billing_plans
  where plan_key=new.plan_key;

  if not found then
    raise exception 'INVALID_BILLING_PLAN' using errcode='22023';
  end if;

  if v_target.billing_mode='postpaid_daily'
     and (coalesce(new.credit_balance_cents,0)>0
          or coalesce(new.credit_reserved_cents,0)>0) then
    raise exception 'PREPAID_CREDIT_STILL_AVAILABLE'
      using errcode='40001';
  end if;

  select * into v_current
  from public.merchant_billing_plans
  where plan_key=old.plan_key;

  if found
     and v_current.billing_mode='prepaid_credit'
     and v_target.billing_mode='prepaid_credit'
     and (coalesce(old.credit_balance_cents,0)>0
          or coalesce(old.credit_reserved_cents,0)>0)
     and v_target.platform_fee_bps>v_current.platform_fee_bps then
    raise exception 'PREPAID_PLAN_DOWNGRADE_WITH_ACTIVE_CREDIT'
      using errcode='40001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_billing_account_plan_transition()
from public, anon, authenticated;
grant execute on function public.enforce_billing_account_plan_transition()
to postgres, service_role;

drop trigger if exists enforce_billing_account_plan_transition_trg
on public.merchant_billing_accounts;
create trigger enforce_billing_account_plan_transition_trg
before update of plan_key,credit_balance_cents,credit_reserved_cents
on public.merchant_billing_accounts
for each row execute function public.enforce_billing_account_plan_transition();
