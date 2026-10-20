-- Read-only discovery infrastructure diagnosis. Exclusive to permanent superadmin.
-- Business listing/OTP/Storage E2E approval remains a separate human check.
create function public.discovery_admin_readiness()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog'
as $readiness$
declare
 v_admin uuid:=(select auth.uid());
 v_cities int;
 v_open int;
 v_listings int;
 v_pending int;
 v_photos boolean;
 v_docs boolean;
 v_rls_count int;
begin
 if v_admin is null or not public.discovery_is_superadmin() then
  raise exception 'ADMIN_REQUIRED' using errcode='42501';
 end if;
 select count(*),count(*) filter(where enabled) into v_cities,v_open
 from public.discovery_vertical_cities;
 select count(*),count(*) filter(where status='review') into v_listings,v_pending
 from public.discovery_listings;
 select exists(select 1 from storage.buckets where id='tamao-discovery-photos'
   and public is true and file_size_limit=5242880),
   exists(select 1 from storage.buckets where id='tamao-discovery-documents'
   and public is false and file_size_limit=10485760)
 into v_photos,v_docs;
 select count(*) into v_rls_count from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in (
  'discovery_vertical_cities','discovery_listings',
  'discovery_professional_details','discovery_ride_details',
  'discovery_stay_details','discovery_advertising_terms',
  'discovery_advertising_daily_ledger','discovery_moderation_log',
  'discovery_listing_reports','discovery_documents')
 and c.relrowsecurity is true;
 return pg_catalog.jsonb_build_object(
  'source','discovery_admin_readiness_v1',
  'infrastructureReady',v_rls_count=10 and v_photos and v_docs,
  'rlsTables',v_rls_count,'expectedRlsTables',10,
  'publicPhotoBucketReady',v_photos,'privateDocumentBucketReady',v_docs,
  'configuredCities',v_cities,'enabledCityVerticals',v_open,
  'totalListings',v_listings,'reviewQueueCount',v_pending,
  'otpAndUploadE2eVerified',false,
  'canDeclareCommercialReadiness',false,
  'externalPaymentValidation',false
 );
end $readiness$;
revoke all on function public.discovery_admin_readiness() from public,anon,authenticated;
grant execute on function public.discovery_admin_readiness() to authenticated;
