-- TAMÃO V1.255: manually attested marketing spend by founder, separate from incentive budgets.
-- Structured receipt references only; no receipt file upload, bank verification, or transfers.
-- Corrections are immutable void events, never destructive updates.
create table public.platform_campaign_marketing_costs_v1_255(
 expense_id uuid primary key,
 allocation_id uuid not null references public.platform_owner_budget_allocations_v1_247(allocation_id) on delete restrict,
 amount_cents bigint not null check(amount_cents between 100 and 5000000),
 paid_on date not null,
 payment_method text not null check(payment_method in ('pix','bank_transfer','card','cash','other')),
 proof_reference text not null check(char_length(proof_reference) between 12 and 120 and proof_reference ~ '^[A-Za-z0-9 .:/_-]+$'),
 description text not null check(char_length(description) between 12 and 240),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 request_id uuid not null unique
);
create unique index owner_campaign_cost_proof_reference_uq_v1_255
 on public.platform_campaign_marketing_costs_v1_255(lower(proof_reference));
create index owner_campaign_cost_alloc_v1_255
 on public.platform_campaign_marketing_costs_v1_255(allocation_id,recorded_at desc);

create table public.platform_campaign_marketing_cost_voids_v1_255(
 expense_id uuid primary key references public.platform_campaign_marketing_costs_v1_255(expense_id) on delete restrict,
 request_id uuid not null unique,
 reason text not null check(char_length(reason) between 12 and 240),
 voided_by uuid not null references auth.users(id),
 voided_at timestamptz not null default clock_timestamp()
);

alter table public.platform_campaign_marketing_costs_v1_255 enable row level security;
alter table public.platform_campaign_marketing_cost_voids_v1_255 enable row level security;
revoke all on public.platform_campaign_marketing_costs_v1_255 from public,anon,authenticated,service_role;
revoke all on public.platform_campaign_marketing_cost_voids_v1_255 from public,anon,authenticated,service_role;

create schema if not exists platform_funding_private_v1_255;
revoke all on schema platform_funding_private_v1_255 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_255 to service_role;

create or replace function platform_funding_private_v1_255.record_expense(
 p_actor uuid,p_expense uuid,p_allocation uuid,p_amount bigint,p_paid_on date,
 p_method text,p_reference text,p_description text,p_request uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $body$
declare
 v_allocation public.platform_owner_budget_allocations_v1_247%rowtype;
 v_existing public.platform_campaign_marketing_costs_v1_255%rowtype;
 v_today date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
 v_replay boolean:=false;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'CAMPAIGN_COST_ADMIN_DENIED' using errcode='42501';end if;
 if p_request is null or p_expense is null or p_allocation is null
   or p_amount is null or p_amount not between 100 and 5000000
   or p_paid_on is null or p_paid_on>v_today or p_paid_on<v_today-180
   or p_method not in ('pix','bank_transfer','card','cash','other')
   or p_reference is null or char_length(btrim(p_reference)) not between 12 and 120
   or btrim(p_reference) !~ '^[A-Za-z0-9 .:/_-]+$'
   or p_description is null or char_length(btrim(p_description)) not between 12 and 240
 then raise exception 'CAMPAIGN_COST_INVALID' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'campaign-marketing-cost:'||p_allocation::text,0));
 select * into v_existing from public.platform_campaign_marketing_costs_v1_255 c
  where c.request_id=p_request;
 if found then
  if v_existing.expense_id<>p_expense or v_existing.recorded_by<>p_actor
    or v_existing.allocation_id<>p_allocation or v_existing.amount_cents<>p_amount
    or v_existing.paid_on<>p_paid_on or v_existing.payment_method<>p_method
    or v_existing.proof_reference<>btrim(p_reference)
    or v_existing.description<>btrim(p_description)
  then raise exception 'CAMPAIGN_COST_REPLAY_CONFLICT' using errcode='23505';end if;
  v_replay:=true;
 else
  select * into v_allocation from public.platform_owner_budget_allocations_v1_247
    where allocation_id=p_allocation for share;
  if not found or p_paid_on<v_allocation.month_key or
    p_paid_on>=(v_allocation.month_key+interval '1 month')::date or
    p_paid_on<(v_allocation.created_at at time zone 'America/Sao_Paulo')::date or
    (v_allocation.released_at is not null and
      p_paid_on>(v_allocation.released_at at time zone 'America/Sao_Paulo')::date)
  then raise exception 'CAMPAIGN_COST_NOT_ELIGIBLE' using errcode='22023';end if;
  insert into public.platform_campaign_marketing_costs_v1_255(
    expense_id,allocation_id,amount_cents,paid_on,payment_method,
    proof_reference,description,recorded_by,request_id)
  values(p_expense,p_allocation,p_amount,p_paid_on,p_method,btrim(p_reference),
   btrim(p_description),p_actor,p_request);
 end if;
 return jsonb_build_object('source','admin_owner_campaign_cost_record_v1_255',
   'recorded',true,'replayed',v_replay,'status','owner_attested',
   'bankVerified',false,'receiptFileUploaded',false,'cashMoved',false,
   'incentiveBudgetDebited',false,'newBenefitsEnabled',false);
