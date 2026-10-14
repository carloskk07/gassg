-- TAMÃO V1.247: exclusive allocation of planned founder monthly budgets.
-- NOT verified cash or spendable money. Active customer rewards untouched.
create table public.platform_owner_budget_allocations_v1_247(
 allocation_id uuid primary key,
 benefit_key text not null references public.platform_incentive_funding_plan_v1_244(benefit_key),
 month_key date not null check (extract(day from month_key)=1),
 campaign_reference text not null check (
  char_length(campaign_reference) between 8 and 80 and
  campaign_reference ~ '^[a-z0-9_-]+$'),
 campaign_label text not null check(char_length(campaign_label) between 12 and 180),
 amount_cents bigint not null check(amount_cents between 100 and 50000000),
 plan_version integer not null check(plan_version>=1),
 status text not null default 'allocated' check(status in ('allocated','released')),
 version integer not null default 1 check(version in (1,2)),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 released_by uuid references auth.users(id),
 released_at timestamptz,
 check((status='allocated' and released_by is null and released_at is null)
   or (status='released' and released_by is not null and released_at is not null)),
 spendable boolean not null default false check(spendable=false),
 funds_verified boolean not null default false check(funds_verified=false),
 coupons_enabled boolean not null default false check(coupons_enabled=false)
);
create unique index owner_budget_allocation_campaign_unique_v1_247
 on public.platform_owner_budget_allocations_v1_247(benefit_key,month_key,campaign_reference);
create index owner_budget_allocation_month_active_v1_247
 on public.platform_owner_budget_allocations_v1_247(benefit_key,month_key,status);
create table public.platform_owner_budget_allocation_events_v1_247(
 request_id uuid primary key,
 allocation_id uuid not null references public.platform_owner_budget_allocations_v1_247(allocation_id),
 actor_id uuid not null references auth.users(id),
 event_type text not null check(event_type in ('allocate','release')),
 request_signature jsonb not null,
 from_version integer not null,
 to_version integer not null,
 created_at timestamptz not null default clock_timestamp()
);
create index owner_budget_allocation_events_lookup_v1_247
 on public.platform_owner_budget_allocation_events_v1_247(allocation_id,created_at desc);
alter table public.platform_owner_budget_allocations_v1_247 enable row level security;
alter table public.platform_owner_budget_allocation_events_v1_247 enable row level security;
revoke all on public.platform_owner_budget_allocations_v1_247 from public,anon,authenticated,service_role;
revoke all on public.platform_owner_budget_allocation_events_v1_247 from public,anon,authenticated,service_role;
create schema if not exists platform_funding_private_v1_247;
revoke all on schema platform_funding_private_v1_247 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_247 to service_role;

-- One canonical plan lock for BOTH V1.244 plan edits and V1.247 allocations.
-- Trigger stops a later budget cut from invalidating existing allocations.
create or replace function platform_funding_private_v1_247.protect_plan()
returns trigger language plpgsql security definer
set search_path=pg_catalog as $fn$
declare v_max bigint;
begin
 select coalesce(max(x.allocated),0) into v_max from (
  select sum(a.amount_cents)::bigint allocated
  from public.platform_owner_budget_allocations_v1_247 a
  where a.benefit_key=new.benefit_key and a.status='allocated'
  group by a.month_key
 )x;
 if v_max>new.planned_budget_cents or
  (v_max>0 and new.status<>'internally_committed') then
  raise exception 'OWNER_BUDGET_PLAN_HAS_ALLOCATIONS' using errcode='23514';
 end if;
 return new;
end;$fn$;
revoke all on function platform_funding_private_v1_247.protect_plan() from public,anon,authenticated,service_role;
create trigger owner_budget_protect_plan_v1_247 before update of planned_budget_cents,status
 on public.platform_incentive_funding_plan_v1_244
 for each row execute function platform_funding_private_v1_247.protect_plan();

