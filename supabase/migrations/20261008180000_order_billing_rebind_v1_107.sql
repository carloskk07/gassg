-- TAMÃO — Order billing snapshot rebind v1.107
-- Financial responsibility follows the merchant that will actually fulfill
-- the order. Before dispatch, changing merchant_id or gross_total_cents
-- atomically releases the old prepaid fee reservation, recalculates the
-- merchant-specific billing snapshot, and reserves the new exact amount.
-- Isolated edits to fee/plan/reservation snapshots are rejected.

create or replace function public.rebind_order_billing_snapshot()
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
  v_package_fee integer:=0;
  v_flex_fee integer:=0;
  v_available bigint:=0;
  v_reservation integer:=0;
  v_basis_changed boolean:=
    new.merchant_id is distinct from old.merchant_id
    or new.gross_total_cents is distinct from old.gross_total_cents;
  v_snapshot_changed boolean:=
    new.platform_fee_bps_snapshot is distinct from old.platform_fee_bps_snapshot
    or new.billing_plan_key_snapshot is distinct from old.billing_plan_key_snapshot
    or new.prepaid_fee_reserved_cents_snapshot
       is distinct from old.prepaid_fee_reserved_cents_snapshot;
begin
  if not v_basis_changed then
    if v_snapshot_changed then
      raise exception 'ORDER_BILLING_SNAPSHOT_IMMUTABLE'
        using errcode='23514';
    end if;
    return new;
  end if;

  if old.financial_state<>'pending'
     or old.status in ('CANCELLED','SETTLED')
     or old.dispatched_at is not null
     or old.delivered_at is not null
     or old.settled_at is not null
     or old.prepaid_fee_credit_consumed_at is not null
     or old.prepaid_fee_credit_released_at is not null then
    raise exception 'ORDER_BILLING_REBIND_TOO_LATE'
      using errcode='40001';
  end if;

  -- Match settlement's merchant-fee-credit lock namespace and acquire
  -- two-merchant moves in deterministic UUID-text order to avoid deadlocks.
  if old.merchant_id is not null
     and new.merchant_id is not null
     and old.merchant_id is distinct from new.merchant_id then
    if old.merchant_id::text<new.merchant_id::text then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'merchant-fee-credit:'||old.merchant_id::text,0
        )
      );
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'merchant-fee-credit:'||new.merchant_id::text,0
        )
      );
    else
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'merchant-fee-credit:'||new.merchant_id::text,0
        )
      );
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'merchant-fee-credit:'||old.merchant_id::text,0
        )
      );
    end if;
  elsif coalesce(new.merchant_id,old.merchant_id) is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'merchant-fee-credit:'
        ||coalesce(new.merchant_id,old.merchant_id)::text,
        0
      )
    );
  end if;

  if old.prepaid_fee_reserved_cents_snapshot>0 then
    if old.merchant_id is null then
      raise exception 'PREPAID_FEE_RESERVATION_OWNER_MISSING'
        using errcode='40001';
    end if;

    update public.merchant_billing_accounts
    set credit_reserved_cents=
          credit_reserved_cents-old.prepaid_fee_reserved_cents_snapshot,
        updated_at=clock_timestamp()
    where merchant_id=old.merchant_id
      and credit_reserved_cents>=old.prepaid_fee_reserved_cents_snapshot;

    if not found then
      raise exception 'PREPAID_FEE_RESERVATION_INCONSISTENT'
        using errcode='40001';
    end if;
  end if;

  new.prepaid_fee_reserved_cents_snapshot:=0;
  new.prepaid_fee_credit_applied_cents:=0;
  new.prepaid_fee_credit_consumed_at:=null;
  new.prepaid_fee_credit_released_at:=null;

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
    new.billing_plan_key_snapshot:=null;
    return new;
  end if;

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

  if not found then
    raise exception 'MERCHANT_BILLING_ACCOUNT_MISSING'
      using errcode='55000';
  end if;

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

  if not found then
    raise exception 'FLEX_BILLING_PLAN_MISSING' using errcode='55000';
  end if;

  if v_plan.plan_key is null then
    v_plan:=v_flex;
  end if;

  if v_plan.billing_mode='prepaid_credit' then
    v_package_fee:=floor(
      (new.gross_total_cents::numeric*v_plan.platform_fee_bps)/10000
    )::integer;
    v_available:=greatest(
      v_account.credit_balance_cents-v_account.credit_reserved_cents,
      0
    );

    if v_package_fee>0 and v_available>=v_package_fee then
      new.platform_fee_bps_snapshot:=v_plan.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_plan.plan_key;
      v_reservation:=v_package_fee;
    elsif v_available>0 then
      v_flex_fee:=floor(
        (new.gross_total_cents::numeric*v_flex.platform_fee_bps)/10000
      )::integer;
      new.platform_fee_bps_snapshot:=v_flex.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_flex.plan_key;
      v_reservation:=least(v_flex_fee,v_available)::integer;
    else
      new.platform_fee_bps_snapshot:=v_flex.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_flex.plan_key;
    end if;
  else
    new.platform_fee_bps_snapshot:=v_plan.platform_fee_bps;
    new.billing_plan_key_snapshot:=v_plan.plan_key;
  end if;

  if v_reservation>0 then
    update public.merchant_billing_accounts
    set credit_reserved_cents=credit_reserved_cents+v_reservation,
        updated_at=clock_timestamp()
    where merchant_id=new.merchant_id
      and credit_balance_cents-credit_reserved_cents>=v_reservation;

    if not found then
      raise exception 'PREPAID_FEE_RESERVATION_RACE'
        using errcode='40001';
    end if;

    new.prepaid_fee_reserved_cents_snapshot:=v_reservation;
  end if;

  return new;
