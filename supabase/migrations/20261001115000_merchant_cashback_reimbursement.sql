-- Chama São Gabriel — merchant cashback reimbursement v1.6.6
-- Cashback redemption is a cash-flow obligation to the merchant, not a new
-- P&L expense: the expense/liability was recognized when cashback was earned.

create table if not exists public.merchant_cashback_reimbursements (
  order_id uuid primary key references public.orders(id) on delete restrict,
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  cashback_cents integer not null check (cashback_cents>0),
  status text not null default 'open'
    check (status in ('open','paid','offset','reversed')),
  due_at timestamptz not null,
  paid_at timestamptz,
  offset_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='paid' and paid_at is not null) or status<>'paid'),
  check ((status='offset' and offset_at is not null) or status<>'offset'),
  check ((status='reversed' and reversed_at is not null) or status<>'reversed')
);

alter table public.merchant_cashback_reimbursements enable row level security;
revoke all on table public.merchant_cashback_reimbursements from anon, authenticated;
grant all on table public.merchant_cashback_reimbursements to service_role;

create index if not exists merchant_cashback_reimbursements_status_idx
  on public.merchant_cashback_reimbursements(merchant_id,status,due_at);

alter table public.platform_settlement_adjustments
  add column if not exists direction text not null default 'platform_owes_merchant'
    check (direction in ('platform_owes_merchant','merchant_owes_platform'));

alter table public.platform_settlement_adjustments
  drop constraint if exists platform_settlement_adjustments_adjustment_type_check;

alter table public.platform_settlement_adjustments
  add constraint platform_settlement_adjustments_adjustment_type_check
  check (
    adjustment_type in (
      'platform_fee_refund_due',
      'cashback_reimbursement_recovery_due'
    )
  );

alter table public.platform_settlement_adjustments
  drop constraint if exists platform_settlement_adjustments_direction_check;

alter table public.platform_settlement_adjustments
  add constraint platform_settlement_adjustments_direction_check
  check (
    (adjustment_type='platform_fee_refund_due' and direction='platform_owes_merchant')
    or
    (
      adjustment_type='cashback_reimbursement_recovery_due'
      and direction='merchant_owes_platform'
    )
  );

create or replace function public.grant_order_rewards(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
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
    if v_order.cashback_reserved_cents>0 then
      insert into public.merchant_cashback_reimbursements(
        order_id,merchant_id,cashback_cents,status,due_at
      )
      values(
        v_order.id,v_order.merchant_id,v_order.cashback_reserved_cents,
        'open',clock_timestamp()+interval '7 days'
      )
      on conflict(order_id) do nothing;
    end if;

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

  insert into public.platform_receivables(
    order_id,merchant_id,gross_total_cents,
    platform_fee_bps,platform_fee_cents,status,due_at
  )
  values(
    v_order.id,v_order.merchant_id,v_order.gross_total_cents,
    v_order.platform_fee_bps_snapshot,v_platform_fee,
    'open',clock_timestamp()+interval '7 days'
  )
  on conflict(order_id) do nothing;

  if v_order.cashback_reserved_cents>0 then
    insert into public.merchant_cashback_reimbursements(
      order_id,merchant_id,cashback_cents,status,due_at
    )
    values(
      v_order.id,v_order.merchant_id,v_order.cashback_reserved_cents,
      'open',clock_timestamp()+interval '7 days'
    )
    on conflict(order_id) do nothing;
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
      'cashbackReimbursementCents',v_order.cashback_reserved_cents,
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
    'cashbackReimbursementCents',v_order.cashback_reserved_cents,
    'commissionAvailableAt',v_available_at,
    'alreadyGranted',false
  );
end;
$$;

revoke all on function public.grant_order_rewards(uuid)
from public, anon, authenticated;
grant execute on function public.grant_order_rewards(uuid)
to postgres, service_role;

create or replace function public.reverse_settled_order_financials(
  p_order_id uuid,
  p_reason text,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_receivable public.platform_receivables%rowtype;
  v_reimbursement public.merchant_cashback_reimbursements%rowtype;
  v_existing public.order_financial_reversals%rowtype;
  v_result jsonb;
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
      'reversedAt',v_existing.created_at
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

  select *
  into v_grant
  from public.order_reward_grants
  where order_id=v_order.id
  for update;

  if found and v_grant.reversed_at is null then
    if v_grant.cashback_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_order.customer_id,v_order.id,'cashback','cashback_reversal',
        -v_grant.cashback_cents,
        'reversal:'||replace(v_order.id::text,'-','')||':cashback',
        jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
      )
      on conflict(idempotency_key) do nothing;
    end if;

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
    if v_receivable.status='paid' and v_receivable.platform_fee_cents>0 then
      insert into public.platform_settlement_adjustments(
        order_id,merchant_id,adjustment_type,amount_cents,status,reason,reference
      )
      values(
        v_order.id,v_receivable.merchant_id,'platform_fee_refund_due',
        'platform_owes_merchant',v_receivable.platform_fee_cents,
        'open',trim(p_reason),nullif(trim(p_reference),'')
      )
      on conflict(order_id,adjustment_type) do nothing;
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
    if v_reimbursement.status in ('paid','offset')
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
    end if;

    update public.merchant_cashback_reimbursements
    set status='reversed',
        reversed_at=coalesce(reversed_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=v_order.id
      and status<>'reversed';
  end if;

  update public.orders
  set financial_state='reversed',
      financial_reversed_at=clock_timestamp(),
      financial_reversal_reason=trim(p_reason),
      financial_reversal_reference=nullif(trim(p_reference),''),
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
      'operationalStatus',v_order.status
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'status',v_order.status,
    'financialState',v_order.financial_state,
    'version',v_order.version,
    'alreadyReversed',false,
    'reversedAt',v_order.financial_reversed_at
  );

  return v_result;
end;
$$;

revoke all on function public.reverse_settled_order_financials(uuid,text,text)
from public, anon, authenticated;
grant execute on function public.reverse_settled_order_financials(uuid,text,text)
to postgres, service_role;

create or replace function public.merchant_financial_position(
  p_merchant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_fees bigint:=0;
  v_cashback bigint:=0;
  v_platform_owes bigint:=0;
  v_merchant_owes bigint:=0;
begin
  if p_merchant_id is null then
    raise exception 'INVALID_MERCHANT' using errcode='22023';
  end if;

  select coalesce(sum(platform_fee_cents),0)
  into v_fees
  from public.platform_receivables
  where merchant_id=p_merchant_id
    and status='open';

  select coalesce(sum(cashback_cents),0)
  into v_cashback
  from public.merchant_cashback_reimbursements
  where merchant_id=p_merchant_id
    and status='open';

  select
    coalesce(sum(amount_cents) filter (
      where direction='platform_owes_merchant' and status='open'
    ),0),
    coalesce(sum(amount_cents) filter (
      where direction='merchant_owes_platform' and status='open'
    ),0)
  into v_platform_owes,v_merchant_owes
  from public.platform_settlement_adjustments
  where merchant_id=p_merchant_id;

  return jsonb_build_object(
    'merchantId',p_merchant_id,
    'platformFeesReceivableCents',v_fees,
    'cashbackReimbursementPayableCents',v_cashback,
    'otherPlatformPayablesCents',v_platform_owes,
    'otherMerchantReceivablesCents',v_merchant_owes,
    'netDueToPlatformCents',
      v_fees+v_merchant_owes-v_cashback-v_platform_owes
  );
end;
$$;

revoke all on function public.merchant_financial_position(uuid)
from public, anon, authenticated;
grant execute on function public.merchant_financial_position(uuid)
to postgres, service_role;
