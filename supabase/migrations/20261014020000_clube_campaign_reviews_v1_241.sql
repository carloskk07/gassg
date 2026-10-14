-- TAMÃO V1.241: Negociações de campanhas Clube, SEM ativação ou autorização financeira.
-- Regra: a intenção voluntária da revenda não é contrato, prova de financiamento, desconto ou venda.
create table public.clube_campaign_reviews_v1_241 (
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 package_key text not null references public.clube_package_drafts_v1_239(package_key),
 interest_version integer not null check(interest_version>=1),
 status text not null check(status in ('under_review','request_documents','economic_prechecked','declined')),
 decision_note text not null check(char_length(decision_note) between 12 and 500),
 city_snapshot text not null check(char_length(city_snapshot) between 2 and 100),
 state_snapshot text not null check(state_snapshot ~ '^[A-Z]{2}$'),
 merchant_share_bps integer not null check(merchant_share_bps between 100 and 10000),
 proposed_budget_cents integer not null check(proposed_budget_cents between 500 and 1000000),
 sponsored_per_coupon_cents integer not null check(sponsored_per_coupon_cents between 1 and 10000),
 max_coupon_uses_illustrative integer not null check(max_coupon_uses_illustrative between 0 and 1000000),
 max_packages_illustrative integer not null check(max_packages_illustrative between 0 and 1000000),
 version integer not null check(version between 1 and 2147483646),
 reviewed_by uuid not null references auth.users(id),
 reviewed_at timestamptz not null default clock_timestamp(),
 funding_verified boolean not null default false check(funding_verified=false),
 contract_approved boolean not null default false check(contract_approved=false),
 campaign_enabled boolean not null default false check(campaign_enabled=false),
 primary key(merchant_id,package_key)
);
create index clube_campaign_reviews_status_v1_241
 on public.clube_campaign_reviews_v1_241(status,reviewed_at desc);
create table public.clube_campaign_review_events_v1_241 (
 request_id uuid primary key,
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 package_key text not null,
 actor_user_id uuid not null references auth.users(id),
 actor_role text not null,
 status text not null,
 note text not null,
 interest_version integer not null,
 request_signature jsonb not null,
 prior_version integer not null,
 resulting_version integer not null,
 created_at timestamptz not null default clock_timestamp()
);
create index clube_campaign_review_events_lookup_v1_241
 on public.clube_campaign_review_events_v1_241(merchant_id,package_key,created_at desc);
alter table public.clube_campaign_reviews_v1_241 enable row level security;
alter table public.clube_campaign_review_events_v1_241 enable row level security;
revoke all on public.clube_campaign_reviews_v1_241 from public,anon,authenticated,service_role;
revoke all on public.clube_campaign_review_events_v1_241 from public,anon,authenticated,service_role;
grant select on public.clube_campaign_reviews_v1_241 to service_role;
create schema if not exists clube_internal_v1_241;
revoke all on schema clube_internal_v1_241 from public,anon,authenticated;
grant usage on schema clube_internal_v1_241 to service_role;

