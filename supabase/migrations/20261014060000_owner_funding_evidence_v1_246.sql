-- TAMÃO V1.246 — Provenance and dual-control review of owner financing evidence.
-- This is not bank API reconciliation, spendable treasury, or permission to issue coupons.
create table public.platform_owner_contributions_v1_246 (
 contribution_id uuid primary key,
 benefit_key text not null check (benefit_key in (
  'customer_cashback','customer_referral','merchant_referral','clube_coupons')),
 plan_version integer not null check (plan_version>=1),
 amount_cents bigint not null check (amount_cents between 100 and 50000000),
 transfer_date date not null,
 transfer_reference text not null check (
  char_length(transfer_reference) between 12 and 100 and
  transfer_reference ~ '^[a-zA-Z0-9 .:/_-]+$'),
 note text not null check (char_length(note) between 12 and 300),
 status text not null default 'pending_review'
  check (status in ('pending_review','manual_reconciled','rejected','disputed')),
 version integer not null default 1 check(version between 1 and 2147483646),
 submitted_by uuid not null references auth.users(id),
 submitted_at timestamptz not null default clock_timestamp(),
 reviewer_id uuid references auth.users(id),
 reviewed_at timestamptz,
 reviewer_note text,
 bank_statement_reference text,
 funds_spendable boolean not null default false check(funds_spendable=false),
 coupons_enabled boolean not null default false check(coupons_enabled=false),
 payouts_enabled boolean not null default false check(payouts_enabled=false),
 check (
  (status='pending_review' and reviewer_id is null and reviewed_at is null
   and reviewer_note is null and bank_statement_reference is null)
  or
  (status<>'pending_review' and reviewer_id is not null and
   reviewed_at is not null and reviewer_note is not null and
   char_length(reviewer_note) between 12 and 300)
 ),
 check (reviewer_id is null or reviewer_id<>submitted_by),
 check (status<>'manual_reconciled' or
   (bank_statement_reference is not null and
    char_length(bank_statement_reference) between 12 and 100))
);
create unique index platform_owner_contribution_reference_uq_v1_246
 on public.platform_owner_contributions_v1_246(lower(transfer_reference));
create index platform_owner_contribution_queue_v1_246
 on public.platform_owner_contributions_v1_246(status,submitted_at desc);
create table public.platform_owner_contribution_events_v1_246(
 request_id uuid primary key,
 contribution_id uuid not null references public.platform_owner_contributions_v1_246(contribution_id),
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('submit','review')),
 request_signature jsonb not null,
 from_version integer not null,
 to_version integer not null,
 created_at timestamptz not null default clock_timestamp()
);
create index platform_owner_contribution_events_lookup_v1_246
 on public.platform_owner_contribution_events_v1_246(contribution_id,created_at desc);
alter table public.platform_owner_contributions_v1_246 enable row level security;
alter table public.platform_owner_contribution_events_v1_246 enable row level security;
revoke all on public.platform_owner_contributions_v1_246 from public,anon,authenticated,service_role;
revoke all on public.platform_owner_contribution_events_v1_246 from public,anon,authenticated,service_role;
create schema if not exists platform_funding_private_v1_246;
revoke all on schema platform_funding_private_v1_246 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_246 to service_role;

