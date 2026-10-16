-- TAMÃO V1.331: prevent conflicting cashback reimbursement facts on
-- replay of the settled-order accounting function.
-- Additive validation only: no payment, order, wallet or settlement mutation.
-- The existing function is reproduced from the active production definition,
-- preserving its signature, privileges, search_path and current receivable guards.
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

    -- A replay must never accept a different reimbursement fact just
    -- because the order_id uniqueness constraint suppressed insertion.
    if not exists(
      select 1
      from public.merchant_cashback_reimbursements r
      where r.order_id=v_order.id
        and r.merchant_id=v_order.merchant_id
        and r.cashback_cents=v_order.cashback_reserved_cents
        and r.due_at=v_due_at
    ) then
      raise exception 'SETTLEMENT_CASHBACK_REIMBURSEMENT_SNAPSHOT_CONFLICT'
        using errcode='23514';
    end if;
  elsif exists(
    select 1 from public.merchant_cashback_reimbursements r
    where r.order_id=v_order.id
  ) then
    -- Zero cashback orders must not have a reimbursable merchant debt.
    raise exception 'SETTLEMENT_CASHBACK_REIMBURSEMENT_SNAPSHOT_CONFLICT'
      using errcode='23514';
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
$function$