create or replace function clube_internal_v1_241.review(
 p_actor uuid,p_merchant uuid,p_package_key text,
 p_status text,p_note text,p_expected_version integer,
 p_expected_interest_version integer,p_request_id uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_role text;
 v_interest public.merchant_clube_interest_v1_240%rowtype;
 v_pack public.clube_package_drafts_v1_239%rowtype;
 v_review public.clube_campaign_reviews_v1_241%rowtype;
 v_event public.clube_campaign_review_events_v1_241%rowtype;
 v_signature jsonb;
 v_current_version integer:=0;
 v_per_use integer;
 v_uses integer;
 v_packages integer;
 v_changed boolean:=false;
 v_replay boolean:=false;
begin
 select a.admin_role into v_role from public.platform_admins a
 where a.user_id=p_actor and a.active;
 if v_role is null or v_role not in ('superadmin','operations','compliance','finance')
 then raise exception 'CLUBE_REVIEW_ACCESS_DENIED' using errcode='42501';end if;
 if p_merchant is null or p_package_key not in ('gas_3x5','water_5x2') or p_package_key is null
   or p_status is null or p_status not in ('under_review','request_documents','economic_prechecked','declined')
   or p_note is null or char_length(btrim(p_note)) not between 12 and 500
   or p_expected_version is null or p_expected_version not between 0 and 2147483645
   or p_expected_interest_version is null or p_expected_interest_version<1
   or p_request_id is null
 then raise exception 'CLUBE_REVIEW_INVALID' using errcode='22023';end if;
 if p_status='economic_prechecked' and v_role not in ('superadmin','finance') then
  raise exception 'CLUBE_FINANCE_ROLE_REQUIRED' using errcode='42501';end if;
 v_signature:=jsonb_build_object('merchant',p_merchant,'package',p_package_key,
   'status',p_status,'note',btrim(p_note),'expectedVersion',p_expected_version,
   'interestVersion',p_expected_interest_version);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'clube-interest-v1-240:'||p_merchant::text||':'||p_package_key,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'clube-review-v1-241:'||p_merchant::text||':'||p_package_key,0));
 select * into v_event from public.clube_campaign_review_events_v1_241
   where request_id=p_request_id;
 if found then
  if v_event.request_signature is distinct from v_signature or
     v_event.actor_user_id is distinct from p_actor then
    raise exception 'CLUBE_REVIEW_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
  v_replay:=true;
 end if;
 select * into v_review from public.clube_campaign_reviews_v1_241 c
  where c.merchant_id=p_merchant and c.package_key=p_package_key;
 if found then v_current_version:=v_review.version;end if;
 if not v_replay then
  if v_current_version<>p_expected_version then
    raise exception 'CLUBE_REVIEW_STALE_VERSION' using errcode='40001';end if;
  select * into v_interest from public.merchant_clube_interest_v1_240 i
    where i.merchant_id=p_merchant and i.package_key=p_package_key for share;
  if not found or not v_interest.interested
    or v_interest.version<>p_expected_interest_version
    or v_interest.funding_verified or v_interest.sponsor_contract_approved
    or v_interest.discount_enabled
  then raise exception 'CLUBE_REVIEW_CONSENT_STALE' using errcode='40900';end if;
  if not exists(select 1 from public.merchant_business_details d
   where d.merchant_id=p_merchant
   and btrim(d.city)=v_interest.city_snapshot
   and upper(btrim(d.state))=v_interest.state_snapshot)
  then raise exception 'CLUBE_REVIEW_CITY_CHANGED' using errcode='22023';end if;
  select * into v_pack from public.clube_package_drafts_v1_239 p
    where p.package_key=p_package_key;
  if not found or v_pack.sales_enabled or v_pack.redemption_enabled then
    raise exception 'CLUBE_REVIEW_PACKAGE_DISABLED' using errcode='42501';end if;
  -- Round sponsorship obligation UP to avoid underestimating a revenda's proposed liability.
  v_per_use:=ceil(v_pack.discount_per_coupon_cents::numeric*
     v_interest.merchant_share_bps/10000)::integer;
  if v_per_use<1 or v_pack.coupon_count<1 then
    raise exception 'CLUBE_REVIEW_BUDGET_INVALID' using errcode='22023';end if;
  v_uses:=floor(v_interest.proposed_budget_cents::numeric/v_per_use)::integer;
  v_packages:=floor(v_uses::numeric/v_pack.coupon_count)::integer;
  if v_current_version=0 or v_review.status is distinct from p_status
    or v_review.decision_note is distinct from btrim(p_note)
    or v_review.interest_version<>v_interest.version then
    insert into public.clube_campaign_reviews_v1_241(
      merchant_id,package_key,interest_version,status,decision_note,
      city_snapshot,state_snapshot,merchant_share_bps,proposed_budget_cents,
      sponsored_per_coupon_cents,max_coupon_uses_illustrative,max_packages_illustrative,
      version,reviewed_by,reviewed_at
    ) values(p_merchant,p_package_key,v_interest.version,p_status,btrim(p_note),
      v_interest.city_snapshot,v_interest.state_snapshot,v_interest.merchant_share_bps,
      v_interest.proposed_budget_cents,v_per_use,v_uses,v_packages,
      v_current_version+1,p_actor,clock_timestamp())
    on conflict(merchant_id,package_key) do update set
      interest_version=excluded.interest_version,status=excluded.status,
      decision_note=excluded.decision_note,city_snapshot=excluded.city_snapshot,
      state_snapshot=excluded.state_snapshot,merchant_share_bps=excluded.merchant_share_bps,
      proposed_budget_cents=excluded.proposed_budget_cents,
      sponsored_per_coupon_cents=excluded.sponsored_per_coupon_cents,
      max_coupon_uses_illustrative=excluded.max_coupon_uses_illustrative,
      max_packages_illustrative=excluded.max_packages_illustrative,
      version=excluded.version,reviewed_by=excluded.reviewed_by,
      reviewed_at=excluded.reviewed_at;
    v_changed:=true;
  end if;
  insert into public.clube_campaign_review_events_v1_241(
    request_id,merchant_id,package_key,actor_user_id,actor_role,status,note,
    interest_version,request_signature,prior_version,resulting_version
  ) values(p_request_id,p_merchant,p_package_key,p_actor,v_role,p_status,
     btrim(p_note),v_interest.version,v_signature,v_current_version,
     v_current_version+case when v_changed then 1 else 0 end);
 end if;
 return jsonb_build_object('source','admin_clube_campaign_review_v1_241',
   'recorded',true,'changed',v_changed,'replayed',v_replay,
   'noCharge',true,'noContract',true,'fundingVerified',false,
   'campaignEnabled',false,'couponSalesEnabled',false);
end;
$fn$;
revoke all on function clube_internal_v1_241.review(
 uuid,uuid,text,text,text,integer,integer,uuid)
 from public,anon,authenticated,service_role;
grant execute on function clube_internal_v1_241.review(
 uuid,uuid,text,text,text,integer,integer,uuid) to service_role;
