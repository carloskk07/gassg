-- Chama São Gabriel — hardening v1.5
-- Security, privacy, abuse resistance, rescue semantics and retention.

-- ---------------------------------------------------------------------------
-- 1) Server-side per-user API rate limiting.
-- ---------------------------------------------------------------------------
create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action_name text not null check (char_length(action_name) between 2 and 80),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count between 1 and 1000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, action_name, window_started_at)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;
grant all on table public.api_rate_limits to service_role;

drop policy if exists "deny authenticated api rate limits" on public.api_rate_limits;
create policy "deny authenticated api rate limits"
on public.api_rate_limits
for all
to authenticated
using (false)
with check (false);

create index if not exists api_rate_limits_window_idx
  on public.api_rate_limits(window_started_at);

create or replace function public.consume_api_quota(
  p_user_id uuid,
  p_action_name text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_bucket timestamptz;
  v_count integer;
  v_retry integer;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_action_name is null
     or char_length(p_action_name) < 2
     or char_length(p_action_name) > 80 then
    raise exception 'INVALID_RATE_ACTION' using errcode='22023';
  end if;

  if p_limit < 1 or p_limit > 10000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_RATE_LIMIT' using errcode='22023';
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits(
    user_id,action_name,window_started_at,request_count,updated_at
  )
  values(
    p_user_id,p_action_name,v_bucket,1,clock_timestamp()
  )
  on conflict(user_id,action_name,window_started_at)
  do update set
    request_count=public.api_rate_limits.request_count+1,
    updated_at=clock_timestamp()
  returning request_count into v_count;

  v_retry := greatest(
    1,
    ceil(extract(epoch from (
      v_bucket + make_interval(secs=>p_window_seconds) - clock_timestamp()
    )))::integer
  );

  return jsonb_build_object(
    'allowed',v_count<=p_limit,
    'count',v_count,
    'limit',p_limit,
    'retryAfterSeconds',v_retry
  );
end;
$$;

revoke all on function public.consume_api_quota(uuid,text,integer,integer)
from public, anon, authenticated;
grant execute on function public.consume_api_quota(uuid,text,integer,integer)
to service_role;

-- ---------------------------------------------------------------------------
-- 2) Fix crypto resolution under SECURITY DEFINER.
-- pgcrypto lives in extensions on hosted Supabase.
-- ---------------------------------------------------------------------------
alter function public.merchant_order_action(uuid,uuid,text,integer,text,text)
  set search_path to pg_catalog, extensions;

alter function public.complete_order_delivery(uuid,uuid,text,integer,text,text)
  set search_path to pg_catalog, extensions;

-- ---------------------------------------------------------------------------
-- 3) Referral code must not expose a prefix of auth.users.id.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  insert into public.profiles(user_id,referral_code)
  values(
    new.id,
    upper(encode(extensions.gen_random_bytes(10),'hex'))
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user()
from public, anon, authenticated;
grant execute on function public.handle_new_auth_user()
to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4) Defense-in-depth: a merchant that rejected/failed an order must not keep
-- reading it while customer is choosing a requote/reassignment.
-- Direct browser SELECT is already revoked; these policies protect against
-- future grant drift.
-- ---------------------------------------------------------------------------
drop policy if exists "read own or assigned orders" on public.orders;
create policy "read own or assigned orders"
on public.orders
for select
to authenticated
using (
  customer_id=(select auth.uid())
  or (
    status not in ('REASSIGNING','REQUOTE_REQUIRED')
    and exists (
      select 1
      from public.merchant_members mm
      where mm.merchant_id=orders.merchant_id
        and mm.user_id=(select auth.uid())
        and mm.active
    )
  )
);

drop policy if exists "read visible order items" on public.order_items;
create policy "read visible order items"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id=order_items.order_id
      and (
        o.customer_id=(select auth.uid())
        or (
          o.status not in ('REASSIGNING','REQUOTE_REQUIRED')
          and exists (
            select 1
            from public.merchant_members mm
            where mm.merchant_id=o.merchant_id
              and mm.user_id=(select auth.uid())
              and mm.active
          )
        )
      )
  )
);

drop policy if exists "read visible order events" on public.order_events;
create policy "read visible order events"
on public.order_events
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id=order_events.order_id
      and (
        o.customer_id=(select auth.uid())
        or (
          o.status not in ('REASSIGNING','REQUOTE_REQUIRED')
          and exists (
            select 1
            from public.merchant_members mm
            where mm.merchant_id=o.merchant_id
              and mm.user_id=(select auth.uid())
              and mm.active
          )
        )
      )
  )
);

