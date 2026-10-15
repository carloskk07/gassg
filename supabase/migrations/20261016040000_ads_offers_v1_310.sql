-- TAMÃO V1.310 — merchant-visible, nonbinding Ads offer and owner response.
-- Never charges, contracts, publishes creatives or sends notifications.
create table if not exists public.platform_ads_offers_v1_310(
 merchant_id uuid primary key references public.merchants(id),
 plan_version integer not null check(plan_version>0),
 creative_version integer not null check(creative_version>0),
 price_cents integer not null check(price_cents between 1000 and 5000000),
 duration_days integer not null check(duration_days between 7 and 90),
 status text not null check(status in ('shared','interested','declined','withdrawn')),
 version integer not null check(version>0),
 shared_at timestamptz not null,expires_at timestamptz not null,
 shared_by uuid not null,responded_at timestamptz,responded_by uuid,
 changed_at timestamptz not null default clock_timestamp()
);
alter table public.platform_ads_offers_v1_310 enable row level security;
revoke all on public.platform_ads_offers_v1_310 from public,anon,authenticated;
grant select,insert,update on public.platform_ads_offers_v1_310 to service_role;

create table if not exists public.platform_ads_offer_actions_v1_310(
 request_id uuid primary key,
 merchant_id uuid not null references public.merchants(id),
 actor_user_id uuid not null,
 operation text not null,
 signature jsonb not null,
 response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists platform_ads_offer_actions_v1_310_merchant
 on public.platform_ads_offer_actions_v1_310(merchant_id,created_at desc);
alter table public.platform_ads_offer_actions_v1_310 enable row level security;
revoke all on public.platform_ads_offer_actions_v1_310 from public,anon,authenticated;
grant select,insert on public.platform_ads_offer_actions_v1_310 to service_role;

create or replace function public.admin_ads_offers_read_v1_310(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $function$
declare v_rows jsonb;v_total bigint;v_interested bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
 where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_OFFERS_ADMIN_DENIED' using errcode='42501';end if;
 select count(*),count(*) filter(where status='interested') into v_total,v_interested
 from public.platform_ads_offers_v1_310;
 select coalesce(jsonb_agg(jsonb_build_object(
  'merchantId',o.merchant_id,'companyName',left(m.name,120),
  'status',o.status,'version',o.version,'planVersion',o.plan_version,
  'creativeVersion',o.creative_version,'priceCents',o.price_cents,
  'durationDays',o.duration_days,'sharedAt',o.shared_at,'expiresAt',o.expires_at,
  'respondedAt',o.responded_at,'expired',o.status='shared' and o.expires_at<=clock_timestamp()
 ) order by o.changed_at desc,o.merchant_id),'[]'::jsonb) into v_rows
 from (select * from public.platform_ads_offers_v1_310 order by changed_at desc limit 50) o
 join public.merchants m on m.id=o.merchant_id;
 return jsonb_build_object('source','admin_ads_offers_v1_310','readOnly',true,
  'checkedAt',clock_timestamp(),'totalOffers',v_total,'interestedResponses',v_interested,
  'rows',v_rows,'noCharge',true,'adsLive',false,'contractsSigned',0,'revenueCents',0,
  'notifiedExternally',false);
end;
$function$;
revoke all on function public.admin_ads_offers_read_v1_310(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_offers_read_v1_310(uuid) to service_role;

create or replace function public.admin_ads_offer_action_v1_310(
 p_actor uuid,p_merchant uuid,p_action text,p_plan_version integer,
 p_expected_offer_version integer,p_reason text,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $function$
declare
 v_plan public.platform_ads_sales_plans_v1_309%rowtype;
 v_offer public.platform_ads_offers_v1_310%rowtype;
 v_sig jsonb;v_old jsonb;v_response jsonb;v_next integer;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
 where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'ADS_OFFER_FOUNDER_REQUIRED' using errcode='42501';end if;
 if p_merchant is null or p_request is null or p_action not in ('share','withdraw')
 or p_plan_version is null or p_plan_version<1 or p_expected_offer_version is null or p_expected_offer_version<0
 or p_reason is null or char_length(btrim(p_reason)) not between 12 and 240
 then raise exception 'ADS_OFFER_INVALID_ACTION' using errcode='22023';end if;
 v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,'action',p_action,
  'planVersion',p_plan_version,'expectedVersion',p_expected_offer_version,'reason',btrim(p_reason));
 select response into v_old from public.platform_ads_offer_actions_v1_310
 where request_id=p_request and signature=v_sig;
 if found then return v_old||jsonb_build_object('replayed',true);end if;
 if exists(select 1 from public.platform_ads_offer_actions_v1_310 where request_id=p_request)
 then raise exception 'ADS_OFFER_IDEMPOTENCY_REUSE' using errcode='23505';end if;
 select * into v_offer from public.platform_ads_offers_v1_310 where merchant_id=p_merchant for update;
 if found then
  if v_offer.version<>p_expected_offer_version
  then raise exception 'ADS_OFFER_VERSION_CONFLICT' using errcode='40001';end if;
 elsif p_expected_offer_version<>0 then
  raise exception 'ADS_OFFER_VERSION_CONFLICT' using errcode='40001';
 end if;
 if p_action='share' then
   select * into v_plan from public.platform_ads_sales_plans_v1_309
   where merchant_id=p_merchant and version=p_plan_version and stage='ready_for_contact' for update;
   if not found then raise exception 'ADS_OFFER_PLAN_NOT_READY' using errcode='40001';end if;
   perform 1 from public.merchant_ads_campaigns_v1_233 c
     where c.merchant_id=p_merchant and c.version=v_plan.creative_version
       and c.status='approved_creative' and c.ads_live=false and c.no_charge=true for update;
   if not found then raise exception 'ADS_OFFER_CREATIVE_NOT_APPROVED' using errcode='40001';end if;
   if v_offer.merchant_id is not null and v_offer.plan_version>=p_plan_version
   then raise exception 'ADS_OFFER_REQUIRES_NEW_PLAN_VERSION' using errcode='40001';end if;
   v_next:=coalesce(v_offer.version,0)+1;
   insert into public.platform_ads_offers_v1_310(
    merchant_id,plan_version,creative_version,price_cents,duration_days,status,version,
    shared_at,expires_at,shared_by,responded_at,responded_by,changed_at
   ) values(p_merchant,v_plan.version,v_plan.creative_version,v_plan.price_cents,v_plan.duration_days,
    'shared',v_next,clock_timestamp(),clock_timestamp()+interval '14 days',
    p_actor,null,null,clock_timestamp())
   on conflict(merchant_id) do update set
    plan_version=excluded.plan_version,creative_version=excluded.creative_version,
    price_cents=excluded.price_cents,duration_days=excluded.duration_days,
    status='shared',version=excluded.version,shared_at=excluded.shared_at,
    expires_at=excluded.expires_at,shared_by=excluded.shared_by,
    responded_at=null,responded_by=null,changed_at=clock_timestamp();
 else
   if v_offer.merchant_id is null or v_offer.status<>'shared' or v_offer.plan_version<>p_plan_version
   then raise exception 'ADS_OFFER_NOT_WITHDRAWABLE' using errcode='40001';end if;
   update public.platform_ads_offers_v1_310 set status='withdrawn',
    version=version+1,changed_at=clock_timestamp()
   where merchant_id=p_merchant returning version into v_next;
 end if;
 v_response:=jsonb_build_object('source','admin_ads_offer_action_v1_310',
  'merchantId',p_merchant,'operation',p_action,'status',case when p_action='share' then 'shared' else 'withdrawn' end,
  'version',v_next,'changed',true,'replayed',false,
  'noCharge',true,'adsLive',false,'contractSigned',false,'merchantNotified',false);
 insert into public.platform_ads_offer_actions_v1_310(
  request_id,merchant_id,actor_user_id,operation,signature,response
 ) values(p_request,p_merchant,p_actor,p_action,v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-offer-'||p_action,'merchant',p_merchant::text,
  jsonb_build_object('requestId',p_request,'planVersion',p_plan_version,
    'offerVersion',v_next,'reason',btrim(p_reason)));
 return v_response;
end;
$function$;
revoke all on function public.admin_ads_offer_action_v1_310(uuid,uuid,text,integer,integer,text,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_ads_offer_action_v1_310(uuid,uuid,text,integer,integer,text,uuid)
 to service_role;

create or replace function public.merchant_ads_offer_v1_310(
 p_actor uuid,p_merchant uuid,p_operation text,p_expected_version integer default null,
 p_consent boolean default false,p_request uuid default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $function$
declare
 v_role text;v_offer public.platform_ads_offers_v1_310%rowtype;
 v_sig jsonb;v_old jsonb;v_response jsonb;v_version integer;
begin
 select mm.member_role into v_role from public.merchant_members mm
 where mm.user_id=p_actor and mm.merchant_id=p_merchant and mm.active
  and mm.member_role in ('owner','manager') limit 1;
 if v_role is null then raise exception 'ADS_OFFER_MERCHANT_ACCESS_DENIED' using errcode='42501';end if;
 if p_operation not in ('view','interested','declined')
 then raise exception 'ADS_OFFER_OPERATION_INVALID' using errcode='22023';end if;
 if p_operation<>'view' then
  if v_role<>'owner' or p_consent is distinct from true or p_request is null
    or p_expected_version is null or p_expected_version<1
  then raise exception 'ADS_OFFER_OWNER_CONFIRMATION_REQUIRED' using errcode='42501';end if;
  v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,
    'operation',p_operation,'version',p_expected_version,'consent',p_consent);
  select response into v_old from public.platform_ads_offer_actions_v1_310
    where request_id=p_request and signature=v_sig;
  if found then return v_old||jsonb_build_object('replayed',true);end if;
  if exists(select 1 from public.platform_ads_offer_actions_v1_310 where request_id=p_request)
  then raise exception 'ADS_OFFER_IDEMPOTENCY_REUSE' using errcode='23505';end if;
 end if;
 select * into v_offer from public.platform_ads_offers_v1_310 where merchant_id=p_merchant
  for update;
 if p_operation<>'view' then
  if not found or v_offer.status<>'shared' or v_offer.version<>p_expected_version
    or v_offer.expires_at<=clock_timestamp()
  then raise exception 'ADS_OFFER_NOT_AVAILABLE' using errcode='40001';end if;
  perform 1 from public.platform_ads_sales_plans_v1_309 p
   where p.merchant_id=p_merchant and p.version=v_offer.plan_version
     and p.stage='ready_for_contact' and p.creative_version=v_offer.creative_version
     and p.price_cents=v_offer.price_cents and p.duration_days=v_offer.duration_days;
  if not found then raise exception 'ADS_OFFER_PLAN_CHANGED' using errcode='40001';end if;
  perform 1 from public.merchant_ads_campaigns_v1_233 c
   where c.merchant_id=p_merchant and c.version=v_offer.creative_version
     and c.status='approved_creative' and c.ads_live=false and c.no_charge=true;
  if not found then raise exception 'ADS_OFFER_CREATIVE_REVOKED' using errcode='40001';end if;
  update public.platform_ads_offers_v1_310 set
   status=p_operation,version=version+1,responded_at=clock_timestamp(),
   responded_by=p_actor,changed_at=clock_timestamp()
   where merchant_id=p_merchant returning version into v_version;
  v_response:=jsonb_build_object('source','merchant_ads_offer_v1_310',
   'merchantId',p_merchant,'operation',p_operation,'status',p_operation,
   'version',v_version,'recorded',true,'replayed',false,
   'noCharge',true,'adsLive',false,'contractSigned',false,'paymentCreated',false);
  insert into public.platform_ads_offer_actions_v1_310(
   request_id,merchant_id,actor_user_id,operation,signature,response
  ) values(p_request,p_merchant,p_actor,p_operation,v_sig,v_response);
  insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
  values(p_actor,'ads-offer-merchant-'||p_operation,'merchant',p_merchant::text,
    jsonb_build_object('offerVersion',v_version,'requestId',p_request,
      'nonbinding',true,'actorRole',v_role));
  return v_response;
 end if;
 return jsonb_build_object('source','merchant_ads_offer_v1_310',
  'merchantId',p_merchant,'readOnly',true,'checkedAt',clock_timestamp(),
  'offer',case when v_offer.merchant_id is null then null else jsonb_build_object(
    'priceCents',v_offer.price_cents,'durationDays',v_offer.duration_days,
    'status',v_offer.status,'version',v_offer.version,
    'sharedAt',v_offer.shared_at,'expiresAt',v_offer.expires_at,
    'expired',v_offer.status='shared' and v_offer.expires_at<=clock_timestamp(),
    'creativeVersion',v_offer.creative_version,'respondedAt',v_offer.responded_at
  ) end,'noCharge',true,'adsLive',false,'contractSigned',false,
  'paymentCreated',false,'nonBinding',true);
end;
$function$;
revoke all on function public.merchant_ads_offer_v1_310(uuid,uuid,text,integer,boolean,uuid)
 from public,anon,authenticated;
grant execute on function public.merchant_ads_offer_v1_310(uuid,uuid,text,integer,boolean,uuid)
 to service_role;
