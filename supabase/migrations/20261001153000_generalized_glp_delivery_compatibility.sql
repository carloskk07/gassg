-- Chama São Gabriel — generalized GLP delivery compatibility v1.15.3
-- Any valid transportable GLP product code P1..P90 inherits the regulated
-- delivery semantics even when it does not have a dedicated profile row.
-- Unknown non-GLP SKUs remain fail-closed until explicitly profiled.

create or replace function public.merchant_cart_delivery_compatible(
  p_merchant_id uuid,
  p_product_codes text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_requested integer;
  v_covered integer;
  v_requires_isolation boolean;
begin
  if p_merchant_id is null
     or p_product_codes is null
     or cardinality(p_product_codes)<1 then
    return false;
  end if;

  with requested as (
    select distinct upper(trim(x)) product_code
    from unnest(p_product_codes) x
    where trim(x)<>''
  ),
  classified as (
    select
      r.product_code,
      (
        p.product_code is not null
        or public.is_glp_product_code(r.product_code)
      ) as covered,
      (
        coalesce(p.requires_isolated_delivery,false)
        or public.is_glp_product_code(r.product_code)
      ) as requires_isolation
    from requested r
    left join public.product_delivery_profiles p
      on p.product_code=r.product_code
     and p.active
  )
  select
    count(*),
    count(*) filter (where covered),
    coalesce(bool_or(requires_isolation),false)
  into
    v_requested,
    v_covered,
    v_requires_isolation
  from classified;

  if v_requested<1 or v_covered<>v_requested then
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
