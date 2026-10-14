-- TAMÃO V1.251 — first-party marketing signals linked to founder campaign tags.
-- No money moves, no benefit activation, no financial ROI or paid conversions inferred.
create schema if not exists platform_funding_private_v1_251;
revoke all on schema platform_funding_private_v1_251 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_251 to service_role;

create or replace function platform_funding_private_v1_251.signals(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $f$
declare
 v_month date:=coalesce(p_month,date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_total bigint;
 v_rows jsonb;
 v_organic_visits bigint;
 v_organic_forms bigint;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'OWNER_SIGNALS_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or
    v_month<date '2026-01-01' or
    v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')+interval '2 months')::date
 then raise exception 'OWNER_SIGNALS_MONTH_INVALID' using errcode='22023';end if;

 select count(*) into v_total from public.platform_owner_budget_allocations_v1_247 a
 where a.month_key=v_month;

 with selected as (
  select a.*,('tam-'||a.benefit_key||'-'||to_char(a.month_key,'YYYYMM')||'-'||a.campaign_reference) as tag
  from public.platform_owner_budget_allocations_v1_247 a
  where a.month_key=v_month
  order by a.created_at desc,a.allocation_id
  limit 50
 ), assembled as (
  select a.*,coalesce(e.landing_views,0)::bigint landing_views,
      coalesce(e.form_views,0)::bigint form_views,
      coalesce(l.leads_total,0)::bigint leads_total,
      coalesce(l.customer_leads,0)::bigint customer_leads,
      coalesce(l.merchant_leads,0)::bigint merchant_leads,
      coalesce(l.qualified_leads,0)::bigint qualified_leads,
      coalesce(l.crm_converted_leads,0)::bigint crm_converted_leads
  from selected a
  left join lateral (
    select coalesce(sum(m.event_count) filter(where m.event_type='landing_view'),0) landing_views,
      coalesce(sum(m.event_count) filter(where m.event_type='lead_form_view'),0) form_views
    from public.prelaunch_marketing_event_daily m
    where m.campaign=a.tag and m.source='tamao' and m.medium='owner_campaign'
      and m.event_date >= greatest(a.month_key,(a.created_at at time zone 'America/Sao_Paulo')::date)
      and m.event_date < (a.month_key+interval '1 month')::date
      and (a.released_at is null or m.event_date <= (a.released_at at time zone 'America/Sao_Paulo')::date)
  )e on true
  left join lateral (
    select count(*) leads_total,
      count(*) filter(where l.lead_type='customer') customer_leads,
      count(*) filter(where l.lead_type='merchant') merchant_leads,
      count(*) filter(where l.qualified_at is not null) qualified_leads,
      count(*) filter(where l.converted_at is not null) crm_converted_leads
    from public.prelaunch_leads l
    where l.campaign=a.tag and l.source='tamao' and l.medium='owner_campaign'
      and l.created_at >= a.created_at
      and l.created_at >= a.month_key::timestamp at time zone 'America/Sao_Paulo'
      and l.created_at < (a.month_key+interval '1 month')::timestamp at time zone 'America/Sao_Paulo'
      and (a.released_at is null or l.created_at<=a.released_at)
  )l on true
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'allocationId',allocation_id,'campaignReference',campaign_reference,
   'campaignLabel',campaign_label,'campaignTag',tag,
   'benefitKey',benefit_key,'month',month_key,'status',status,
   'plannedAllocationCents',amount_cents,'createdAt',created_at,'releasedAt',released_at,
   'landingViews',landing_views,'formViews',form_views,
   'leads',leads_total,'customerLeads',customer_leads,'merchantLeads',merchant_leads,
   'qualifiedLeads',qualified_leads,'crmConvertedLeads',crm_converted_leads,
   'attributionScope','first_party_utm_tag_within_month_and_allocation_window',
   'returnOnInvestmentMeasured',false,'revenueAttributedCents',null
 ) order by created_at desc,allocation_id),'[]'::jsonb)
 into v_rows from assembled;

 -- Context only; unattributed events are never allocated or credited to any campaign.
 select coalesce(sum(m.event_count) filter(where m.event_type='landing_view'),0)::bigint,
   coalesce(sum(m.event_count) filter(where m.event_type='lead_form_view'),0)::bigint
 into v_organic_visits,v_organic_forms
 from public.prelaunch_marketing_event_daily m
 where m.event_date>=v_month and m.event_date<(v_month+interval '1 month')::date
   and (m.campaign='' or m.source<>'tamao' or m.medium<>'owner_campaign');

 return jsonb_build_object(
  'source','admin_owner_campaign_signals_v1_251',
  'month',v_month,'totalCampaigns',v_total,
  'rows',v_rows,'limit',50,'truncated',v_total>50,
  'unattributedLandingViews',v_organic_visits,'unattributedFormViews',v_organic_forms,
  'measurementUnit','first_party_event_counts_not_unique_people',
  'revenueAttributedCents',null,'returnOnInvestmentMeasured',false,
  'readOnly',true,'plannedOnly',true,'bankApiConfirmed',false,
  'spendableCents',0,'newBenefitsEnabled',false,'noCharge',true
 );
end;$f$;

revoke all on function platform_funding_private_v1_251.signals(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_251.signals(uuid,date) to service_role;

create or replace function public.admin_owner_campaign_signals_v1_251(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $w$
 select platform_funding_private_v1_251.signals($1,$2)
$w$;
revoke all on function public.admin_owner_campaign_signals_v1_251(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_campaign_signals_v1_251(uuid,date)
 to service_role;

-- Existing event indexes cover month scans; index campaign tag for aggregate joins.
create index if not exists marketing_daily_campaign_signal_v1_251
 on public.prelaunch_marketing_event_daily(campaign,event_date)
 where source='tamao' and medium='owner_campaign';
create index if not exists prelaunch_leads_campaign_signal_v1_251
 on public.prelaunch_leads(campaign,created_at)
 where source='tamao' and medium='owner_campaign';

do $acl$begin
 if has_function_privilege('anon','public.admin_owner_campaign_signals_v1_251(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_campaign_signals_v1_251(uuid,date)','EXECUTE')
 or has_table_privilege('authenticated','public.prelaunch_marketing_event_daily','SELECT')
 then raise exception 'OWNER_SIGNALS_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
