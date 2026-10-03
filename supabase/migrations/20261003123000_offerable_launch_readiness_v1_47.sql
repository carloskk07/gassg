-- Chama São Gabriel — launch readiness requires one actually offerable merchant v1.47

create or replace function public.platform_launch_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_control public.platform_launch_control%rowtype;
  v_supply jsonb;
  v_active_admins integer:=0;
  v_owner_ready integer:=0;
  v_payment_ready integer:=0;
  v_offer_ready integer:=0;
  v_configured_merchants integer:=0;
  v_portals_fresh boolean:=false;
  v_database_ready boolean:=false;
  v_blockers jsonb:='[]'::jsonb;
begin
  select *
  into v_control
  from public.platform_launch_control
  where singleton=true;

  if not found then
    raise exception 'LAUNCH_CONTROL_MISSING' using errcode='P0002';
  end if;

  select count(*)::integer
  into v_active_admins
  from public.platform_admins
  where active;

  v_supply:=public.market_supply_status();
  v_configured_merchants:=coalesce((v_supply->>'configuredMerchantCount')::integer,0);

  select count(distinct m.id)::integer
  into v_owner_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and exists(
      select 1
      from public.merchant_members mm
      where mm.merchant_id=m.id
        and mm.active
        and mm.member_role='owner'
    )
    and exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.price_cents>0
    );

  select count(distinct m.id)::integer
  into v_payment_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and exists(
      select 1
      from public.merchant_payment_methods p
      where p.merchant_id=m.id
        and p.active
    )
    and exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.price_cents>0
    );

  select count(distinct m.id)::integer
  into v_offer_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and m.online
    and m.accepts_citywide
    and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
    and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
    and exists(
      select 1
      from public.merchant_members mm
      where mm.merchant_id=m.id
        and mm.active
        and mm.member_role='owner'
    )
    and exists(
      select 1
      from public.merchant_payment_methods p
      where p.merchant_id=m.id
        and p.active
    )
    and exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.available_stock>0
        and ci.price_cents>0
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
    );

  v_portals_fresh:=
    v_control.portals_verified_at is not null
    and v_control.portals_verified_at>=statement_timestamp()-interval '60 minutes'
    and v_control.customer_portal_ok
    and v_control.merchant_portal_ok
    and v_control.admin_portal_ok
    and v_control.portals_source_sha is not null;

  v_database_ready:=
    v_active_admins>0
    and coalesce((v_supply->>'realSupplyConfigured')::boolean,false)
    and v_configured_merchants>0
    and v_owner_ready>0
    and v_payment_ready>0
    and v_offer_ready>0;

  if v_active_admins<1 then
    v_blockers:=v_blockers||jsonb_build_array('admin_required');
  end if;
  if not coalesce((v_supply->>'realSupplyConfigured')::boolean,false) then
    v_blockers:=v_blockers||jsonb_build_array('real_supply_required');
  end if;
  if v_owner_ready<1 then
    v_blockers:=v_blockers||jsonb_build_array('merchant_owner_required');
  end if;
  if v_payment_ready<1 then
    v_blockers:=v_blockers||jsonb_build_array('merchant_payment_required');
  end if;
  if v_offer_ready<1 then
    v_blockers:=v_blockers||jsonb_build_array('offerable_supply_required');
  end if;
  if not v_portals_fresh then
    v_blockers:=v_blockers||jsonb_build_array('live_portals_verification_required');
  end if;

  return jsonb_build_object(
    'commerceEnabled',v_control.commerce_enabled,
    'databaseReady',v_database_ready,
    'readyToEnable',v_database_ready and v_portals_fresh,
    'activeAdminCount',v_active_admins,
    'configuredMerchantCount',v_configured_merchants,
    'ownerReadyMerchantCount',v_owner_ready,
    'paymentReadyMerchantCount',v_payment_ready,
    'offerReadyMerchantCount',v_offer_ready,
    'availableNow',coalesce((v_supply->>'availableNow')::boolean,false),
    'availableMerchantCount',coalesce((v_supply->>'availableMerchantCount')::integer,0),
    'portalsFresh',v_portals_fresh,
    'portalsVerifiedAt',v_control.portals_verified_at,
    'portalsSourceSha',v_control.portals_source_sha,
    'customerPortalOk',v_control.customer_portal_ok,
    'merchantPortalOk',v_control.merchant_portal_ok,
    'adminPortalOk',v_control.admin_portal_ok,
    'blockers',v_blockers,
    'supply',v_supply
  );
end;
$$;

revoke all on function public.platform_launch_readiness()
from public, anon, authenticated;
grant execute on function public.platform_launch_readiness()
to service_role;