-- ---------------------------------------------------------------------------
-- 5) Generic rescue authority shared by timeout and post-accept failure.
-- ---------------------------------------------------------------------------
create or replace function public.system_rescue_order(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_candidate_id uuid;
  v_candidate_gross integer;
  v_new_reserved integer;
  v_release_diff integer;
  v_key text;
  v_result jsonb;
begin
  if p_reason is null or char_length(p_reason) < 2 or char_length(p_reason) > 120 then
    raise exception 'INVALID_RESCUE_REASON' using errcode='22023';
  end if;

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status <> 'REASSIGNING' then
    raise exception 'INVALID_RESCUE_STATE' using errcode='40001';
  end if;

  v_key := 'system-rescue:'
    || replace(v_order.id::text,'-','')
    || ':'
    || v_order.version::text;

  select
    m.id,
    (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents)::integer
  into
    v_candidate_id,
    v_candidate_gross
  from public.merchants m
  join public.order_items oi
    on oi.order_id=v_order.id
  join public.catalog_items ci
    on ci.merchant_id=m.id
   and ci.product_code=oi.product_code
   and ci.active
   and ci.available_stock>=oi.quantity
  where m.status='active'
    and m.online
    and m.accepts_citywide
    and m.last_seen_at>=clock_timestamp()-interval '10 minutes'
    and m.price_confirmed_at>=clock_timestamp()-interval '24 hours'
    and not (m.id=any(v_order.attempted_merchant_ids))
  group by m.id,m.delivery_fee_cents,m.base_eta_minutes,m.trust_score
  having count(*)=(select count(*) from public.order_items where order_id=v_order.id)
  order by
    (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents) asc,
    m.base_eta_minutes asc,
    m.trust_score desc
  limit 1;

  if v_candidate_id is null then
    update public.orders
    set status='CANCELLED',
        supplier_name_snapshot=null,
        risk_reason=p_reason,
        offer_expires_at=null,
        dispatch_due_at=null,
        promised_by=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    if v_order.cashback_reserved_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_order.customer_id,v_order.id,'cashback','cashback_release',
        v_order.cashback_reserved_cents,
        v_key||':cashback-release',
        jsonb_build_object('reason',p_reason)
      )
      on conflict(idempotency_key) do nothing;
    end if;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','CANCELLED',
      'Pedido cancelado',
      'Nenhuma outra revenda elegível conseguiu assumir o pedido.',
      jsonb_build_object('reason',p_reason)
    );

    return jsonb_build_object(
      'ok',true,
      'orderId',v_order.id,
      'status','CANCELLED',
      'version',v_order.version
    );
  end if;

  v_new_reserved:=least(v_order.cashback_reserved_cents,v_candidate_gross);
  v_release_diff:=v_order.cashback_reserved_cents-v_new_reserved;

  if v_release_diff>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,v_order.id,'cashback','cashback_release',
      v_release_diff,
      v_key||':cashback-rebalance',
      jsonb_build_object('reason',p_reason)
    )
    on conflict(idempotency_key) do nothing;
  end if;

  if v_candidate_gross<=v_order.gross_total_cents then
    update public.orders
    set merchant_id=v_candidate_id,
        supplier_name_snapshot=null,
        gross_total_cents=v_candidate_gross,
        cashback_reserved_cents=v_new_reserved,
        total_cents=v_candidate_gross-v_new_reserved,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        status='OFFERED_TO_MERCHANT',
        attempted_merchant_ids=array_append(attempted_merchant_ids,v_candidate_id),
        offer_expires_at=clock_timestamp()+interval '3 minutes',
        accepted_at=null,
        dispatch_due_at=null,
        promised_by=null,
        risk_reason=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','OFFERED_TO_MERCHANT',
      'Nova revenda acionada',
      'Outra revenda recebeu o pedido sem aumento de preço.',
      jsonb_build_object('reason',p_reason)
    );

    v_result:=jsonb_build_object(
      'ok',true,
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'totalCents',v_order.total_cents,
      'offerExpiresAt',v_order.offer_expires_at
    );
  else
    update public.orders
    set status='REQUOTE_REQUIRED',
        supplier_name_snapshot=null,
        proposed_merchant_id=v_candidate_id,
        proposed_gross_total_cents=v_candidate_gross,
        proposed_total_cents=v_candidate_gross-v_new_reserved,
        offer_expires_at=null,
        accepted_at=null,
        dispatch_due_at=null,
        promised_by=null,
        risk_reason=p_reason,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','REQUOTE_REQUIRED',
      'Nova confirmação necessária',
      'A alternativa encontrada possui preço diferente e precisa de aceite do cliente.',
      jsonb_build_object('reason',p_reason)
    );

    v_result:=jsonb_build_object(
      'ok',true,
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'proposedTotalCents',v_order.proposed_total_cents
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.system_rescue_order(uuid,text)
from public, anon, authenticated;
grant execute on function public.system_rescue_order(uuid,text)
to postgres, service_role;

create or replace function public.system_reassign_expired_order(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','ORDER_NOT_FOUND');
  end if;

  if v_order.status <> 'OFFERED_TO_MERCHANT'
     or v_order.offer_expires_at is null
     or v_order.offer_expires_at > clock_timestamp() then
    return jsonb_build_object('ok',false,'reason','NOT_EXPIRED');
  end if;

  update public.orders
  set status='REASSIGNING',
      offer_expires_at=null,
      supplier_name_snapshot=null,
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail
  )
  values(
    v_order.id,null,'system','OFFER_TIMEOUT',
    'Revenda não respondeu',
    'O prazo de confirmação expirou e o sistema iniciou resgate automático.'
  );

  return public.system_rescue_order(v_order.id,'offer_timeout');
end;
$$;

revoke all on function public.system_reassign_expired_order(uuid)
from public, anon, authenticated;
grant execute on function public.system_reassign_expired_order(uuid)
to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 6) Merchant accepted but cannot fulfill before dispatch:
-- restore reserved stock and rescue atomically.
-- ---------------------------------------------------------------------------
create or replace function public.merchant_fail_before_dispatch(
  p_user_id uuid,
  p_order_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text,
  p_reason text default 'merchant_cannot_fulfill'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_member_role text;
  v_item record;
  v_restored integer := 0;
  v_expected integer := 0;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_VERSION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null or char_length(p_request_hash)<>64 then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  if p_reason is null or char_length(p_reason)<2 or char_length(p_reason)>120 then
    raise exception 'INVALID_FAILURE_REASON' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_user_id,'merchant-action:cannot-fulfill',p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_user_id
     or v_action.action_name<>'merchant-action:cannot-fulfill'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  select mm.member_role
  into v_member_role
  from public.merchant_members mm
  where mm.merchant_id=v_order.merchant_id
    and mm.user_id=p_user_id
    and mm.active
  limit 1;

  if not found
     or v_member_role not in ('owner','manager','operator') then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  if v_order.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;

  if v_order.status not in ('PREPARING','AT_RISK') then
    raise exception 'INVALID_TRANSITION' using errcode='40001';
  end if;

  select count(*) into v_expected
  from public.order_items
  where order_id=v_order.id;

  for v_item in
    select product_code,quantity
    from public.order_items
    where order_id=v_order.id
    order by product_code
  loop
    update public.catalog_items
    set available_stock=available_stock+v_item.quantity,
        updated_at=clock_timestamp()
    where merchant_id=v_order.merchant_id
      and product_code=v_item.product_code;

    if found then
      v_restored:=v_restored+1;
    end if;
  end loop;

  if v_restored<>v_expected then
    raise exception 'STOCK_RESTORE_FAILED' using errcode='40001';
  end if;

  delete from public.order_delivery_secrets
  where order_id=v_order.id;

  update public.orders
  set status='REASSIGNING',
      supplier_name_snapshot=null,
      accepted_at=null,
      dispatch_due_at=null,
      promised_by=null,
      offer_expires_at=null,
      pin_hash=null,
      pin_failures=0,
      risk_reason=p_reason,
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,p_user_id,'merchant','MERCHANT_CANNOT_FULFILL',
    'Revenda não consegue concluir',
    'O estoque reservado foi devolvido e o sistema iniciou resgate automático.',
    jsonb_build_object('reason',p_reason)
  );

  v_result:=public.system_rescue_order(v_order.id,p_reason);

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.merchant_fail_before_dispatch(
  uuid,uuid,integer,text,text,text
) from public, anon, authenticated;
grant execute on function public.merchant_fail_before_dispatch(
  uuid,uuid,integer,text,text,text
) to service_role;

