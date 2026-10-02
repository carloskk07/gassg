-- Chama São Gabriel — prelaunch example auto-disable authority v1.7
-- Examples are a frontend-only preview. They disappear permanently from the
-- customer experience as soon as at least one real merchant is production-configured.
-- Temporary merchant downtime must never reactivate examples.

create or replace function public.market_supply_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_configured integer:=0;
  v_available integer:=0;
  v_products jsonb:='[]'::jsonb;
begin
  select count(*)
  into v_configured
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.price_cents>0
    );

  select count(*)
  into v_available
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and m.online
    and m.accepts_citywide
    and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
    and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
    and exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.available_stock>0
        and ci.price_cents>0
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
    );

  select coalesce(jsonb_agg(x.product_code order by x.product_code),'[]'::jsonb)
  into v_products
  from (
    select distinct ci.product_code
    from public.catalog_items ci
    join public.merchants m on m.id=ci.merchant_id
    where m.status='active'
      and public.merchant_operational_compliance_current(m.id)
      and ci.active
      and ci.price_cents>0
  ) x;

  return jsonb_build_object(
    'realSupplyConfigured',v_configured>0,
    'configuredMerchantCount',v_configured,
    'availableNow',v_available>0,
    'availableMerchantCount',v_available,
    'productCodes',v_products
  );
end;
$$;

revoke all on function public.market_supply_status()
from public, anon, authenticated;
grant execute on function public.market_supply_status()
to postgres, service_role;