create or replace function public.admin_clube_campaign_review_v1_241(
 p_actor uuid,p_merchant uuid,p_package_key text,
 p_status text,p_note text,p_expected_version integer,
 p_expected_interest_version integer,p_request_id uuid
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrapper$
 select clube_internal_v1_241.review($1,$2,$3,$4,$5,$6,$7,$8)
$wrapper$;
revoke all on function public.admin_clube_campaign_review_v1_241(
 uuid,uuid,text,text,text,integer,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_clube_campaign_review_v1_241(
 uuid,uuid,text,text,text,integer,integer,uuid) to service_role;

create or replace function public.admin_clube_campaign_queue_v1_241(p_actor uuid)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog as $fn$
declare v_rows jsonb; v_total bigint;v_current bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active
    and a.admin_role in ('superadmin','operations','compliance','finance','readonly'))
 then raise exception 'CLUBE_CAMPAIGN_QUEUE_DENIED' using errcode='42501';end if;
 select count(*) into v_total from public.merchant_clube_interest_v1_240;
 select count(*) into v_current from public.merchant_clube_interest_v1_240 i
   where i.interested;
 select coalesce(jsonb_agg(jsonb_build_object(
  'merchantId',x.merchant_id,'companyName',x.company_name,
  'packageKey',x.package_key,'city',x.city_snapshot,
  'state',x.state_snapshot,
  'interestActive',x.interested,'interestVersion',x.interest_version,
  'shareBps',x.merchant_share_bps,'budgetCents',x.proposed_budget_cents,
  'sponsoredPerCouponCents',x.per_use_cents,'maxCouponUsesIllustrative',x.max_uses,
  'maxPackagesIllustrative',x.max_packages,
  'reviewStatus',x.review_status,'reviewVersion',x.review_version,
  'reviewNote',x.review_note,'reviewCurrent',x.review_current,
  'updatedAt',x.updated_at
 ) order by x.updated_at desc,x.merchant_id,x.package_key),'[]'::jsonb)
 into v_rows from (
  select i.merchant_id,left(m.name,120) company_name,
   i.package_key,i.city_snapshot,i.state_snapshot,i.interested,i.version interest_version,
   i.merchant_share_bps,i.proposed_budget_cents,
   case when i.interested then ceil(p.discount_per_coupon_cents::numeric*
     i.merchant_share_bps/10000)::integer else 0 end per_use_cents,
   case when i.interested and i.merchant_share_bps>0 then
     floor(i.proposed_budget_cents::numeric/
       ceil(p.discount_per_coupon_cents::numeric*i.merchant_share_bps/10000))::integer
     else 0 end max_uses,
   case when i.interested and i.merchant_share_bps>0 then
     floor(floor(i.proposed_budget_cents::numeric/
       ceil(p.discount_per_coupon_cents::numeric*i.merchant_share_bps/10000))/
       p.coupon_count)::integer else 0 end max_packages,
   c.status review_status,coalesce(c.version,0) review_version,
   c.decision_note review_note,
   coalesce((i.interested and c.interest_version=i.version
    and c.city_snapshot=i.city_snapshot and c.state_snapshot=i.state_snapshot
    and c.merchant_share_bps=i.merchant_share_bps
    and c.proposed_budget_cents=i.proposed_budget_cents),false) review_current,
   i.updated_at
  from public.merchant_clube_interest_v1_240 i
  join public.merchants m on m.id=i.merchant_id
  join public.clube_package_drafts_v1_239 p on p.package_key=i.package_key
  left join public.clube_campaign_reviews_v1_241 c
   on c.merchant_id=i.merchant_id and c.package_key=i.package_key
  order by i.updated_at desc,i.merchant_id,i.package_key limit 50
 )x;
 return jsonb_build_object('source','admin_clube_campaign_queue_v1_241',
  'totalProposals',v_total,'activeInterests',v_current,
  'rows',v_rows,'readOnly',true,'noContractsApproved',true,
  'sponsorFundingConfirmedCents',0,'couponSalesEnabled',false,
  'noCharge',true,'campaignsActive',0,'noMerchantSaleProceeds',true);
end;
$fn$;
revoke all on function public.admin_clube_campaign_queue_v1_241(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_clube_campaign_queue_v1_241(uuid) to service_role;

do $acl$begin
 if has_table_privilege('anon','public.clube_campaign_reviews_v1_241','SELECT')
  or has_table_privilege('authenticated','public.clube_campaign_reviews_v1_241','INSERT')
  or has_table_privilege('service_role','public.clube_campaign_reviews_v1_241','INSERT')
  or has_table_privilege('service_role','public.clube_campaign_review_events_v1_241','INSERT')
  or has_function_privilege('anon','public.admin_clube_campaign_review_v1_241(uuid,uuid,text,text,text,integer,integer,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.admin_clube_campaign_review_v1_241(uuid,uuid,text,text,text,integer,integer,uuid)','EXECUTE')
  or not has_function_privilege('service_role','public.admin_clube_campaign_queue_v1_241(uuid)','EXECUTE')
 then raise exception 'CLUBE_CAMPAIGN_ACL_DRIFT' using errcode='42501';end if;
end $acl$;