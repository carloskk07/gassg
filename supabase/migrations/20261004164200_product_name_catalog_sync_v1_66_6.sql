-- TAMÃO v1.66.6 — renomear produto sincroniza catálogos atuais, nunca snapshots históricos.
create or replace function public.admin_product_registry_action(
  p_actor_user_id uuid,
  p_action text,
  p_category_key text,
  p_category_name text,
  p_product_code text,
  p_product_name text,
  p_delivery_class text,
  p_requires_isolated_delivery boolean,
  p_customer_visible boolean,
  p_merchant_add_allowed boolean,
  p_active boolean,
  p_sort_order integer,
  p_reason text,
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
  v_result jsonb;
  v_is_glp boolean:=false;
  v_is_container boolean:=false;
  v_affected integer:=0;
  v_renamed integer:=0;
begin
  perform public.require_platform_admin(p_actor_user_id);

  p_action:=lower(trim(coalesce(p_action,'')));
  p_category_key:=lower(trim(coalesce(p_category_key,'')));
  p_category_name:=trim(regexp_replace(coalesce(p_category_name,''),'\s+',' ','g'));
  p_product_code:=upper(trim(coalesce(p_product_code,'')));
  p_product_name:=trim(regexp_replace(coalesce(p_product_name,''),'\s+',' ','g'));
  p_delivery_class:=lower(trim(coalesce(p_delivery_class,'')));
  p_reason:=trim(regexp_replace(coalesce(p_reason,''),'\s+',' ','g'));

  if p_action not in ('upsert-category','upsert-product','set-product-active') then
    raise exception 'INVALID_PRODUCT_REGISTRY_ACTION' using errcode='22023';
  end if;
  if char_length(p_reason)<3 or char_length(p_reason)>1000 then
    raise exception 'PRODUCT_REGISTRY_REASON_REQUIRED' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,'admin-product-registry:'||p_action,p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;
  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-product-registry:'||p_action
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  if p_action='upsert-category' then
    if p_category_key!~'^[a-z][a-z0-9_]{1,39}$'
       or char_length(p_category_name)<2
       or char_length(p_category_name)>80
       or p_active is null
       or p_sort_order is null
       or p_sort_order<0
       or p_sort_order>10000 then
      raise exception 'INVALID_PRODUCT_CATEGORY' using errcode='22023';
    end if;

    insert into public.product_categories(
      category_key,category_name,active,sort_order,updated_by,updated_at
    )
    values(
      p_category_key,p_category_name,p_active,p_sort_order,
      p_actor_user_id,clock_timestamp()
    )
    on conflict(category_key) do update
    set category_name=excluded.category_name,
        active=excluded.active,
        sort_order=excluded.sort_order,
        updated_by=excluded.updated_by,
        updated_at=clock_timestamp();

    if not p_active then
      update public.catalog_items ci
      set active=false,updated_at=clock_timestamp()
      where ci.active
        and exists(
          select 1
          from public.product_delivery_profiles p
          where p.product_code=ci.product_code
            and p.category_key=p_category_key
        );
      get diagnostics v_affected=row_count;
    end if;

    v_result:=jsonb_build_object(
      'ok',true,'action',p_action,
      'categoryKey',p_category_key,
      'categoryName',p_category_name,
      'active',p_active,
      'sortOrder',p_sort_order,
      'catalogItemsPaused',v_affected
    );

  elsif p_action='upsert-product' then
    if p_product_code!~'^[A-Z][A-Z0-9_]{1,31}$'
       or char_length(p_product_name)<2
       or char_length(p_product_name)>120
       or p_category_key!~'^[a-z][a-z0-9_]{1,39}$'
       or p_delivery_class not in ('regulated_glp','household_general')
       or p_requires_isolated_delivery is null
       or p_customer_visible is null
       or p_merchant_add_allowed is null
       or p_active is null
       or p_sort_order is null
       or p_sort_order<0
       or p_sort_order>10000 then
      raise exception 'INVALID_PRODUCT_PROFILE' using errcode='22023';
    end if;

    if not exists(
      select 1 from public.product_categories c
      where c.category_key=p_category_key
    ) then
      raise exception 'PRODUCT_CATEGORY_NOT_FOUND' using errcode='P0002';
    end if;

    v_is_glp:=public.is_glp_product_code(p_product_code);
    v_is_container:=public.is_glp_container_product_code(p_product_code);

    if v_is_glp then
      if p_category_key<>'glp'
         or p_delivery_class<>'regulated_glp'
         or not p_requires_isolated_delivery
         or not p_customer_visible
         or not p_merchant_add_allowed
         or p_product_name<>'Gás P'||substring(p_product_code from 2) then
        raise exception 'GLP_PRODUCT_CANONICAL_POLICY' using errcode='23514';
      end if;
    elsif v_is_container then
      if p_category_key<>'glp'
         or p_delivery_class<>'regulated_glp'
         or not p_requires_isolated_delivery
         or p_customer_visible
         or not p_merchant_add_allowed
         or p_product_name<>'Vasilhame P'||substring(
              p_product_code from '^P([1-9][0-9]?)_CONTAINER$'
            ) then
        raise exception 'GLP_PRODUCT_CANONICAL_POLICY' using errcode='23514';
      end if;
    else
      if p_delivery_class<>'household_general'
         or p_category_key='glp'
         or p_product_code~'^P([0-9].*)' then
        raise exception 'GENERAL_PRODUCT_CLASS_POLICY' using errcode='23514';
      end if;
    end if;

    insert into public.product_delivery_profiles(
      product_code,product_name,delivery_class,requires_isolated_delivery,
      active,category_key,customer_visible,merchant_add_allowed,sort_order,
      updated_by,updated_at
    )
    values(
      p_product_code,p_product_name,p_delivery_class,p_requires_isolated_delivery,
      p_active,p_category_key,p_customer_visible,p_merchant_add_allowed,p_sort_order,
      p_actor_user_id,clock_timestamp()
    )
    on conflict(product_code) do update
    set product_name=excluded.product_name,
        delivery_class=excluded.delivery_class,
        requires_isolated_delivery=excluded.requires_isolated_delivery,
        active=excluded.active,
        category_key=excluded.category_key,
        customer_visible=excluded.customer_visible,
        merchant_add_allowed=excluded.merchant_add_allowed,
        sort_order=excluded.sort_order,
        updated_by=excluded.updated_by,
        updated_at=clock_timestamp();

    update public.catalog_items
    set product_name=p_product_name,
        updated_at=clock_timestamp()
    where product_code=p_product_code
      and product_name is distinct from p_product_name;
    get diagnostics v_renamed=row_count;

    if not p_active then
      update public.catalog_items
      set active=false,updated_at=clock_timestamp()
      where product_code=p_product_code and active;
      get diagnostics v_affected=row_count;
    end if;

    v_result:=jsonb_build_object(
      'ok',true,'action',p_action,
      'productCode',p_product_code,
      'productName',p_product_name,
      'categoryKey',p_category_key,
      'active',p_active,
      'catalogItemsPaused',v_affected,
      'catalogItemsRenamed',v_renamed
    );

  else
    if p_product_code!~'^[A-Z][A-Z0-9_]{1,31}$'
       or p_active is null then
      raise exception 'INVALID_PRODUCT_PROFILE' using errcode='22023';
    end if;

    update public.product_delivery_profiles
    set active=p_active,
        updated_by=p_actor_user_id,
        updated_at=clock_timestamp()
    where product_code=p_product_code;

    if not found then
      raise exception 'PRODUCT_PROFILE_NOT_FOUND' using errcode='P0002';
    end if;

    if not p_active then
      update public.catalog_items
      set active=false,updated_at=clock_timestamp()
      where product_code=p_product_code and active;
      get diagnostics v_affected=row_count;
    end if;

    v_result:=jsonb_build_object(
      'ok',true,'action',p_action,
      'productCode',p_product_code,
      'active',p_active,
      'catalogItemsPaused',v_affected
    );
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'product-registry-'||p_action,
    case when p_action='upsert-category' then 'product_category' else 'product_profile' end,
    case when p_action='upsert-category' then p_category_key else p_product_code end,
    jsonb_build_object('reason',p_reason,'result',v_result)
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;
