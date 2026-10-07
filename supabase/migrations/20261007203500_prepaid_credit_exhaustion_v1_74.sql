-- TAMÃO — Prepaid credit exhaustion v1.74
-- Uses every remaining cent of fee credit on the last discounted order and
-- automatically returns the merchant to Flex once all prepaid credit/reservations are exhausted.

create or replace function public.snapshot_order_economics()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_policy public.reward_policy%rowtype;
  v_account public.merchant_billing_accounts%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_flex public.merchant_billing_plans%rowtype;
  v_projected_fee integer:=0;
  v_available bigint:=0;
  v_reservation integer:=0;
begin
  select *
  into v_policy
  from public.reward_policy
  where policy_key='default'
  for share;

  if not found then
    raise exception 'FINANCIAL_POLICY_MISSING' using errcode='55000';
  end if;

  if not v_policy.active then
    new.platform_fee_bps_snapshot:=0;
    new.variable_cost_bps_snapshot:=0;
    new.minimum_contribution_bps_snapshot:=0;
    new.cashback_bps_snapshot:=0;
    new.referral_bps_snapshot:=0;
    new.commission_hold_hours_snapshot:=0;
    new.billing_plan_key_snapshot:=null;
    new.prepaid_fee_reserved_cents_snapshot:=0;
    return new;
  end if;

  new.variable_cost_bps_snapshot:=v_policy.variable_cost_bps;
  new.minimum_contribution_bps_snapshot:=v_policy.minimum_contribution_bps;
  new.cashback_bps_snapshot:=v_policy.cashback_bps;
  new.referral_bps_snapshot:=v_policy.direct_referral_bps;
  new.commission_hold_hours_snapshot:=v_policy.commission_hold_hours;
  new.prepaid_fee_reserved_cents_snapshot:=0;

  if new.merchant_id is null then
    new.platform_fee_bps_snapshot:=v_policy.platform_fee_bps;
    new.billing_plan_key_snapshot:='legacy_default';
    return new;
  end if;

  insert into public.merchant_billing_accounts(merchant_id,plan_key)
  values(new.merchant_id,'flex_daily')
  on conflict(merchant_id) do nothing;

  select *
  into v_account
  from public.merchant_billing_accounts
  where merchant_id=new.merchant_id
  for update;

  select *
  into v_plan
  from public.merchant_billing_plans
  where plan_key=v_account.plan_key
    and active;

  select *
  into v_flex
  from public.merchant_billing_plans
  where plan_key='flex_daily'
    and active;

  if v_flex.plan_key is null then
    raise exception 'FLEX_BILLING_PLAN_MISSING' using errcode='55000';
  end if;

  if v_plan.plan_key is null then
    v_plan:=v_flex;
  end if;

  if v_plan.billing_mode='prepaid_credit' then
    v_projected_fee:=floor(
      (new.gross_total_cents::numeric*v_plan.platform_fee_bps)/10000
    )::integer;
    v_available:=greatest(
      v_account.credit_balance_cents-v_account.credit_reserved_cents,
      0
    );

    if v_projected_fee>0 and v_available>0 then
      v_reservation:=least(v_projected_fee,v_available)::integer;
      new.platform_fee_bps_snapshot:=v_plan.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_plan.plan_key;
      new.prepaid_fee_reserved_cents_snapshot:=v_reservation;

      update public.merchant_billing_accounts
      set credit_reserved_cents=credit_reserved_cents+v_reservation,
          updated_at=clock_timestamp()
      where merchant_id=new.merchant_id;
    else
      new.platform_fee_bps_snapshot:=v_flex.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_flex.plan_key;
    end if;
  else
    new.platform_fee_bps_snapshot:=v_plan.platform_fee_bps;
    new.billing_plan_key_snapshot:=v_plan.plan_key;
  end if;

  return new;
end;
$$;

revoke all on function public.snapshot_order_economics()
from public, anon, authenticated;
grant execute on function public.snapshot_order_economics()
to postgres, service_role;

