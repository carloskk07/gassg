CREATE OR REPLACE FUNCTION public.admin_merchant_readiness_snapshot(p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      public.merchant_cnpj_compliance_current(m.id) as cnpj_verification_current,
      public.merchant_anp_compliance_current(m.id) as anp_verification_current,
      public.merchant_has_compliant_catalog_item(m.id) as compliance_ready,
      (
        public.merchant_financial_sales_allowed(m.id)
        and exists(
          select 1
          from public.merchant_payment_methods pm
          where pm.merchant_id=m.id
            and pm.active
            and public.merchant_delivery_payment_allowed(m.id,pm.payment_method)
        )
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
      -- One and the same SKU must be stocked, fresh and legally eligible.
      -- Keep inventory_price_ready as the raw freshness signal for existing UIs.
      exists(
        select 1
        from public.catalog_items ci
        where ci.merchant_id=m.id
          and ci.active
          and ci.available_stock>0
          and ci.price_cents>0
          and ci.price_confirmed_at is not null
          and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
          and public.merchant_basket_compliance_current(m.id,array[ci.product_code])
      ) as sellable_offer_ready,
      (
        coalesce(m.accepts_citywide,false)
        and m.delivery_fee_confirmed_at is not null
        and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
      ) as delivery_ready,
      (m.status='active') as merchant_active,
      (
        m.last_seen_at is not null
        and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
      ) as heartbeat_fresh,
      -- Authoritative *public* visibility includes global and city opening,
      -- merchant mode, regulatory/cart, payment, location and live presence.
      exists(
        select 1 from public.merchant_business_details d
        where d.merchant_id=m.id
          and m.id=any(public.market_city_offer_scope(d.city,d.state))
      ) as quote_authority_ready
    from public.merchants m
  ),
  normalized as (
    select
      r.*,
      (
        r.sellable_offer_ready
        and r.delivery_ready
      ) as commercial_ready,
      (
        r.owner_ready
        and r.compliance_ready
        and r.payment_ready
        and r.catalog_configured
        and r.inventory_price_ready
        and r.sellable_offer_ready
        and r.delivery_ready
        and r.merchant_active
        and r.online_ready
        and r.heartbeat_fresh
        and r.quote_authority_ready
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
        'cnpjVerificationCurrent',n.cnpj_verification_current,
        'anpVerificationCurrent',n.anp_verification_current,
        'paymentReady',n.payment_ready,
        'catalogConfigured',n.catalog_configured,
        'inventoryPriceReady',n.inventory_price_ready,
        'deliveryReady',n.delivery_ready,
        'commercialReady',n.commercial_ready,
        'merchantActive',n.merchant_active,
        'online',n.online_ready,
        'heartbeatFresh',n.heartbeat_fresh,
        'offerReady',n.offer_ready,
        'quoteAuthorityReady',n.quote_authority_ready,
        'nextAction',case
          when not n.owner_ready then 'assign_owner'
          when not n.compliance_ready then 'verify_compliance'
          when not n.payment_ready then 'confirm_payment'
          when not n.catalog_configured or not n.inventory_price_ready or not n.sellable_offer_ready then 'confirm_offer'
          when not n.delivery_ready then 'confirm_logistics'
          when not n.merchant_active then 'activate_merchant'
          when not n.online_ready then 'go_online'
          when not n.heartbeat_fresh then 'refresh_heartbeat'
          when not n.quote_authority_ready then 'check_city_launch'
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
$function$;

-- Preserve restricted RPC execution; this does not grant customer access.
revoke all on function public.admin_merchant_readiness_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.admin_merchant_readiness_snapshot(uuid) to service_role;