end;
$$;

revoke all on function public.rebind_order_billing_snapshot()
from public,anon,authenticated;
grant execute on function public.rebind_order_billing_snapshot()
to postgres,service_role;

drop trigger if exists rebind_order_billing_snapshot_before_update
on public.orders;
create trigger rebind_order_billing_snapshot_before_update
before update of
  merchant_id,gross_total_cents,
  platform_fee_bps_snapshot,billing_plan_key_snapshot,
  prepaid_fee_reserved_cents_snapshot
on public.orders
for each row execute function public.rebind_order_billing_snapshot();

create or replace function public.audit_order_billing_snapshot_rebind()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.merchant_id is distinct from old.merchant_id
     or new.gross_total_cents is distinct from old.gross_total_cents then
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      new.id,null,'system','BILLING_SNAPSHOT_REBOUND',
      'Cobrança recalculada para a revenda atual',
      'O snapshot financeiro foi recalculado porque a revenda ou o valor bruto do pedido mudou antes da saída.',
      jsonb_build_object(
        'oldMerchantId',old.merchant_id,
        'newMerchantId',new.merchant_id,
        'oldGrossTotalCents',old.gross_total_cents,
        'newGrossTotalCents',new.gross_total_cents,
        'oldBillingPlanKey',old.billing_plan_key_snapshot,
        'newBillingPlanKey',new.billing_plan_key_snapshot,
        'oldPlatformFeeBps',old.platform_fee_bps_snapshot,
        'newPlatformFeeBps',new.platform_fee_bps_snapshot,
        'oldReservedCents',old.prepaid_fee_reserved_cents_snapshot,
        'newReservedCents',new.prepaid_fee_reserved_cents_snapshot
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_order_billing_snapshot_rebind()
from public,anon,authenticated;
grant execute on function public.audit_order_billing_snapshot_rebind()
to postgres,service_role;

drop trigger if exists audit_order_billing_snapshot_rebind_after_update
on public.orders;
create trigger audit_order_billing_snapshot_rebind_after_update
after update of merchant_id,gross_total_cents
on public.orders
for each row execute function public.audit_order_billing_snapshot_rebind();