create or replace function platform_funding_private_v1_247.allocate(
 p_actor uuid,p_allocation uuid,p_benefit text,p_month date,
 p_reference text,p_label text,p_amount bigint,p_plan_version integer,p_request uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_plan public.platform_incentive_funding_plan_v1_244%rowtype;
 v_event public.platform_owner_budget_allocation_events_v1_247%rowtype;
 v_signature jsonb;
 v_total bigint;
 v_replayed boolean:=false;
 v_now_month date;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role='superadmin') then
  raise exception 'OWNER_BUDGET_SUPERADMIN_REQUIRED' using errcode='42501';end if;
 v_now_month:=date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date;
 if p_request is null or p_allocation is null or p_benefit is null or
  p_benefit not in ('customer_cashback','customer_referral','merchant_referral','clube_coupons')
  or p_month is null or extract(day from p_month)<>1 or
  p_month<v_now_month or p_month>(v_now_month+interval '2 months')::date
  or p_reference is null or length(btrim(p_reference)) not between 8 and 80
  or btrim(p_reference) !~ '^[a-z0-9_-]+$'
  or p_label is null or length(btrim(p_label)) not between 12 and 180
  or p_amount is null or p_amount not between 100 and 50000000
  or p_plan_version is null or p_plan_version<1
 then raise exception 'OWNER_BUDGET_ALLOCATION_INVALID' using errcode='22023';end if;
 v_signature:=jsonb_build_object(
  'operation','allocate','allocation',p_allocation,'benefit',p_benefit,
  'month',p_month,'reference',btrim(p_reference),'label',btrim(p_label),
  'amount',p_amount,'planVersion',p_plan_version);
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('founder-funding-v1-244:'||p_benefit,0));
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('owner-budget-v1-247:'||p_benefit||':'||p_month::text,0));
 select * into v_event from public.platform_owner_budget_allocation_events_v1_247
  where request_id=p_request;
 if found then
  if v_event.event_type<>'allocate' or v_event.actor_id<>p_actor
   or v_event.allocation_id<>p_allocation
   or v_event.request_signature is distinct from v_signature
  then raise exception 'OWNER_BUDGET_IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
  v_replayed:=true;
 end if;
 if not v_replayed then
  select * into v_plan from public.platform_incentive_funding_plan_v1_244
   where benefit_key=p_benefit for share;
  if not found or v_plan.status<>'internally_committed' or
    v_plan.version<>p_plan_version then
    raise exception 'OWNER_BUDGET_PLAN_STALE' using errcode='40001';end if;
  select coalesce(sum(a.amount_cents),0) into v_total
   from public.platform_owner_budget_allocations_v1_247 a
   where a.benefit_key=p_benefit and a.month_key=p_month and a.status='allocated';
  if p_amount>v_plan.planned_budget_cents-v_total then
   raise exception 'OWNER_BUDGET_EXCEEDED' using errcode='23514';end if;
  insert into public.platform_owner_budget_allocations_v1_247(
   allocation_id,benefit_key,month_key,campaign_reference,campaign_label,
   amount_cents,plan_version,created_by
  )values(p_allocation,p_benefit,p_month,btrim(p_reference),btrim(p_label),
   p_amount,p_plan_version,p_actor);
  insert into public.platform_owner_budget_allocation_events_v1_247(
   request_id,allocation_id,actor_id,event_type,request_signature,from_version,to_version
  )values(p_request,p_allocation,p_actor,'allocate',v_signature,0,1);
 end if;
 return jsonb_build_object('source','admin_owner_budget_allocate_v1_247',
  'recorded',true,'replayed',v_replayed,
  'plannedOnly',true,'noCharge',true,'fundsVerified',false,
  'spendableCents',0,'newBenefitsEnabled',false);
end;$fn$;

