-- TAMÃO V1.321 — Merchant-specific Ads start checklist, server-grounded and read-only.
-- No outreach, enrollment, creative approval, billing or Ads publication.
create or replace function public.merchant_ads_start_read_v1_321(
 p_actor uuid,p_merchant uuid
) returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog' as $f$
declare
 v_status text;v_city text;v_state text;
 v_interest boolean:=false;v_catalog bigint:=0;
 v_creative public.merchant_ads_campaigns_v1_233%rowtype;
 v_city_valid boolean:=false;v_city_current boolean:=false;
 v_catalog_ready boolean:=false;v_ready boolean:=false;
 v_step text;v_count integer:=0;
begin
 if p_actor is null or p_merchant is null or not exists(
  select 1 from public.merchant_members mm
  where mm.user_id=p_actor and mm.merchant_id=p_merchant and mm.active
    and mm.member_role in ('owner','manager')
 ) then raise exception 'ADS_START_MERCHANT_ACCESS_DENIED' using errcode='42501';end if;
 select m.status into v_status from public.merchants m where m.id=p_merchant;
 if not found then raise exception 'ADS_START_MERCHANT_MISSING' using errcode='22023';end if;
 select left(btrim(d.city),100),upper(left(btrim(d.state),2)) into v_city,v_state
 from public.merchant_business_details d where d.merchant_id=p_merchant;
 v_city_valid:=char_length(coalesce(v_city,''))>=2 and coalesce(v_state,'')~'^[A-Z]{2}$';
 select coalesce(i.interested,false) into v_interest
 from public.merchant_ads_interest_v1_232 i where i.merchant_id=p_merchant;
 v_interest:=coalesce(v_interest,false);
 select * into v_creative from public.merchant_ads_campaigns_v1_233
 where merchant_id=p_merchant;
 v_city_current:=v_city_valid and (
  v_creative.merchant_id is null or
  (v_creative.target_city=v_city and v_creative.target_state=v_state));
 select count(*) into v_catalog from public.catalog_items ci
 join public.product_delivery_profiles pr on pr.product_code=ci.product_code and pr.active
 where ci.merchant_id=p_merchant and ci.active
 and (v_creative.merchant_id is null or v_creative.category_key='all'
   or pr.category_key=v_creative.category_key);
 v_catalog_ready:=v_catalog>0;
 v_ready:=v_status='active' and v_interest and v_city_current and
   v_catalog_ready and v_creative.merchant_id is not null and v_creative.status='draft';
 if v_creative.status='approved_creative' then v_step:='creative_approved';
 elsif v_creative.status='submitted' then v_step:='awaiting_review';
 elsif v_status<>'active' then v_step:='activate_merchant';
 elsif not v_city_valid then v_step:='complete_business_city';
 elsif not v_city_current then v_step:='update_creative_city';
 elsif not v_interest then v_step:='register_interest';
 elsif not v_catalog_ready then v_step:='activate_catalog';
 elsif v_creative.merchant_id is null then v_step:='prepare_creative';
 elsif v_creative.status in ('needs_changes','withdrawn') then v_step:='revise_creative';
 elsif v_creative.status='draft' then v_step:='submit_creative';
 else v_step:='review_status';
 end if;
 return jsonb_build_object(
  'source','merchant_ads_start_read_v1_321','merchantId',p_merchant,
  'readOnly',true,'noCharge',true,'adsLive',false,'noAutomaticEnrollment',true,
  'checkedAt',clock_timestamp(),'merchantActive',v_status='active',
  'businessCityReady',v_city_valid,'creativeCityCurrent',v_city_current,
  'interestRegistered',v_interest,'matchingActiveCatalogCount',v_catalog,
  'activeCatalogReady',v_catalog_ready,
  'creativeStatus',case when v_creative.merchant_id is null then null else v_creative.status end,
  'creativeVersion',case when v_creative.merchant_id is null then 0 else v_creative.version end,
  'readyToSubmit',v_ready,'nextAction',v_step
 );
end;
$f$;
revoke all on function public.merchant_ads_start_read_v1_321(uuid,uuid) from public,anon,authenticated;
grant execute on function public.merchant_ads_start_read_v1_321(uuid,uuid) to service_role;
