-- TAMÃO V1.322 — real, opt-in merchant Ads pipeline; read-only commercial acquisition.
-- Interest is not a campaign/contract; never infer customer consent from registration.
create or replace function public.admin_ads_leads_v1_322(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $fn$
declare v_total bigint;v_rows jsonb;v_ready bigint;v_preparing bigint;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','operations','readonly')
 ) then raise exception 'ADS_LEADS_ADMIN_DENIED' using errcode='42501';end if;
 select count(*) into v_total from public.merchant_ads_interest_v1_232 i
 where i.interested is true;
 with eligible as (
  select i.merchant_id,m.name,m.status as merchant_status,
   left(btrim(coalesce(d.city,'')),100) city,upper(left(btrim(coalesce(d.state,'')),2)) state,
   c.status as creative_status,c.category_key,c.target_city,c.target_state,
   coalesce(ci.catalog_count,0) catalog_count,
   i.updated_at as interest_at,c.updated_at as creative_at
  from public.merchant_ads_interest_v1_232 i
  join public.merchants m on m.id=i.merchant_id
  left join public.merchant_business_details d on d.merchant_id=i.merchant_id
  left join public.merchant_ads_campaigns_v1_233 c on c.merchant_id=i.merchant_id
  left join lateral (
   select count(*) as catalog_count from public.catalog_items p
   join public.product_delivery_profiles pr on pr.product_code=p.product_code and pr.active
   where p.merchant_id=i.merchant_id and p.active
    and (c.merchant_id is null or c.category_key='all' or pr.category_key=c.category_key)
  ) ci on true
  where i.interested is true
 ), staged as (
  select e.*,case
   when e.creative_status='approved_creative' then 'approved_for_planning'
   when e.creative_status='submitted' then 'awaiting_review'
   when e.merchant_status<>'active' then 'merchant_inactive'
   when char_length(e.city)<2 or e.state !~ '^[A-Z]{2}$' then 'location_incomplete'
   when e.creative_status is not null and
      (e.target_city is distinct from e.city or e.target_state is distinct from e.state)
    then 'city_changed'
   when e.catalog_count<1 then 'catalog_not_ready'
   when e.creative_status='draft' then 'draft_ready_to_submit'
   when e.creative_status='needs_changes' then 'needs_creative_changes'
   else 'needs_creative'
   end as stage
  from eligible e
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'merchantId',r.merchant_id,'merchantName',left(r.name,120),
   'city',r.city,'state',r.state,'stage',r.stage,
   'creativeStatus',r.creative_status,'matchingActiveCatalogCount',r.catalog_count,
   'interestAt',r.interest_at,'creativeAt',r.creative_at,
   'marketingConsentInferred',false,'contactPerformed',false
 ) order by r.rank,r.interest_at desc,r.merchant_id),'[]'::jsonb)
 into v_rows
 from (
  select s.*,case s.stage
   when 'approved_for_planning' then 1 when 'draft_ready_to_submit' then 2
   when 'awaiting_review' then 3 when 'needs_creative_changes' then 4
   when 'needs_creative' then 5 when 'catalog_not_ready' then 6
   when 'city_changed' then 7 when 'location_incomplete' then 8 else 9 end rank
  from staged s order by rank,interest_at desc,merchant_id limit 50
 ) r;
 select count(*) into v_ready from public.merchant_ads_interest_v1_232 i
 join public.merchant_ads_campaigns_v1_233 c on c.merchant_id=i.merchant_id
 where i.interested is true and c.status='approved_creative' and c.ads_live=false;
 select count(*) into v_preparing from public.merchant_ads_interest_v1_232 i
 left join public.merchant_ads_campaigns_v1_233 c on c.merchant_id=i.merchant_id
 where i.interested is true and (c.merchant_id is null or c.status in ('draft','needs_changes','withdrawn'));
 return jsonb_build_object(
  'source','admin_ads_leads_v1_322','readOnly',true,'snapshotAt',clock_timestamp(),
  'totalOptedIn',v_total,'creativeApproved',v_ready,'preparingCreative',v_preparing,
  'rows',v_rows,'contactPerformed',false,'notificationSent',false,
  'paymentCreated',false,'adsLive',false,'noAutomaticOutreach',true);
end;
$fn$;
revoke all on function public.admin_ads_leads_v1_322(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_leads_v1_322(uuid) to service_role;
