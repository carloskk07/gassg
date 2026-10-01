-- Chama São Gabriel — post-settlement financial reversal v1.6.4
-- Operational delivery history remains immutable; financial settlement can be
-- reversed after a confirmed refund/cancellation outside the delivery flow.

alter table public.orders
  add column if not exists financial_state text not null default 'pending'
    check (financial_state in ('pending','settled','reversed')),
  add column if not exists financial_reversed_at timestamptz,
  add column if not exists financial_reversal_reason text,
  add column if not exists financial_reversal_reference text;

update public.orders
set financial_state=case
  when status='SETTLED' then 'settled'
  else 'pending'
end
where financial_state='pending';

alter table public.orders
  drop constraint if exists orders_financial_state_consistency;

alter table public.orders
  add constraint orders_financial_state_consistency
  check (
    (financial_state='pending' and financial_reversed_at is null)
    or
    (
      financial_state='settled'
      and status='SETTLED'
      and financial_reversed_at is null
    )
    or
    (
      financial_state='reversed'
      and status='SETTLED'
      and financial_reversed_at is not null
      and financial_reversal_reason is not null
    )
  );

create or replace function public.sync_order_financial_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status='SETTLED'
     and old.status is distinct from new.status
     and new.financial_state<>'reversed' then
    new.financial_state:='settled';
  end if;
  return new;
end;
$$;

revoke all on function public.sync_order_financial_state()
from public, anon, authenticated;
grant execute on function public.sync_order_financial_state()
to postgres, service_role;

drop trigger if exists sync_order_financial_state_before_status on public.orders;
create trigger sync_order_financial_state_before_status
before update of status on public.orders
for each row
execute function public.sync_order_financial_state();

alter table public.order_reward_grants
  add column if not exists reversed_at timestamptz,
  add column if not exists reversal_reason text;

create table if not exists public.order_financial_reversals (
  order_id uuid primary key references public.orders(id) on delete restrict,
  reason text not null check (char_length(reason) between 3 and 240),
  reference text check (reference is null or char_length(reference) between 3 and 120),
  created_at timestamptz not null default now()
);

alter table public.order_financial_reversals enable row level security;
revoke all on table public.order_financial_reversals from anon, authenticated;
grant all on table public.order_financial_reversals to service_role;

create table if not exists public.platform_settlement_adjustments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  adjustment_type text not null
    check (adjustment_type in ('platform_fee_refund_due')),
  amount_cents integer not null check (amount_cents>0),
  status text not null default 'open'
    check (status in ('open','paid','waived')),
  reason text not null check (char_length(reason) between 3 and 240),
  reference text,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id,adjustment_type),
  check (
    (status='paid' and settled_at is not null)
    or status<>'paid'
  )
);

alter table public.platform_settlement_adjustments enable row level security;
revoke all on table public.platform_settlement_adjustments from anon, authenticated;
grant all on table public.platform_settlement_adjustments to service_role;

create index if not exists platform_settlement_adjustments_status_idx
  on public.platform_settlement_adjustments(status,created_at);

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
        v_receivable.platform_fee_cents,'open',trim(p_reason),nullif(trim(p_reference),'')
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

create or replace function public.process_reward_maturation()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_user_is_anonymous boolean;
  v_count integer:=0;
  v_key text;
begin
  for v_order_id in
    select g.order_id
    from public.order_reward_grants g
    where g.referral_pending_cents>0
      and g.matured_at is null
      and g.reversed_at is null
      and g.commission_available_at<=clock_timestamp()
    order by g.commission_available_at
    limit 100
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('reward:'||v_order_id::text,0)
    );

    select *
    into v_order
    from public.orders
    where id=v_order_id
    for update;

    if not found
       or v_order.status<>'SETTLED'
       or v_order.financial_state<>'settled' then
      continue;
    end if;

    select *
    into v_grant
    from public.order_reward_grants
    where order_id=v_order_id
    for update;

    if not found
       or v_grant.referral_pending_cents<=0
       or v_grant.matured_at is not null
       or v_grant.reversed_at is not null
       or v_grant.commission_available_at>clock_timestamp()
       or v_grant.referrer_user_id is null then
      continue;
    end if;

    select u.is_anonymous
    into v_user_is_anonymous
    from auth.users u
    where u.id=v_grant.referrer_user_id;

    if not found or v_user_is_anonymous is true then
      continue;
    end if;

    v_key:='reward:'||replace(v_grant.order_id::text,'-','');

    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values
      (
        v_grant.referrer_user_id,v_grant.order_id,'commission_pending',
        'referral_pending_release',-v_grant.referral_pending_cents,
        v_key||':referral-pending-release',
        jsonb_build_object('maturedAt',clock_timestamp())
      ),
      (
        v_grant.referrer_user_id,v_grant.order_id,'commission_available',
        'referral_available',v_grant.referral_pending_cents,
        v_key||':referral-available',
        jsonb_build_object('maturedAt',clock_timestamp())
      )
    on conflict(idempotency_key) do nothing;

    update public.order_reward_grants
    set matured_at=clock_timestamp()
    where order_id=v_grant.order_id
      and matured_at is null
      and reversed_at is null;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_grant.order_id,null,'system','COMMISSION_AVAILABLE',
      'Comissão liberada',
      'A janela de validação terminou e a comissão elegível ficou disponível.',
      jsonb_build_object('amountCents',v_grant.referral_pending_cents)
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
