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

-- Recheck the city at final checkout; a previously quoted city may have been suspended.
CREATE OR REPLACE FUNCTION public.create_order_from_quote_v8(p_user_id uuid, p_quote_id uuid, p_payment_method text, p_use_cashback boolean, p_idempotency_key text, p_request_hash text, p_referral_code text DEFAULT NULL::text, p_cash_tender_cents integer DEFAULT NULL::integer, p_customer_phone text DEFAULT NULL::text, p_address_complement text DEFAULT NULL::text, p_delivery_reference text DEFAULT NULL::text, p_delivery_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_enabled boolean:=false;
  v_mode text:='PRELAUNCH';
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_result jsonb;
  v_order_id uuid;
  v_merchant_id uuid;
  v_city_commerce_authorized boolean:=false;
begin
  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key;

  if found and v_action.completed_at is not null then
    if v_action.user_id<>p_user_id
       or v_action.action_name<>'create-order'
       or v_action.request_hash<>p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;

    v_result:=v_action.result_json;
    v_order_id:=(v_result->>'orderId')::uuid;

    select *
    into v_order
    from public.orders o
    where o.id=v_order_id
      and o.customer_id=p_user_id;

    if not found then
      raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
    end if;

    return v_result||jsonb_build_object(
      'cashTenderCents',v_order.cash_tender_cents,
      'deliveryWindowStart',v_order.delivery_window_start,
      'deliveryWindowEnd',v_order.delivery_window_end,
      'comparisonSavingsCents',v_order.comparison_savings_cents,
      'deliveryDetailsCaptured',true,
      'postalCode',v_order.postal_code,
      'postalValidated',v_order.postal_code is not null,
      'addressNumber',v_order.address_number,
      'canonicalAddress',v_order.address_text
    );
  end if;

  -- Serialize every new checkout attempt for this customer before any lower
  -- layer evaluates ACTIVE_ORDER_EXISTS, referral first-order state or cashback.
  -- Reuses the same lock namespace already used by create_order_from_quote().
  perform pg_advisory_xact_lock(
    hashtextextended('cashback-user:'||p_user_id::text,0)
  );

  select commerce_enabled,operation_mode
  into v_enabled,v_mode
  from public.platform_launch_control
  where singleton=true
  for share;

  if not coalesce(v_enabled,false) then
    raise exception 'COMMERCE_NOT_ENABLED' using errcode='55000';
  end if;

  -- V1.306: an existing quote cannot be converted into a NEW order after
  -- the founder suspends commerce for that city. Previously confirmed orders
  -- and idempotent replay responses remain unaffected.
  select exists (
    select 1 from public.quotes q
    join public.postal_code_validation_cache pc
      on pc.postal_code=q.postal_code and pc.service_area_allowed
      and pc.verified_at>=statement_timestamp()-interval '30 days'
    join public.market_cities mc
      on mc.state=upper(trim(pc.state))
      and mc.city_key=public.market_city_key(pc.city)
    where q.id=p_quote_id and q.customer_id=p_user_id
      and mc.commerce_enabled is true and mc.admin_paused is false
  ) into v_city_commerce_authorized;
  if not coalesce(v_city_commerce_authorized,false) then
    raise exception 'CITY_COMMERCE_NOT_AUTHORIZED' using errcode='42501';
  end if;

  if upper(coalesce(v_mode,'PRELAUNCH'))='PILOT' then
    select q.merchant_id
    into v_merchant_id
    from public.quotes q
    where q.id=p_quote_id
      and q.customer_id=p_user_id;

    if not found or not exists(
      select 1
      from public.pilot_partner_drafts d
      where d.merchant_id=v_merchant_id
        and d.onboarding_status='converted'
    ) then
      raise exception 'PILOT_MERCHANT_NOT_ALLOWED' using errcode='40001';
    end if;
  end if;

  return public.create_order_from_quote_v7(
    p_user_id,p_quote_id,p_payment_method,p_use_cashback,
    p_idempotency_key,p_request_hash,p_referral_code,p_cash_tender_cents,
    p_customer_phone,p_address_complement,p_delivery_reference,p_delivery_notes
  );
end;
$function$
