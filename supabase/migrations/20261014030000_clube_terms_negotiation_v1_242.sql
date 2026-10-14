-- TAMÃO V1.242: negotiated coupon economics and document workflow, WITHOUT legal contracting or funding.
-- Never exposes checkout, reserves funds, issues benefits or binds a merchant to pay.
create table public.clube_terms_drafts_v1_242 (
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 package_key text not null references public.clube_package_drafts_v1_239(package_key),
 interest_version integer not null check(interest_version>=1),
 review_version integer not null check(review_version>=1),
 terms_status text not null check(terms_status in ('draft','shared_for_discussion','withdrawn')),
 brand_share_bps integer not null check(brand_share_bps between 0 and 10000),
 brand_budget_cents integer not null check(brand_budget_cents between 0 and 1000000),
 platform_budget_cents integer not null check(platform_budget_cents between 0 and 1000000),
 identity_document_status text not null check(identity_document_status in ('not_requested','requested','supplied_unverified')),
 agreement_document_status text not null check(agreement_document_status in ('not_requested','requested','supplied_unverified')),
 funding_document_status text not null check(funding_document_status in ('not_requested','requested','supplied_unverified')),
 notes text not null check(char_length(notes) between 12 and 500),
 version integer not null check(version between 1 and 2147483646),
 merchant_response text not null default 'none'
  check(merchant_response in ('none','read_for_discussion','not_interested')),
 merchant_response_version integer not null default 0 check(merchant_response_version>=0),
 merchant_responded_by uuid references auth.users(id),
 merchant_responded_at timestamptz,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default clock_timestamp(),
 funding_verified boolean not null default false check(funding_verified=false),
 contract_signed boolean not null default false check(contract_signed=false),
 coupon_sales_enabled boolean not null default false check(coupon_sales_enabled=false),
 primary key(merchant_id,package_key),
 check(merchant_response_version=0 or merchant_response_version=version),
 check((merchant_response='none') =
  (merchant_response_version=0 and merchant_responded_by is null and merchant_responded_at is null))
);
create table public.clube_terms_events_v1_242 (
 request_id uuid primary key,
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 package_key text not null,
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('save_terms','merchant_reply')),
 request_signature jsonb not null,
 previous_version integer not null,
 resulting_version integer not null,
 created_at timestamptz not null default clock_timestamp()
);
create index clube_terms_events_lookup_v1_242
 on public.clube_terms_events_v1_242(merchant_id,package_key,created_at desc);
alter table public.clube_terms_drafts_v1_242 enable row level security;
alter table public.clube_terms_events_v1_242 enable row level security;
revoke all on public.clube_terms_drafts_v1_242 from public,anon,authenticated,service_role;
revoke all on public.clube_terms_events_v1_242 from public,anon,authenticated,service_role;
grant select on public.clube_terms_drafts_v1_242 to service_role;
create schema if not exists clube_internal_v1_242;
revoke all on schema clube_internal_v1_242 from public,anon,authenticated;
grant usage on schema clube_internal_v1_242 to service_role;

create or replace function clube_internal_v1_242.term_capacity(
 p_discount integer,p_count integer,p_merchant_bps integer,p_brand_bps integer,
 p_merchant_budget integer,p_brand_budget integer,p_platform_budget integer
) returns jsonb language plpgsql immutable security invoker
set search_path=pg_catalog as $fn$
declare
 v_merchant integer;
 v_brand integer;
 v_platform integer;
 v_uses integer;
 v_packages integer;
