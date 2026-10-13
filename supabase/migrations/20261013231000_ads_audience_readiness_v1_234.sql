-- TAMÃO V1.234 — honest Ads audience readiness (admin-only, aggregate, read-only).
-- The existing marketing collector receives anonymous client-side events.
-- These counters are NOT unique people, city-localized visits, or advertising impressions.
create or replace function public.admin_ads_audience_readiness_v1_234(p_actor_user_id uuid)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog as $fn$
declare
 v_today date := (statement_timestamp() at time zone 'UTC')::date;
 v_landing_customer bigint;
 v_landing_merchant bigint;
 v_forms_customer bigint;
 v_forms_merchant bigint;
 v_recent7 bigint;
 v_active_days bigint;
 v_last_event date;
 v_daily jsonb;
 v_cities jsonb;
begin
 if p_actor_user_id is null or not exists (
   select 1 from public.platform_admins a
   where a.user_id=p_actor_user_id and a.active
   and a.admin_role in ('superadmin','operations','compliance','finance','readonly')
 ) then
   raise exception 'ADS_AUDIENCE_ADMIN_DENIED' using errcode='42501';
 end if;
 select
   coalesce(sum(m.event_count) filter (
     where m.event_type='landing_view' and m.audience='customer'),0)::bigint,
   coalesce(sum(m.event_count) filter (
     where m.event_type='landing_view' and m.audience='merchant'),0)::bigint,
   coalesce(sum(m.event_count) filter (
     where m.event_type='lead_form_view' and m.audience='customer'),0)::bigint,
   coalesce(sum(m.event_count) filter (
     where m.event_type='lead_form_view' and m.audience='merchant'),0)::bigint,
   coalesce(sum(m.event_count) filter (where m.event_date>=v_today-6),0)::bigint,
   count(distinct m.event_date)::bigint,
   max(m.event_date)
 into v_landing_customer,v_landing_merchant,v_forms_customer,v_forms_merchant,
      v_recent7,v_active_days,v_last_event
 from public.prelaunch_marketing_event_daily m
 where m.event_date between v_today-29 and v_today;

 select coalesce(jsonb_agg(jsonb_build_object(
   'date',x.day::text,
   'landingEvents',x.landings,
   'formEvents',x.forms
 ) order by x.day),'[]'::jsonb)
 into v_daily
 from (
   select d.day::date as day,
     coalesce(sum(e.event_count) filter(where e.event_type='landing_view'),0)::bigint as landings,
     coalesce(sum(e.event_count) filter(where e.event_type='lead_form_view'),0)::bigint as forms
   from generate_series(v_today-13,v_today,interval '1 day') d(day)
   left join public.prelaunch_marketing_event_daily e on e.event_date=d.day::date
   group by d.day
 ) x;

 -- Merchant demand is scoped to merchant-declared location, not visitor IP/UTM.
 -- No individual name, contact information or marketing attribution is exposed.
 select coalesce(jsonb_agg(jsonb_build_object(
   'city',c.city,
   'state',c.state,
   'interestedMerchants',c.interested,
   'submittedCreatives',c.submitted,
   'approvedCreatives',c.approved
 ) order by c.interested desc,c.city,c.state),'[]'::jsonb)
 into v_cities
 from (
   select left(btrim(d.city),100) city,upper(left(btrim(d.state),2)) state,
     count(*) filter(where i.interested=true)::bigint interested,
     count(*) filter(where ac.status='submitted')::bigint submitted,
     count(*) filter(where ac.status='approved_creative')::bigint approved
   from public.merchant_business_details d
   left join public.merchant_ads_interest_v1_232 i on i.merchant_id=d.merchant_id
   left join public.merchant_ads_campaigns_v1_233 ac on ac.merchant_id=d.merchant_id
   where char_length(btrim(coalesce(d.city,''))) between 2 and 100
     and upper(left(btrim(coalesce(d.state,'')),2)) ~ '^[A-Z]{2}$'
   group by left(btrim(d.city),100),upper(left(btrim(d.state),2))
   having count(*) filter(where i.interested=true)>0
      or count(*) filter(where ac.status in ('submitted','approved_creative'))>0
   order by interested desc,city,state limit 20
 ) c;

 return jsonb_build_object(
   'source','admin_ads_audience_readiness_v1_234',
   'generatedAt',statement_timestamp(),
   'periodDays',30,
   'timezone','UTC',
   'marketingEventSource','prelaunch_marketing_event_daily',
   'metricType','unverified_anonymous_site_events',
   'landingCustomerEvents',v_landing_customer,
   'landingMerchantEvents',v_landing_merchant,
   'customerFormEvents',v_forms_customer,
   'merchantFormEvents',v_forms_merchant,
   'last7dEvents',v_recent7,
   'activeDays',v_active_days,
   'lastEventDate',v_last_event,
   'daily',v_daily,
   'cityDemand',v_cities,
   'evidence',jsonb_build_object(
     'uniqueVisitorsVerified',false,
     'cityOfVisitorVerified',false,
     'invalidTrafficFiltered',false,
     'actualAdDeliveryImplemented',false,
     'trackingConsentVerifiedForAds',false,
     'eventDedupAcrossClientsVerified',false,
     'sourceCanBeSpoofed',true
   ),
   'commercial',jsonb_build_object(
     'adsLive',false,'noCharge',true,'readyToSell',false,
     'verifiedAdImpressions',0,'billableImpressions',0,
     'verifiedAdClicks',0,'adsRevenueCents',0
   ),
   'readOnly',true
 );
end;
$fn$;
revoke all on function public.admin_ads_audience_readiness_v1_234(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_ads_audience_readiness_v1_234(uuid)
 to service_role;

do $verify$
begin
 if has_function_privilege('anon','public.admin_ads_audience_readiness_v1_234(uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_ads_audience_readiness_v1_234(uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_ads_audience_readiness_v1_234(uuid)','EXECUTE')
 then raise exception 'ADS_AUDIENCE_ACL_DRIFT' using errcode='42501'; end if;
end;
$verify$;