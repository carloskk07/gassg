-- Chama São Gabriel — reward engine v1.5.5
-- Pilot policy is configurable in one server-only row. All reward writes are
-- ledger-backed, capped by an order budget and idempotent per order.

create table if not exists public.reward_policy (
  policy_key text primary key check (policy_key='default'),
  active boolean not null default true,
  cashback_cents integer not null default 125 check (cashback_cents between 0 and 100000),
  direct_referral_cents integer not null default 250 check (direct_referral_cents between 0 and 100000),
  max_reward_bps integer not null default 500 check (max_reward_bps between 0 and 10000),
  commission_hold_hours integer not null default 168 check (commission_hold_hours between 0 and 2160),
  updated_at timestamptz not null default now()
);

insert into public.reward_policy(
  policy_key,active,cashback_cents,direct_referral_cents,max_reward_bps,commission_hold_hours
)
values('default',true,125,250,500,168)
on conflict(policy_key) do nothing;

alter table public.reward_policy enable row level security;
revoke all on table public.reward_policy from anon, authenticated;
grant all on table public.reward_policy to service_role;

create table if not exists public.order_reward_grants (
  order_id uuid primary key references public.orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete restrict,
  referrer_user_id uuid references auth.users(id) on delete set null,
  reward_budget_cents integer not null check (reward_budget_cents >= 0),
  cashback_cents integer not null check (cashback_cents >= 0),
  referral_pending_cents integer not null check (referral_pending_cents >= 0),
  commission_available_at timestamptz,
  matured_at timestamptz,
  created_at timestamptz not null default now(),
  check (cashback_cents + referral_pending_cents <= reward_budget_cents),
  check (
    (referral_pending_cents=0 and commission_available_at is null)
    or
    (referral_pending_cents>0 and commission_available_at is not null)
  )
);

alter table public.order_reward_grants enable row level security;
revoke all on table public.order_reward_grants from anon, authenticated;
grant all on table public.order_reward_grants to service_role;

create index if not exists order_reward_grants_maturity_idx
  on public.order_reward_grants(commission_available_at)
  where referral_pending_cents>0 and matured_at is null;

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
  v_policy public.reward_policy%rowtype;
  v_referral public.referrals%rowtype;
  v_existing public.order_reward_grants%rowtype;
  v_budget integer := 0;
  v_cashback integer := 0;
  v_referral_amount integer := 0;
  v_referrer uuid := null;
  v_available_at timestamptz := null;
  v_result jsonb;
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
     or v_order.delivered_at is null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_REWARDS' using errcode='40001';
  end if;

  select *
  into v_existing
  from public.order_reward_grants
  where order_id=v_order.id;

  if found then
    return jsonb_build_object(
      'orderId',v_existing.order_id,
      'rewardBudgetCents',v_existing.reward_budget_cents,
      'cashbackCents',v_existing.cashback_cents,
      'referralPendingCents',v_existing.referral_pending_cents,
      'commissionAvailableAt',v_existing.commission_available_at,
      'alreadyGranted',true
    );
  end if;

  select *
  into v_policy
  from public.reward_policy
  where policy_key='default'
  for share;

  if not found or not v_policy.active then
    insert into public.order_reward_grants(
      order_id,customer_id,reward_budget_cents,cashback_cents,referral_pending_cents
    )
    values(v_order.id,v_order.customer_id,0,0,0);

    return jsonb_build_object(
      'orderId',v_order.id,
      'rewardBudgetCents',0,
      'cashbackCents',0,
      'referralPendingCents',0,
      'commissionAvailableAt',null,
      'alreadyGranted',false
    );
  end if;

  v_budget:=floor((v_order.gross_total_cents::numeric*v_policy.max_reward_bps)/10000)::integer;
  v_budget:=greatest(0,v_budget);
  v_cashback:=least(v_policy.cashback_cents,v_budget);

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
      v_policy.direct_referral_cents,
      greatest(0,v_budget-v_cashback)
    );

    if v_referral.qualified_order_id is null then
      update public.referrals
      set qualified_order_id=v_order.id
      where referred_user_id=v_order.customer_id
        and qualified_order_id is null;
    end if;

    if v_referral_amount>0 then
      v_available_at:=clock_timestamp()
        + make_interval(hours=>v_policy.commission_hold_hours);
    end if;
  end if;

  insert into public.order_reward_grants(
    order_id,customer_id,referrer_user_id,reward_budget_cents,
    cashback_cents,referral_pending_cents,commission_available_at
  )
  values(
    v_order.id,v_order.customer_id,v_referrer,v_budget,
    v_cashback,v_referral_amount,v_available_at
  );

  if v_cashback>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,v_order.id,'cashback','cashback_earn',v_cashback,
      'reward:'||replace(v_order.id::text,'-','')||':cashback',
      jsonb_build_object(
        'policy','default',
        'rewardBudgetCents',v_budget
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
        'policy','default'
      )
    )
    on conflict(idempotency_key) do nothing;
  end if;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,null,'system','REWARDS_GRANTED',
    'Benefícios registrados',
    'Os benefícios elegíveis foram registrados no ledger do pedido.',
    jsonb_build_object(
      'cashbackCents',v_cashback,
      'referralPendingCents',v_referral_amount,
      'rewardBudgetCents',v_budget,
      'commissionAvailableAt',v_available_at
    )
  );

  v_result:=jsonb_build_object(
    'orderId',v_order.id,
    'rewardBudgetCents',v_budget,
    'cashbackCents',v_cashback,
    'referralPendingCents',v_referral_amount,
    'commissionAvailableAt',v_available_at,
    'alreadyGranted',false
  );

  return v_result;