begin
 if p_discount is null or p_discount<1 or p_discount>10000 or
 p_count is null or p_count<1 or p_count>12 or
 p_merchant_bps is null or p_merchant_bps not between 100 and 10000 or
 p_brand_bps is null or p_brand_bps not between 0 and 10000-p_merchant_bps or
 p_merchant_budget is null or p_merchant_budget not between 500 and 1000000 or
 p_brand_budget is null or p_brand_budget not between 0 and 1000000 or
 p_platform_budget is null or p_platform_budget not between 0 and 1000000 then
  raise exception 'CLUBE_CAPACITY_INVALID' using errcode='22023';
 end if;
 -- The merchant's hypothetical cost is rounded UP, so a budget is never overstated.
 v_merchant:=ceil(p_discount::numeric*p_merchant_bps/10000)::integer;
 v_brand:=floor(p_discount::numeric*p_brand_bps/10000)::integer;
 v_platform:=p_discount-v_merchant-v_brand;
 if v_platform<0 then raise exception 'CLUBE_CAPACITY_SPLIT_INVALID';end if;
 v_uses:=least(
   floor(p_merchant_budget::numeric/v_merchant)::integer,
   case when v_brand>0 then floor(p_brand_budget::numeric/v_brand)::integer else 1000000 end,
   case when v_platform>0 then floor(p_platform_budget::numeric/v_platform)::integer else 1000000 end
 );
 v_packages:=floor(v_uses::numeric/p_count)::integer;
 return jsonb_build_object(
  'merchantPerUseCents',v_merchant,'brandPerUseCents',v_brand,
  'platformPerUseCents',v_platform,
  'maxUsesIllustrative',v_uses,'maxPackagesIllustrative',v_packages,
  'oneFullPackageWithinSuggestedBudgets',v_packages>=1,
  'fundingVerified',false,'financiallyReady',false,'merchantBudgetContracted',false
 );
end;$fn$;
revoke all on function clube_internal_v1_242.term_capacity(integer,integer,integer,integer,integer,integer,integer)
 from public,anon,authenticated,service_role;
grant execute on function clube_internal_v1_242.term_capacity(integer,integer,integer,integer,integer,integer,integer)
 to service_role;

