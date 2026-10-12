-- V1.158.3 — order settlement / daily billing invariants
-- Requires migrations V1.158.1 and V1.158.2.
-- Writer and validators disagreed on due_at (São Paulo D+1 close vs settled_at + 7 days).
-- This migration changes no historical fact and does not issue any charge.
-- Authority shared by settlement writer and both immutable financial-fact validators.
-- Due at 23:59:59 (São Paulo) on the day after the business day of settlement.
create or replace function public.merchant_settlement_daily_due_at(p_settled_at timestamptz)
returns timestamptz
language sql stable
set search_path to pg_catalog
as $func$
  select case when p_settled_at is null then null::timestamptz
    else (
      (((p_settled_at at time zone 'America/Sao_Paulo')::date+2)::timestamp
        at time zone 'America/Sao_Paulo')
      -interval '1 second'
    )
  end;
$func$;
revoke all on function public.merchant_settlement_daily_due_at(timestamptz) from public,anon,authenticated;
grant execute on function public.merchant_settlement_daily_due_at(timestamptz) to service_role;


CREATE OR REPLACE FUNCTION public.ensure_order_settlement_accounting(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
     or v_order.delivered_at is null
     or v_order.settled_at is null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING' using errcode='40001';
  end if;

  v_credit_applied:=v_order.prepaid_fee_credit_applied_cents;

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
        -v_credit_applied,v_order.prepaid_fee_credit_source_plan_key_snapshot,
        'order-settlement:'||v_order.public_code
      );
    else
      raise exception 'PREPAID_FEE_RESERVATION_INCONSISTENT' using errcode='40001';
    end if;
  end if;

  v_due_at:=public.merchant_settlement_daily_due_at(v_order.settled_at);

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

  -- A replay must neither charge again nor return a fictional zero-credit payment.
  -- The receivable is keyed by order_id; verify the idempotent result matches
  -- the already approved and immutable order snapshot.
  if not exists(
    select 1 from public.platform_receivables pr
    where pr.order_id=v_order.id
      and pr.merchant_id=v_order.merchant_id
      and pr.gross_total_cents=v_order.gross_total_cents
      and pr.platform_fee_bps=v_order.platform_fee_bps_snapshot
      and pr.platform_fee_cents=v_platform_fee
      and pr.due_at=v_due_at
      and pr.prepaid_credit_applied_cents=v_credit_applied
  ) then
    raise exception 'SETTLEMENT_RECEIVABLE_SNAPSHOT_CONFLICT'
      using errcode='23514';
  end if;

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
    'prepaidCreditSourcePlanKey',v_order.prepaid_fee_credit_source_plan_key_snapshot,
    'postpaidDueCents',greatest(v_platform_fee-v_credit_applied,0),
    'cashbackReimbursementCents',v_order.cashback_reserved_cents,
    'dueAt',v_due_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_platform_receivable_fact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_expected_fee integer;
  v_expected_due timestamptz;
begin
  if tg_op='UPDATE' and (
    new.order_id is distinct from old.order_id
    or new.merchant_id is distinct from old.merchant_id
    or new.gross_total_cents is distinct from old.gross_total_cents
    or new.platform_fee_bps is distinct from old.platform_fee_bps
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.due_at is distinct from old.due_at
    or new.prepaid_credit_applied_cents is distinct from old.prepaid_credit_applied_cents
  ) then
    raise exception 'FINANCIAL_FACT_IMMUTABLE' using errcode='23514';
  end if;

  if tg_op='INSERT' then
    select * into v_order
    from public.orders
    where id=new.order_id
    for share;

    if not found then
      raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
    end if;

    if v_order.status<>'SETTLED'
       or v_order.financial_state<>'settled'
       or v_order.financial_reversed_at is not null
       or v_order.merchant_id is null
       or v_order.settled_at is null
       or v_order.payment_confirmed_at is null
       or v_order.delivered_at is null then
      raise exception 'ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING' using errcode='40001';
    end if;

    v_expected_fee:=floor(
      (v_order.gross_total_cents::numeric*v_order.platform_fee_bps_snapshot)/10000
    )::integer;
    v_expected_due:=public.merchant_settlement_daily_due_at(v_order.settled_at);

    if new.merchant_id<>v_order.merchant_id
       or new.gross_total_cents<>v_order.gross_total_cents
       or new.platform_fee_bps<>v_order.platform_fee_bps_snapshot
       or new.platform_fee_cents<>v_expected_fee
       or new.prepaid_credit_applied_cents<>v_order.prepaid_fee_credit_applied_cents
       or new.due_at<>v_expected_due then
      raise exception 'PLATFORM_RECEIVABLE_MISMATCH' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_cashback_reimbursement_fact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_expected_due timestamptz;
begin
  if tg_op='UPDATE' and (
    new.order_id is distinct from old.order_id
    or new.merchant_id is distinct from old.merchant_id
    or new.cashback_cents is distinct from old.cashback_cents
    or new.due_at is distinct from old.due_at
  ) then
    raise exception 'FINANCIAL_FACT_IMMUTABLE' using errcode='23514';
  end if;

  if tg_op='INSERT' then
    select * into v_order
    from public.orders
    where id=new.order_id
    for share;

    if not found then
      raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
    end if;

    if v_order.status<>'SETTLED'
       or v_order.financial_state<>'settled'
       or v_order.financial_reversed_at is not null
       or v_order.merchant_id is null
       or v_order.settled_at is null
       or v_order.delivered_at is null
       or v_order.payment_confirmed_at is null
       or v_order.cashback_reserved_cents<=0 then
      raise exception 'ORDER_NOT_ELIGIBLE_FOR_CASHBACK_REIMBURSEMENT' using errcode='40001';
    end if;

    v_expected_due:=public.merchant_settlement_daily_due_at(v_order.settled_at);

    if new.merchant_id<>v_order.merchant_id
       or new.cashback_cents<>v_order.cashback_reserved_cents
       or new.due_at<>v_expected_due then
      raise exception 'CASHBACK_REIMBURSEMENT_MISMATCH' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

-- Preserve existing immutable fact trigger and include the prepaid-credit
-- field so changing only applied credits cannot bypass validation.
drop trigger if exists validate_platform_receivable_fact on public.platform_receivables;
create trigger validate_platform_receivable_fact
before insert or update of
  order_id,merchant_id,gross_total_cents,platform_fee_bps,
  platform_fee_cents,prepaid_credit_applied_cents,due_at
on public.platform_receivables for each row
execute function public.validate_platform_receivable_fact();
