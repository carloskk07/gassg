-- Chama São Gabriel — production reconciliation v1.4
-- Brings a database bootstrapped with supabase/schema.sql to the current live runtime state.
-- Designed to be idempotent where practical.

-- 1) Lock down the defensive RLS event-trigger function if present.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
    execute 'grant execute on function public.rls_auto_enable() to postgres, service_role';
  end if;
end
$$;

-- 2) Explicit deny policies for server-only authority tables.
drop policy if exists "deny authenticated quotes" on public.quotes;
create policy "deny authenticated quotes"
on public.quotes for all to authenticated
using (false) with check (false);

drop policy if exists "deny authenticated quote items" on public.quote_items;
create policy "deny authenticated quote items"
on public.quote_items for all to authenticated
using (false) with check (false);

drop policy if exists "deny authenticated action requests" on public.action_requests;
create policy "deny authenticated action requests"
on public.action_requests for all to authenticated
using (false) with check (false);

-- 3) Cover foreign keys used by joins/RLS.
create index if not exists merchant_members_user_idx on public.merchant_members(user_id);
create index if not exists order_events_actor_user_idx on public.order_events(actor_user_id);
create index if not exists orders_proposed_merchant_idx on public.orders(proposed_merchant_id);
create index if not exists referrals_qualified_order_idx on public.referrals(qualified_order_id);
create index if not exists wallet_entries_order_idx on public.wallet_entries(order_id);

-- 4) Operational offer fields.
alter table public.merchants
  add column if not exists delivery_fee_cents integer not null default 0
    check (delivery_fee_cents >= 0 and delivery_fee_cents <= 100000),
  add column if not exists base_eta_minutes smallint not null default 30
    check (base_eta_minutes between 5 and 180),
  add column if not exists accepts_citywide boolean not null default false;

create index if not exists merchants_offer_eligibility_idx
  on public.merchants(status,online,accepts_citywide,price_confirmed_at,last_seen_at);

-- 5) Quote is bound to its normalized delivery address.
alter table public.quotes add column if not exists address_text text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='quotes_address_text_check'
      and conrelid='public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_address_text_check
      check (address_text is null or char_length(address_text) between 5 and 240);
  end if;
end
$$;

-- Only make NOT NULL when no legacy rows violate it.
do $$
begin
  if not exists (select 1 from public.quotes where address_text is null) then
    alter table public.quotes alter column address_text set not null;
  end if;
end
$$;

-- 6) PIN is generated at dispatch; raw code stays in a server-only table.
alter table public.orders alter column pin_hash drop not null;

alter table public.orders
  drop constraint if exists orders_pin_required_after_dispatch;

alter table public.orders
  add constraint orders_pin_required_after_dispatch
  check (
    status not in ('OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED')
    or pin_hash is not null
  );

create table if not exists public.order_delivery_secrets (
  order_id uuid primary key references public.orders(id) on delete cascade,
  pin_code text not null check (pin_code ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  revealed_at timestamptz,
  consumed_at timestamptz
);

alter table public.order_delivery_secrets enable row level security;
revoke all on table public.order_delivery_secrets from anon, authenticated;
grant all on table public.order_delivery_secrets to service_role;

drop policy if exists "deny authenticated delivery secrets" on public.order_delivery_secrets;
create policy "deny authenticated delivery secrets"
on public.order_delivery_secrets for all to authenticated
using (false) with check (false);

-- 7) Order identity is projected by Edge Functions, never directly by browser.
revoke select on table public.orders, public.order_items, public.order_events from authenticated;

