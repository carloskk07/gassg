-- TAMÃO V1.311 — commercial contract dossier REVIEW, not contract execution or billing.
create table public.platform_ads_contract_dossiers_v1_311(
 merchant_id uuid primary key references public.merchants(id),
 offer_version integer not null check(offer_version>0),
 price_cents integer not null check(price_cents between 1000 and 5000000),
 duration_days integer not null check(duration_days between 7 and 90),
 service_scope text not null check(char_length(service_scope) between 60 and 700),
 cancellation_terms text not null check(char_length(cancellation_terms) between 40 and 700),
 due_days integer not null check(due_days between 1 and 30),
 status text not null check(status in ('draft','shared_for_review','changes_requested','reviewed','withdrawn')),
 version integer not null check(version>0),
 updated_by uuid not null,updated_at timestamptz not null default clock_timestamp(),
 shared_at timestamptz,reviewed_by uuid,reviewed_at timestamptz
);
alter table public.platform_ads_contract_dossiers_v1_311 enable row level security;
revoke all on public.platform_ads_contract_dossiers_v1_311 from public,anon,authenticated;
grant select,insert,update on public.platform_ads_contract_dossiers_v1_311 to service_role;
create table public.platform_ads_dossier_actions_v1_311(
 request_id uuid primary key,merchant_id uuid not null references public.merchants(id),
 actor_user_id uuid not null,signature jsonb not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index platform_ads_dossier_actions_v1_311_merchant on
 public.platform_ads_dossier_actions_v1_311(merchant_id,created_at desc);
alter table public.platform_ads_dossier_actions_v1_311 enable row level security;
revoke all on public.platform_ads_dossier_actions_v1_311 from public,anon,authenticated;
grant select,insert on public.platform_ads_dossier_actions_v1_311 to service_role;

create or replace function public.admin_ads_dossiers_read_v1_311(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $f$
declare v_rows jsonb;v_total bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
 where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_DOSSIER_READ_DENIED' using errcode='42501';end if;
 select count(*) into v_total from public.platform_ads_contract_dossiers_v1_311;
 select coalesce(jsonb_agg(jsonb_build_object(
  'merchantId',d.merchant_id,'companyName',left(m.name,120),
  'offerVersion',d.offer_version,'priceCents',d.price_cents,
  'durationDays',d.duration_days,'serviceScope',d.service_scope,
  'cancellationTerms',d.cancellation_terms,'dueDays',d.due_days,
  'status',d.status,'version',d.version,'sharedAt',d.shared_at,
  'reviewedAt',d.reviewed_at,'updatedAt',d.updated_at
 ) order by d.updated_at desc,d.merchant_id),'[]'::jsonb) into v_rows
 from (select * from public.platform_ads_contract_dossiers_v1_311 order by updated_at desc limit 50) d
 join public.merchants m on m.id=d.merchant_id;
 return jsonb_build_object('source','admin_ads_dossiers_v1_311','readOnly',true,
 'totalDossiers',v_total,'rows',v_rows,'noCharge',true,'adsLive',false,
 'contractsSigned',0,'revenueCents',0,'paymentRequestsCreated',0);
end;
$f$;
revoke all on function public.admin_ads_dossiers_read_v1_311(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_dossiers_read_v1_311(uuid) to service_role;

create or replace function public.admin_ads_dossier_action_v1_311(
 p_actor uuid,p_merchant uuid,p_action text,p_offer_version integer,p_expected_version integer,
 p_service_scope text,p_cancellation_terms text,p_due_days integer,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $f$
declare
 v_offer public.platform_ads_offers_v1_310%rowtype;
 v_pack public.platform_ads_contract_dossiers_v1_311%rowtype;
 v_signature jsonb;v_prior record;v_response jsonb;v_version integer;v_status text;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
 where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'ADS_DOSSIER_FOUNDER_ONLY' using errcode='42501';end if;
 if p_merchant is null or p_request is null or p_action not in ('save','share','withdraw')
  or p_offer_version is null or p_offer_version<1
  or p_expected_version is null or p_expected_version<0
 then raise exception 'ADS_DOSSIER_ACTION_INVALID' using errcode='22023';end if;
 if p_action='save' and (p_service_scope is null or char_length(btrim(p_service_scope)) not between 60 and 700
  or p_cancellation_terms is null or char_length(btrim(p_cancellation_terms)) not between 40 and 700
  or p_due_days is null or p_due_days not between 1 and 30)
 then raise exception 'ADS_DOSSIER_TERMS_INVALID' using errcode='22023';end if;
 v_signature:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,'operation',p_action,
  'offerVersion',p_offer_version,'expectedVersion',p_expected_version,
  'scope',coalesce(btrim(p_service_scope),''),'cancellation',coalesce(btrim(p_cancellation_terms),''),
  'dueDays',p_due_days);
 select signature,response into v_prior from public.platform_ads_dossier_actions_v1_311
 where request_id=p_request;
 if found then
  if v_prior.signature<>v_signature then raise exception 'ADS_DOSSIER_REQUEST_REUSE' using errcode='23505';end if;
  return v_prior.response||jsonb_build_object('replayed',true);
 end if;
 select * into v_offer from public.platform_ads_offers_v1_310
 where merchant_id=p_merchant and version=p_offer_version and status='interested' for update;
 if not found then raise exception 'ADS_DOSSIER_OFFER_NOT_INTERESTED' using errcode='40001';end if;
 -- A withdrawn or edited creative cannot have a new dossier shared.
 perform 1 from public.merchant_ads_campaigns_v1_233 c
 where c.merchant_id=p_merchant and c.version=v_offer.creative_version
 and c.status='approved_creative' and c.ads_live=false and c.no_charge=true for update;
 if not found then raise exception 'ADS_DOSSIER_CREATIVE_REVOKED' using errcode='40001';end if;
 select * into v_pack from public.platform_ads_contract_dossiers_v1_311
 where merchant_id=p_merchant for update;
 if v_pack.merchant_id is null then
  if p_action<>'save' or p_expected_version<>0 then raise exception 'ADS_DOSSIER_NOT_FOUND' using errcode='40001';end if;
 else
  if v_pack.version<>p_expected_version or v_pack.offer_version<>p_offer_version
  then raise exception 'ADS_DOSSIER_VERSION_CONFLICT' using errcode='40001';end if;
 end if;
 if p_action='save' then
  if v_pack.merchant_id is not null and v_pack.status not in ('draft','changes_requested')
  then raise exception 'ADS_DOSSIER_NOT_EDITABLE' using errcode='40001';end if;
  v_status:='draft';v_version:=p_expected_version+1;
  insert into public.platform_ads_contract_dossiers_v1_311(
   merchant_id,offer_version,price_cents,duration_days,service_scope,
   cancellation_terms,due_days,status,version,updated_by)
  values(p_merchant,v_offer.version,v_offer.price_cents,v_offer.duration_days,
   btrim(p_service_scope),btrim(p_cancellation_terms),p_due_days,'draft',v_version,p_actor)
  on conflict (merchant_id) do update set
   service_scope=excluded.service_scope,cancellation_terms=excluded.cancellation_terms,
   due_days=excluded.due_days,status='draft',version=excluded.version,
   updated_by=p_actor,updated_at=clock_timestamp(),shared_at=null,reviewed_by=null,reviewed_at=null;
 elsif p_action='share' then
  if v_pack.status<>'draft' then raise exception 'ADS_DOSSIER_NOT_DRAFT' using errcode='40001';end if;
  v_status:='shared_for_review';v_version:=p_expected_version+1;
  update public.platform_ads_contract_dossiers_v1_311 set
   status=v_status,version=v_version,shared_at=clock_timestamp(),
   updated_by=p_actor,updated_at=clock_timestamp()
  where merchant_id=p_merchant;
 else
  if v_pack.status<>'shared_for_review' then raise exception 'ADS_DOSSIER_NOT_SHARED' using errcode='40001';end if;
  v_status:='withdrawn';v_version:=p_expected_version+1;
  update public.platform_ads_contract_dossiers_v1_311 set
   status=v_status,version=v_version,updated_by=p_actor,updated_at=clock_timestamp()
  where merchant_id=p_merchant;
 end if;
 v_response:=jsonb_build_object('source','admin_ads_dossier_action_v1_311',
  'merchantId',p_merchant,'status',v_status,'version',v_version,
  'recorded',true,'replayed',false,'noCharge',true,'adsLive',false,
  'contractSigned',false,'paymentRequestCreated',false);
 insert into public.platform_ads_dossier_actions_v1_311(
  request_id,merchant_id,actor_user_id,signature,response)
 values(p_request,p_merchant,p_actor,v_signature,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-dossier-'||p_action,'merchant',p_merchant::text,
  jsonb_build_object('requestId',p_request,'dossierVersion',v_version,
   'offerVersion',p_offer_version,'noBilling',true));
 return v_response;
end;
$f$;
revoke all on function public.admin_ads_dossier_action_v1_311(uuid,uuid,text,integer,integer,text,text,integer,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_ads_dossier_action_v1_311(uuid,uuid,text,integer,integer,text,text,integer,uuid)
 to service_role;

create or replace function public.merchant_ads_dossier_v1_311(
 p_actor uuid,p_merchant uuid,p_action text,p_expected_version integer default null,
 p_confirmed boolean default false,p_request uuid default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $f$
declare
 v_role text;v_pack public.platform_ads_contract_dossiers_v1_311%rowtype;
 v_sig jsonb;v_prior record;v_response jsonb;v_version integer;
begin
 select mm.member_role into v_role from public.merchant_members mm
 where mm.user_id=p_actor and mm.merchant_id=p_merchant and mm.active
  and mm.member_role in ('owner','manager') limit 1;
 if v_role is null then raise exception 'ADS_DOSSIER_MEMBER_DENIED' using errcode='42501';end if;
 if p_action not in ('view','reviewed','request_changes')
 then raise exception 'ADS_DOSSIER_OPERATION_INVALID' using errcode='22023';end if;
 if p_action<>'view' then
  if v_role<>'owner' or p_confirmed is distinct from true or p_request is null or
    p_expected_version is null or p_expected_version<1
  then raise exception 'ADS_DOSSIER_OWNER_CONFIRMATION_REQUIRED' using errcode='42501';end if;
  v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,'action',p_action,
   'expectedVersion',p_expected_version,'confirmed',true);
  select signature,response into v_prior from public.platform_ads_dossier_actions_v1_311
  where request_id=p_request;
  if found then
   if v_prior.signature<>v_sig then raise exception 'ADS_DOSSIER_REQUEST_REUSE' using errcode='23505';end if;
   return v_prior.response||jsonb_build_object('replayed',true);
  end if;
 end if;
 select * into v_pack from public.platform_ads_contract_dossiers_v1_311
 where merchant_id=p_merchant for update;
 if p_action='view' then
  return jsonb_build_object('source','merchant_ads_dossier_v1_311','merchantId',p_merchant,
   'readOnly',true,'noCharge',true,'adsLive',false,'contractSigned',false,
   'paymentRequestCreated',false,'reviewOnly',true,
   'dossier',case when v_pack.merchant_id is not null and
      v_pack.status in ('shared_for_review','reviewed','changes_requested') then
     jsonb_build_object('status',v_pack.status,'version',v_pack.version,
      'priceCents',v_pack.price_cents,'durationDays',v_pack.duration_days,
      'serviceScope',v_pack.service_scope,'cancellationTerms',v_pack.cancellation_terms,
      'dueDays',v_pack.due_days,'sharedAt',v_pack.shared_at,'reviewedAt',v_pack.reviewed_at)
    else null end);
 end if;
 if v_pack.merchant_id is null or v_pack.status<>'shared_for_review'
  or v_pack.version<>p_expected_version
 then raise exception 'ADS_DOSSIER_NO_ACTIVE_REVIEW' using errcode='40001';end if;
 -- Can only review an unchanged Ads offer with the same audited interested status.
 perform 1 from public.platform_ads_offers_v1_310 o
 where o.merchant_id=p_merchant and o.version=v_pack.offer_version and o.status='interested';
 if not found then raise exception 'ADS_DOSSIER_OFFER_CHANGED' using errcode='40001';end if;
 update public.platform_ads_contract_dossiers_v1_311 set
  status=case when p_action='reviewed' then 'reviewed' else 'changes_requested' end,
  version=version+1,reviewed_by=p_actor,reviewed_at=clock_timestamp(),
  updated_by=p_actor,updated_at=clock_timestamp()
 where merchant_id=p_merchant returning version into v_version;
 v_response:=jsonb_build_object('source','merchant_ads_dossier_v1_311',
  'merchantId',p_merchant,'status',case when p_action='reviewed' then 'reviewed' else 'changes_requested' end,
  'version',v_version,'recorded',true,'replayed',false,'noCharge',true,
  'adsLive',false,'contractSigned',false,'paymentRequestCreated',false);
 insert into public.platform_ads_dossier_actions_v1_311(
  request_id,merchant_id,actor_user_id,signature,response)
 values(p_request,p_merchant,p_actor,v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-dossier-merchant-'||p_action,'merchant',p_merchant::text,
  jsonb_build_object('requestId',p_request,'dossierVersion',v_version,'reviewOnly',true));
 return v_response;
end;
$f$;
revoke all on function public.merchant_ads_dossier_v1_311(uuid,uuid,text,integer,boolean,uuid) from public,anon,authenticated;
grant execute on function public.merchant_ads_dossier_v1_311(uuid,uuid,text,integer,boolean,uuid) to service_role;
