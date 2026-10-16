-- TAMÃO V1.332: validate persisted reversal adjustments after idempotent inserts.
-- Captured from production function: only adds expected-adjustment flags and
-- equality checks (order/merchant/direction/amount); all financial logic preserved.
CREATE OR REPLACE FUNCTION public.reverse_settled_order_financials(p_order_id uuid, p_reason text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_receivable public.platform_receivables%rowtype;
  v_reimbursement public.merchant_cashback_reimbursements%rowtype;
  v_statement public.merchant_daily_statements%rowtype;
  v_account public.merchant_billing_accounts%rowtype;
  v_source_plan public.merchant_billing_plans%rowtype;
  v_current_plan public.merchant_billing_plans%rowtype;
  v_existing public.order_financial_reversals%rowtype;
  v_restore_ledger_id uuid;
  v_target_plan_key text;
  v_credit_restored integer:=0;
  v_cash_refund_due integer:=0;
  v_result jsonb;
  v_fee_refund_adjustment_expected boolean:=false;
  v_cashback_recovery_adjustment_expected boolean:=false;
begin
  if p_reason is null
     or char_length(trim(p_reason))<3
     or char_length(trim(p_reason))>240 then
    raise exception 'INVALID_REVERSAL_REASON' using errcode='22023';
  end if;

  if p_reference is not null
     and (char_length(trim(p_reference))<3 or char_length(trim(p_reference))>120) then
    raise exception 'INVALID_REVERSAL_REFERENCE' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('reward:'||p_order_id::text,0)
  );

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cashback-user:'||v_order.customer_id::text,0)
  );

  select *
  into v_existing
  from public.order_financial_reversals
  where order_id=v_order.id;

  if found then
    return jsonb_build_object(
      'ok',true,
      'orderId',v_order.id,
      'financialState','reversed',
      'alreadyReversed',true,
      'reversedAt',coalesce(v_order.financial_reversed_at,v_existing.created_at)
    );
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.settled_at is null then
    raise exception 'ORDER_NOT_REVERSIBLE' using errcode='40001';
  end if;

  insert into public.order_financial_reversals(order_id,reason,reference)
  values(v_order.id,trim(p_reason),nullif(trim(p_reference),''))
  returning * into v_existing;

  if v_order.prepaid_fee_credit_applied_cents>0 then
    if v_order.prepaid_fee_credit_source_plan_key_snapshot is null then
      raise exception 'PREPAID_FEE_REVERSAL_SOURCE_PLAN_MISSING'
        using errcode='40001';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-fee-credit:'||v_order.merchant_id::text,0)
    );

    select *
    into v_account
    from public.merchant_billing_accounts
    where merchant_id=v_order.merchant_id
    for update;

    if not found then
      raise exception 'MERCHANT_BILLING_ACCOUNT_MISSING'
        using errcode='55000';
    end if;

    select *
    into v_source_plan
    from public.merchant_billing_plans
    where plan_key=v_order.prepaid_fee_credit_source_plan_key_snapshot
      and billing_mode='prepaid_credit'
      and active;

    if not found then
      raise exception 'PREPAID_FEE_REVERSAL_SOURCE_PLAN_INVALID'
        using errcode='40001';
    end if;

    select *
    into v_current_plan
    from public.merchant_billing_plans
    where plan_key=v_account.plan_key;

    v_target_plan_key:=v_source_plan.plan_key;
    if found
       and v_current_plan.billing_mode='prepaid_credit'
       and v_current_plan.active
       and v_current_plan.platform_fee_bps<=v_source_plan.platform_fee_bps then
      v_target_plan_key:=v_current_plan.plan_key;
    end if;

    insert into public.merchant_fee_credit_ledger(
      merchant_id,order_id,entry_type,amount_cents,plan_key,reference
    )
    values(
      v_order.merchant_id,v_order.id,'fee_reversal_credit',
      v_order.prepaid_fee_credit_applied_cents,
      v_order.prepaid_fee_credit_source_plan_key_snapshot,
      'order-reversal:'||v_order.public_code
    )
    on conflict(order_id)
      where entry_type='fee_reversal_credit' and order_id is not null
      do nothing
    returning id into v_restore_ledger_id;

    if v_restore_ledger_id is null then
      raise exception 'PREPAID_FEE_REVERSAL_ALREADY_APPLIED'
        using errcode='40001';
    end if;

    update public.merchant_billing_accounts
    set plan_key=v_target_plan_key,
        credit_balance_cents=
          credit_balance_cents+v_order.prepaid_fee_credit_applied_cents,
        updated_at=clock_timestamp()
    where merchant_id=v_order.merchant_id;

    if not found then
      raise exception 'PREPAID_FEE_REVERSAL_ACCOUNT_UPDATE_FAILED'
        using errcode='40001';
    end if;

    v_credit_restored:=v_order.prepaid_fee_credit_applied_cents;
  end if;

  select *
  into v_grant
  from public.order_reward_grants
  where order_id=v_order.id
  for update;

  if found and v_grant.reversed_at is null then
    if v_grant.referral_pending_cents>0
       and v_grant.referrer_user_id is not null then
      if v_grant.matured_at is null then
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        )
        values(
          v_grant.referrer_user_id,v_order.id,'commission_pending',
          'referral_pending_release',-v_grant.referral_pending_cents,
          'reversal:'||replace(v_order.id::text,'-','')||':referral-pending',
          jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
        )
        on conflict(idempotency_key) do nothing;
      else
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        )
        values(
          v_grant.referrer_user_id,v_order.id,'commission_available',
          'referral_reversal',-v_grant.referral_pending_cents,
          'reversal:'||replace(v_order.id::text,'-','')||':referral-available',
          jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
        )
        on conflict(idempotency_key) do nothing;
      end if;
    end if;

    update public.order_reward_grants
    set reversed_at=clock_timestamp(),
        reversal_reason=trim(p_reason)
    where order_id=v_order.id
      and reversed_at is null;
  end if;

  update public.referrals
  set qualified_order_id=null
  where qualified_order_id=v_order.id;

  select *
  into v_receivable
  from public.platform_receivables
  where order_id=v_order.id
  for update;

  if found then
    v_cash_refund_due:=greatest(
      v_receivable.platform_fee_cents
      -v_receivable.prepaid_credit_applied_cents,
      0
    );

    if v_receivable.daily_statement_id is not null then
      select *
      into v_statement
      from public.merchant_daily_statements
      where id=v_receivable.daily_statement_id
      for update;

      if not found then
        raise exception 'DAILY_STATEMENT_NOT_FOUND'
          using errcode='P0002';
      end if;

      if v_statement.status in ('open','overdue') then
        if v_statement.gross_sales_cents<v_receivable.gross_total_cents
           or v_statement.gross_fee_cents<v_receivable.platform_fee_cents
           or v_statement.prepaid_credit_applied_cents
              <v_receivable.prepaid_credit_applied_cents
           or v_statement.amount_due_cents<v_cash_refund_due then
          raise exception 'DAILY_STATEMENT_REVERSAL_INCONSISTENT'
            using errcode='40001';
        end if;

        update public.merchant_daily_statements
        set gross_sales_cents=
              gross_sales_cents-v_receivable.gross_total_cents,
            gross_fee_cents=
              gross_fee_cents-v_receivable.platform_fee_cents,
            prepaid_credit_applied_cents=
              prepaid_credit_applied_cents
              -v_receivable.prepaid_credit_applied_cents,
            amount_due_cents=amount_due_cents-v_cash_refund_due,
            status=case
              when amount_due_cents-v_cash_refund_due=0 then 'paid'
              else status
            end,
            resolution_reference=case
              when amount_due_cents-v_cash_refund_due=0
                then coalesce(
                  resolution_reference,
                  'net-zero-order-reversal:'||v_order.public_code
                )
              else resolution_reference
            end,
            updated_at=clock_timestamp()
        where id=v_statement.id
        returning * into v_statement;

        if v_cash_refund_due>0 then
          update public.merchant_billing_payment_requests
          set status='cancelled',
              resolved_at=clock_timestamp(),
              admin_reference='statement-adjusted-by-order-reversal',
              updated_at=clock_timestamp()
          where statement_id=v_statement.id
            and merchant_id=v_statement.merchant_id
            and request_kind='statement_payment'
            and status='pending';
        end if;

      elsif v_statement.status='paid'
         and v_receivable.status='paid'
         and v_cash_refund_due>0 then
        insert into public.platform_settlement_adjustments(
          order_id,merchant_id,adjustment_type,direction,
          amount_cents,status,reason,reference
        )
        values(
          v_order.id,v_receivable.merchant_id,'platform_fee_refund_due',
          'platform_owes_merchant',v_cash_refund_due,
          'open',trim(p_reason),nullif(trim(p_reference),'')
        )
        on conflict(order_id,adjustment_type) do nothing;
        v_fee_refund_adjustment_expected:=true;
      end if;

    elsif v_receivable.status='paid' and v_cash_refund_due>0 then
      insert into public.platform_settlement_adjustments(
        order_id,merchant_id,adjustment_type,direction,
        amount_cents,status,reason,reference
      )
      values(
        v_order.id,v_receivable.merchant_id,'platform_fee_refund_due',
        'platform_owes_merchant',v_cash_refund_due,
        'open',trim(p_reason),nullif(trim(p_reference),'')
      )
      on conflict(order_id,adjustment_type) do nothing;
        v_fee_refund_adjustment_expected:=true;
    end if;

    update public.platform_receivables
    set status='reversed',
        reversed_at=coalesce(reversed_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=v_order.id
      and status<>'reversed';
  end if;

  select *
  into v_reimbursement
  from public.merchant_cashback_reimbursements
  where order_id=v_order.id
  for update;

  if found then
    if v_reimbursement.status='paid'
       and v_reimbursement.cashback_cents>0 then
      insert into public.platform_settlement_adjustments(
        order_id,merchant_id,adjustment_type,direction,amount_cents,
        status,reason,reference
      )
      values(
        v_order.id,v_reimbursement.merchant_id,
        'cashback_reimbursement_recovery_due','merchant_owes_platform',
        v_reimbursement.cashback_cents,'open',
        trim(p_reason),nullif(trim(p_reference),'')
      )
      on conflict(order_id,adjustment_type) do nothing;
        v_cashback_recovery_adjustment_expected:=true;
    end if;

    update public.merchant_cashback_reimbursements
    set status='reversed',
        reversed_at=coalesce(reversed_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=v_order.id
      and status<>'reversed';
  end if;

  -- An existing adjustment is not proof it matches the financial reversal.
  -- The order lock serializes this check; a conflict is a transactional failure.
  if v_fee_refund_adjustment_expected and not exists(
    select 1 from public.platform_settlement_adjustments a
    where a.order_id=v_order.id
      and a.adjustment_type='platform_fee_refund_due'
      and a.merchant_id=v_receivable.merchant_id
      and a.direction='platform_owes_merchant'
      and a.amount_cents=v_cash_refund_due
  ) then
    raise exception 'REVERSAL_FEE_ADJUSTMENT_SNAPSHOT_CONFLICT'
      using errcode='23514';
  end if;

  if v_cashback_recovery_adjustment_expected and not exists(
    select 1 from public.platform_settlement_adjustments a
    where a.order_id=v_order.id
      and a.adjustment_type='cashback_reimbursement_recovery_due'
      and a.merchant_id=v_reimbursement.merchant_id
      and a.direction='merchant_owes_platform'
      and a.amount_cents=v_reimbursement.cashback_cents
  ) then
    raise exception 'REVERSAL_CASHBACK_ADJUSTMENT_SNAPSHOT_CONFLICT'
      using errcode='23514';
  end if;

  update public.orders
  set financial_state='reversed',
      financial_reversed_at=clock_timestamp(),
      financial_reversal_reason=trim(p_reason),
      financial_reversal_reference=nullif(trim(p_reference),''),
      prepaid_fee_credit_reversed_at=case
        when v_credit_restored>0 then clock_timestamp()
        else prepaid_fee_credit_reversed_at
      end,
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id
  returning * into v_order;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,null,'system','FINANCIAL_REVERSED',
    'Liquidação financeira revertida',
    'Benefícios e recebíveis da plataforma foram estornados após confirmação da reversão.',
    jsonb_build_object(
      'reason',trim(p_reason),
      'reference',p_reference,
      'operationalStatus',v_order.status,
      'cashbackClawbackCents',coalesce(v_grant.cashback_cents,0),
      'cashbackClawbackMode','effective_balance_offset',
      'prepaidCreditRestoredCents',v_credit_restored,
      'cashRefundDueCents',v_cash_refund_due
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'status',v_order.status,
    'financialState',v_order.financial_state,
    'version',v_order.version,
    'alreadyReversed',false,
    'reversedAt',v_order.financial_reversed_at,
    'prepaidCreditRestoredCents',v_credit_restored,
    'cashRefundDueCents',v_cash_refund_due
  );

  return v_result;
end;
$function$

