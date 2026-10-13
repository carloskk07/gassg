-- TAMÃO Ads V1.237 — Read-only pilot qualification. No public rollout or billing.
-- Reuses the REAL offer-scope gate, not a weaker ad-specific substitute.
-- No fabricated advertisers, customers, quotes, campaigns or impressions.
create schema if not exists ads_internal_v1_237;
revoke all on schema ads_internal_v1_237 from public,anon,authenticated;
grant usage on schema ads_internal_v1_237 to service_role;

create or replace function ads_internal_v1_237.pilot_preflight(
 p_actor uuid, p_merchant uuid
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare
 v_campaign public.merchant_ads_campaigns_v1_233%rowtype;
 v_has_campaign boolean:=false;
 v_reviewed boolean:=false;
 v_opted_in boolean:=false;
 v_merchant_active boolean:=false;
 v_city_match boolean:=false;
 v_city text:=null;
 v_state text:=null;
 v_scope boolean:=false;
 v_catalog boolean:=false;
 v_preview_reported boolean:=false;
 v_placement_disabled boolean:=false;
 v_billing_disabled boolean:=false;
 v_verified_delivery_disabled boolean:=false;
 v_prerequisites boolean:=false;
begin
 -- Even the private function enforces authorization; caller-provided actor
 -- is accepted only by the service-role-only façade through authenticated Edge.
 if p_actor is null or p_merchant is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active
     and a.admin_role in ('superadmin','operations','compliance','finance','readonly')
 ) then
   raise exception 'ADS_PILOT_PREFLIGHT_DENIED' using errcode='42501';
 end if;

 select * into v_campaign from public.merchant_ads_campaigns_v1_233 c
 where c.merchant_id=p_merchant;
 v_has_campaign:=found;
 if v_has_campaign then
   v_city:=v_campaign.target_city;
   v_state:=v_campaign.target_state;
   v_reviewed:=v_campaign.status='approved_creative'
     and v_campaign.reviewed_at is not null and v_campaign.reviewed_by is not null;

   select coalesce(i.interested,false) into v_opted_in
   from public.merchant_ads_interest_v1_232 i where i.merchant_id=p_merchant;
   v_opted_in:=coalesce(v_opted_in,false);

   select (m.status='active' and m.online=true) into v_merchant_active
   from public.merchants m where m.id=p_merchant;
   v_merchant_active:=coalesce(v_merchant_active,false);

   select exists(select 1 from public.merchant_business_details d
     where d.merchant_id=p_merchant
       and btrim(d.city)=v_city and upper(btrim(d.state))=v_state)
   into v_city_match;

   -- Single source of truth for real offer eligibility. This checks merchant
   -- compliance, launch, heartbeat, geography, price, availability, payment,
   -- operation mode, and paused cities.
   if v_city_match then
     v_scope:=p_merchant=any(public.market_city_offer_scope(v_city,v_state));
   end if;

   -- An active product for the creative's category is additional evidence,
   -- not proof that a specific customer basket is available.
   select exists(
     select 1 from public.catalog_items ci
       join public.product_delivery_profiles pr
         on pr.product_code=ci.product_code and pr.active
     where ci.merchant_id=p_merchant and ci.active
       and ci.available_stock>0 and ci.price_cents>0
       and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
       and (v_campaign.category_key='all' or pr.category_key=v_campaign.category_key)
       and public.merchant_basket_compliance_current(p_merchant,array[ci.product_code])
   ) into v_catalog;

   -- An internal preview report is only a self-report from the admin's
   -- browser, NOT independently validated human visibility or an impression.
   select exists(
     select 1 from public.ads_preview_reports_v1_235 pr
     join public.ads_preview_challenges_v1_235 ch on ch.id=pr.challenge_id
     where pr.merchant_id=p_merchant and ch.merchant_id=p_merchant
       and ch.creative_version=v_campaign.version
       and pr.preview_only and not pr.independently_verified and not pr.billable
   ) into v_preview_reported;
 end if;

 select (not c.public_enabled),(not c.billing_enabled),
        (not c.verified_delivery_enabled)
 into v_placement_disabled,v_billing_disabled,v_verified_delivery_disabled
 from public.ads_placement_controls_v1_236 c where c.singleton=true;

 v_placement_disabled:=coalesce(v_placement_disabled,false);
 v_billing_disabled:=coalesce(v_billing_disabled,false);
 v_verified_delivery_disabled:=coalesce(v_verified_delivery_disabled,false);
 v_prerequisites:=
   v_reviewed and v_opted_in and v_merchant_active and
   v_city_match and v_scope and v_catalog and v_preview_reported and
   v_placement_disabled and v_billing_disabled and v_verified_delivery_disabled;

 return jsonb_build_object(
   'source','admin_ads_pilot_preflight_v1_237',
   'merchantId',p_merchant,
   'campaignVersion',case when v_has_campaign then v_campaign.version else null end,
   'campaignStatus',case when v_has_campaign then v_campaign.status else null end,
   'city',v_city,'state',v_state,
   'checkedAt',statement_timestamp(),
   'checks',jsonb_build_object(
     'creativeExists',v_has_campaign,
     'creativeReviewed',v_reviewed,
     'advertiserOptedIn',v_opted_in,
     'merchantActiveOnline',v_merchant_active,
     'campaignCityMatchesMerchant',v_city_match,
     'merchantEligibleForRealOffers',v_scope,
     'eligibleCategoryProductExists',v_catalog,
     'internalPreviewClientReported',v_preview_reported,
     'publicPlacementLocked',v_placement_disabled,
     'billingLocked',v_billing_disabled,
     'verifiedDeliveryLocked',v_verified_delivery_disabled
   ),
   'internalPrerequisitesMet',v_prerequisites,
   'evidence',jsonb_build_object(
     'visitorCityVerified',false,
     'clientPreviewIndependentlyVerified',false,
     'endToEndCustomerAdDeliveryVerified',false,
     'adFraudDefenseVerified',false,
     'customerBasketAvailabilityProven',false
   ),
   'commercial',jsonb_build_object(
     'publicAdsLive',false,
     'readyToSell',false,
     'noCharge',true,
     'billableImpressions',0,
     'verifiedAdImpressions',0,
     'adsRevenueCents',0
   ),
   'readOnly',true
 );
end;
$fn$;
revoke all on function ads_internal_v1_237.pilot_preflight(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function ads_internal_v1_237.pilot_preflight(uuid,uuid)
 to service_role;

create or replace function public.admin_ads_pilot_preflight_v1_237(
 p_actor uuid,p_merchant uuid
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select ads_internal_v1_237.pilot_preflight($1,$2)
$wrapper$;
revoke all on function public.admin_ads_pilot_preflight_v1_237(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_ads_pilot_preflight_v1_237(uuid,uuid)
 to service_role;

do $acl$
begin
 if has_function_privilege('anon',
    'public.admin_ads_pilot_preflight_v1_237(uuid,uuid)','EXECUTE')
 or has_function_privilege('authenticated',
    'public.admin_ads_pilot_preflight_v1_237(uuid,uuid)','EXECUTE')
 or not has_function_privilege('service_role',
    'public.admin_ads_pilot_preflight_v1_237(uuid,uuid)','EXECUTE')
 then raise exception 'ADS_PILOT_PREFLIGHT_ACL_DRIFT' using errcode='42501';end if;
end;
$acl$;