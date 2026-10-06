-- TAMÃO V1.70.27 — catalog retry authority
-- Make price/stock creation and updates replay-safe across ACK loss and concurrent tabs.

create or replace function public.merchant_catalog_action(
  p_user_id uuid,
  p_merchant_id uuid,
  p_product_code text,
  p_expected_updated_at timestamptz,
  p_price_cents integer,
  p_pricing_mode text,
  p_min_price_cents integer,
  p_max_price_cents integer,
  p_pricing_strategy text,
  p_available_stock integer,
  p_active boolean,
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
  v_role text;
  v_profile public.product_delivery_profiles%rowtype;
  v_catalog public.catalog_items%rowtype;
  v_existing boolean:=false;
  v_now timestamptz:=clock_timestamp();
  v_result jsonb;
begin
  if p_user_id is null or p_merchant_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  p_product_code:=upper(trim(coalesce(p_product_code,'')));
  p_pricing_mode:=lower(trim(coalesce(p_pricing_mode,'')));
  p_pricing_strategy:=lower(trim(coalesce(p_pricing_strategy,'')));

  if p_product_code!~'^[A-Z][A-Z0-9_]{1,31}$' then
    raise exception 'INVALID_PRODUCT' using errcode='22023';
  end if;
  if p_pricing_mode not in ('fixed','range') then
    raise exception 'INVALID_PRICING_MODE' using errcode='22023';
  end if;
  if p_pricing_strategy not in ('volume','balanced','margin') then
    raise exception 'INVALID_PRICING_STRATEGY' using errcode='22023';
  end if;
  if p_price_cents is null or p_price_cents<1 or p_price_cents>1000000
     or p_min_price_cents is null or p_min_price_cents<1 or p_min_price_cents>1000000
     or p_max_price_cents is null or p_max_price_cents<1 or p_max_price_cents>1000000 then
    raise exception 'INVALID_PRICE' using errcode='22023';
  end if;
  if p_pricing_mode='fixed'
     and (p_min_price_cents<>p_price_cents or p_max_price_cents<>p_price_cents) then
    raise exception 'INVALID_PRICE_RANGE' using errcode='22023';
  end if;
  if p_pricing_mode='range'
     and (p_min_price_cents>p_price_cents or p_price_cents>p_max_price_cents) then
    raise exception 'INVALID_PRICE_RANGE' using errcode='22023';
  end if;
  if p_available_stock is null or p_available_stock<0 or p_available_stock>100000 then
    raise exception 'INVALID_STOCK' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120
     or p_idempotency_key!~'^[A-Za-z0-9._:-]+$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_user_id,'merchant-catalog:update-product',p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;
  if v_action.user_id<>p_user_id
     or v_action.action_name<>'merchant-catalog:update-product'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select mm.member_role
  into v_role
  from public.merchant_members mm
  where mm.merchant_id=p_merchant_id
    and mm.user_id=p_user_id
    and mm.active
  limit 1;

  if not found or v_role not in ('owner','manager') then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  select pdp.*
  into v_profile
  from public.product_delivery_profiles pdp
  join public.product_categories pc
    on pc.category_key=pdp.category_key
   and pc.active
  where pdp.product_code=p_product_code
    and pdp.active
    and pdp.merchant_add_allowed
  for share of pdp;

  if not found then
    raise exception 'INVALID_PRODUCT' using errcode='22023';
  end if;

  select *
  into v_catalog
  from public.catalog_items
  where merchant_id=p_merchant_id
    and product_code=p_product_code
  for update;

  v_existing:=found;

  if v_existing then
    if p_expected_updated_at is null then
      raise exception 'CATALOG_VERSION_REQUIRED' using errcode='40001';
    end if;
    if v_catalog.updated_at is distinct from p_expected_updated_at then
      raise exception 'CATALOG_VERSION_CONFLICT' using errcode='40001';
    end if;

    update public.catalog_items
    set product_name=v_profile.product_name,
        price_cents=p_price_cents,
        pricing_mode=p_pricing_mode,
        min_price_cents=p_min_price_cents,
        max_price_cents=p_max_price_cents,
        pricing_strategy=p_pricing_strategy,
        available_stock=p_available_stock,
        active=coalesce(p_active,true),
        price_confirmed_at=v_now,
        updated_at=v_now
    where merchant_id=p_merchant_id
      and product_code=p_product_code
    returning * into v_catalog;
  else
    if p_expected_updated_at is not null then
      raise exception 'CATALOG_VERSION_CONFLICT' using errcode='40001';
    end if;

    insert into public.catalog_items(
      merchant_id,product_code,product_name,price_cents,pricing_mode,
      min_price_cents,max_price_cents,pricing_strategy,available_stock,
      active,price_confirmed_at,updated_at
    )
    values(
      p_merchant_id,p_product_code,v_profile.product_name,p_price_cents,p_pricing_mode,
      p_min_price_cents,p_max_price_cents,p_pricing_strategy,p_available_stock,
      coalesce(p_active,true),v_now,v_now
    )
    returning * into v_catalog;
  end if;

  update public.merchants
  set last_seen_at=v_now,
      online=case
        when exists(
          select 1
          from public.catalog_items ci
          where ci.merchant_id=p_merchant_id
            and ci.active
            and ci.available_stock>0
        ) then online
        else false
      end
  where id=p_merchant_id;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  v_result:=jsonb_build_object(
    'ok',true,
    'replayed',false,
    'product',jsonb_build_object(
      'product_code',v_catalog.product_code,
      'product_name',v_catalog.product_name,
      'price_cents',v_catalog.price_cents,
      'pricing_mode',v_catalog.pricing_mode,
      'min_price_cents',v_catalog.min_price_cents,
      'max_price_cents',v_catalog.max_price_cents,
      'pricing_strategy',v_catalog.pricing_strategy,
      'available_stock',v_catalog.available_stock,
      'active',v_catalog.active,
      'price_confirmed_at',v_catalog.price_confirmed_at,
      'updated_at',v_catalog.updated_at
    ),
    'priceConfirmedAt',v_catalog.price_confirmed_at
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.merchant_catalog_action(
  uuid,uuid,text,timestamptz,integer,text,integer,integer,text,integer,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.merchant_catalog_action(
  uuid,uuid,text,timestamptz,integer,text,integer,integer,text,integer,boolean,text,text
) to service_role;