create or replace function clube_internal_v1_242.save_terms(
 p_actor uuid,p_merchant uuid,p_package text,p_status text,
 p_brand_bps integer,p_brand_budget integer,p_platform_budget integer,
 p_identity text,p_agreement text,p_funding text,p_notes text,
 p_expected_version integer,p_expected_interest_version integer,
 p_expected_review_version integer,p_request uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_interest public.merchant_clube_interest_v1_240%rowtype;
 v_review public.clube_campaign_reviews_v1_241%rowtype;
 v_pack public.clube_package_drafts_v1_239%rowtype;
 v_old public.clube_terms_drafts_v1_242%rowtype;
 v_event public.clube_terms_events_v1_242%rowtype;
 v_capacity jsonb;
 v_signature jsonb;
 v_version integer:=0;
 v_replayed boolean:=false;
 v_changed boolean:=false;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'CLUBE_TERMS_FINANCE_DENIED' using errcode='42501';end if;
 if p_merchant is null or p_package not in ('gas_3x5','water_5x2') or p_package is null
 or p_status not in ('draft','shared_for_discussion','withdrawn') or p_status is null
 or p_brand_bps is null or p_brand_bps not between 0 and 10000
 or p_brand_budget is null or p_brand_budget not between 0 and 1000000
 or p_platform_budget is null or p_platform_budget not between 0 and 1000000
 or p_identity not in ('not_requested','requested','supplied_unverified')
 or p_agreement not in ('not_requested','requested','supplied_unverified')
 or p_funding not in ('not_requested','requested','supplied_unverified')
 or p_notes is null or char_length(btrim(p_notes)) not between 12 and 500
 or p_expected_version is null or p_expected_version not between 0 and 2147483645
 or p_expected_interest_version is null or p_expected_interest_version<1
 or p_expected_review_version is null or p_expected_review_version<1 or p_request is null
 then raise exception 'CLUBE_TERMS_INVALID' using errcode='22023'; end if;
 v_signature:=jsonb_build_object('merchant',p_merchant,'package',p_package,'status',p_status,
  'brandBps',p_brand_bps,'brandBudget',p_brand_budget,'platformBudget',p_platform_budget,
  'identityDoc',p_identity,'agreementDoc',p_agreement,'fundingDoc',p_funding,
  'notes',btrim(p_notes),'expectedVersion',p_expected_version,
  'interestVersion',p_expected_interest_version,'reviewVersion',p_expected_review_version);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'clube-interest-v1-240:'||p_merchant::text||':'||p_package,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'clube-review-v1-241:'||p_merchant::text||':'||p_package,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'clube-terms-v1-242:'||p_merchant::text||':'||p_package,0));
 select * into v_event from public.clube_terms_events_v1_242 where request_id=p_request;
 if found then
  if v_event.actor_id is distinct from p_actor or v_event.action<>'save_terms'
   or v_event.request_signature is distinct from v_signature
  then raise exception 'CLUBE_TERMS_IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
  v_replayed:=true;
 end if;
 select * into v_old from public.clube_terms_drafts_v1_242 t
   where merchant_id=p_merchant and package_key=p_package;
 if found then v_version:=v_old.version;end if;
 if not v_replayed then
  if v_version<>p_expected_version then
   raise exception 'CLUBE_TERMS_STALE_VERSION' using errcode='40001';end if;
  select * into v_interest from public.merchant_clube_interest_v1_240 i
   where i.merchant_id=p_merchant and i.package_key=p_package for share;
  if not found or not v_interest.interested or
    v_interest.version<>p_expected_interest_version then
   raise exception 'CLUBE_TERMS_INTEREST_STALE' using errcode='42501';end if;
  select * into v_review from public.clube_campaign_reviews_v1_241 r
   where r.merchant_id=p_merchant and r.package_key=p_package for share;
  if not found or v_review.version<>p_expected_review_version
    or v_review.interest_version<>v_interest.version
    or v_review.status not in ('under_review','request_documents','economic_prechecked')
  then raise exception 'CLUBE_TERMS_REVIEW_STALE' using errcode='42501';end if;
  if v_review.city_snapshot<>v_interest.city_snapshot or
   v_review.state_snapshot<>v_interest.state_snapshot or
   v_review.merchant_share_bps<>v_interest.merchant_share_bps or
   v_review.proposed_budget_cents<>v_interest.proposed_budget_cents
  then raise exception 'CLUBE_TERMS_CITY_OR_BUDGET_CHANGED' using errcode='42501';end if;
  select * into v_pack from public.clube_package_drafts_v1_239
   where package_key=p_package;
  if not found or v_pack.sales_enabled or v_pack.redemption_enabled then
   raise exception 'CLUBE_TERMS_PACKAGE_DISABLED' using errcode='42501';end if;
  if p_brand_bps>10000-v_interest.merchant_share_bps then
   raise exception 'CLUBE_TERMS_INVALID_SPLIT' using errcode='22023';end if;
  v_capacity:=clube_internal_v1_242.term_capacity(
   v_pack.discount_per_coupon_cents,v_pack.coupon_count,
   v_interest.merchant_share_bps,p_brand_bps,
   v_interest.proposed_budget_cents,p_brand_budget,p_platform_budget);
  -- Sharing zero-capacity terms would be deceptive; keep those as internal draft.
  if p_status='shared_for_discussion' and
    (v_capacity->>'maxPackagesIllustrative')::integer<1 then
   raise exception 'CLUBE_TERMS_NO_COMPLETE_PACKAGE' using errcode='22023';end if;
  if v_version=0 or v_old.terms_status is distinct from p_status or
     v_old.brand_share_bps is distinct from p_brand_bps or
     v_old.brand_budget_cents is distinct from p_brand_budget or
     v_old.platform_budget_cents is distinct from p_platform_budget or
     v_old.identity_document_status is distinct from p_identity or
     v_old.agreement_document_status is distinct from p_agreement or
     v_old.funding_document_status is distinct from p_funding or
     v_old.notes is distinct from btrim(p_notes) or
     v_old.interest_version<>v_interest.version or
     v_old.review_version<>v_review.version then
   insert into public.clube_terms_drafts_v1_242(
    merchant_id,package_key,interest_version,review_version,terms_status,
    brand_share_bps,brand_budget_cents,platform_budget_cents,
    identity_document_status,agreement_document_status,funding_document_status,
    notes,version,updated_by,updated_at
   ) values(p_merchant,p_package,v_interest.version,v_review.version,p_status,
    p_brand_bps,p_brand_budget,p_platform_budget,p_identity,p_agreement,p_funding,
    btrim(p_notes),v_version+1,p_actor,clock_timestamp())
   on conflict(merchant_id,package_key) do update set
    interest_version=excluded.interest_version,
    review_version=excluded.review_version,terms_status=excluded.terms_status,
    brand_share_bps=excluded.brand_share_bps,
    brand_budget_cents=excluded.brand_budget_cents,
    platform_budget_cents=excluded.platform_budget_cents,
    identity_document_status=excluded.identity_document_status,
    agreement_document_status=excluded.agreement_document_status,
    funding_document_status=excluded.funding_document_status,
    notes=excluded.notes,version=excluded.version,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at,
    merchant_response='none',merchant_response_version=0,
    merchant_responded_by=null,merchant_responded_at=null;
   v_changed:=true;
  end if;
  insert into public.clube_terms_events_v1_242(
   request_id,merchant_id,package_key,actor_id,action,request_signature,
   previous_version,resulting_version
  )values(p_request,p_merchant,p_package,p_actor,'save_terms',v_signature,
   v_version,v_version+case when v_changed then 1 else 0 end);
 end if;
 return jsonb_build_object('source','admin_clube_terms_save_v1_242',
  'recorded',true,'changed',v_changed,'replayed',v_replayed,
  'noContract',true,'noCharge',true,'fundingVerified',false,
  'couponSalesEnabled',false,'budgetReservedCents',0);