create or replace function platform_funding_private_v1_246.submit(
 p_actor uuid,p_contribution uuid,p_benefit text,p_plan_version integer,
 p_amount bigint,p_date date,p_reference text,p_note text,p_request uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $func$
declare
 v_plan public.platform_incentive_funding_plan_v1_244%rowtype;
 v_event public.platform_owner_contribution_events_v1_246%rowtype;
 v_signature jsonb;
 v_existing public.platform_owner_contributions_v1_246%rowtype;
 v_replayed boolean:=false;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'OWNER_EVIDENCE_ACCESS_DENIED' using errcode='42501';end if;
 if p_contribution is null or p_request is null or
  p_benefit is null or p_benefit not in
  ('customer_cashback','customer_referral','merchant_referral','clube_coupons')
  or p_plan_version is null or p_plan_version<1
  or p_amount is null or p_amount not between 100 and 50000000
  or p_date is null or p_date>current_date or p_date<current_date-90
  or p_reference is null or char_length(btrim(p_reference)) not between 12 and 100
  or btrim(p_reference) !~ '^[a-zA-Z0-9 .:/_-]+$'
  or p_note is null or char_length(btrim(p_note)) not between 12 and 300
 then raise exception 'OWNER_EVIDENCE_INVALID' using errcode='22023';end if;
 v_signature:=jsonb_build_object('action','submit','contribution',p_contribution,
   'benefit',p_benefit,'planVersion',p_plan_version,'amount',p_amount,
   'date',p_date,'reference',btrim(p_reference),'note',btrim(p_note));
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('owner-evidence-v1-246:'||p_contribution::text,0));
 select * into v_event from public.platform_owner_contribution_events_v1_246
  where request_id=p_request;
 if found then
   if v_event.actor_id is distinct from p_actor or v_event.action<>'submit'
    or v_event.request_signature is distinct from v_signature
   then raise exception 'OWNER_EVIDENCE_IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
   v_replayed:=true;
 end if;
 if not v_replayed then
  select * into v_plan from public.platform_incentive_funding_plan_v1_244 p
   where p.benefit_key=p_benefit for share;
  if not found or v_plan.version<>p_plan_version or
    v_plan.status<>'internally_committed' or v_plan.planned_budget_cents<p_amount
  then raise exception 'OWNER_EVIDENCE_PLAN_STALE' using errcode='40001';end if;
  if exists(select 1 from public.platform_owner_contributions_v1_246 c
            where c.contribution_id=p_contribution) then
    raise exception 'OWNER_EVIDENCE_DUPLICATE_ID' using errcode='23505';end if;
  insert into public.platform_owner_contributions_v1_246(
   contribution_id,benefit_key,plan_version,amount_cents,transfer_date,
   transfer_reference,note,submitted_by
  )values(p_contribution,p_benefit,p_plan_version,p_amount,p_date,
   btrim(p_reference),btrim(p_note),p_actor);
  insert into public.platform_owner_contribution_events_v1_246(
   request_id,contribution_id,actor_id,action,request_signature,
   from_version,to_version
  ) values(p_request,p_contribution,p_actor,'submit',v_signature,0,1);
 end if;
 return jsonb_build_object('source','admin_owner_evidence_submit_v1_246',
  'recorded',true,'replayed',v_replayed,'status','pending_review',
  'bankApiConfirmed',false,'fundsSpendable',false,
  'newBenefitsEnabled',false,'cashMoved',false);
end;$func$;

create or replace function platform_funding_private_v1_246.review(
 p_actor uuid,p_contribution uuid,p_action text,p_expected_version integer,
 p_note text,p_statement_reference text,p_request uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $func$
declare
 v_prev public.platform_owner_contributions_v1_246%rowtype;
 v_event public.platform_owner_contribution_events_v1_246%rowtype;
 v_sig jsonb;
 v_replayed boolean:=false;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'OWNER_EVIDENCE_REVIEW_DENIED' using errcode='42501';end if;
 if p_contribution is null or p_request is null or
  p_action is null or p_action not in ('manual_reconciled','rejected','disputed') or
  p_expected_version is null or p_expected_version<1 or
  p_note is null or char_length(btrim(p_note)) not between 12 and 300 or
  (p_action='manual_reconciled' and
   (p_statement_reference is null or
    char_length(btrim(p_statement_reference)) not between 12 and 100 or
    btrim(p_statement_reference) !~ '^[a-zA-Z0-9 .:/_-]+$')) or
  (p_action<>'manual_reconciled' and nullif(btrim(coalesce(p_statement_reference,'')),'') is not null)
 then raise exception 'OWNER_EVIDENCE_REVIEW_INVALID' using errcode='22023';end if;
 v_sig:=jsonb_build_object('action',p_action,'contribution',p_contribution,
  'version',p_expected_version,'note',btrim(p_note),
  'statementReference',nullif(btrim(coalesce(p_statement_reference,'')),''));
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('owner-evidence-v1-246:'||p_contribution::text,0));
 select * into v_event from public.platform_owner_contribution_events_v1_246
  where request_id=p_request;
 if found then
  if v_event.actor_id<>p_actor or v_event.action<>'review' or
     v_event.request_signature is distinct from v_sig
  then raise exception 'OWNER_EVIDENCE_REVIEW_REPLAY_CONFLICT' using errcode='23505';end if;
  v_replayed:=true;
 end if;
 select * into v_prev from public.platform_owner_contributions_v1_246
  where contribution_id=p_contribution;
 if not found then raise exception 'OWNER_EVIDENCE_NOT_FOUND' using errcode='22023';end if;
 if v_prev.submitted_by=p_actor then
  raise exception 'OWNER_EVIDENCE_INDEPENDENT_REVIEW_REQUIRED' using errcode='42501';end if;
 if not v_replayed then
  if v_prev.version<>p_expected_version or
    (v_prev.status<>'pending_review' and
      not (v_prev.status='manual_reconciled' and p_action='disputed'))
  then raise exception 'OWNER_EVIDENCE_REVIEW_STALE' using errcode='40001';end if;
  update public.platform_owner_contributions_v1_246 set
   status=p_action,version=version+1,
   reviewer_id=p_actor,reviewed_at=clock_timestamp(),
   reviewer_note=btrim(p_note),
   bank_statement_reference=case when p_action='manual_reconciled'
    then btrim(p_statement_reference) else null end
   where contribution_id=p_contribution;
  insert into public.platform_owner_contribution_events_v1_246(
   request_id,contribution_id,actor_id,action,request_signature,
   from_version,to_version
  )values(p_request,p_contribution,p_actor,'review',v_sig,
   v_prev.version,v_prev.version+1);
 end if;
 return jsonb_build_object('source','admin_owner_evidence_review_v1_246',
  'recorded',true,'replayed',v_replayed,'reviewStatus',p_action,
  'bankApiConfirmed',false,'fundsSpendable',false,
  'newBenefitsEnabled',false,'cashMoved',false);
