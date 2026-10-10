-- V1.152 — independent municipal supply authority. No partner = no open city.
-- National registrations and ANP prospect imports cannot create sellable supply.
alter table public.market_cities
  add column if not exists admin_paused boolean not null default false,
  add column if not exists paused_at timestamptz;

create index if not exists merchant_business_city_scope_idx
  on public.merchant_business_details (state,city,merchant_id);

create or replace function public.market_city_key(p_city text)
returns text
language sql immutable parallel safe
set search_path to pg_catalog
as $func$
  select trim(regexp_replace(
    translate(upper(coalesce(p_city,'')),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'AAAAAEEEEIIIIOOOOOUUUUC'),
    '[^A-Z0-9]+',' ','g'
  ));
$func$;
revoke all on function public.market_city_key(text) from public,anon,authenticated;
grant execute on function public.market_city_key(text) to service_role;

create or replace function public.market_city_offer_scope(p_city text,p_state text)
returns uuid[]
language sql stable security definer
set search_path to pg_catalog
as $func$
with requested as (
  select public.market_city_key(p_city) as city_key, upper(trim(coalesce(p_state,''))) as state
)
select coalesce(array_agg(m.id order by m.id),array[]::uuid[])
from requested r
join public.merchant_business_details d
  on upper(trim(d.state))=r.state
 and public.market_city_key(d.city)=r.city_key
join public.merchants m on m.id=d.merchant_id
where char_length(r.city_key)>=2
  and r.state ~ '^[A-Z]{2}$'
  and m.status='active'
  and m.online
  and m.accepts_citywide
  and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
  and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
  and public.merchant_operational_compliance_current(m.id)
  and public.merchant_allowed_in_operation_mode(m.id)
  and public.merchant_financial_sales_allowed(m.id)
  and exists (
    select 1 from public.platform_launch_control lc
    where lc.singleton and lc.commerce_enabled
      and lc.operation_mode in ('LIVE','PILOT')
  )
  and not exists (
    select 1 from public.market_cities mc
    where mc.state=r.state and mc.city_key=r.city_key and mc.admin_paused
  )
  and exists (
    select 1 from public.catalog_items ci
    where ci.merchant_id=m.id and ci.active
      and ci.available_stock>0 and ci.price_cents>0
      and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
  )
  and exists (
    select 1 from public.merchant_payment_methods pm
    where pm.merchant_id=m.id and pm.active
  )
  and exists (
    select 1 from public.merchant_payment_routes pr
    where pr.merchant_id=m.id and pr.active
  );
$func$;
revoke all on function public.market_city_offer_scope(text,text) from public,anon,authenticated;
grant execute on function public.market_city_offer_scope(text,text) to service_role;

create or replace function public.market_city_ready(p_city text,p_state text)
returns boolean
language sql stable security definer
set search_path to pg_catalog
as $func$
  select cardinality(public.market_city_offer_scope(p_city,p_state))>0;
$func$;
revoke all on function public.market_city_ready(text,text) from public,anon,authenticated;
grant execute on function public.market_city_ready(text,text) to service_role;

-- Quote insertion is the durable commerce boundary: a merchant must be in
-- the same municipality AND currently pass all operational checks.
create or replace function public.assert_quote_city_scope()
returns trigger
language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
  v_city text;
  v_state text;
  v_ids uuid[];
begin
  select pc.city,pc.state into v_city,v_state
  from public.postal_code_validation_cache pc
  where pc.postal_code=new.postal_code
    and pc.service_area_allowed
    and pc.verified_at>=statement_timestamp()-interval '30 days';
  if not found or v_city is null or v_state is null then
    raise exception 'POSTAL_CODE_UNVERIFIED' using errcode='40001';
  end if;
  v_ids:=public.market_city_offer_scope(v_city,v_state);
  if not new.merchant_id=any(v_ids) then
    raise exception 'MERCHANT_CITY_NOT_READY' using errcode='40001';
  end if;
  return new;
end;
$func$;
revoke all on function public.assert_quote_city_scope() from public,anon,authenticated;
drop trigger if exists quotes_city_scope_guard on public.quotes;
create trigger quotes_city_scope_guard
  before insert or update of merchant_id,postal_code on public.quotes
  for each row execute function public.assert_quote_city_scope();

-- Cached service_area_allowed is an address verification hint, never
-- sufficient authority to bypass live municipal merchant checks.


-- Admin override is transactional and audited; no client can enable a city.
create or replace function public.admin_set_market_city_pause(
  p_actor_user_id uuid,
  p_city text,
  p_state text,
  p_paused boolean,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
  v_key text:=public.market_city_key(p_city);
  v_state text:=upper(trim(coalesce(p_state,'')));
  v_previous boolean;
begin
  if not exists(
    select 1 from public.platform_admins a where a.user_id=p_actor_user_id
      and a.active and a.admin_role in ('superadmin','operations')
  ) then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_paused is null or v_state!~'^[A-Z]{2}$' or char_length(v_key)<2
     or char_length(v_key)>120 or p_city is null or char_length(p_city)>120
     or trim(coalesce(p_reason,''))='' or char_length(p_reason)>240 then
    raise exception 'INVALID_CITY_PAUSE' using errcode='22023';
  end if;
  insert into public.market_cities(state,city_key,city_name)
  values(v_state,v_key,trim(p_city))
  on conflict (state,city_key) do nothing;

  select admin_paused into v_previous from public.market_cities
  where state=v_state and city_key=v_key for update;

  if v_previous is distinct from p_paused then
    update public.market_cities set
      admin_paused=p_paused,
      paused_at=case when p_paused then clock_timestamp() else null end,
      updated_at=clock_timestamp()
    where state=v_state and city_key=v_key;

    insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
    values(p_actor_user_id,'market-city-pause','market_city',v_state||'/'||v_key,
      jsonb_build_object('previous',v_previous,'paused',p_paused,'reason',p_reason));
  end if;
  return jsonb_build_object('city',trim(p_city),'state',v_state,'paused',p_paused,
    'changed',v_previous is distinct from p_paused);
end;
$func$;
revoke all on function public.admin_set_market_city_pause(uuid,text,text,boolean,text)
from public,anon,authenticated;
grant execute on function public.admin_set_market_city_pause(uuid,text,text,boolean,text) to service_role;
