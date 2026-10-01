-- Chama São Gabriel — financial unit economics v1.6
-- Rewards are funded by platform revenue, not by GMV.
-- Default pilot economics:
-- platform fee 7.50% of order gross
-- variable-cost reserve 0.75%
-- minimum platform contribution 2.50%
-- cashback target 1.00%
-- direct referral target 2.00% on the first qualified purchase
-- commission hold 168h

alter table public.reward_policy
  add column if not exists platform_fee_bps integer not null default 750
    check (platform_fee_bps between 0 and 5000),
  add column if not exists variable_cost_bps integer not null default 75
    check (variable_cost_bps between 0 and 5000),
  add column if not exists minimum_contribution_bps integer not null default 250
    check (minimum_contribution_bps between 0 and 5000),
  add column if not exists cashback_bps integer not null default 100
    check (cashback_bps between 0 and 5000),
  add column if not exists direct_referral_bps integer not null default 200
    check (direct_referral_bps between 0 and 5000);

update public.reward_policy
set
  platform_fee_bps=750,
  variable_cost_bps=75,
  minimum_contribution_bps=250,
  cashback_bps=100,
  direct_referral_bps=200,
  commission_hold_hours=168,
  updated_at=clock_timestamp()
where policy_key='default';

alter table public.orders
  add column if not exists platform_fee_bps_snapshot integer not null default 0
    check (platform_fee_bps_snapshot between 0 and 5000),
  add column if not exists variable_cost_bps_snapshot integer not null default 0
    check (variable_cost_bps_snapshot between 0 and 5000),
  add column if not exists minimum_contribution_bps_snapshot integer not null default 0
    check (minimum_contribution_bps_snapshot between 0 and 5000),
  add column if not exists cashback_bps_snapshot integer not null default 0
    check (cashback_bps_snapshot between 0 and 5000),
  add column if not exists referral_bps_snapshot integer not null default 0
    check (referral_bps_snapshot between 0 and 5000),
  add column if not exists commission_hold_hours_snapshot integer not null default 0
    check (commission_hold_hours_snapshot between 0 and 2160);

create or replace function public.snapshot_order_economics()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_policy public.reward_policy%rowtype;
begin
  select *
  into v_policy
  from public.reward_policy
  where policy_key='default'
  for share;

  if not found then
    raise exception 'FINANCIAL_POLICY_MISSING' using errcode='55000';
  end if;

  if v_policy.active then
    new.platform_fee_bps_snapshot:=v_policy.platform_fee_bps;
    new.variable_cost_bps_snapshot:=v_policy.variable_cost_bps;
    new.minimum_contribution_bps_snapshot:=v_policy.minimum_contribution_bps;
    new.cashback_bps_snapshot:=v_policy.cashback_bps;
    new.referral_bps_snapshot:=v_policy.direct_referral_bps;
    new.commission_hold_hours_snapshot:=v_policy.commission_hold_hours;
  else
    new.platform_fee_bps_snapshot:=0;
    new.variable_cost_bps_snapshot:=0;
    new.minimum_contribution_bps_snapshot:=0;
    new.cashback_bps_snapshot:=0;
    new.referral_bps_snapshot:=0;
    new.commission_hold_hours_snapshot:=0;
  end if;

  return new;
end;
$$;

revoke all on function public.snapshot_order_economics()
from public, anon, authenticated;
grant execute on function public.snapshot_order_economics()
to postgres, service_role;

drop trigger if exists snapshot_order_economics_before_insert on public.orders;
create trigger snapshot_order_economics_before_insert
before insert on public.orders
for each row
execute function public.snapshot_order_economics();

alter table public.order_reward_grants
  add column if not exists platform_fee_cents integer not null default 0
    check (platform_fee_cents >= 0),
  add column if not exists variable_cost_reserve_cents integer not null default 0
    check (variable_cost_reserve_cents >= 0),
  add column if not exists minimum_contribution_cents integer not null default 0
    check (minimum_contribution_cents >= 0),
  add column if not exists platform_contribution_cents integer not null default 0
    check (platform_contribution_cents >= 0);

alter table public.order_reward_grants
  drop constraint if exists order_reward_grants_financial_identity;

alter table public.order_reward_grants
  add constraint order_reward_grants_financial_identity
  check (
    platform_fee_cents
      = variable_cost_reserve_cents
      + cashback_cents
      + referral_pending_cents
      + platform_contribution_cents
  );

alter table public.order_reward_grants
  drop constraint if exists order_reward_grants_minimum_contribution;

alter table public.order_reward_grants
  add constraint order_reward_grants_minimum_contribution
  check (
    platform_contribution_cents >= minimum_contribution_cents
  );

create index if not exists order_reward_grants_customer_idx
  on public.order_reward_grants(customer_id);

create index if not exists order_reward_grants_referrer_idx
  on public.order_reward_grants(referrer_user_id)
  where referrer_user_id is not null;

create table if not exists public.platform_receivables (
  order_id uuid primary key references public.orders(id) on delete restrict,
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  gross_total_cents integer not null check (gross_total_cents >= 0),
  platform_fee_bps integer not null check (platform_fee_bps between 0 and 5000),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  status text not null default 'open'
    check (status in ('open','paid','waived','reversed')),
  due_at timestamptz not null,
  paid_at timestamptz,
  waived_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status='paid' and paid_at is not null)
    or status<>'paid'
  ),
  check (
    (status='waived' and waived_at is not null)
    or status<>'waived'
  ),
  check (
    (status='reversed' and reversed_at is not null)
    or status<>'reversed'
  )
);

alter table public.platform_receivables enable row level security;
revoke all on table public.platform_receivables from anon, authenticated;
grant all on table public.platform_receivables to service_role;

create index if not exists platform_receivables_merchant_status_idx
  on public.platform_receivables(merchant_id,status,due_at);

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
$$;

revoke all on function public.grant_order_rewards(uuid)
from public, anon, authenticated;
grant execute on function public.grant_order_rewards(uuid)
to postgres, service_role;
