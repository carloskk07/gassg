-- TAMÃO V1.240 — merchant's voluntarily expressed Clube interest, not a funding commitment.
-- No discount entitlement, checkout change, customer coupon, billing or advertising.
create table public.merchant_clube_interest_v1_240 (
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 package_key text not null references public.clube_package_drafts_v1_239(package_key),
 interested boolean not null default false,
 merchant_share_bps integer not null default 0 check(merchant_share_bps between 0 and 10000),
 proposed_budget_cents integer not null default 0 check(proposed_budget_cents between 0 and 1000000),
 city_snapshot text not null check(char_length(city_snapshot) between 2 and 100),
 state_snapshot text not null check(state_snapshot ~ '^[A-Z]{2}$'),
 reviewed_terms_version integer not null default 1 check(reviewed_terms_version=1),
 consented_at timestamptz,
 version integer not null default 1 check(version between 1 and 2147483646),
 updated_by uuid not null references auth.users(id) on delete restrict,
 updated_at timestamptz not null default clock_timestamp(),
 -- Absolutely no financial activation through this API: future version must add a separate ledger.
 funding_verified boolean not null default false check(funding_verified=false),
 sponsor_contract_approved boolean not null default false check(sponsor_contract_approved=false),
 discount_enabled boolean not null default false check(discount_enabled=false),
 primary key(merchant_id,package_key),
 check(not interested or (merchant_share_bps>=100 and proposed_budget_cents>=500 and consented_at is not null)),
 check(interested or (merchant_share_bps=0 and proposed_budget_cents=0 and consented_at is null))
);
create index merchant_clube_interest_active_v1_240
 on public.merchant_clube_interest_v1_240(updated_at desc,merchant_id,package_key)
 where interested;
create table public.merchant_clube_interest_events_v1_240 (
 request_id uuid primary key,
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 package_key text not null,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 operation text not null check(operation in ('register','withdraw')),
 request_signature jsonb not null,
 prior_version integer not null,
 resulting_version integer not null,
 created_at timestamptz not null default clock_timestamp()
);
create index merchant_clube_interest_events_merchant_v1_240
 on public.merchant_clube_interest_events_v1_240(merchant_id,created_at desc);
alter table public.merchant_clube_interest_v1_240 enable row level security;
alter table public.merchant_clube_interest_events_v1_240 enable row level security;
revoke all on public.merchant_clube_interest_v1_240 from public,anon,authenticated,service_role;
revoke all on public.merchant_clube_interest_events_v1_240 from public,anon,authenticated,service_role;
grant select on public.merchant_clube_interest_v1_240 to service_role;
create schema if not exists clube_internal_v1_240;
revoke all on schema clube_internal_v1_240 from public,anon,authenticated;
grant usage on schema clube_internal_v1_240 to service_role;