end;$fn$;
revoke all on function clube_internal_v1_242.save_terms(
 uuid,uuid,text,text,integer,integer,integer,text,text,text,text,integer,integer,integer,uuid
) from public,anon,authenticated,service_role;
grant execute on function clube_internal_v1_242.save_terms(
 uuid,uuid,text,text,integer,integer,integer,text,text,text,text,integer,integer,integer,uuid
) to service_role;
create or replace function public.admin_clube_terms_save_v1_242(
 p_actor uuid,p_merchant uuid,p_package text,p_status text,
 p_brand_bps integer,p_brand_budget integer,p_platform_budget integer,
 p_identity text,p_agreement text,p_funding text,p_notes text,
 p_expected_version integer,p_expected_interest_version integer,
 p_expected_review_version integer,p_request uuid
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrapper$
 select clube_internal_v1_242.save_terms($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
$wrapper$;
revoke all on function public.admin_clube_terms_save_v1_242(
 uuid,uuid,text,text,integer,integer,integer,text,text,text,text,integer,integer,integer,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.admin_clube_terms_save_v1_242(
 uuid,uuid,text,text,integer,integer,integer,text,text,text,text,integer,integer,integer,uuid
) to service_role;

create or replace function public.admin_clube_terms_queue_v1_242(p_actor uuid)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog as $fn$
declare v_rows jsonb;v_total bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','operations','compliance','finance','readonly'))
 then raise exception 'CLUBE_TERMS_ADMIN_DENIED' using errcode='42501';end if;
 select count(*) into v_total from public.clube_campaign_reviews_v1_241;
 select coalesce(jsonb_agg(
   jsonb_build_object(
    'merchantId',x.merchant_id,'companyName',x.name,'packageKey',x.package_key,
    'city',x.city,'state',x.state,'merchantShareBps',x.merchant_bps,
    'merchantBudgetCents',x.merchant_budget,
    'interestVersion',x.interest_version,'reviewVersion',x.review_version,
    'termsVersion',coalesce(x.terms_version,0),'termsStatus',x.terms_status,
    'brandShareBps',coalesce(x.brand_bps,0),
    'brandBudgetCents',coalesce(x.brand_budget,0),
    'platformBudgetCents',coalesce(x.platform_budget,0),
    'identityDocumentStatus',coalesce(x.doc_identity,'not_requested'),
    'agreementDocumentStatus',coalesce(x.doc_agreement,'not_requested'),
    'fundingDocumentStatus',coalesce(x.doc_funding,'not_requested'),
    'notes',x.notes,'merchantResponse',coalesce(x.merchant_response,'none'),
    'merchantResponseVersion',coalesce(x.merchant_response_version,0),
    'currentInterest',x.current_interest,'currentReview',x.current_review,
    'currentTerms',x.current_terms,'capacity',x.capacity
   ) order by x.updated_at desc,x.merchant_id,x.package_key
  ),'[]'::jsonb) into v_rows
 from (
  select r.merchant_id,left(m.name,120) name,r.package_key,
   i.city_snapshot city,i.state_snapshot state,
   i.merchant_share_bps merchant_bps,i.proposed_budget_cents merchant_budget,
   i.version interest_version,r.version review_version,
   t.version terms_version,t.terms_status,t.brand_share_bps brand_bps,
   t.brand_budget_cents brand_budget,t.platform_budget_cents platform_budget,
   t.identity_document_status doc_identity,t.agreement_document_status doc_agreement,
   t.funding_document_status doc_funding,t.notes,t.merchant_response,
   t.merchant_response_version,
   i.interested current_interest,
   (r.interest_version=i.version and r.status<>'declined'
     and r.city_snapshot=i.city_snapshot and r.state_snapshot=i.state_snapshot
     and r.merchant_share_bps=i.merchant_share_bps
     and r.proposed_budget_cents=i.proposed_budget_cents) current_review,
   coalesce(t.interest_version=i.version and t.review_version=r.version
      and i.interested and r.status<>'declined',false) current_terms,
   case when i.interested then
    clube_internal_v1_242.term_capacity(p.discount_per_coupon_cents,
      p.coupon_count,i.merchant_share_bps,coalesce(t.brand_share_bps,0),
      i.proposed_budget_cents,coalesce(t.brand_budget_cents,0),
      coalesce(t.platform_budget_cents,0))
   else null end capacity,
   coalesce(t.updated_at,r.reviewed_at) updated_at
  from public.clube_campaign_reviews_v1_241 r
  join public.merchant_clube_interest_v1_240 i
    on i.merchant_id=r.merchant_id and i.package_key=r.package_key
  join public.merchants m on m.id=r.merchant_id
  join public.clube_package_drafts_v1_239 p on p.package_key=r.package_key
  left join public.clube_terms_drafts_v1_242 t
    on t.merchant_id=r.merchant_id and t.package_key=r.package_key
  order by coalesce(t.updated_at,r.reviewed_at) desc,r.merchant_id,r.package_key limit 50
 )x;
 return jsonb_build_object('source','admin_clube_terms_queue_v1_242',
  'totalReviews',v_total,'rows',v_rows,'readOnly',true,
  'noContractsSigned',true,'fundingVerifiedCents',0,
  'couponSalesEnabled',false,'noCharge',true,'moneyReservedCents',0);
end;$fn$;
revoke all on function public.admin_clube_terms_queue_v1_242(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_clube_terms_queue_v1_242(uuid)
 to service_role;

create or replace function clube_internal_v1_242.merchant_terms(
 p_actor uuid,p_merchant uuid,p_package text,p_action text,p_version integer,p_request uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_term public.clube_terms_drafts_v1_242%rowtype;
 v_interest public.merchant_clube_interest_v1_240%rowtype;
 v_review public.clube_campaign_reviews_v1_241%rowtype;
 v_pack public.clube_package_drafts_v1_239%rowtype;
 v_role text;
 v_event public.clube_terms_events_v1_242%rowtype;
 v_signature jsonb;
 v_replayed boolean:=false;
 v_changed boolean:=false;
 v_current boolean:=false;
 v_capacity jsonb;
begin
 select mm.member_role into v_role from public.merchant_members mm
 where mm.user_id=p_actor and mm.merchant_id=p_merchant and mm.active;
 if v_role is null or v_role not in ('owner','manager') then
  raise exception 'CLUBE_TERMS_MERCHANT_DENIED' using errcode='42501';end if;
 if p_package not in ('gas_3x5','water_5x2') or
 p_action not in ('view','read_for_discussion','not_interested') then
  raise exception 'CLUBE_TERMS_MERCHANT_ACTION_INVALID' using errcode='22023';end if;
 if p_action<>'view' and
  (v_role<>'owner' or p_request is null or p_version is null or p_version<1)
 then raise exception 'CLUBE_TERMS_OWNER_REQUIRED' using errcode='42501';end if;
 if p_action<>'view' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'clube-interest-v1-240:'||p_merchant::text||':'||p_package,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'clube-review-v1-241:'||p_merchant::text||':'||p_package,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'clube-terms-v1-242:'||p_merchant::text||':'||p_package,0));
 end if;
 v_signature:=jsonb_build_object('merchant',p_merchant,'package',p_package,
  'action',p_action,'version',p_version);
 if p_action<>'view' then
  select * into v_event from public.clube_terms_events_v1_242 where request_id=p_request;
  if found then
   if v_event.actor_id is distinct from p_actor
    or v_event.action<>'merchant_reply'
    or v_event.request_signature is distinct from v_signature
   then raise exception 'CLUBE_TERMS_REPLY_IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
   v_replayed:=true;
  end if;
 end if;
 select * into v_term from public.clube_terms_drafts_v1_242 t
 where t.merchant_id=p_merchant and t.package_key=p_package;
 if not found then
  if p_action<>'view' then raise exception 'CLUBE_TERMS_NOT_FOUND' using errcode='40001';end if;
  return jsonb_build_object('source','merchant_clube_terms_v1_242',
   'merchantId',p_merchant,'packageKey',p_package,'terms',null,
   'readOnly',p_action='view','changed',false,'replayed',v_replayed,
   'noContract',true,'noCharge',true,'fundingVerified',false,'couponSalesEnabled',false);
 end if;
 select * into v_interest from public.merchant_clube_interest_v1_240 i
 where i.merchant_id=p_merchant and i.package_key=p_package;
 select * into v_review from public.clube_campaign_reviews_v1_241 r
 where r.merchant_id=p_merchant and r.package_key=p_package;
 v_current:=v_interest.interested and v_interest.version=v_term.interest_version
  and v_review.version=v_term.review_version
  and v_review.interest_version=v_interest.version
  and v_review.status<>'declined' and
  v_review.city_snapshot=v_interest.city_snapshot
  and v_review.state_snapshot=v_interest.state_snapshot
  and v_review.merchant_share_bps=v_interest.merchant_share_bps
  and v_review.proposed_budget_cents=v_interest.proposed_budget_cents;
 if p_action<>'view' and not v_replayed then
  if not v_current or v_term.version<>p_version or v_term.terms_status<>'shared_for_discussion' then
   raise exception 'CLUBE_TERMS_REPLY_STALE' using errcode='40001';end if;
  if v_term.merchant_response<>p_action or v_term.merchant_response_version<>v_term.version then
   update public.clube_terms_drafts_v1_242 t set
    merchant_response=p_action,merchant_response_version=t.version,
    merchant_responded_by=p_actor,merchant_responded_at=clock_timestamp()
   where t.merchant_id=p_merchant and t.package_key=p_package;
   v_changed:=true;
  end if;
  insert into public.clube_terms_events_v1_242(
    request_id,merchant_id,package_key,actor_id,action,request_signature,
    previous_version,resulting_version
  )values(p_request,p_merchant,p_package,p_actor,'merchant_reply',v_signature,
    v_term.version,v_term.version);
 end if;
 select * into v_term from public.clube_terms_drafts_v1_242 t
 where t.merchant_id=p_merchant and t.package_key=p_package;
 select * into v_pack from public.clube_package_drafts_v1_239 p
 where p.package_key=p_package;
 if v_current and v_pack.package_key is not null then
  v_capacity:=clube_internal_v1_242.term_capacity(v_pack.discount_per_coupon_cents,
   v_pack.coupon_count,v_interest.merchant_share_bps,v_term.brand_share_bps,
   v_interest.proposed_budget_cents,v_term.brand_budget_cents,v_term.platform_budget_cents);
 end if;
 return jsonb_build_object('source','merchant_clube_terms_v1_242',
  'merchantId',p_merchant,'packageKey',p_package,'readOnly',p_action='view',
  'changed',v_changed,'replayed',v_replayed,
  'terms',jsonb_build_object('version',v_term.version,'status',v_term.terms_status,
    'current',v_current,'merchantShareBps',v_interest.merchant_share_bps,
    'merchantProposedBudgetCents',v_interest.proposed_budget_cents,
    'brandShareBps',v_term.brand_share_bps,
    'brandBudgetCents',v_term.brand_budget_cents,
    'platformBudgetCents',v_term.platform_budget_cents,
    'identityDocumentStatus',v_term.identity_document_status,
    'agreementDocumentStatus',v_term.agreement_document_status,
    'fundingDocumentStatus',v_term.funding_document_status,
    'notes',v_term.notes,'merchantResponse',v_term.merchant_response,
    'merchantResponseVersion',v_term.merchant_response_version,
    'capacity',v_capacity),
  'noContract',true,'noCharge',true,'fundingVerified',false,'couponSalesEnabled',false
 );
end;$fn$;
revoke all on function clube_internal_v1_242.merchant_terms(uuid,uuid,text,text,integer,uuid)
 from public,anon,authenticated,service_role;
grant execute on function clube_internal_v1_242.merchant_terms(uuid,uuid,text,text,integer,uuid)
 to service_role;
create or replace function public.merchant_clube_terms_v1_242(
 p_actor uuid,p_merchant uuid,p_package text,p_action text default 'view',
 p_version integer default null,p_request uuid default null
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrapper$
 select clube_internal_v1_242.merchant_terms($1,$2,$3,$4,$5,$6)
$wrapper$;
revoke all on function public.merchant_clube_terms_v1_242(uuid,uuid,text,text,integer,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.merchant_clube_terms_v1_242(uuid,uuid,text,text,integer,uuid)
 to service_role;

do $acl$ begin
 if has_table_privilege('anon','public.clube_terms_drafts_v1_242','SELECT')
 or has_table_privilege('authenticated','public.clube_terms_drafts_v1_242','INSERT')
 or has_table_privilege('service_role','public.clube_terms_drafts_v1_242','INSERT')
 or has_table_privilege('service_role','public.clube_terms_events_v1_242','INSERT')
 or has_function_privilege('anon','public.admin_clube_terms_save_v1_242(uuid,uuid,text,text,integer,integer,integer,text,text,text,text,integer,integer,integer,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.merchant_clube_terms_v1_242(uuid,uuid,text,text,integer,uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_clube_terms_queue_v1_242(uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.merchant_clube_terms_v1_242(uuid,uuid,text,text,integer,uuid)','EXECUTE')
 then raise exception 'CLUBE_TERMS_ACL_DRIFT' using errcode='42501';end if;
end;$acl$;
