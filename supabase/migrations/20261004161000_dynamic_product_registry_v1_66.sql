-- TAMÃO v1.66 — registro dinâmico de categorias e produtos.
-- product_delivery_profiles passa a ser a autoridade canônica dos SKUs.

create table if not exists public.product_categories (
  category_key text primary key
    check(category_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  category_name text not null
    check(char_length(trim(category_name)) between 2 and 80),
  active boolean not null default true,
  sort_order integer not null default 100
    check(sort_order between 0 and 10000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid
);

alter table public.product_categories enable row level security;
revoke all on table public.product_categories from public, anon, authenticated;
grant all on table public.product_categories to service_role;

insert into public.product_categories(category_key,category_name,active,sort_order)
values
  ('glp','Gás e vasilhames',true,10),
  ('water','Água',true,20),
  ('barbecue','Churrasco e aquecimento',true,30),
  ('ice','Gelo',true,40),
  ('other','Outros',true,90)
on conflict(category_key) do update
set category_name=excluded.category_name,
    sort_order=excluded.sort_order,
    updated_at=clock_timestamp();

alter table public.product_delivery_profiles
  add column if not exists category_key text,
  add column if not exists customer_visible boolean not null default true,
  add column if not exists merchant_add_allowed boolean not null default true,
  add column if not exists sort_order integer not null default 100,
  add column if not exists created_at timestamptz not null default clock_timestamp(),
  add column if not exists updated_by uuid;

update public.product_delivery_profiles
set category_key=case product_code
      when 'WATER20' then 'water'
      when 'CHARCOAL4' then 'barbecue'
      when 'WOOD' then 'barbecue'
      when 'ICE5' then 'ice'
      else case
        when public.is_glp_product_code(product_code)
          or public.is_glp_container_product_code(product_code)
          then 'glp'
        else 'other'
      end
    end,
    customer_visible=case
      when public.is_glp_container_product_code(product_code) then false
      else customer_visible
    end,
    sort_order=case
      when product_code='P13' then 13
      when product_code='WATER20' then 200
      when product_code='CHARCOAL4' then 300
      when product_code='WOOD' then 310
      when product_code='ICE5' then 400
      else sort_order
    end
where category_key is null
   or public.is_glp_container_product_code(product_code);

insert into public.product_delivery_profiles(
  product_code,product_name,delivery_class,requires_isolated_delivery,
  active,category_key,customer_visible,merchant_add_allowed,sort_order
)
select
  'P'||g::text,
  'Gás P'||g::text,
  'regulated_glp',
  true,
  true,
  'glp',
  true,
  true,
  g
from generate_series(1,90) g
on conflict(product_code) do update
set product_name=excluded.product_name,
    delivery_class='regulated_glp',
    requires_isolated_delivery=true,
    category_key='glp',
    customer_visible=true,
    merchant_add_allowed=true,
    sort_order=excluded.sort_order,
    updated_at=clock_timestamp();

insert into public.product_delivery_profiles(
  product_code,product_name,delivery_class,requires_isolated_delivery,
  active,category_key,customer_visible,merchant_add_allowed,sort_order
)
select
  'P'||g::text||'_CONTAINER',
  'Vasilhame P'||g::text,
  'regulated_glp',
  true,
  true,
  'glp',
  false,
  true,
  1000+g
from generate_series(1,90) g
on conflict(product_code) do update
set product_name=excluded.product_name,
    delivery_class='regulated_glp',
    requires_isolated_delivery=true,
    category_key='glp',
    customer_visible=false,
    merchant_add_allowed=true,
    sort_order=excluded.sort_order,
    updated_at=clock_timestamp();

update public.product_delivery_profiles
set category_key='water', sort_order=200
where product_code='WATER20';
update public.product_delivery_profiles
set category_key='barbecue', sort_order=300
where product_code='CHARCOAL4';
update public.product_delivery_profiles
set category_key='barbecue', sort_order=310
where product_code='WOOD';
update public.product_delivery_profiles
set category_key='ice', sort_order=400
where product_code='ICE5';

alter table public.product_delivery_profiles
  alter column category_key set not null;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='product_delivery_profiles_category_fkey'
      and conrelid='public.product_delivery_profiles'::regclass
  ) then
    alter table public.product_delivery_profiles
      add constraint product_delivery_profiles_category_fkey
      foreign key(category_key)
      references public.product_categories(category_key)
      on update cascade on delete restrict;
  end if;

  if not exists(
    select 1 from pg_constraint
    where conname='product_delivery_profiles_code_shape_check'
      and conrelid='public.product_delivery_profiles'::regclass
  ) then
    alter table public.product_delivery_profiles
      add constraint product_delivery_profiles_code_shape_check
      check(product_code ~ '^[A-Z][A-Z0-9_]{1,31}$');
  end if;

  if not exists(
    select 1 from pg_constraint
    where conname='product_delivery_profiles_sort_order_check'
      and conrelid='public.product_delivery_profiles'::regclass
  ) then
    alter table public.product_delivery_profiles
      add constraint product_delivery_profiles_sort_order_check
      check(sort_order between 0 and 10000);
  end if;
end
$$;

alter table public.catalog_items
  drop constraint if exists catalog_items_product_code_check;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='catalog_items_product_code_registry_fkey'
      and conrelid='public.catalog_items'::regclass
  ) then
    alter table public.catalog_items
      add constraint catalog_items_product_code_registry_fkey
      foreign key(product_code)
      references public.product_delivery_profiles(product_code)
      on update cascade on delete restrict;
  end if;
end
$$;

create index if not exists product_delivery_profiles_category_active_idx
  on public.product_delivery_profiles(category_key,active,sort_order,product_code);

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

    v_result:=jsonb_build_object(
      'ok',true,'action',p_action,
      'categoryKey',p_category_key,
      'categoryName',p_category_name,
      'active',p_active,
      'sortOrder',p_sort_order
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
      'catalogItemsPaused',v_affected
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

revoke all on function public.admin_product_registry_action(
  uuid,text,text,text,text,text,text,boolean,boolean,boolean,boolean,integer,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_product_registry_action(
  uuid,text,text,text,text,text,text,boolean,boolean,boolean,boolean,integer,text,text,text
) to service_role;