create or replace function platform_funding_private_v1_247.release(
 p_actor uuid,p_allocation uuid,p_version integer,p_reason text,p_request uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_prev public.platform_owner_budget_allocations_v1_247%rowtype;
 v_event public.platform_owner_budget_allocation_events_v1_247%rowtype;
 v_sig jsonb;
 v_replayed boolean:=false;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'OWNER_BUDGET_RELEASE_DENIED' using errcode='42501';end if;
 if p_allocation is null or p_request is null or p_version is null or p_version<>1
  or p_reason is null or length(btrim(p_reason)) not between 12 and 240
 then raise exception 'OWNER_BUDGET_RELEASE_INVALID' using errcode='22023';end if;
 -- Allocation identity is immutable, allowing stable lock ordering.
 select * into v_prev from public.platform_owner_budget_allocations_v1_247
  where allocation_id=p_allocation;
 if not found then raise exception 'OWNER_BUDGET_ALLOCATION_NOT_FOUND' using errcode='22023';end if;
 v_sig:=jsonb_build_object('operation','release','allocation',p_allocation,
  'version',p_version,'reason',btrim(p_reason));
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('founder-funding-v1-244:'||v_prev.benefit_key,0));
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('owner-budget-v1-247:'||v_prev.benefit_key||':'||v_prev.month_key::text,0));
 select * into v_event from public.platform_owner_budget_allocation_events_v1_247
  where request_id=p_request;
 if found then
  if v_event.actor_id<>p_actor or v_event.event_type<>'release' or
     v_event.allocation_id<>p_allocation or
     v_event.request_signature is distinct from v_sig then
   raise exception 'OWNER_BUDGET_RELEASE_REPLAY_CONFLICT' using errcode='23505';end if;
  v_replayed:=true;
 end if;
 if not v_replayed then
  select * into v_prev from public.platform_owner_budget_allocations_v1_247
   where allocation_id=p_allocation for update;
  if not found or v_prev.status<>'allocated' or v_prev.version<>p_version
  then raise exception 'OWNER_BUDGET_RELEASE_STALE' using errcode='40001';end if;
  update public.platform_owner_budget_allocations_v1_247 set
   status='released',version=version+1,released_by=p_actor,
   released_at=clock_timestamp()
  where allocation_id=p_allocation;
  insert into public.platform_owner_budget_allocation_events_v1_247(
   request_id,allocation_id,actor_id,event_type,request_signature,from_version,to_version
  )values(p_request,p_allocation,p_actor,'release',v_sig,p_version,p_version+1);
 end if;
 return jsonb_build_object('source','admin_owner_budget_release_v1_247',
  'recorded',true,'replayed',v_replayed,'plannedOnly',true,'noCharge',true,
  'fundsVerified',false,'spendableCents',0,'newBenefitsEnabled',false);
end;$fn$;

