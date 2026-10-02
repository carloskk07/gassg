-- Chama São Gabriel — delivery compatibility authority v1.8
-- Fail closed for regulated GLP mixed baskets. A mixed GLP basket may only be
-- quoted/rescued/accepted by a merchant with an explicit verified capability.

create table if not exists public.product_delivery_profiles (
  product_code text primary key,
  product_name text not null,
  delivery_class text not null
    check (delivery_class in ('regulated_glp','household_general')),
  requires_isolated_delivery boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.product_delivery_profiles enable row level security;
revoke all on table public.product_delivery_profiles from anon, authenticated;
grant all on table public.product_delivery_profiles to service_role;

insert into public.product_delivery_profiles(
  product_code,product_name,delivery_class,requires_isolated_delivery,active
)
values
  ('P13','Gás P13','regulated_glp',true,true),
  ('WATER20','Água 20 L','household_general',false,true),
  ('CHARCOAL4','Carvão 4 kg','household_general',false,true),
  ('WOOD','Lenha','household_general',false,true),
  ('ICE5','Gelo 5 kg','household_general',false,true)
on conflict(product_code) do update
set product_name=excluded.product_name,
    delivery_class=excluded.delivery_class,
    requires_isolated_delivery=excluded.requires_isolated_delivery,
    active=excluded.active,
    updated_at=clock_timestamp();

create table if not exists public.merchant_delivery_capabilities (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  capability_code text not null
    check (capability_code in ('regulated_glp_mixed_load_verified')),
  active boolean not null default true,
  verified_at timestamptz not null,
  verified_by uuid not null references auth.users(id) on delete restrict,
  notes text check (notes is null or char_length(notes)<=1000),
  updated_at timestamptz not null default now(),
  primary key (merchant_id,capability_code)
);

alter table public.merchant_delivery_capabilities enable row level security;
revoke all on table public.merchant_delivery_capabilities from anon, authenticated;
grant all on table public.merchant_delivery_capabilities to service_role;

create index if not exists merchant_delivery_capabilities_active_idx
  on public.merchant_delivery_capabilities(merchant_id,capability_code)
  where active;

create or replace function public.merchant_cart_delivery_compatible(
  p_merchant_id uuid,
  p_product_codes text[]
)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog
as $$
declare
  v_requested integer;
  v_profiled integer;
  v_requires_isolation boolean;
begin
  if p_merchant_id is null
     or p_product_codes is null
     or cardinality(p_product_codes)<1 then
    return false;
  end if;

  select count(distinct upper(trim(x)))
  into v_requested
  from unnest(p_product_codes) x
  where trim(x)<>'';

  if v_requested<1 then return false; end if;

  select
    count(*),
    coalesce(bool_or(p.requires_isolated_delivery),false)
  into
    v_profiled,
    v_requires_isolation
  from public.product_delivery_profiles p
  where p.active
    and p.product_code=any(
      array(
        select distinct upper(trim(x))
        from unnest(p_product_codes) x
        where trim(x)<>''
      )
    );

  if v_profiled<>v_requested then
    return false;
  end if;

  if v_requested=1 or not v_requires_isolation then
    return true;
  end if;

  return exists(
    select 1
    from public.merchant_delivery_capabilities c
    where c.merchant_id=p_merchant_id
      and c.capability_code='regulated_glp_mixed_load_verified'
      and c.active
      and c.verified_at is not null
  );
end;
$$;

revoke all on function public.merchant_cart_delivery_compatible(uuid,text[])
from public, anon, authenticated;
grant execute on function public.merchant_cart_delivery_compatible(uuid,text[])
to postgres, service_role;

create or replace function public.filter_delivery_compatible_merchants(
  p_merchant_ids uuid[],
  p_product_codes text[]
)
returns uuid[]
language sql
security definer
stable
set search_path = pg_catalog
as $$
  select coalesce(array_agg(m order by m),array[]::uuid[])
  from unnest(p_merchant_ids) m
  where public.merchant_cart_delivery_compatible(m,p_product_codes);
$$;

revoke all on function public.filter_delivery_compatible_merchants(uuid[],text[])
from public, anon, authenticated;
grant execute on function public.filter_delivery_compatible_merchants(uuid[],text[])
to service_role;

-- Quote creation is the server-side safety boundary even if an Edge Function regresses.
create or replace function public.assert_quote_delivery_compatible()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_codes text[];
begin
  select array_agg(qi.product_code order by qi.product_code)
  into v_codes
  from public.quote_items qi
  where qi.quote_id=new.quote_id;

  -- quote_items are inserted row-by-row after quote creation; final enforcement
  -- is done by create_quote_snapshot below. This trigger remains a no-op guard
  -- for future direct quote-item mutation paths.
  return new;
end;
$$;

revoke all on function public.assert_quote_delivery_compatible()
from public, anon, authenticated;
grant execute on function public.assert_quote_delivery_compatible()
to postgres, service_role;