-- ---------------------------------------------------------------------------
-- 7) Data retention for ephemeral secrets/quotes/idempotency/rate buckets.
-- ---------------------------------------------------------------------------
create or replace function public.process_data_retention()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_quotes integer := 0;
  v_actions integer := 0;
  v_pins integer := 0;
  v_rates integer := 0;
  v_requotes integer := 0;
begin
  delete from public.order_delivery_secrets
  where consumed_at is not null
    and consumed_at < clock_timestamp()-interval '24 hours';
  get diagnostics v_pins = row_count;

  delete from public.quotes
  where expires_at < clock_timestamp()-interval '24 hours';
  get diagnostics v_quotes = row_count;

  delete from public.action_requests
  where coalesce(completed_at,created_at) < clock_timestamp()-interval '30 days';
  get diagnostics v_actions = row_count;

  delete from public.api_rate_limits
  where window_started_at < clock_timestamp()-interval '2 days';
  get diagnostics v_rates = row_count;

  delete from public.order_requote_items ri
  using public.orders o
  where o.id=ri.order_id
    and (
      o.status<>'REQUOTE_REQUIRED'
      or o.proposed_merchant_id is null
    );
  get diagnostics v_requotes = row_count;

  return jsonb_build_object(
    'quotesDeleted',v_quotes,
    'actionsDeleted',v_actions,
    'deliverySecretsDeleted',v_pins,
    'rateBucketsDeleted',v_rates,
    'requoteSnapshotsDeleted',v_requotes
  );
end;
$$;

revoke all on function public.process_data_retention()
from public, anon, authenticated;
grant execute on function public.process_data_retention()
to postgres, service_role;

select cron.schedule(
  'chama-data-retention',
  '17 3 * * *',
  $$select public.process_data_retention();$$
);