end;$body$;

create or replace function platform_funding_private_v1_255.void_expense(
 p_actor uuid,p_expense uuid,p_reason text,p_request uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $body$
declare
 v_cost public.platform_campaign_marketing_costs_v1_255%rowtype;
 v_void public.platform_campaign_marketing_cost_voids_v1_255%rowtype;
 v_replay boolean:=false;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'CAMPAIGN_COST_VOID_DENIED' using errcode='42501';end if;
 if p_expense is null or p_request is null or p_reason is null
   or char_length(btrim(p_reason)) not between 12 and 240
 then raise exception 'CAMPAIGN_COST_VOID_INVALID' using errcode='22023';end if;
 select * into v_cost from public.platform_campaign_marketing_costs_v1_255
  where expense_id=p_expense;
 if not found then raise exception 'CAMPAIGN_COST_NOT_FOUND' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'campaign-marketing-cost:'||v_cost.allocation_id::text,0));
 select * into v_void from public.platform_campaign_marketing_cost_voids_v1_255
  where request_id=p_request;
 if found then
  if v_void.expense_id<>p_expense or v_void.voided_by<>p_actor
    or v_void.reason<>btrim(p_reason)
  then raise exception 'CAMPAIGN_COST_VOID_REPLAY_CONFLICT' using errcode='23505';end if;
  v_replay:=true;
 else
  if exists(select 1 from public.platform_campaign_marketing_cost_voids_v1_255
    where expense_id=p_expense)
  then raise exception 'CAMPAIGN_COST_ALREADY_VOID' using errcode='23505';end if;
  insert into public.platform_campaign_marketing_cost_voids_v1_255(
    expense_id,request_id,reason,voided_by)
  values(p_expense,p_request,btrim(p_reason),p_actor);
 end if;
 return jsonb_build_object('source','admin_owner_campaign_cost_void_v1_255',
   'recorded',true,'replayed',v_replay,'status','voided',
   'cashMoved',false,'bankVerified',false,
   'incentiveBudgetDebited',false,'newBenefitsEnabled',false);
end;$body$;