-- 8) Profile/referral code creation for every Auth user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.profiles(user_id,referral_code)
  values(
    new.id,
    upper(substr(replace(new.id::text,'-',''),1,20))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
grant execute on function public.handle_new_auth_user() to postgres, service_role;

drop trigger if exists on_auth_user_created_chama on auth.users;
create trigger on_auth_user_created_chama
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- 9) Atomic create-order authority.
create or replace function public.create_order_from_quote(
  p_user_id uuid,
  p_quote_id uuid,
  p_payment_method text,
  p_use_cashback boolean,
  p_idempotency_key text,
  p_request_hash text,
  p_referral_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_quote public.quotes%rowtype;
  v_merchant public.merchants%rowtype;
  v_order_id uuid;
  v_public_code text;
  v_cashback_balance bigint := 0;
  v_reserved integer := 0;
  v_total integer := 0;
  v_offer_expires_at timestamptz;
  v_result jsonb;
  v_referrer uuid;
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_payment_method not in ('pix','card','cash') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<12 or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or char_length(p_request_hash)<>64 then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_user_id,'create-order',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_user_id or v_action.action_name<>'create-order' or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    if v_action.result_json is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return v_action.result_json;
  end if;

  select * into v_quote
  from public.quotes
  where id=p_quote_id and customer_id=p_user_id
  for update;

  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if v_quote.consumed_at is not null then raise exception 'QUOTE_ALREADY_USED' using errcode='23505'; end if;
  if v_quote.expires_at<=clock_timestamp() then raise exception 'QUOTE_EXPIRED' using errcode='22023'; end if;

  select * into v_merchant
  from public.merchants
  where id=v_quote.merchant_id
  for share;

  if not found
     or v_merchant.status<>'active'
     or not v_merchant.online
     or not v_merchant.accepts_citywide
     or v_merchant.last_seen_at is null
     or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1
    from public.quote_items qi
    left join public.catalog_items ci
      on ci.merchant_id=v_quote.merchant_id and ci.product_code=qi.product_code
    where qi.quote_id=v_quote.id
      and (ci.merchant_id is null or not ci.active or ci.available_stock<qi.quantity)
  ) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1 from public.orders
    where customer_id=p_user_id and status not in ('SETTLED','CANCELLED')
  ) then
    raise exception 'ACTIVE_ORDER_EXISTS' using errcode='23505';
  end if;

  select greatest(0,coalesce(sum(amount_cents),0))
  into v_cashback_balance
  from public.wallet_entries
  where user_id=p_user_id and bucket='cashback';

  if p_use_cashback then
    v_reserved:=least(v_quote.gross_total_cents,v_cashback_balance)::integer;
  end if;

  v_total:=v_quote.gross_total_cents-v_reserved;
  v_order_id:=gen_random_uuid();
  v_public_code:='SG-'||upper(substr(replace(v_order_id::text,'-',''),1,12));
  v_offer_expires_at:=clock_timestamp()+interval '3 minutes';

  insert into public.orders(
    id,public_code,customer_id,merchant_id,status,address_text,payment_method,
    gross_total_cents,cashback_reserved_cents,total_cents,pin_hash,
    attempted_merchant_ids,offer_expires_at
  ) values(
    v_order_id,v_public_code,p_user_id,v_quote.merchant_id,'OFFERED_TO_MERCHANT',
    v_quote.address_text,p_payment_method,v_quote.gross_total_cents,v_reserved,v_total,
    null,array[v_quote.merchant_id],v_offer_expires_at
  );

  insert into public.order_items(
    order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  )
  select v_order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  from public.quote_items where quote_id=v_quote.id;

  if v_reserved>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    ) values(
      p_user_id,v_order_id,'cashback','cashback_reserve',-v_reserved,
      p_idempotency_key||':cashback-reserve',
      jsonb_build_object('quoteId',v_quote.id)
    );
  end if;

  if p_referral_code is not null and char_length(trim(p_referral_code)) between 6 and 20 then
    select user_id into v_referrer
    from public.profiles
    where referral_code=upper(trim(p_referral_code))
    limit 1;

    if v_referrer is not null and v_referrer<>p_user_id then
      insert into public.referrals(referred_user_id,referrer_user_id,referral_code)
      values(p_user_id,v_referrer,upper(trim(p_referral_code)))
      on conflict(referred_user_id) do nothing;
    end if;
  end if;

  insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
  values
    (v_order_id,p_user_id,'customer','CREATED','Pedido recebido','Pedido criado a partir de uma cotação válida.'),
    (v_order_id,p_user_id,'system','QUOTE_LOCKED','Preço protegido','Preço, itens e endereço foram congelados para este pedido.'),
    (v_order_id,p_user_id,'system','OFFERED_TO_MERCHANT','Aguardando confirmação da revenda','A revenda precisa aceitar antes de o pedido ser considerado confirmado.');

  update public.quotes set consumed_at=clock_timestamp() where id=v_quote.id;

  v_result:=jsonb_build_object(
    'orderId',v_order_id,'publicCode',v_public_code,'status','OFFERED_TO_MERCHANT',
    'grossTotalCents',v_quote.gross_total_cents,'cashbackReservedCents',v_reserved,
    'totalCents',v_total,'offerExpiresAt',v_offer_expires_at
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.create_order_from_quote(uuid,uuid,text,boolean,text,text,text)
  from public, anon, authenticated;
grant execute on function public.create_order_from_quote(uuid,uuid,text,boolean,text,text,text)
  to service_role;

-- 10) Merchant action authority.
create or replace function public.merchant_order_action(
  p_user_id uuid,
  p_order_id uuid,
  p_action text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_merchant public.merchants%rowtype;
  v_member_role text;
  v_item record;
  v_candidate_id uuid;
  v_candidate_gross integer;
  v_new_reserved integer;
  v_release_diff integer;
  v_dispatch_minutes integer;
  v_pin_seed integer;
  v_pin_code text;
  v_pin_hash text;
  v_result jsonb;
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_action not in ('accept','reject','dispatch','arriving') then raise exception 'INVALID_ACTION' using errcode='22023'; end if;
  if p_expected_version is null or p_expected_version<1 then raise exception 'INVALID_VERSION' using errcode='22023'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<12 or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or char_length(p_request_hash)<>64 then raise exception 'INVALID_REQUEST_HASH' using errcode='22023'; end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_user_id,'merchant-action:'||p_action,p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action from public.action_requests
  where idempotency_key=p_idempotency_key for update;

  if v_action.user_id<>p_user_id
     or v_action.action_name<>'merchant-action:'||p_action
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then return v_action.result_json; end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;

  select mm.member_role into v_member_role
  from public.merchant_members mm
  where mm.merchant_id=v_order.merchant_id and mm.user_id=p_user_id and mm.active
  limit 1;
  if not found then raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action in ('accept','reject') and v_member_role not in ('owner','manager','operator') then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;
  if v_order.version<>p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;

  select * into v_merchant from public.merchants where id=v_order.merchant_id for share;
  if not found then raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002'; end if;

  if p_action='accept' then
    if v_order.status<>'OFFERED_TO_MERCHANT' then raise exception 'INVALID_TRANSITION' using errcode='40001'; end if;
    if v_order.offer_expires_at is null or v_order.offer_expires_at<=clock_timestamp() then
      raise exception 'OFFER_EXPIRED' using errcode='40001';
    end if;
    if v_merchant.status<>'active'
       or not v_merchant.online
       or v_merchant.last_seen_at is null
       or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
      raise exception 'MERCHANT_UNAVAILABLE' using errcode='40001';
    end if;

    for v_item in
      select product_code,quantity from public.order_items
      where order_id=v_order.id order by product_code
    loop
      update public.catalog_items
      set available_stock=available_stock-v_item.quantity,
          updated_at=clock_timestamp()
      where merchant_id=v_order.merchant_id
        and product_code=v_item.product_code
        and active and available_stock>=v_item.quantity;
      if not found then raise exception 'INSUFFICIENT_STOCK' using errcode='40001'; end if;
    end loop;

    v_dispatch_minutes:=greatest(3,least(10,ceil(v_merchant.base_eta_minutes*0.35)::integer));

    update public.orders
    set status='PREPARING',
        supplier_name_snapshot=v_merchant.name,
        accepted_at=clock_timestamp(),
        dispatch_due_at=clock_timestamp()+make_interval(mins=>v_dispatch_minutes),
        promised_by=clock_timestamp()+make_interval(mins=>v_merchant.base_eta_minutes+7),
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id returning * into v_order;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values
      (v_order.id,p_user_id,'merchant','MERCHANT_ACCEPTED','Revenda confirmou','A revenda confirmou itens, preço e capacidade de entrega.'),
      (v_order.id,p_user_id,'merchant','PREPARING','Em preparação','Estoque reservado e entrega sendo preparada.');

    v_result:=jsonb_build_object(
      'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'supplierName',v_order.supplier_name_snapshot,'dispatchDueAt',v_order.dispatch_due_at,
      'promisedBy',v_order.promised_by
    );

  elsif p_action='reject' then
    if v_order.status<>'OFFERED_TO_MERCHANT' then raise exception 'INVALID_TRANSITION' using errcode='40001'; end if;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values(v_order.id,p_user_id,'merchant','REASSIGNING','Buscando outra revenda','A revenda recusou antes do aceite.');

    select
      m.id,
      (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents)::integer
    into v_candidate_id,v_candidate_gross
    from public.merchants m
    join public.order_items oi on oi.order_id=v_order.id
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
    order by (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents) asc,
             m.base_eta_minutes asc,m.trust_score desc
    limit 1;

    if v_candidate_id is null then
      update public.orders
      set status='CANCELLED',version=version+1,updated_at=clock_timestamp()
      where id=v_order.id returning * into v_order;

      if v_order.cashback_reserved_cents>0 then
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        ) values(
          v_order.customer_id,v_order.id,'cashback','cashback_release',
          v_order.cashback_reserved_cents,p_idempotency_key||':cashback-release',
          jsonb_build_object('reason','no_alternative_merchant')
        );
      end if;

      insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
      values(v_order.id,null,'system','CANCELLED','Pedido cancelado','Nenhuma outra revenda elegível conseguiu atender a cesta.');

      v_result:=jsonb_build_object('orderId',v_order.id,'status','CANCELLED','version',v_order.version);
    else
      v_new_reserved:=least(v_order.cashback_reserved_cents,v_candidate_gross);
      v_release_diff:=v_order.cashback_reserved_cents-v_new_reserved;

      if v_release_diff>0 then
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        ) values(
          v_order.customer_id,v_order.id,'cashback','cashback_release',
          v_release_diff,p_idempotency_key||':cashback-rebalance',
          jsonb_build_object('reason','cheaper_reassignment')
        );
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
            version=version+1,
            updated_at=clock_timestamp()
        where id=v_order.id returning * into v_order;

        insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
        values(v_order.id,null,'system','OFFERED_TO_MERCHANT','Nova revenda acionada','Outra revenda recebeu o pedido sem aumento de preço.');

        v_result:=jsonb_build_object(
          'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
          'totalCents',v_order.total_cents,'offerExpiresAt',v_order.offer_expires_at
        );
      else
        update public.orders
        set status='REQUOTE_REQUIRED',
            proposed_merchant_id=v_candidate_id,
            proposed_gross_total_cents=v_candidate_gross,
            proposed_total_cents=v_candidate_gross-v_new_reserved,
            version=version+1,
            updated_at=clock_timestamp()
        where id=v_order.id returning * into v_order;

        insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
        values(v_order.id,null,'system','REQUOTE_REQUIRED','Nova confirmação necessária','A alternativa encontrada possui preço diferente e precisa de aceite do cliente.');

        v_result:=jsonb_build_object(
          'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
          'proposedTotalCents',v_order.proposed_total_cents
        );
      end if;
    end if;

  elsif p_action='dispatch' then
    if v_order.status not in ('PREPARING','AT_RISK') then raise exception 'INVALID_TRANSITION' using errcode='40001'; end if;

    v_pin_seed:=get_byte(gen_random_bytes(2),0)*256+get_byte(gen_random_bytes(2),1);
    v_pin_code:=lpad((1000+(v_pin_seed%9000))::text,4,'0');
    v_pin_hash:=encode(digest(v_pin_code,'sha256'),'hex');

    insert into public.order_delivery_secrets(order_id,pin_code)
    values(v_order.id,v_pin_code)
    on conflict(order_id) do update
      set pin_code=excluded.pin_code,created_at=clock_timestamp(),revealed_at=null,consumed_at=null;

    update public.orders
    set status='OUT_FOR_DELIVERY',pin_hash=v_pin_hash,dispatched_at=clock_timestamp(),
        version=version+1,updated_at=clock_timestamp()
    where id=v_order.id returning * into v_order;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values(v_order.id,p_user_id,'merchant','OUT_FOR_DELIVERY','Saiu para entrega','A revenda confirmou explicitamente a saída.');

    v_result:=jsonb_build_object(
      'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'dispatchedAt',v_order.dispatched_at
    );

  elsif p_action='arriving' then
    if v_order.status<>'OUT_FOR_DELIVERY' then raise exception 'INVALID_TRANSITION' using errcode='40001'; end if;

    update public.orders
    set status='ARRIVING',arriving_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where id=v_order.id returning * into v_order;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values(v_order.id,p_user_id,'merchant','ARRIVING','Entregador chegando','A chegada próxima foi confirmada.');

    v_result:=jsonb_build_object(
      'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'arrivingAt',v_order.arriving_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.merchant_order_action(uuid,uuid,text,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.merchant_order_action(uuid,uuid,text,integer,text,text)
  to service_role;

-- 11) Customer authority for pre-accept cancellation and requotes.
create or replace function public.customer_order_action(
  p_user_id uuid,
  p_order_id uuid,
  p_action text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_merchant public.merchants%rowtype;
  v_result jsonb;
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_action not in ('cancel-before-accept','accept-requote') then raise exception 'INVALID_ACTION' using errcode='22023'; end if;
  if p_expected_version is null or p_expected_version<1 then raise exception 'INVALID_VERSION' using errcode='22023'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<12 or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or char_length(p_request_hash)<>64 then raise exception 'INVALID_REQUEST_HASH' using errcode='22023'; end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_user_id,'customer-action:'||p_action,p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action from public.action_requests
  where idempotency_key=p_idempotency_key for update;

  if v_action.user_id<>p_user_id
     or v_action.action_name<>'customer-action:'||p_action
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then return v_action.result_json; end if;

  select * into v_order from public.orders
  where id=p_order_id and customer_id=p_user_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_order.version<>p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;

  if p_action='cancel-before-accept' then
    if v_order.status not in ('OFFERED_TO_MERCHANT','REQUOTE_REQUIRED') then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    if v_order.cashback_reserved_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      ) values(
        v_order.customer_id,v_order.id,'cashback','cashback_release',
        v_order.cashback_reserved_cents,p_idempotency_key||':cashback-release',
        jsonb_build_object('reason','customer_cancelled_before_accept')
      );
    end if;

    update public.orders
    set status='CANCELLED',proposed_merchant_id=null,proposed_gross_total_cents=null,
        proposed_total_cents=null,version=version+1,updated_at=clock_timestamp()
    where id=v_order.id returning * into v_order;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values(v_order.id,p_user_id,'customer','CANCELLED','Cancelado pelo cliente','O pedido foi cancelado antes do compromisso de entrega.');

    v_result:=jsonb_build_object('orderId',v_order.id,'status',v_order.status,'version',v_order.version);

  elsif p_action='accept-requote' then
    if v_order.status<>'REQUOTE_REQUIRED'
       or v_order.proposed_merchant_id is null
       or v_order.proposed_gross_total_cents is null
       or v_order.proposed_total_cents is null then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    select * into v_merchant from public.merchants
    where id=v_order.proposed_merchant_id for share;

    if not found
       or v_merchant.status<>'active'
       or not v_merchant.online
       or not v_merchant.accepts_citywide
       or v_merchant.last_seen_at is null
       or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes'
       or v_merchant.price_confirmed_at is null
       or v_merchant.price_confirmed_at<clock_timestamp()-interval '24 hours' then
      raise exception 'PROPOSED_OFFER_STALE' using errcode='40001';
    end if;

    if exists(
      select 1 from public.order_items oi
      left join public.catalog_items ci
        on ci.merchant_id=v_order.proposed_merchant_id and ci.product_code=oi.product_code
      where oi.order_id=v_order.id
        and (ci.merchant_id is null or not ci.active or ci.available_stock<oi.quantity)
    ) then
      raise exception 'PROPOSED_OFFER_STALE' using errcode='40001';
    end if;

    update public.orders
    set merchant_id=v_order.proposed_merchant_id,
        supplier_name_snapshot=null,
        gross_total_cents=v_order.proposed_gross_total_cents,
        total_cents=v_order.proposed_total_cents,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        status='OFFERED_TO_MERCHANT',
        attempted_merchant_ids=array_append(attempted_merchant_ids,v_order.proposed_merchant_id),
        offer_expires_at=clock_timestamp()+interval '3 minutes',
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id returning * into v_order;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
    values
      (v_order.id,p_user_id,'customer','REQUOTE_ACCEPTED','Nova cotação aceita','O cliente aceitou explicitamente a nova condição.'),
      (v_order.id,null,'system','OFFERED_TO_MERCHANT','Nova revenda acionada','A nova revenda recebeu o pedido para confirmação.');

    v_result:=jsonb_build_object(
      'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'totalCents',v_order.total_cents,'offerExpiresAt',v_order.offer_expires_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.customer_order_action(uuid,uuid,text,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.customer_order_action(uuid,uuid,text,integer,text,text)
  to service_role;

-- 12) Atomic delivery completion authority.
create or replace function public.complete_order_delivery(
  p_user_id uuid,
  p_order_id uuid,
  p_pin_code text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
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
  v_secret public.order_delivery_secrets%rowtype;
  v_submitted_hash text;
  v_result jsonb;
  v_new_failures integer;
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_pin_code is null or p_pin_code!~'^[0-9]{4}$' then raise exception 'INVALID_PIN_FORMAT' using errcode='22023'; end if;
  if p_expected_version is null or p_expected_version<1 then raise exception 'INVALID_VERSION' using errcode='22023'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<12 or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or char_length(p_request_hash)<>64 then raise exception 'INVALID_REQUEST_HASH' using errcode='22023'; end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_user_id,'complete-delivery',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action from public.action_requests
  where idempotency_key=p_idempotency_key for update;

  if v_action.user_id<>p_user_id
     or v_action.action_name<>'complete-delivery'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then return v_action.result_json; end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;

  select mm.member_role into v_member_role
  from public.merchant_members mm
  where mm.merchant_id=v_order.merchant_id and mm.user_id=p_user_id and mm.active
  limit 1;
  if not found then raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501'; end if;

  if v_order.version<>p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  if v_order.status<>'ARRIVING' then raise exception 'INVALID_TRANSITION' using errcode='40001'; end if;
  if v_order.pin_failures>=5 then raise exception 'PIN_LOCKED' using errcode='42501'; end if;

  select * into v_secret
  from public.order_delivery_secrets
  where order_id=v_order.id
  for update;

  if not found or v_secret.consumed_at is not null or v_order.pin_hash is null then
    raise exception 'PIN_UNAVAILABLE' using errcode='40001';
  end if;

  v_submitted_hash:=encode(digest(p_pin_code,'sha256'),'hex');

  if v_submitted_hash<>v_order.pin_hash then
    v_new_failures:=v_order.pin_failures+1;

    update public.orders
    set pin_failures=v_new_failures,version=version+1,updated_at=clock_timestamp()
    where id=v_order.id returning * into v_order;

    insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail,metadata)
    values(
      v_order.id,p_user_id,'merchant',
      case when v_new_failures>=5 then 'PIN_LOCKED' else 'PIN_FAILED' end,
      case when v_new_failures>=5 then 'PIN bloqueado' else 'PIN incorreto' end,
      'A entrega não foi concluída.',
      jsonb_build_object('failureCount',v_new_failures)
    );

    v_result:=jsonb_build_object(
      'ok',false,'error',case when v_new_failures>=5 then 'PIN_LOCKED' else 'INVALID_PIN' end,
      'orderId',v_order.id,'status',v_order.status,'version',v_order.version,'pinFailures',v_new_failures
    );

    update public.action_requests
    set result_json=v_result,completed_at=clock_timestamp()
    where idempotency_key=p_idempotency_key;

    return v_result;
  end if;

  update public.orders
  set status='SETTLED',delivered_at=clock_timestamp(),settled_at=clock_timestamp(),
      version=version+1,updated_at=clock_timestamp()
  where id=v_order.id returning * into v_order;

  update public.order_delivery_secrets
  set consumed_at=clock_timestamp()
  where order_id=v_order.id;

  insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
  values
    (v_order.id,p_user_id,'merchant','DELIVERED','Entregue','O PIN de recebimento foi validado.'),
    (v_order.id,null,'system','SETTLED','Pedido concluído','A entrega foi conciliada e encerrada.');

  update public.referrals
  set qualified_order_id=v_order.id
  where referred_user_id=v_order.customer_id and qualified_order_id is null;

  v_result:=jsonb_build_object(
    'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
    'deliveredAt',v_order.delivered_at,'settledAt',v_order.settled_at
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.complete_order_delivery(uuid,uuid,text,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.complete_order_delivery(uuid,uuid,text,integer,text,text)
  to service_role;
