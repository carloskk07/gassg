-- TAMÃO Ads V1.236: sponsored slot foundation, deliberately disabled in production.
-- Does NOT modify offer ranking, execute ad delivery, record impressions, or charge advertisers.
create table if not exists public.ads_placement_controls_v1_236(
  singleton boolean primary key default true check(singleton=true),
  public_enabled boolean not null default false check(public_enabled=false),
  billing_enabled boolean not null default false check(billing_enabled=false),
  verified_delivery_enabled boolean not null default false check(verified_delivery_enabled=false),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.ads_placement_controls_v1_236(singleton)
 values(true) on conflict(singleton) do nothing;
alter table public.ads_placement_controls_v1_236 enable row level security;
revoke all on public.ads_placement_controls_v1_236
 from public,anon,authenticated,service_role;
create schema if not exists ads_internal_v1_236;
revoke all on schema ads_internal_v1_236 from public,anon,authenticated;
grant usage on schema ads_internal_v1_236 to service_role;

-- SQL never trusts a client "enabled" flag. Even if a future code path
-- attempts to request placement, this database gate forces a null slot.
create or replace function ads_internal_v1_236.select_sponsored_slot(
 p_city text,p_state text,p_offer_merchants uuid[],p_product_codes text[]
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare
 v_enabled boolean:=false;
 v_creative record;
 v_city text:=btrim(coalesce(p_city,''));
 v_state text:=upper(btrim(coalesce(p_state,'')));
begin
 select public_enabled into v_enabled
 from public.ads_placement_controls_v1_236 where singleton=true;
 if coalesce(v_enabled,false) is distinct from true
    or char_length(v_city) not between 2 and 100
    or v_state !~ '^[A-Z]{2}$'
    or coalesce(array_length(p_offer_merchants,1),0)=0
    or coalesce(array_length(p_product_codes,1),0)=0
    or coalesce(array_length(p_offer_merchants,1),0)>20
    or coalesce(array_length(p_product_codes,1),0)>30
 then
   return jsonb_build_object(
     'source','ads_sponsored_slot_v1_236','sponsoredSlot',null,
     'publicEnabled',false,'billingEnabled',false,
     'verifiedDeliveryEnabled',false,'noCharge',true
   );
 end if;

 -- For a future explicitly reviewed rollout only: the sponsorship is a
 -- separate editorial surface, never inserted into quote or ranking arrays.
 -- The input IDs must come from already-created valid quotes on get-offers.
 select c.title,c.description,c.target_city,c.target_state,
        m.name as advertiser_name,c.merchant_id,c.version
 into v_creative
 from public.merchant_ads_campaigns_v1_233 c
 join public.merchants m on m.id=c.merchant_id
 join public.merchant_ads_interest_v1_232 i
   on i.merchant_id=c.merchant_id and i.interested
 where c.status='approved_creative'
   and c.target_city=v_city and c.target_state=v_state
   and c.merchant_id=any(p_offer_merchants)
   and m.status='active' and m.online=true
   and (c.category_key='all' or exists(
     select 1 from public.product_delivery_profiles pr
     where pr.category_key=c.category_key and pr.active
       and pr.product_code=any(p_product_codes)))
 order by c.reviewed_at asc nulls last,c.merchant_id
 limit 1;
 if not found then
   return jsonb_build_object(
     'source','ads_sponsored_slot_v1_236','sponsoredSlot',null,
     'publicEnabled',true,'billingEnabled',false,
     'verifiedDeliveryEnabled',false,'noCharge',true
   );
 end if;
 return jsonb_build_object(
   'source','ads_sponsored_slot_v1_236',
   'sponsoredSlot',jsonb_build_object(
     'label','Patrocinado','title',v_creative.title,
     'description',v_creative.description,
     'advertiser',left(v_creative.advertiser_name,120),
     'city',v_creative.target_city,'state',v_creative.target_state,
     'nonBillable',true,'adId',null,'clickUrl',null
   ),
   'publicEnabled',true,'billingEnabled',false,
   'verifiedDeliveryEnabled',false,'noCharge',true
 );
end;
$fn$;
revoke all on function ads_internal_v1_236.select_sponsored_slot(text,text,uuid[],text[])
 from public,anon,authenticated,service_role;
grant execute on function ads_internal_v1_236.select_sponsored_slot(text,text,uuid[],text[])
 to service_role;

create or replace function public.ads_sponsored_slot_v1_236(
 p_city text,p_state text,p_offer_merchants uuid[],p_product_codes text[]
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select ads_internal_v1_236.select_sponsored_slot($1,$2,$3,$4)
$wrapper$;
revoke all on function public.ads_sponsored_slot_v1_236(text,text,uuid[],text[])
 from public,anon,authenticated,service_role;
grant execute on function public.ads_sponsored_slot_v1_236(text,text,uuid[],text[])
 to service_role;

create or replace function ads_internal_v1_236.placement_readiness(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_count bigint:=0;v_approved bigint:=0;v_gate boolean:=false;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a where a.user_id=p_actor and a.active
    and a.admin_role in ('superadmin','operations','compliance','finance','readonly')
 ) then
   raise exception 'ADS_PLACEMENT_ADMIN_DENIED' using errcode='42501';
 end if;
 select public_enabled into v_gate from public.ads_placement_controls_v1_236 where singleton=true;
 select count(*)::bigint into v_approved
 from public.merchant_ads_campaigns_v1_233 where status='approved_creative';
 select count(*)::bigint into v_count
 from public.merchant_ads_campaigns_v1_233 c
 join public.merchants m on m.id=c.merchant_id
 join public.merchant_ads_interest_v1_232 i on i.merchant_id=c.merchant_id and i.interested
 where c.status='approved_creative' and m.status='active' and m.online=true;
 return jsonb_build_object(
  'source','admin_ads_placement_readiness_v1_236',
  'approvedCreatives',v_approved,'potentialMerchantCreatives',v_count,
  'publicEnabled',coalesce(v_gate,false),
  'billingEnabled',false,'verifiedDeliveryEnabled',false,
  'verifiedAdImpressions',0,'billableImpressions',0,
  'adsRevenueCents',0,'noCharge',true,'readyToSell',false,
  'organicRankingUnaffected',true,'readOnly',true
 );
end;
$fn$;
revoke all on function ads_internal_v1_236.placement_readiness(uuid)
 from public,anon,authenticated,service_role;
grant execute on function ads_internal_v1_236.placement_readiness(uuid)
 to service_role;

create or replace function public.admin_ads_placement_readiness_v1_236(p_actor uuid)
returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select ads_internal_v1_236.placement_readiness($1)
$wrapper$;
revoke all on function public.admin_ads_placement_readiness_v1_236(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_ads_placement_readiness_v1_236(uuid)
 to service_role;

do $acl$
begin
 if has_table_privilege('service_role','public.ads_placement_controls_v1_236','UPDATE')
 or has_table_privilege('anon','public.ads_placement_controls_v1_236','SELECT')
 or has_function_privilege('authenticated','public.ads_sponsored_slot_v1_236(text,text,uuid[],text[])','EXECUTE')
 or has_function_privilege('anon','public.admin_ads_placement_readiness_v1_236(uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.ads_sponsored_slot_v1_236(text,text,uuid[],text[])','EXECUTE')
 then raise exception 'ADS_PLACEMENT_ACL_DRIFT' using errcode='42501';end if;
end;
$acl$;