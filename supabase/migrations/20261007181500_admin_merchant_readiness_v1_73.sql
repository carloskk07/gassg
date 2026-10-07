-- TAMÃO V1.73 — Merchant readiness snapshot
-- Centralizes the operational path from created merchant to offer-ready.
-- Server-only authority: admin UI consumes this only through admin-ops.

create or replace function public.admin_merchant_readiness_snapshot(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog
as $$
declare
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  with readiness as (
    select
      m.id as merchant_id,
      m.name,
      m.status,
      coalesce(m.online,false) as online_ready,
      exists(
        select 1
        from public.merchant_members mm
        where mm.merchant_id=m.id
          and mm.active
          and mm.member_role='owner'
      ) as owner_ready,
      public.merchant_operational_compliance_current(m.id) as compliance_ready,
      exists(
        select 1
        from public.merchant_payment_methods pm
        where pm.merchant_id=m.id
          and pm.active
      ) as payment_ready,
      exists(
        select 1
        from public.catalog_items ci
        where ci.merchant_id=m.id
          and ci.active
          and ci.price_cents>0
      ) as catalog_configured,
      exists(
        select 1
        from public.catalog_items ci
        where ci.merchant_id=m.id
          and ci.active
          and ci.available_stock>0
          and ci.price_cents>0
          and ci.price_confirmed_at is not null
          and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
      ) as inventory_price_ready,
      (
        coalesce(m.accepts_citywide,false)
        and m.delivery_fee_confirmed_at is not null
        and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
      ) as delivery_ready,
      (m.status='active') as merchant_active,
      (
        m.last_seen_at is not null
        and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
      ) as heartbeat_fresh
    from public.merchants m
  ),
  normalized as (
    select
      r.*,
      (
        r.catalog_configured
        and r.inventory_price_ready
        and r.delivery_ready
      ) as commercial_ready,
      (
        r.owner_ready
        and r.compliance_ready
        and r.payment_ready
        and r.catalog_configured
        and r.inventory_price_ready
        and r.delivery_ready
        and r.merchant_active
        and r.online_ready
        and r.heartbeat_fresh
      ) as offer_ready
    from readiness r
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'merchantId',n.merchant_id,
        'name',n.name,
        'merchantStatus',n.status,
        'ownerReady',n.owner_ready,
        'complianceReady',n.compliance_ready,
        'paymentReady',n.payment_ready,
        'catalogConfigured',n.catalog_configured,
        'inventoryPriceReady',n.inventory_price_ready,
        'deliveryReady',n.delivery_ready,
        'commercialReady',n.commercial_ready,
        'merchantActive',n.merchant_active,
        'online',n.online_ready,
        'heartbeatFresh',n.heartbeat_fresh,
        'offerReady',n.offer_ready,
        'nextAction',case
          when not n.owner_ready then 'assign_owner'
          when not n.compliance_ready then 'verify_compliance'
          when not n.payment_ready then 'confirm_payment'
          when not n.catalog_configured or not n.inventory_price_ready then 'confirm_offer'
          when not n.delivery_ready then 'confirm_logistics'
          when not n.merchant_active then 'activate_merchant'
          when not n.online_ready then 'go_online'
          when not n.heartbeat_fresh then 'refresh_heartbeat'
          else 'ready'
        end
      )
      order by n.name,n.merchant_id
    ),
    '[]'::jsonb
  )
  into v_result
  from normalized n;

  return v_result;
end;
$$;

revoke all on function public.admin_merchant_readiness_snapshot(uuid)
from public, anon, authenticated;

grant execute on function public.admin_merchant_readiness_snapshot(uuid)
to service_role;
