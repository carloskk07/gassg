-- TAMÃO #843: financeira canônica sobre o valor líquido do bônus
-- Corrige dois validadores legados que calculavam a taxa de plataforma
-- sobre o bruto, recusando a fatura e criando erro de conciliação.
-- Contratos e faturas anteriores sem desconto continuam idênticos.

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
  v_partner public.merchant_welcome_order_uses_v1_843%rowtype;
  v_fee_basis integer;
  v_expected_basis integer:=null;
begin
  if tg_op='UPDATE' and (
    new.order_id is distinct from old.order_id
    or new.merchant_id is distinct from old.merchant_id
    or new.gross_total_cents is distinct from old.gross_total_cents
    or new.platform_fee_bps is distinct from old.platform_fee_bps
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.due_at is distinct from old.due_at
    or new.prepaid_credit_applied_cents is distinct from old.prepaid_credit_applied_cents
    or new.benefit_fee_basis_cents_v1_843 is distinct from old.benefit_fee_basis_cents_v1_843
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

    -- A venda paga pela revenda aceita R$1 fora da receita da plataforma.
    -- Em pedidos antigos, a base permanece o valor bruto original.
    v_fee_basis:=v_order.gross_total_cents;
    select * into v_partner
    from public.merchant_welcome_order_uses_v1_843 a
    where a.order_id=v_order.id;
    if found then
      if v_partner.merchant_id<>v_order.merchant_id
        or v_partner.customer_id<>v_order.customer_id
        or v_partner.gross_cents<>v_order.gross_total_cents
        or v_partner.net_cents<>v_order.total_cents
        or v_partner.amount_cents<>100
        or v_order.cashback_reserved_cents<>100
        or v_partner.fee_bps_snapshot<>v_order.platform_fee_bps_snapshot
      then raise exception 'PARTNER_WELCOME_RECEIVABLE_BASIS_CONFLICT' using errcode='23514';end if;
      v_fee_basis:=v_partner.net_cents;
      v_expected_basis:=v_partner.net_cents;
    end if;
    v_expected_fee:=floor(
      (v_fee_basis::numeric*v_order.platform_fee_bps_snapshot)/10000
    )::integer;
    v_expected_due:=public.merchant_settlement_daily_due_at(v_order.settled_at);

    if new.merchant_id<>v_order.merchant_id
       or new.gross_total_cents<>v_order.gross_total_cents
       or new.platform_fee_bps<>v_order.platform_fee_bps_snapshot
       or new.platform_fee_cents<>v_expected_fee
       or new.prepaid_credit_applied_cents<>v_order.prepaid_fee_credit_applied_cents
       or new.benefit_fee_basis_cents_v1_843 is distinct from v_expected_basis
       or new.due_at<>v_expected_due then
      raise exception 'PLATFORM_RECEIVABLE_MISMATCH' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;


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
  v_fee_basis integer:=0;
  v_partner public.merchant_welcome_order_uses_v1_843%rowtype;
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

  v_fee_basis:=v_order.gross_total_cents;
  select * into v_partner
  from public.merchant_welcome_order_uses_v1_843 a
  where a.order_id=v_order.id;
  if found then
    if v_partner.merchant_id<>v_order.merchant_id
      or v_partner.customer_id<>v_order.customer_id
      or v_partner.gross_cents<>v_order.gross_total_cents
      or v_partner.net_cents<>v_order.total_cents
      or v_partner.amount_cents<>100
      or v_order.cashback_reserved_cents<>100
      or v_partner.fee_bps_snapshot<>v_order.platform_fee_bps_snapshot
      or not exists(select 1 from public.platform_receivables p
        where p.order_id=v_order.id and p.merchant_id=v_order.merchant_id
          and p.benefit_fee_basis_cents_v1_843=v_partner.net_cents
          and p.platform_fee_bps=v_partner.fee_bps_snapshot)
    then raise exception 'PARTNER_WELCOME_REWARD_NOT_BACKED' using errcode='23514';end if;
    v_fee_basis:=v_partner.net_cents;
  end if;
  v_platform_fee:=floor(
    (v_fee_basis::numeric*v_order.platform_fee_bps_snapshot)/10000
  )::integer;

  v_variable_reserve:=least(
    v_platform_fee,
    ceil((v_fee_basis::numeric*v_order.variable_cost_bps_snapshot)/10000)::integer
  );

  v_minimum_contribution:=least(
    greatest(0,v_platform_fee-v_variable_reserve),
    ceil((v_fee_basis::numeric*v_order.minimum_contribution_bps_snapshot)/10000)::integer
  );

  v_reward_budget:=greatest(
    0,
    v_platform_fee-v_variable_reserve-v_minimum_contribution
  );

  v_cashback_target:=floor(
    (v_fee_basis::numeric*v_order.cashback_bps_snapshot)/10000
  )::integer;

  v_referral_target:=floor(
    (v_fee_basis::numeric*v_order.referral_bps_snapshot)/10000
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
      v_available_at:=coalesce(v_order.settled_at,v_order.payment_confirmed_at,v_order.delivered_at,clock_timestamp())
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
    minimum_contribution_cents,platform_contribution_cents,created_at
  )
  values(
    v_order.id,v_order.customer_id,v_referrer,
    v_reward_budget,v_cashback,v_referral_amount,
    v_available_at,v_platform_fee,v_variable_reserve,
    v_minimum_contribution,v_platform_contribution,
    coalesce(v_order.settled_at,v_order.payment_confirmed_at,v_order.delivered_at,clock_timestamp())
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