create or replace function platform_funding_private_v1_247.queue(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_rows jsonb;v_allocations jsonb;v_count bigint;v_month date;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'OWNER_BUDGET_QUEUE_DENIED' using errcode='42501';end if;
 v_month:=date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date;
 select coalesce(jsonb_agg(jsonb_build_object(
  'benefitKey',r.benefit_key,'month',r.month_key,
  'planVersion',r.version,'planStatus',r.status,
  'plannedCents',r.budget,'allocatedCents',r.allocated,
  'unallocatedCents',greatest(0,r.budget-r.allocated),
  'coverageExceeded',r.allocated>r.budget
 ) order by r.benefit_key,r.month_key),'[]'::jsonb) into v_rows
 from (
  select k.benefit_key,(v_month+make_interval(months=>n.month_step))::date month_key,
   coalesce(p.version,0) version,coalesce(p.status,'planning') status,
   coalesce(p.planned_budget_cents,0)::bigint budget,
   coalesce(sum(a.amount_cents),0)::bigint allocated
  from (values('customer_cashback'::text),('customer_referral'::text),
    ('merchant_referral'::text),('clube_coupons'::text))k(benefit_key)
  cross join (values(0),(1),(2))n(month_step)
  left join public.platform_incentive_funding_plan_v1_244 p on p.benefit_key=k.benefit_key
  left join public.platform_owner_budget_allocations_v1_247 a
   on a.benefit_key=k.benefit_key
   and a.month_key=(v_month+make_interval(months=>n.month_step))::date
   and a.status='allocated'
  group by k.benefit_key,n.month_step,p.version,p.status,p.planned_budget_cents
 )r;
 select count(*) into v_count from public.platform_owner_budget_allocations_v1_247;
 select coalesce(jsonb_agg(jsonb_build_object(
  'allocationId',a.allocation_id,'benefitKey',a.benefit_key,
  'month',a.month_key,'campaignReference',a.campaign_reference,
  'campaignLabel',a.campaign_label,
  'amountCents',a.amount_cents,'status',a.status,
  'version',a.version,'planVersion',a.plan_version,
  'createdBy',a.created_by,'createdAt',a.created_at,
  'releasedAt',a.released_at
 ) order by a.created_at desc,a.allocation_id),'[]'::jsonb) into v_allocations
 from (select * from public.platform_owner_budget_allocations_v1_247
 order by created_at desc,allocation_id limit 50)a;
 return jsonb_build_object('source','admin_owner_budget_queue_v1_247',
  'rows',v_rows,'allocations',v_allocations,'totalAllocations',v_count,
  'readOnly',true,'plannedOnly',true,
  'verifiedCashCents',0,'spendableCents',0,
  'newBenefitsEnabled',false,'noCharge',true);
end;$fn$;

revoke all on function platform_funding_private_v1_247.allocate(uuid,uuid,text,date,text,text,bigint,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_247.release(uuid,uuid,integer,text,uuid) from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_247.queue(uuid) from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_247.allocate(uuid,uuid,text,date,text,text,bigint,integer,uuid) to service_role;
grant execute on function platform_funding_private_v1_247.release(uuid,uuid,integer,text,uuid) to service_role;
grant execute on function platform_funding_private_v1_247.queue(uuid) to service_role;

create or replace function public.admin_owner_budget_allocate_v1_247(
 p_actor uuid,p_allocation uuid,p_benefit text,p_month date,
 p_reference text,p_label text,p_amount bigint,p_plan_version integer,p_request uuid
) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $fn$
 select platform_funding_private_v1_247.allocate($1,$2,$3,$4,$5,$6,$7,$8,$9)
$fn$;
create or replace function public.admin_owner_budget_release_v1_247(
 p_actor uuid,p_allocation uuid,p_version integer,p_reason text,p_request uuid
) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $fn$
 select platform_funding_private_v1_247.release($1,$2,$3,$4,$5)
$fn$;
create or replace function public.admin_owner_budget_queue_v1_247(p_actor uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $fn$
 select platform_funding_private_v1_247.queue($1)
$fn$;
revoke all on function public.admin_owner_budget_allocate_v1_247(uuid,uuid,text,date,text,text,bigint,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_budget_release_v1_247(uuid,uuid,integer,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_budget_queue_v1_247(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_budget_allocate_v1_247(uuid,uuid,text,date,text,text,bigint,integer,uuid) to service_role;
grant execute on function public.admin_owner_budget_release_v1_247(uuid,uuid,integer,text,uuid) to service_role;
grant execute on function public.admin_owner_budget_queue_v1_247(uuid) to service_role;

do $acl$begin
 if has_table_privilege('anon','public.platform_owner_budget_allocations_v1_247','SELECT')
  or has_table_privilege('authenticated','public.platform_owner_budget_allocations_v1_247','INSERT')
  or has_table_privilege('service_role','public.platform_owner_budget_allocations_v1_247','UPDATE')
  or has_table_privilege('service_role','public.platform_owner_budget_allocation_events_v1_247','INSERT')
  or has_function_privilege('anon','public.admin_owner_budget_queue_v1_247(uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.admin_owner_budget_allocate_v1_247(uuid,uuid,text,date,text,text,bigint,integer,uuid)','EXECUTE')
 then raise exception 'OWNER_BUDGET_ACL_DRIFT' using errcode='42501';end if;
end $acl$;