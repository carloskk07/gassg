-- TAMÃO V1.238 — Revenue starts with a real merchant.
-- Aggregate-only activation pulse. Independent populations, not a fabricated conversion funnel.
-- Read-only: no invitations, outreach, profiles, billing or Ads events are created.
create schema if not exists growth_internal_v1_238;
revoke all on schema growth_internal_v1_238 from public,anon,authenticated;
grant usage on schema growth_internal_v1_238 to service_role;

create or replace function growth_internal_v1_238.activation_pulse(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare
 v_now timestamptz:=statement_timestamp();
 v_prospects bigint:=0;
 v_uncontacted bigint:=0;
 v_contacted bigint:=0;
 v_interested bigint:=0;
 v_onboarding bigint:=0;
 v_invites_active bigint:=0;
 v_invites_claimed bigint:=0;
 v_leads bigint:=0;
 v_leads_new bigint:=0;
 v_applications bigint:=0;
 v_applications_pending bigint:=0;
 v_merchants bigint:=0;
 v_merchants_active bigint:=0;
 v_merchants_online bigint:=0;
 v_ads_interest bigint:=0;
 v_creatives_approved bigint:=0;
 v_cities jsonb:='[]'::jsonb;
 v_priority text:='onboard_first_merchant';
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor and a.active
      and a.admin_role in ('superadmin','operations','compliance','finance','readonly')) then
   raise exception 'COMMERCIAL_ACTIVATION_ACCESS_DENIED' using errcode='42501';
 end if;

 select count(*)::bigint,
        count(*) filter(where prospect_status='uncontacted')::bigint,
        count(*) filter(where prospect_status='contacted')::bigint,
        count(*) filter(where prospect_status='interested')::bigint,
        count(*) filter(where prospect_status='onboarding')::bigint
 into v_prospects,v_uncontacted,v_contacted,v_interested,v_onboarding
 from public.anp_glp_prospects;

 select count(*) filter(where revoked_at is null and claimed_at is null
     and expires_at>v_now)::bigint,
     count(*) filter(where claimed_at is not null)::bigint
 into v_invites_active,v_invites_claimed
 from public.anp_prospect_invites;

 select count(*)::bigint,
        count(*) filter(where status='new')::bigint
 into v_leads,v_leads_new
 from public.prelaunch_leads where lead_type='merchant';

 select count(*)::bigint,
        count(*) filter(where status='pending')::bigint
 into v_applications,v_applications_pending
 from public.merchant_applications;

 select count(*)::bigint,
        count(*) filter(where status='active')::bigint,
        count(*) filter(where status='active' and online=true)::bigint
 into v_merchants,v_merchants_active,v_merchants_online
 from public.merchants;

 select count(*)::bigint into v_ads_interest
 from public.merchant_ads_interest_v1_232 where interested;

 select count(*)::bigint into v_creatives_approved
 from public.merchant_ads_campaigns_v1_233 where status='approved_creative';

 -- City distribution of PROSPECTS only: never misrepresent prospect cities
 -- as where customers, orders, merchant applications or Ads visits originated.
 select coalesce(jsonb_agg(jsonb_build_object(
   'city',x.city,'state',x.state,'prospects',x.total,
   'uncontacted',x.uncontacted,'interested',x.interested,
   'onboarding',x.onboarding)
   order by x.uncontacted desc,x.total desc,x.city,x.state),'[]'::jsonb)
 into v_cities
 from (
   select left(p.city_name,100) city,p.state state,
      count(*)::bigint total,
      count(*) filter(where p.prospect_status='uncontacted')::bigint uncontacted,
      count(*) filter(where p.prospect_status='interested')::bigint interested,
      count(*) filter(where p.prospect_status='onboarding')::bigint onboarding
   from public.anp_glp_prospects p
   where char_length(btrim(coalesce(p.city_name,''))) between 2 and 100
     and p.state ~ '^[A-Z]{2}$'
   group by left(p.city_name,100),p.state
   order by uncontacted desc,total desc,city,state
   limit 20
 ) x;

 v_priority:=case
  when v_applications_pending>0 then 'review_applications'
  when v_merchants_active=0 and v_leads_new>0 then 'respond_merchant_leads'
  when v_merchants_active=0 and v_uncontacted>0 then 'contact_anp_prospects'
  when v_merchants_active=0 and v_interested+v_onboarding>0 then 'followup_prospects'
  when v_merchants_active=0 then 'acquire_first_merchant'
  when v_merchants_online=0 then 'enable_partner_operation'
  when v_ads_interest=0 then 'collect_voluntary_ads_interest'
  when v_creatives_approved=0 then 'review_creative'
  else 'validate_first_campaign'
 end;

 return jsonb_build_object(
   'source','admin_commercial_activation_v1_238','readOnly',true,
   'generatedAt',v_now,'stage','commercial_merchant_activation',
   'counts',jsonb_build_object(
     'anpProspects',v_prospects,'anpUncontacted',v_uncontacted,
     'anpContacted',v_contacted,'anpInterested',v_interested,
     'anpOnboarding',v_onboarding,'invitationsPending',v_invites_active,
     'invitationsClaimed',v_invites_claimed,
     'merchantLeads',v_leads,'merchantNewLeads',v_leads_new,
     'merchantApplications',v_applications,
     'merchantPendingApplications',v_applications_pending,
     'merchantsRegistered',v_merchants,'merchantsActive',v_merchants_active,
     'merchantsActiveOnline',v_merchants_online,
     'adsOptedIn',v_ads_interest,'adsCreativesReviewed',v_creatives_approved
   ),
   'nextAction',v_priority,'prospectCities',v_cities,
   'dataMeaning','independent_operational_populations',
   'noContactsExposed',true,'noMessagesSent',true,'noSyntheticMerchants',true,
   'adsLive',false,'adsRevenueCents',0,'noCharge',true
 );
end;
$fn$;
revoke all on function growth_internal_v1_238.activation_pulse(uuid)
 from public,anon,authenticated,service_role;
grant execute on function growth_internal_v1_238.activation_pulse(uuid)
 to service_role;

create or replace function public.admin_commercial_activation_v1_238(
 p_actor uuid
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select growth_internal_v1_238.activation_pulse($1)
$wrapper$;
revoke all on function public.admin_commercial_activation_v1_238(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_commercial_activation_v1_238(uuid)
 to service_role;

do $acl$
begin
 if has_function_privilege('anon','public.admin_commercial_activation_v1_238(uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_commercial_activation_v1_238(uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_commercial_activation_v1_238(uuid)','EXECUTE')
 then raise exception 'COMMERCIAL_ACTIVATION_ACL_DRIFT' using errcode='42501';end if;
end;
$acl$;