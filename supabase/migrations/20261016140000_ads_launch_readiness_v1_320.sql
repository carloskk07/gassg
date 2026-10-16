-- TAMÃO V1.320 — reliable read-only Ads commercial launch diagnostics.
-- Never approves merchants, opens cities, issues charges, records revenue or enables Ads.
create or replace function public.admin_ads_launch_readiness_v1_320(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog' as $f$
declare
 v_creatives bigint;v_plans bigint;v_interests bigint;v_dossiers bigint;
 v_bilateral bigint;v_issued bigint;v_checkouts bigint;v_approved bigint;
 v_stale bigint;v_reversed bigint;v_public boolean;v_billing boolean;v_delivery boolean;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a where a.user_id=p_actor
   and a.active and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_LAUNCH_ACCESS_DENIED' using errcode='42501';end if;
 select count(*) into v_creatives
 from public.merchant_ads_campaigns_v1_233
 where status='approved_creative' and ads_live=false and no_charge=true;
 select count(*) into v_plans
 from public.platform_ads_sales_plans_v1_309 where stage='ready_for_contact';
 select count(*) into v_interests
 from public.platform_ads_offers_v1_310 where status='interested';
 select count(*) into v_dossiers
 from public.platform_ads_contract_dossiers_v1_311 where status='reviewed';
 select count(*) into v_bilateral
 from public.platform_ads_instruments_v1_312 where status='bilateral_accepted';
 select count(*) into v_issued
 from public.platform_ads_receivables_v1_313 where status='issued';
 select count(*) into v_checkouts
 from public.platform_ads_psp_checkouts_v1_314
 where status='checkout_ready';
 select count(*),
        count(*) filter(where verified_at is null or
         verified_at<clock_timestamp()-interval '24 hours')
 into v_approved,v_stale
 from public.platform_ads_psp_checkouts_v1_314 where status='payment_approved';
 select count(*) into v_reversed
 from public.platform_ads_psp_checkouts_v1_314 where status='payment_reversed';
 select coalesce(public_enabled,false),coalesce(billing_enabled,false),
        coalesce(verified_delivery_enabled,false)
 into v_public,v_billing,v_delivery
 from public.ads_placement_controls_v1_236 where singleton=true;
 return jsonb_build_object(
  'source','admin_ads_launch_readiness_v1_320','readOnly',true,
  'snapshotAt',clock_timestamp(),'merchantBillingSeparate',true,
  'noAutomaticActivation',true,'providerLookupPerformed',false,
  'verifiedRevenueCents',null,'publicAdsVerified',false,
  'creativesApproved',v_creatives,'plansContactReady',v_plans,
  'merchantInterests',v_interests,'dossiersReviewed',v_dossiers,
  'bilateralAcceptances',v_bilateral,'statementsIssued',v_issued,
  'checkoutsReady',v_checkouts,'lastKnownApprovedPayments',v_approved,
  'staleApprovals24h',v_stale,'reversalsRecorded',v_reversed,
  'publicEnabled',coalesce(v_public,false),
  'billingEnabled',coalesce(v_billing,false),
  'verifiedDeliveryEnabled',coalesce(v_delivery,false)
 );
end;
$f$;
revoke all on function public.admin_ads_launch_readiness_v1_320(uuid)
from public,anon,authenticated;
grant execute on function public.admin_ads_launch_readiness_v1_320(uuid) to service_role;
