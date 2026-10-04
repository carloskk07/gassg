-- TAMÃO v1.66.5 — onboarding assistido também usa o registro canônico de produtos.
create or replace function public.admin_assisted_merchant_onboarding(
  p_actor_user_id uuid,
  p_draft_id uuid,
  p_trade_name text,
  p_legal_name text,
  p_cnpj text,
  p_responsible_name text,
  p_phone text,
  p_whatsapp text,
  p_postal_code text,
  p_city text,
  p_state text,
  p_address_text text,
  p_owner_user_id uuid,
  p_owner_display_name text,
  p_product_code text,
  p_product_name text,
  p_pricing_mode text,
  p_min_price_cents integer,
  p_preferred_price_cents integer,
  p_max_price_cents integer,
  p_pricing_strategy text,
  p_available_stock integer,
  p_payment_methods text[],
  p_delivery_fee_cents integer,
  p_base_eta_minutes integer,
  p_accepts_citywide boolean,
  p_service_radius_km numeric,
  p_admin_notes text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_action public.action_requests%rowtype;
  v_draft public.pilot_partner_drafts%rowtype;
  v_merchant public.merchants%rowtype;
  v_product_profile public.product_delivery_profiles%rowtype;
  v_existing_owner uuid;
  v_payment text;
  v_result jsonb;
  v_price_confirmed_at timestamptz;
begin
  perform public.require_platform_admin(p_actor_user_id);

  p_trade_name:=trim(coalesce(p_trade_name,''));
  p_legal_name:=trim(coalesce(p_legal_name,''));
  p_cnpj:=upper(regexp_replace(coalesce(p_cnpj,''),'[^0-9A-Z]','','g'));
  p_responsible_name:=trim(coalesce(p_responsible_name,''));
  p_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  p_whatsapp:=regexp_replace(coalesce(p_whatsapp,''),'[^0-9]','','g');
  p_postal_code:=regexp_replace(coalesce(p_postal_code,''),'[^0-9]','','g');
  p_city:=trim(coalesce(p_city,''));
  p_state:=upper(trim(coalesce(p_state,'RS')));
  p_address_text:=trim(regexp_replace(coalesce(p_address_text,''),'\s+',' ','g'));
  p_product_code:=upper(trim(coalesce(p_product_code,'')));
  p_product_name:=trim(coalesce(p_product_name,''));
  p_pricing_mode:=lower(trim(coalesce(p_pricing_mode,'')));
  p_pricing_strategy:=lower(trim(coalesce(p_pricing_strategy,'balanced')));
  p_owner_display_name:=nullif(trim(coalesce(p_owner_display_name,'')),'');
  p_admin_notes:=nullif(trim(coalesce(p_admin_notes,'')),'');

  if char_length(p_trade_name) not between 2 and 120
     or char_length(p_legal_name) not between 2 and 180
     or char_length(p_responsible_name) not between 2 and 120 then
    raise exception 'INVALID_MERCHANT_IDENTITY' using errcode='22023';
  end if;
  if p_cnpj!~'^[0-9A-Z]{12}[0-9]{2}$' then
    raise exception 'INVALID_CNPJ' using errcode='22023';
  end if;
  if p_phone!~'^[0-9]{10,13}$' or p_whatsapp!~'^[0-9]{10,13}$' then
    raise exception 'INVALID_MERCHANT_PHONE' using errcode='22023';
  end if;
  if p_postal_code!~'^[0-9]{8}$'
     or char_length(p_city) not between 2 and 120
     or p_state!~'^[A-Z]{2}$'
     or char_length(p_address_text) not between 5 and 240 then
    raise exception 'INVALID_MERCHANT_ADDRESS' using errcode='22023';
  end if;
  if p_product_code!~'^[A-Z][A-Z0-9_]{1,31}$' then
    raise exception 'INVALID_PRODUCT_CODE' using errcode='22023';
  end if;

  select p.*
  into v_product_profile
  from public.product_delivery_profiles p
  where p.product_code=p_product_code
    and p.active
    and p.merchant_add_allowed
  for share;

  if not found then
    raise exception 'INVALID_PRODUCT_CODE' using errcode='22023';
  end if;

  if not exists(
    select 1
    from public.product_categories c
    where c.category_key=v_product_profile.category_key
      and c.active
  ) then
    raise exception 'INVALID_PRODUCT_CODE' using errcode='22023';
  end if;

  p_product_name:=v_product_profile.product_name;
  if p_pricing_mode not in ('fixed','range')
     or p_pricing_strategy not in ('volume','balanced','margin') then
    raise exception 'INVALID_PRICING_POLICY' using errcode='22023';
  end if;
  if p_min_price_cents is null or p_preferred_price_cents is null or p_max_price_cents is null
     or p_min_price_cents<1 or p_max_price_cents>1000000
     or p_min_price_cents>p_preferred_price_cents
     or p_preferred_price_cents>p_max_price_cents
     or (p_pricing_mode='fixed' and not (
       p_min_price_cents=p_preferred_price_cents and p_preferred_price_cents=p_max_price_cents
     )) then
    raise exception 'INVALID_PRICE_RANGE' using errcode='22023';
  end if;
  if p_available_stock is null or p_available_stock<0 or p_available_stock>1000000 then
    raise exception 'INVALID_STOCK' using errcode='22023';
  end if;
  if p_delivery_fee_cents is null or p_delivery_fee_cents<0 or p_delivery_fee_cents>100000
     or p_base_eta_minutes is null or p_base_eta_minutes<5 or p_base_eta_minutes>180
     or p_service_radius_km is not null and (p_service_radius_km<0 or p_service_radius_km>100) then
    raise exception 'INVALID_DELIVERY_CONFIGURATION' using errcode='22023';
  end if;
  if p_admin_notes is not null and char_length(p_admin_notes)>2000 then
    raise exception 'INVALID_ADMIN_NOTES' using errcode='22023';
  end if;
  if exists(
    select 1 from unnest(coalesce(p_payment_methods,'{}'::text[])) x
    where x not in ('pix','card','cash')
  ) then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<12 or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or char_length(p_request_hash)<>64 or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  if p_draft_id is not null then
    select * into v_draft
    from public.pilot_partner_drafts
    where id=p_draft_id
    for update;

    if not found then
      raise exception 'PILOT_PARTNER_NOT_FOUND' using errcode='P0002';
    end if;
    if v_draft.onboarding_status='cancelled' then
      raise exception 'PILOT_PARTNER_CANCELLED' using errcode='40001';
    end if;
    if v_draft.merchant_id is not null then
      select * into v_merchant from public.merchants where id=v_draft.merchant_id;
      if not found then
        raise exception 'PILOT_PARTNER_MERCHANT_MISSING' using errcode='40001';
      end if;
      return jsonb_build_object(
        'ok',true,'merchantId',v_merchant.id,'status',v_merchant.status,
        'alreadyConverted',true,'draftId',v_draft.id
      );
    end if;
    if v_draft.proposed_product_code<>p_product_code then
      raise exception 'PILOT_PRODUCT_MISMATCH' using errcode='22023';
    end if;
  end if;

  if p_owner_user_id is not null then
    if not exists(
      select 1 from auth.users u
      where u.id=p_owner_user_id and u.is_anonymous is false
    ) then
      raise exception 'OWNER_USER_NOT_FOUND' using errcode='P0002';
    end if;
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_actor_user_id,'admin-assisted-onboarding',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;
  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-assisted-onboarding'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select * into v_merchant
  from public.merchants
  where cnpj=p_cnpj
  for update;

  if found then
    if v_merchant.status='rejected' then
      raise exception 'MERCHANT_REJECTED_EXISTS' using errcode='40001';
    end if;
  else
    insert into public.merchants(
      name,cnpj,status,online,trust_score,address_text,service_radius_km,
      delivery_fee_cents,base_eta_minutes,accepts_citywide,
      price_confirmed_at,delivery_fee_confirmed_at,last_seen_at,
      max_active_orders,accepts_scheduled_orders
    )
    values(
      p_trade_name,p_cnpj,'pending',false,80,p_address_text,p_service_radius_km,
      p_delivery_fee_cents,p_base_eta_minutes,coalesce(p_accepts_citywide,false),
      clock_timestamp(),clock_timestamp(),null,
      8,false
    )
    returning * into v_merchant;
  end if;

  update public.merchants
  set name=p_trade_name,
      address_text=p_address_text,
      service_radius_km=p_service_radius_km,
      delivery_fee_cents=p_delivery_fee_cents,
      base_eta_minutes=p_base_eta_minutes,
      accepts_citywide=coalesce(p_accepts_citywide,false),
      delivery_fee_confirmed_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where id=v_merchant.id;

  insert into public.merchant_business_details(
    merchant_id,legal_name,trade_name,responsible_name,phone,whatsapp,
    postal_code,city,state,address_text,admin_notes
  )
  values(
    v_merchant.id,p_legal_name,p_trade_name,p_responsible_name,p_phone,p_whatsapp,
    p_postal_code,p_city,p_state,p_address_text,p_admin_notes
  )
  on conflict(merchant_id) do update
  set legal_name=excluded.legal_name,
      trade_name=excluded.trade_name,
      responsible_name=excluded.responsible_name,
      phone=excluded.phone,
      whatsapp=excluded.whatsapp,
      postal_code=excluded.postal_code,
      city=excluded.city,
      state=excluded.state,
      address_text=excluded.address_text,
      admin_notes=excluded.admin_notes,
      updated_at=clock_timestamp();

  if p_owner_user_id is not null then
    select mm.user_id into v_existing_owner
    from public.merchant_members mm
    where mm.merchant_id=v_merchant.id
      and mm.member_role='owner'
      and mm.active
      and mm.user_id<>p_owner_user_id
    limit 1;

    if found then
      raise exception 'MERCHANT_OWNERSHIP_CONFLICT' using errcode='42501';
    end if;

    insert into public.merchant_members(
      merchant_id,user_id,member_role,active,display_name
    )
    values(
      v_merchant.id,p_owner_user_id,'owner',true,p_owner_display_name
    )
    on conflict(merchant_id,user_id) do update
    set member_role='owner',active=true,display_name=excluded.display_name;
  end if;

  insert into public.merchant_compliance(merchant_id,cnpj_status,anp_status,notes)
  values(
    v_merchant.id,'pending',
    case when public.is_glp_product_code(p_product_code) then 'pending' else 'not_required' end,
    case
      when p_admin_notes is null then 'Onboarding assistido: validações ainda pendentes.'
      else left('Onboarding assistido: validações ainda pendentes. '||p_admin_notes,1000)
    end
  )
  on conflict(merchant_id) do nothing;

  v_price_confirmed_at:=case
    when p_draft_id is not null and v_draft.price_status='confirmed'
      then clock_timestamp()
    else null
  end;

  insert into public.catalog_items(
    merchant_id,product_code,product_name,price_cents,available_stock,active,
    price_confirmed_at,pricing_mode,min_price_cents,max_price_cents,pricing_strategy
  )
  values(
    v_merchant.id,p_product_code,v_product_profile.product_name,p_preferred_price_cents,
    p_available_stock,true,v_price_confirmed_at,p_pricing_mode,
    p_min_price_cents,p_max_price_cents,p_pricing_strategy
  )
  on conflict(merchant_id,product_code) do update
  set product_name=excluded.product_name,
      price_cents=excluded.price_cents,
      available_stock=excluded.available_stock,
      active=true,
      price_confirmed_at=excluded.price_confirmed_at,
      pricing_mode=excluded.pricing_mode,
      min_price_cents=excluded.min_price_cents,
      max_price_cents=excluded.max_price_cents,
      pricing_strategy=excluded.pricing_strategy,
      updated_at=clock_timestamp();

  foreach v_payment in array coalesce(p_payment_methods,'{}'::text[]) loop
    insert into public.merchant_payment_methods(
      merchant_id,payment_method,active,confirmed_at,updated_at
    )
    values(v_merchant.id,v_payment,true,clock_timestamp(),clock_timestamp())
    on conflict(merchant_id,payment_method) do update
    set active=true,confirmed_at=clock_timestamp(),updated_at=clock_timestamp();
  end loop;

  if p_draft_id is not null then
    update public.pilot_partner_drafts
    set onboarding_status='converted',
        merchant_id=v_merchant.id,
        updated_at=clock_timestamp()
    where id=p_draft_id;
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,'assisted-merchant-onboarding','merchant',v_merchant.id::text,
    jsonb_build_object(
      'draftId',p_draft_id,
      'cnpj',p_cnpj,
      'ownerUserId',p_owner_user_id,
      'productCode',p_product_code,
      'pricingMode',p_pricing_mode,
      'minPriceCents',p_min_price_cents,
      'preferredPriceCents',p_preferred_price_cents,
      'maxPriceCents',p_max_price_cents,
      'availableStock',p_available_stock,
      'paymentMethods',coalesce(p_payment_methods,'{}'::text[]),
      'deliveryFeeCents',p_delivery_fee_cents,
      'baseEtaMinutes',p_base_eta_minutes,
      'acceptsCitywide',coalesce(p_accepts_citywide,false),
      'compliance','pending'
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'merchantId',v_merchant.id,
    'status','pending',
    'draftId',p_draft_id,
    'ownerAssigned',p_owner_user_id is not null,
    'paymentMethods',coalesce(p_payment_methods,'{}'::text[]),
    'compliancePending',true,
    'alreadyConverted',false
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;
