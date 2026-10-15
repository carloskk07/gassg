-- TAMÃO V1.306 — city-level commercial authorization controlled by the founder.
-- Preserves the global launch gate, merchant compliance, stock, payment and heartbeat checks.
-- Never changes an existing city or merchant automatically.
create or replace function public.market_city_offer_scope(p_city text,p_state text)
returns uuid[]
language sql stable security definer
set search_path to 'pg_catalog'
as $function$
with requested as (
  select public.market_city_key(p_city) as city_key,
         upper(trim(coalesce(p_state,''))) as state
)
select coalesce(array_agg(m.id order by m.id),array[]::uuid[])
from requested r
join public.market_cities mc on mc.city_key=r.city_key and mc.state=r.state
  and mc.commerce_enabled is true and mc.admin_paused is false
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
  and public.merchant_cnpj_compliance_current(m.id)
  and public.merchant_allowed_in_operation_mode(m.id)
  and public.merchant_financial_sales_allowed(m.id)
  and exists (
    select 1 from public.platform_launch_control lc
    where lc.singleton and lc.commerce_enabled
      and lc.operation_mode in ('LIVE','PILOT')
  )
  and exists (
    select 1 from public.catalog_items ci
    where ci.merchant_id=m.id and ci.active
      and ci.available_stock>0 and ci.price_cents>0
      and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
      and public.merchant_basket_compliance_current(m.id,array[ci.product_code])
  )
  and exists (
    select 1 from public.merchant_payment_methods pm
    where pm.merchant_id=m.id and pm.active
      and public.merchant_delivery_payment_allowed(m.id,pm.payment_method)
  );
$function$;
comment on function public.market_city_offer_scope(text,text)
  is 'V1.306: city commerce_enabled AND not admin_paused plus global mode, compliance and quote readiness';

create or replace function public.admin_set_market_city_commerce(
  p_actor_user_id uuid,p_city text,p_state text,p_enabled boolean,p_reason text
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_state text:=upper(trim(coalesce(p_state,'')));
  v_key text:=public.market_city_key(p_city);
  v_city text;
  v_previous boolean;
  v_paused boolean;
begin
  -- Only the founder's active superadmin role may authorize opening a city.
  -- The Edge function is the exclusive caller and derives p_actor_user_id from a verified JWT.
  if p_actor_user_id is null or not exists (
    select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active and a.admin_role='superadmin'
  ) then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_enabled is null or p_city is null or char_length(trim(p_city)) not between 2 and 120
     or char_length(v_key) not between 2 and 120 or v_state!~'^[A-Z]{2}$'
     or p_reason is null or char_length(trim(p_reason)) not between 5 and 240 then
    raise exception 'INVALID_CITY_COMMERCIAL_AUTHORIZATION' using errcode='22023';
  end if;
  select mc.city_name,mc.commerce_enabled,mc.admin_paused
  into v_city,v_previous,v_paused
  from public.market_cities mc
  where mc.state=v_state and mc.city_key=v_key
  for update;
  if not found then
    raise exception 'CITY_NOT_DISCOVERED' using errcode='P0002';
  end if;
  if p_enabled and v_paused then
    raise exception 'CITY_ADMINISTRATIVELY_PAUSED' using errcode='40001';
  end if;
  if p_enabled and v_previous is distinct from true and not exists (
    select 1 from public.merchant_business_details d
    join public.merchants m on m.id=d.merchant_id
    where upper(trim(d.state))=v_state
      and public.market_city_key(d.city)=v_key
      and m.status='active'
      and public.merchant_cnpj_compliance_current(m.id)
      and public.merchant_has_compliant_catalog_item(m.id)
      and exists (
        select 1 from public.merchant_members mm
        where mm.merchant_id=m.id and mm.active and mm.member_role='owner'
      )
      and exists (
        select 1 from public.merchant_payment_methods pm
        where pm.merchant_id=m.id and pm.active
      )
  ) then
    raise exception 'CITY_NO_ELIGIBLE_MERCHANT' using errcode='40001';
  end if;
  if v_previous is distinct from p_enabled then
    update public.market_cities
    set commerce_enabled=p_enabled,
        activated_at=case when p_enabled then clock_timestamp() else null end,
        updated_at=clock_timestamp()
    where state=v_state and city_key=v_key;
    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    ) values (
      p_actor_user_id,'market-city-commerce','market_city',v_state||'/'||v_key,
      jsonb_build_object('previous',v_previous,'enabled',p_enabled,
        'city',v_city,'reason',trim(p_reason),'adminPaused',v_paused)
    );
  end if;
  return jsonb_build_object(
    'city',v_city,'state',v_state,'enabled',p_enabled,
    'changed',v_previous is distinct from p_enabled,
    'adminPaused',v_paused,
    'globalModeUnchanged',true,'noMerchantActivation',true
  );
end;
$function$;

revoke all on function public.admin_set_market_city_commerce(uuid,text,text,boolean,text)
  from public,anon,authenticated;
grant execute on function public.admin_set_market_city_commerce(uuid,text,text,boolean,text)
  to service_role;
comment on function public.admin_set_market_city_commerce(uuid,text,text,boolean,text)
  is 'V1.306 service-role-only founder city authorization, admin audit; does not grant global commerce';