create or replace function platform_funding_private_v1_255.read_expenses(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $body$
declare
 v_month date:=coalesce(p_month,date_trunc('month',
   clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_campaigns jsonb;v_expenses jsonb;v_campaign_total bigint;v_expense_total bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'CAMPAIGN_COST_READ_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
   or v_month>(date_trunc('month',
     clock_timestamp() at time zone 'America/Sao_Paulo')+interval '2 months')::date
 then raise exception 'CAMPAIGN_COST_MONTH_INVALID' using errcode='22023';end if;
 select count(*) into v_campaign_total from public.platform_owner_budget_allocations_v1_247
 where month_key=v_month;
 select count(*) into v_expense_total from public.platform_campaign_marketing_costs_v1_255 c
 join public.platform_owner_budget_allocations_v1_247 a on a.allocation_id=c.allocation_id
 where a.month_key=v_month;

 with campaigns as (
  select a.* from public.platform_owner_budget_allocations_v1_247 a
  where a.month_key=v_month order by a.created_at desc,a.allocation_id limit 50
 ), totals as (
  select c.allocation_id,
   count(*)::bigint total_count,
   count(*) filter(where v.expense_id is null)::bigint active_count,
   count(*) filter(where v.expense_id is not null)::bigint void_count,
   coalesce(sum(c.amount_cents) filter(where v.expense_id is null),0)::bigint active_amount
  from public.platform_campaign_marketing_costs_v1_255 c
  left join public.platform_campaign_marketing_cost_voids_v1_255 v
    on v.expense_id=c.expense_id
  where c.allocation_id in(select allocation_id from campaigns)
  group by c.allocation_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'allocationId',a.allocation_id,'campaignTag','tam-'||a.benefit_key||'-'||
     to_char(a.month_key,'YYYYMM')||'-'||a.campaign_reference,
   'campaignLabel',a.campaign_label,'status',a.status,
   'incentivePlannedCents',a.amount_cents,
   'ownerReportedPaidMarketingCents',coalesce(t.active_amount,0),
   'activeExpenses',coalesce(t.active_count,0),
   'voidedExpenses',coalesce(t.void_count,0)
 ) order by a.created_at desc,a.allocation_id),'[]'::jsonb) into v_campaigns
 from campaigns a left join totals t on t.allocation_id=a.allocation_id;

 select coalesce(jsonb_agg(jsonb_build_object(
   'expenseId',c.expense_id,'allocationId',c.allocation_id,
   'amountCents',c.amount_cents,'paidOn',c.paid_on,
   'paymentMethod',c.payment_method,'proofReference',c.proof_reference,
   'description',c.description,'recordedAt',c.recorded_at,
   'status',case when v.expense_id is null then 'owner_attested' else 'voided' end,
   'voidedAt',v.voided_at,'voidReason',v.reason
 ) order by c.recorded_at desc,c.expense_id),'[]'::jsonb)
 into v_expenses from (
  select c.* from public.platform_campaign_marketing_costs_v1_255 c
  join public.platform_owner_budget_allocations_v1_247 a on a.allocation_id=c.allocation_id
  where a.month_key=v_month order by c.recorded_at desc,c.expense_id limit 100
 )c left join public.platform_campaign_marketing_cost_voids_v1_255 v
    on v.expense_id=c.expense_id;
 return jsonb_build_object(
  'source','admin_owner_campaign_cost_read_v1_255',
  'month',v_month,'totalCampaigns',v_campaign_total,
  'campaigns',v_campaigns,'campaignLimit',50,'campaignTruncated',v_campaign_total>50,
  'totalExpenses',v_expense_total,'expenses',v_expenses,
  'expenseLimit',100,'expenseTruncated',v_expense_total>100,
  'evidenceLevel','owner_attested_proof_reference_not_bank_verified',
  'bankVerified',false,'receiptFileUploaded',false,'roiMeasured',false,
  'cashMoved',false,'incentiveBudgetDebited',false,
  'newBenefitsEnabled',false,'readOnly',true
 );
end;$body$;

revoke all on function platform_funding_private_v1_255.record_expense(uuid,uuid,uuid,bigint,date,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_255.void_expense(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_255.read_expenses(uuid,date) from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_255.record_expense(uuid,uuid,uuid,bigint,date,text,text,text,uuid) to service_role;
grant execute on function platform_funding_private_v1_255.void_expense(uuid,uuid,text,uuid) to service_role;
grant execute on function platform_funding_private_v1_255.read_expenses(uuid,date) to service_role;

create or replace function public.admin_owner_campaign_cost_record_v1_255(
 p_actor uuid,p_expense uuid,p_allocation uuid,p_amount bigint,p_paid_on date,
 p_method text,p_reference text,p_description text,p_request uuid
) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $wrapper$
 select platform_funding_private_v1_255.record_expense($1,$2,$3,$4,$5,$6,$7,$8,$9)
$wrapper$;
create or replace function public.admin_owner_campaign_cost_void_v1_255(
 p_actor uuid,p_expense uuid,p_reason text,p_request uuid
) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $wrapper$
 select platform_funding_private_v1_255.void_expense($1,$2,$3,$4)
$wrapper$;
create or replace function public.admin_owner_campaign_cost_read_v1_255(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrapper$
 select platform_funding_private_v1_255.read_expenses($1,$2)
$wrapper$;
revoke all on function public.admin_owner_campaign_cost_record_v1_255(uuid,uuid,uuid,bigint,date,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_campaign_cost_void_v1_255(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_campaign_cost_read_v1_255(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_campaign_cost_record_v1_255(uuid,uuid,uuid,bigint,date,text,text,text,uuid) to service_role;
grant execute on function public.admin_owner_campaign_cost_void_v1_255(uuid,uuid,text,uuid) to service_role;
grant execute on function public.admin_owner_campaign_cost_read_v1_255(uuid,date) to service_role;

do $acl$begin
 if has_table_privilege('anon','public.platform_campaign_marketing_costs_v1_255','SELECT')
 or has_table_privilege('authenticated','public.platform_campaign_marketing_costs_v1_255','INSERT')
 or has_table_privilege('service_role','public.platform_campaign_marketing_costs_v1_255','UPDATE')
 or has_table_privilege('service_role','public.platform_campaign_marketing_cost_voids_v1_255','DELETE')
 or has_function_privilege('authenticated','public.admin_owner_campaign_cost_record_v1_255(uuid,uuid,uuid,bigint,date,text,text,text,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_campaign_cost_read_v1_255(uuid,date)','EXECUTE')
 then raise exception 'CAMPAIGN_COST_ACL_DRIFT' using errcode='42501';end if;
end$acl$;