end;$func$;

create or replace function platform_funding_private_v1_246.queue(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $func$
declare v_rows jsonb;v_count bigint;v_pending bigint;v_manual bigint;v_disputed bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'OWNER_EVIDENCE_QUEUE_DENIED' using errcode='42501';end if;
 select count(*),count(*) filter(where status='pending_review'),
  coalesce(sum(amount_cents) filter(where status='manual_reconciled'),0),
  coalesce(sum(amount_cents) filter(where status='disputed'),0)
 into v_count,v_pending,v_manual,v_disputed
 from public.platform_owner_contributions_v1_246;
 select coalesce(jsonb_agg(jsonb_build_object(
  'contributionId',c.contribution_id,'benefitKey',c.benefit_key,
  'planVersion',c.plan_version,'amountCents',c.amount_cents,
  'transferDate',c.transfer_date,'transferReference',c.transfer_reference,
  'note',c.note,'status',c.status,'version',c.version,
  'submittedBy',c.submitted_by,'submittedAt',c.submitted_at,
  'reviewedBy',c.reviewer_id,'reviewedAt',c.reviewed_at,
  'reviewNote',c.reviewer_note,'statementReference',c.bank_statement_reference,
  'fundsSpendable',false,'bankApiConfirmed',false
 ) order by c.submitted_at desc,c.contribution_id),'[]'::jsonb)
 into v_rows
 from (select * from public.platform_owner_contributions_v1_246
       order by submitted_at desc,contribution_id limit 50) c;
 return jsonb_build_object('source','admin_owner_evidence_queue_v1_246',
  'rows',v_rows,'total',v_count,'pendingCount',v_pending,
  'manualReconciledCents',v_manual,'disputedCents',v_disputed,
  'bankApiConfirmed',false,'fundsSpendable',false,
  'spendableCents',0,'newBenefitsEnabled',false,
  'cashMoved',false,'readOnly',true);
end;$func$;

revoke all on function platform_funding_private_v1_246.submit(uuid,uuid,text,integer,bigint,date,text,text,uuid)
 from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_246.review(uuid,uuid,text,integer,text,text,uuid)
 from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_246.queue(uuid)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_246.submit(uuid,uuid,text,integer,bigint,date,text,text,uuid) to service_role;
grant execute on function platform_funding_private_v1_246.review(uuid,uuid,text,integer,text,text,uuid) to service_role;
grant execute on function platform_funding_private_v1_246.queue(uuid) to service_role;

create or replace function public.admin_owner_evidence_submit_v1_246(
 p_actor uuid,p_contribution uuid,p_benefit text,p_plan_version integer,
 p_amount bigint,p_date date,p_reference text,p_note text,p_request uuid
) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_246.submit($1,$2,$3,$4,$5,$6,$7,$8,$9)
$wrap$;
create or replace function public.admin_owner_evidence_review_v1_246(
 p_actor uuid,p_contribution uuid,p_action text,p_expected_version integer,
 p_note text,p_statement_reference text,p_request uuid
) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_246.review($1,$2,$3,$4,$5,$6,$7)
$wrap$;
create or replace function public.admin_owner_evidence_queue_v1_246(p_actor uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_246.queue($1)
$wrap$;
revoke all on function public.admin_owner_evidence_submit_v1_246(uuid,uuid,text,integer,bigint,date,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_evidence_review_v1_246(uuid,uuid,text,integer,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_evidence_queue_v1_246(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_evidence_submit_v1_246(uuid,uuid,text,integer,bigint,date,text,text,uuid) to service_role;
grant execute on function public.admin_owner_evidence_review_v1_246(uuid,uuid,text,integer,text,text,uuid) to service_role;
grant execute on function public.admin_owner_evidence_queue_v1_246(uuid) to service_role;

do $acl$ begin
 if has_table_privilege('anon','public.platform_owner_contributions_v1_246','SELECT')
  or has_table_privilege('authenticated','public.platform_owner_contributions_v1_246','INSERT')
  or has_table_privilege('service_role','public.platform_owner_contributions_v1_246','UPDATE')
  or has_table_privilege('service_role','public.platform_owner_contribution_events_v1_246','INSERT')
  or has_function_privilege('anon','public.admin_owner_evidence_queue_v1_246(uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.admin_owner_evidence_submit_v1_246(uuid,uuid,text,integer,bigint,date,text,text,uuid)','EXECUTE')
 then raise exception 'OWNER_EVIDENCE_ACL_DRIFT' using errcode='42501';end if;
end $acl$;