end;
$$;

revoke all on function public.grant_order_rewards(uuid)
from public, anon, authenticated;
grant execute on function public.grant_order_rewards(uuid)
to postgres, service_role;

create or replace function public.on_order_settled_grant_rewards()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status='SETTLED'
     and old.status is distinct from new.status then
    perform public.grant_order_rewards(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.on_order_settled_grant_rewards()
from public, anon, authenticated;
grant execute on function public.on_order_settled_grant_rewards()
to postgres, service_role;

drop trigger if exists grant_rewards_after_settlement on public.orders;
create trigger grant_rewards_after_settlement
after update of status on public.orders
for each row
when (new.status='SETTLED' and old.status is distinct from new.status)
execute function public.on_order_settled_grant_rewards();

create or replace function public.process_reward_maturation()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row public.order_reward_grants%rowtype;
  v_count integer:=0;
  v_key text;
begin
  for v_row in
    select g.*
    from public.order_reward_grants g
    join public.orders o on o.id=g.order_id
    where g.referral_pending_cents>0
      and g.matured_at is null
      and g.commission_available_at<=clock_timestamp()
      and o.status='SETTLED'
    order by g.commission_available_at
    for update of g skip locked
    limit 100
  loop
    v_key:='reward:'||replace(v_row.order_id::text,'-','');

    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values
      (
        v_row.referrer_user_id,v_row.order_id,'commission_pending',
        'referral_pending_release',-v_row.referral_pending_cents,
        v_key||':referral-pending-release',
        jsonb_build_object('maturedAt',clock_timestamp())
      ),
      (
        v_row.referrer_user_id,v_row.order_id,'commission_available',
        'referral_available',v_row.referral_pending_cents,
        v_key||':referral-available',
        jsonb_build_object('maturedAt',clock_timestamp())
      )
    on conflict(idempotency_key) do nothing;

    update public.order_reward_grants
    set matured_at=clock_timestamp()
    where order_id=v_row.order_id
      and matured_at is null;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_row.order_id,null,'system','COMMISSION_AVAILABLE',
      'Comissão liberada',
      'A janela de validação terminou e a comissão elegível ficou disponível.',
      jsonb_build_object('amountCents',v_row.referral_pending_cents)
    );

    v_count:=v_count+1;
  end loop;

  return jsonb_build_object('maturedCommissions',v_count);
end;
$$;

revoke all on function public.process_reward_maturation()
from public, anon, authenticated;
grant execute on function public.process_reward_maturation()
to postgres, service_role;

select cron.schedule(
  'chama-reward-maturation',
  '23 * * * *',
  $$select public.process_reward_maturation();$$
);