create or replace function public.ensure_order_settlement_accounting(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_platform_fee integer:=0;
  v_credit_applied integer:=0;
  v_due_at timestamptz;
begin
  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.financial_reversed_at is not null
     or v_order.merchant_id is null
     or v_order.payment_confirmed_at is null
     or v_order.delivered_at is null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING' using errcode='40001';
  end if;

  v_platform_fee:=floor(
    (v_order.gross_total_cents::numeric*v_order.platform_fee_bps_snapshot)/10000
  )::integer;

  if v_order.prepaid_fee_reserved_cents_snapshot>0
     and v_order.prepaid_fee_credit_consumed_at is null
     and v_order.prepaid_fee_credit_released_at is null then

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-fee-credit:'||v_order.merchant_id::text,0)
    );

    update public.merchant_billing_accounts
    set plan_key=case
          when credit_balance_cents-v_order.prepaid_fee_reserved_cents_snapshot=0
           and greatest(credit_reserved_cents-v_order.prepaid_fee_reserved_cents_snapshot,0)=0
            then 'flex_daily'
          else plan_key
        end,
        credit_balance_cents=credit_balance_cents-v_order.prepaid_fee_reserved_cents_snapshot,
        credit_reserved_cents=greatest(
          credit_reserved_cents-v_order.prepaid_fee_reserved_cents_snapshot,
          0
        ),
        updated_at=clock_timestamp()
    where merchant_id=v_order.merchant_id
      and credit_balance_cents>=v_order.prepaid_fee_reserved_cents_snapshot
      and credit_reserved_cents>=v_order.prepaid_fee_reserved_cents_snapshot;

    if found then
      v_credit_applied:=least(
        v_order.prepaid_fee_reserved_cents_snapshot,
        v_platform_fee
      );

      update public.orders
      set prepaid_fee_credit_applied_cents=v_credit_applied,
          prepaid_fee_credit_consumed_at=clock_timestamp()
      where id=v_order.id;

      insert into public.merchant_fee_credit_ledger(
        merchant_id,order_id,entry_type,amount_cents,plan_key,reference
      )
      values(
        v_order.merchant_id,v_order.id,'fee_consumption',
        -v_credit_applied,v_order.billing_plan_key_snapshot,
        'order-settlement:'||v_order.public_code
      );
    else
      raise exception 'PREPAID_FEE_RESERVATION_INCONSISTENT' using errcode='40001';
    end if;
  end if;

  v_due_at:=(
    (
      (
        coalesce(
          v_order.settled_at,
          v_order.payment_confirmed_at,
          v_order.delivered_at,
          clock_timestamp()
        ) at time zone 'America/Sao_Paulo'
      )::date + 2
    )::timestamp at time zone 'America/Sao_Paulo'
  )-interval '1 second';

  insert into public.platform_receivables(
    order_id,merchant_id,gross_total_cents,
    platform_fee_bps,platform_fee_cents,status,due_at,
    prepaid_credit_applied_cents
  )
  values(
    v_order.id,v_order.merchant_id,v_order.gross_total_cents,
    v_order.platform_fee_bps_snapshot,v_platform_fee,
    'open',v_due_at,v_credit_applied
  )
  on conflict(order_id) do nothing;

  if v_order.cashback_reserved_cents>0 then
    insert into public.merchant_cashback_reimbursements(
      order_id,merchant_id,cashback_cents,status,due_at
    )
    values(
      v_order.id,v_order.merchant_id,v_order.cashback_reserved_cents,
      'open',v_due_at
    )
    on conflict(order_id) do nothing;
  end if;

  update public.settlement_accounting_failures
  set resolved_at=clock_timestamp(),
      next_retry_at=null,
      dead_lettered_at=null,
      updated_at=clock_timestamp()
  where order_id=v_order.id
    and resolved_at is null;

  return jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'billingPlanKey',v_order.billing_plan_key_snapshot,
    'platformFeeCents',v_platform_fee,
    'prepaidCreditAppliedCents',v_credit_applied,
    'postpaidDueCents',greatest(v_platform_fee-v_credit_applied,0),
    'cashbackReimbursementCents',v_order.cashback_reserved_cents,
    'dueAt',v_due_at
  );
end;
$$;

revoke all on function public.ensure_order_settlement_accounting(uuid)
from public, anon, authenticated;
grant execute on function public.ensure_order_settlement_accounting(uuid)
to postgres, service_role;
