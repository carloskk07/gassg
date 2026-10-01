-- Chama São Gabriel — strict accounting/reward separation v1.14.7
-- Rewards may only mutate reward/ledger state. Platform receivables and
-- merchant cashback reimbursements belong exclusively to settlement accounting.

CREATE OR REPLACE FUNCTION public.grant_order_rewards(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_referral public.referrals%rowtype;
  v_existing public.order_reward_grants%rowtype;
  v_platform_fee integer:=0;
  v_variable_reserve integer:=0;
  v_minimum_contribution integer:=0;
  v_reward_budget integer:=0;
  v_cashback_target integer:=0;
  v_referral_target integer:=0;
  v_cashback integer:=0;
  v_referral_amount integer:=0;
  v_platform_contribution integer:=0;
  v_referrer uuid:=null;
  v_available_at timestamptz:=null;
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
     or v_order.payment_confirmed_at is null
     or v_order.delivered_at is null
     or v_order.merchant_id is null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_REWARDS' using errcode='40001';
  end if;

  select *
  into v_existing
  from public.order_reward_grants
  where order_id=v_order.id;

  if found then
    return jsonb_build_object(
      'orderId',v_existing.order_id,
      'platformFeeCents',v_existing.platform_fee_cents,
      'rewardBudgetCents',v_existing.reward_budget_cents,
      'cashbackCents',v_existing.cashback_cents,
      'referralPendingCents',v_existing.referral_pending_cents,
      'platformContributionCents',v_existing.platform_contribution_cents,
      'commissionAvailableAt',v_existing.commission_available_at,
      'alreadyGranted',true
    );
  end if;

  v_platform_fee:=floor(
    (v_order.gross_total_cents::numeric*v_order.platform_fee_bps_snapshot)/10000
  )::integer;

  v_variable_reserve:=least(
    v_platform_fee,
    ceil((v_order.gross_total_cents::numeric*v_order.variable_cost_bps_snapshot)/10000)::integer
  );

  v_minimum_contribution:=least(
    greatest(0,v_platform_fee-v_variable_reserve),
    ceil((v_order.gross_total_cents::numeric*v_order.minimum_contribution_bps_snapshot)/10000)::integer
  );

  v_reward_budget:=greatest(
    0,
    v_platform_fee-v_variable_reserve-v_minimum_contribution
  );

  v_cashback_target:=floor(
    (v_order.gross_total_cents::numeric*v_order.cashback_bps_snapshot)/10000
  )::integer;

  v_referral_target:=floor(
    (v_order.gross_total_cents::numeric*v_order.referral_bps_snapshot)/10000
  )::integer;

  v_cashback:=least(v_cashback_target,v_reward_budget);

  select *
  into v_referral
  from public.referrals
  where referred_user_id=v_order.customer_id
  for update;

  if found
     and (v_referral.qualified_order_id is null or v_referral.qualified_order_id=v_order.id)
     and v_referral.referrer_user_id<>v_order.customer_id then
    v_referrer:=v_referral.referrer_user_id;
    v_referral_amount:=least(
      v_referral_target,
      greatest(0,v_reward_budget-v_cashback)
    );

    if v_referral.qualified_order_id is null then
      update public.referrals
      set qualified_order_id=v_order.id
      where referred_user_id=v_order.customer_id
        and qualified_order_id is null;
    end if;

    if v_referral_amount>0 then
      v_available_at:=clock_timestamp()
        + make_interval(hours=>v_order.commission_hold_hours_snapshot);
    end if;
  end if;

  if v_referrer is not null and v_referral_amount>0 then
    perform pg_advisory_xact_lock(
      hashtextextended('referral-risk:'||v_referrer::text,0)
    );
  end if;

  v_platform_contribution:=
    v_platform_fee
    - v_variable_reserve
    - v_cashback
    - v_referral_amount;

  if v_platform_contribution<v_minimum_contribution then
    raise exception 'REWARD_BUDGET_INVARIANT_FAILED' using errcode='23514';
  end if;

  insert into public.order_reward_grants(
    order_id,customer_id,referrer_user_id,
    reward_budget_cents,cashback_cents,referral_pending_cents,
    commission_available_at,platform_fee_cents,variable_cost_reserve_cents,
    minimum_contribution_cents,platform_contribution_cents
  )
  values(
    v_order.id,v_order.customer_id,v_referrer,
    v_reward_budget,v_cashback,v_referral_amount,
    v_available_at,v_platform_fee,v_variable_reserve,
    v_minimum_contribution,v_platform_contribution
  );

  if v_cashback>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,v_order.id,'cashback','cashback_earn',v_cashback,
      'reward:'||replace(v_order.id::text,'-','')||':cashback',
      jsonb_build_object(
        'basis','platform_revenue',
        'platformFeeCents',v_platform_fee,
        'rewardBudgetCents',v_reward_budget
      )
    )
    on conflict(idempotency_key) do nothing;
  end if;

  if v_referral_amount>0 and v_referrer is not null then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_referrer,v_order.id,'commission_pending','referral_pending',v_referral_amount,
      'reward:'||replace(v_order.id::text,'-','')||':referral-pending',
      jsonb_build_object(
        'referredUserId',v_order.customer_id,
        'holdUntil',v_available_at,
        'basis','platform_revenue',
        'platformFeeCents',v_platform_fee
      )
    )
    on conflict(idempotency_key) do nothing;
  end if;


  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,null,'system','REWARDS_GRANTED',
    'Benefícios e resultado unitário registrados',
    'Benefícios foram limitados pela receita e contribuição mínima da plataforma.',
    jsonb_build_object(
      'platformFeeCents',v_platform_fee,
      'variableCostReserveCents',v_variable_reserve,
      'rewardBudgetCents',v_reward_budget,
      'cashbackCents',v_cashback,
      'referralPendingCents',v_referral_amount,
      'platformContributionCents',v_platform_contribution,
      'commissionAvailableAt',v_available_at
    )
  );

  return jsonb_build_object(
    'orderId',v_order.id,
    'platformFeeCents',v_platform_fee,
    'rewardBudgetCents',v_reward_budget,
    'cashbackCents',v_cashback,
    'referralPendingCents',v_referral_amount,
    'platformContributionCents',v_platform_contribution,
    'commissionAvailableAt',v_available_at,
    'alreadyGranted',false
  );
end;
$function$;

revoke all on function public.grant_order_rewards(uuid)
from public, anon, authenticated;
grant execute on function public.grant_order_rewards(uuid)
to postgres, service_role;