create or replace function clube_internal_v1_240.merchant_interest(
 p_actor uuid,p_merchant uuid,p_package_key text,p_operation text,
 p_merchant_share_bps integer,p_budget_cents integer,p_consent boolean,
 p_expected_version integer,p_request_id uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_record public.merchant_clube_interest_v1_240%rowtype;
 v_existing boolean;
 v_city text;
 v_state text;
 v_pack public.clube_package_drafts_v1_239%rowtype;
 v_signature jsonb;
 v_replayed boolean:=false;
 v_changed boolean:=false;
 v_old_version integer:=0;
 v_event public.merchant_clube_interest_events_v1_240%rowtype;
begin
 if p_actor is null or p_merchant is null or not exists(
  select 1 from public.merchant_members mm
  where mm.merchant_id=p_merchant and mm.user_id=p_actor
    and mm.active and mm.member_role in ('owner','manager')
 ) then raise exception 'CLUBE_MERCHANT_DENIED' using errcode='42501'; end if;
 if p_operation not in ('view','register','withdraw') or p_operation is null
   or p_package_key not in ('gas_3x5','water_5x2') or p_package_key is null
 then raise exception 'CLUBE_ACTION_INVALID' using errcode='22023'; end if;
 select * into v_pack from public.clube_package_drafts_v1_239
  where package_key=p_package_key;
 if not found or v_pack.sales_enabled or v_pack.redemption_enabled then
  raise exception 'CLUBE_PACKAGE_INACTIVE' using errcode='42501'; end if;
 if p_operation='register' then
  if p_consent is distinct from true
    or p_merchant_share_bps is null or p_merchant_share_bps not between 100 and 10000
    or p_budget_cents is null or p_budget_cents not between 500 and 1000000
    or p_budget_cents < ceil(v_pack.discount_per_coupon_cents::numeric * p_merchant_share_bps/10000)::integer
  then raise exception 'CLUBE_PROPOSAL_INVALID' using errcode='22023'; end if;
 end if;
 if p_operation<>'view' and
   (p_expected_version is null or p_expected_version not between 0 and 2147483645
     or p_request_id is null) then
  raise exception 'CLUBE_EXPECTED_VERSION_REQUIRED' using errcode='22023'; end if;

 v_signature:=jsonb_build_object('operation',p_operation,'packageKey',p_package_key,
  'shareBps',case when p_operation='register' then p_merchant_share_bps else 0 end,
  'budgetCents',case when p_operation='register' then p_budget_cents else 0 end);
 if p_operation<>'view' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'clube-interest-v1-240:'||p_merchant::text||':'||p_package_key,0));
  select * into v_event from public.merchant_clube_interest_events_v1_240
   where request_id=p_request_id;
  if found then
   if v_event.merchant_id is distinct from p_merchant or
      v_event.request_signature is distinct from v_signature then
    raise exception 'CLUBE_IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
   v_replayed:=true;
  end if;
 end if;
 select * into v_record from public.merchant_clube_interest_v1_240
  where merchant_id=p_merchant and package_key=p_package_key;
 v_existing:=found;
 v_old_version:=case when v_existing then v_record.version else 0 end;
 if p_operation<>'view' and not v_replayed then
  if p_expected_version<>v_old_version then
   raise exception 'CLUBE_STALE_VERSION' using errcode='40001'; end if;
  if p_operation='register' then
   select left(btrim(d.city),100),upper(btrim(d.state)) into v_city,v_state
    from public.merchant_business_details d where d.merchant_id=p_merchant;
   if v_city is null or char_length(v_city)<2 or
      v_state is null or v_state !~ '^[A-Z]{2}$'
   then raise exception 'CLUBE_CITY_UNCONFIRMED' using errcode='22023'; end if;
   if not v_existing or not v_record.interested
      or v_record.merchant_share_bps<>p_merchant_share_bps
      or v_record.proposed_budget_cents<>p_budget_cents
      or v_record.city_snapshot<>v_city or v_record.state_snapshot<>v_state then
    insert into public.merchant_clube_interest_v1_240(
     merchant_id,package_key,interested,merchant_share_bps,proposed_budget_cents,
     city_snapshot,state_snapshot,consented_at,updated_by,version,updated_at
    ) values(p_merchant,p_package_key,true,p_merchant_share_bps,p_budget_cents,
      v_city,v_state,clock_timestamp(),p_actor,v_old_version+1,clock_timestamp())
    on conflict(merchant_id,package_key) do update set
     interested=true,merchant_share_bps=excluded.merchant_share_bps,
     proposed_budget_cents=excluded.proposed_budget_cents,
     city_snapshot=excluded.city_snapshot,state_snapshot=excluded.state_snapshot,
     consented_at=excluded.consented_at,updated_by=excluded.updated_by,
     version=excluded.version,updated_at=excluded.updated_at;
    v_changed:=true;
   end if;
  elsif p_operation='withdraw' and v_existing and v_record.interested then
   update public.merchant_clube_interest_v1_240 set interested=false,
     merchant_share_bps=0,proposed_budget_cents=0,consented_at=null,
     updated_by=p_actor,version=version+1,updated_at=clock_timestamp()
    where merchant_id=p_merchant and package_key=p_package_key;
   v_changed:=true;
  end if;
  -- Reserve every request ID, including no-op writes, for exactly-once retries.
  if true then
   insert into public.merchant_clube_interest_events_v1_240(
     request_id,merchant_id,package_key,actor_user_id,operation,
     request_signature,prior_version,resulting_version
   )values(p_request_id,p_merchant,p_package_key,p_actor,p_operation,
    v_signature,v_old_version,v_old_version+case when v_changed then 1 else 0 end);
  end if;
 end if;
 select * into v_record from public.merchant_clube_interest_v1_240
  where merchant_id=p_merchant and package_key=p_package_key;
 v_existing:=found;
 return jsonb_build_object(
  'source','merchant_clube_interest_v1_240','merchantId',p_merchant,
  'packageKey',p_package_key,'category',v_pack.category,
  'interested',case when v_existing then v_record.interested else false end,
  'merchantShareBps',case when v_existing and v_record.interested then v_record.merchant_share_bps else 0 end,
  'proposedBudgetCents',case when v_existing and v_record.interested then v_record.proposed_budget_cents else 0 end,
  'city',case when v_existing then v_record.city_snapshot else null end,
  'state',case when v_existing then v_record.state_snapshot else null end,
  'version',case when v_existing then v_record.version else 0 end,
  'updatedAt',case when v_existing then v_record.updated_at else null end,
  'changed',v_changed,'replayed',v_replayed,
  'readOnly',p_operation='view','noCharge',true,'noContract',true,
  'fundingVerified',false,'discountEnabled',false,'couponSalesEnabled',false,
  'noFinancialObligation',true
 );
end;
$fn$;
revoke all on function clube_internal_v1_240.merchant_interest(
 uuid,uuid,text,text,integer,integer,boolean,integer,uuid
) from public,anon,authenticated,service_role;
grant execute on function clube_internal_v1_240.merchant_interest(
 uuid,uuid,text,text,integer,integer,boolean,integer,uuid
) to service_role;

create or replace function public.merchant_clube_interest_v1_240(
 p_actor uuid,p_merchant uuid,p_package_key text,p_operation text,
 p_merchant_share_bps integer default null,p_budget_cents integer default null,
 p_consent boolean default false,p_expected_version integer default null,
 p_request_id uuid default null
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrapper$
 select clube_internal_v1_240.merchant_interest($1,$2,$3,$4,$5,$6,$7,$8,$9)
$wrapper$;
revoke all on function public.merchant_clube_interest_v1_240(
 uuid,uuid,text,text,integer,integer,boolean,integer,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.merchant_clube_interest_v1_240(
 uuid,uuid,text,text,integer,integer,boolean,integer,uuid
) to service_role;

create or replace function public.admin_clube_interest_queue_v1_240(p_actor uuid)
 returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog as $fn$
declare v_count bigint;v_rows jsonb;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','operations','compliance','finance','readonly'))
 then raise exception 'CLUBE_ADMIN_DENIED' using errcode='42501';end if;
 select count(*) into v_count from public.merchant_clube_interest_v1_240 where interested;
 select coalesce(jsonb_agg(jsonb_build_object(
  'merchantId',x.merchant_id,'companyName',x.company_name,
  'packageKey',x.package_key,'category',x.category,'city',x.city_snapshot,
  'state',x.state_snapshot,'shareBps',x.merchant_share_bps,
  'budgetCents',x.proposed_budget_cents,'updatedAt',x.updated_at,
  'fundingVerified',false,'contractApproved',false
 ) order by x.updated_at desc,x.merchant_id),'[]'::jsonb)
 into v_rows from (
  select i.merchant_id,left(m.name,120) company_name,i.package_key,p.category,
   i.city_snapshot,i.state_snapshot,i.merchant_share_bps,
   i.proposed_budget_cents,i.updated_at
  from public.merchant_clube_interest_v1_240 i
  join public.merchants m on m.id=i.merchant_id
  join public.clube_package_drafts_v1_239 p on p.package_key=i.package_key
  where i.interested order by i.updated_at desc,i.merchant_id desc limit 50
 )x;
 return jsonb_build_object('source','admin_clube_interest_queue_v1_240',
  'totalProposals',v_count,'rows',v_rows,'readOnly',true,
  'noContactsExposed',true,'sponsorFundingConfirmedCents',0,
  'couponSalesEnabled',false,'noCharge',true,'noContractsApproved',true);
end;
$fn$;
revoke all on function public.admin_clube_interest_queue_v1_240(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_clube_interest_queue_v1_240(uuid)
 to service_role;
do $acl$begin
 if has_table_privilege('anon','public.merchant_clube_interest_v1_240','SELECT')
 or has_table_privilege('authenticated','public.merchant_clube_interest_v1_240','INSERT')
 or has_table_privilege('service_role','public.merchant_clube_interest_v1_240','INSERT')
 or has_table_privilege('service_role','public.merchant_clube_interest_events_v1_240','INSERT')
 or has_function_privilege('anon','public.merchant_clube_interest_v1_240(uuid,uuid,text,text,integer,integer,boolean,integer,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.merchant_clube_interest_v1_240(uuid,uuid,text,text,integer,integer,boolean,integer,uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.merchant_clube_interest_v1_240(uuid,uuid,text,text,integer,integer,boolean,integer,uuid)','EXECUTE')
 then raise exception 'CLUBE_INTEREST_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
