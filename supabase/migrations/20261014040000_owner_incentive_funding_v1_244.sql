-- TAMÃO V1.244: owner-financed incentives, controllable internal sponsorship planning.
-- This proposal makes the founder the proposed sponsor but does NOT claim proof of cash,
-- disburse funds, alter existing rewards, or activate otherwise-inactive benefit programs.
create table public.platform_incentive_funding_plan_v1_244(
 benefit_key text primary key check(benefit_key in ('customer_cashback','customer_referral','merchant_referral','clube_coupons')),
 funding_source text not null default 'platform_owner' check(funding_source='platform_owner'),
 period_key text not null default 'monthly' check(period_key='monthly'),
 planned_budget_cents bigint not null default 0 check(planned_budget_cents between 0 and 50000000),
 beneficiary_limit_cents bigint not null default 0 check(beneficiary_limit_cents between 0 and 10000000),
 status text not null default 'planning' check(status in ('planning','internally_committed')),
 note text not null check(char_length(note) between 12 and 400),
 version integer not null default 1 check(version between 1 and 2147483646),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default clock_timestamp(),
 verified_deposit_cents bigint not null default 0 check(verified_deposit_cents=0),
 reserved_cents bigint not null default 0 check(reserved_cents=0),
 paid_cents bigint not null default 0 check(paid_cents=0),
 new_benefits_enabled boolean not null default false check(new_benefits_enabled=false)
);
create table public.platform_incentive_funding_events_v1_244(
 request_id uuid primary key,
 benefit_key text not null references public.platform_incentive_funding_plan_v1_244(benefit_key),
 actor uuid not null references auth.users(id),
 request_signature jsonb not null,
 old_version integer not null,
 new_version integer not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_incentive_funding_plan_v1_244 enable row level security;
alter table public.platform_incentive_funding_events_v1_244 enable row level security;
revoke all on public.platform_incentive_funding_plan_v1_244 from public,anon,authenticated,service_role;
revoke all on public.platform_incentive_funding_events_v1_244 from public,anon,authenticated,service_role;
create schema if not exists platform_funding_private_v1_244;
revoke all on schema platform_funding_private_v1_244 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_244 to service_role;
create or replace function platform_funding_private_v1_244.save_plan(
 p_actor uuid,p_benefit text,p_budget bigint,p_cap bigint,
 p_status text,p_note text,p_expected_version integer,p_request uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_prev public.platform_incentive_funding_plan_v1_244%rowtype;
 v_event public.platform_incentive_funding_events_v1_244%rowtype;
 v_signature jsonb;
 v_version integer:=0;
 v_changed boolean:=false;
 v_replayed boolean:=false;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role='superadmin'
 ) then raise exception 'FUNDING_SUPERADMIN_REQUIRED' using errcode='42501';end if;
 if p_benefit is null or p_benefit not in
  ('customer_cashback','customer_referral','merchant_referral','clube_coupons')
  or p_budget is null or p_budget not between 0 and 50000000
  or p_cap is null or p_cap not between 0 and 10000000
  or p_cap>p_budget
  or p_status is null or p_status not in ('planning','internally_committed')
  or p_note is null or char_length(btrim(p_note)) not between 12 and 400
  or p_expected_version is null or p_expected_version not between 0 and 2147483645
  or p_request is null
 then raise exception 'FUNDING_INVALID_PLAN' using errcode='22023';end if;
 -- Committing an empty budget misleads; zero amounts remain at planning stage.
 if p_status='internally_committed' and (p_budget=0 or p_cap=0) then
  raise exception 'FUNDING_EMPTY_COMMITMENT' using errcode='22023';end if;
 v_signature:=jsonb_build_object(
  'benefit',p_benefit,'budget',p_budget,'cap',p_cap,
  'status',p_status,'note',btrim(p_note),'expectedVersion',p_expected_version
 );
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('founder-funding-v1-244:'||p_benefit,0));
 select * into v_event from public.platform_incentive_funding_events_v1_244 e
  where e.request_id=p_request;
 if found then
  if v_event.actor<>p_actor or v_event.benefit_key<>p_benefit
    or v_event.request_signature is distinct from v_signature
  then raise exception 'FUNDING_REPLAY_CONFLICT' using errcode='23505';end if;
  v_replayed:=true;
 end if;
 select * into v_prev from public.platform_incentive_funding_plan_v1_244 p
  where p.benefit_key=p_benefit;
 if found then v_version:=v_prev.version;end if;
 if not v_replayed then
  if v_version<>p_expected_version
  then raise exception 'FUNDING_STALE_VERSION' using errcode='40001';end if;
  if v_version=0 or v_prev.planned_budget_cents<>p_budget
   or v_prev.beneficiary_limit_cents<>p_cap
   or v_prev.status<>p_status or v_prev.note<>btrim(p_note)
  then
   insert into public.platform_incentive_funding_plan_v1_244(
    benefit_key,planned_budget_cents,beneficiary_limit_cents,status,note,
    version,updated_by,updated_at
   )values(p_benefit,p_budget,p_cap,p_status,btrim(p_note),
    v_version+1,p_actor,clock_timestamp())
   on conflict(benefit_key) do update set
    planned_budget_cents=excluded.planned_budget_cents,
    beneficiary_limit_cents=excluded.beneficiary_limit_cents,
    status=excluded.status,note=excluded.note,version=excluded.version,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;
   v_changed:=true;
  end if;
  insert into public.platform_incentive_funding_events_v1_244(
   request_id,benefit_key,actor,request_signature,old_version,new_version
  ) values(p_request,p_benefit,p_actor,v_signature,v_version,
   v_version+case when v_changed then 1 else 0 end);
 end if;
 return jsonb_build_object('source','admin_owner_funding_save_v1_244',
  'recorded',true,'changed',v_changed,'replayed',v_replayed,
  'newBenefitsEnabled',false,'verifiedDepositCents',0,
  'moneyReservedCents',0,'moneyPaidCents',0,
  'noExternalCommitment',true);
end;$fn$;
revoke all on function platform_funding_private_v1_244.save_plan(uuid,text,bigint,bigint,text,text,integer,uuid)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_244.save_plan(uuid,text,bigint,bigint,text,text,integer,uuid)
 to service_role;
create or replace function public.admin_owner_funding_save_v1_244(
 p_actor uuid,p_benefit text,p_budget bigint,p_cap bigint,
 p_status text,p_note text,p_expected_version integer,p_request uuid
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $f$
 select platform_funding_private_v1_244.save_plan($1,$2,$3,$4,$5,$6,$7,$8)
$f$;
revoke all on function public.admin_owner_funding_save_v1_244(uuid,text,bigint,bigint,text,text,integer,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_funding_save_v1_244(uuid,text,bigint,bigint,text,text,integer,uuid)
 to service_role;

create or replace function public.admin_owner_funding_read_v1_244(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_rows jsonb;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'FUNDING_ADMIN_DENIED' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'benefitKey',k.benefit_key,
  'budgetCents',coalesce(p.planned_budget_cents,0),
  'capCents',coalesce(p.beneficiary_limit_cents,0),
  'status',coalesce(p.status,'planning'),
  'note',coalesce(p.note,''),
  'version',coalesce(p.version,0),
  'updatedAt',p.updated_at
 ) order by k.benefit_key),'[]'::jsonb) into v_rows
 from (values('customer_cashback'),('customer_referral'),('merchant_referral'),('clube_coupons')) k(benefit_key)
 left join public.platform_incentive_funding_plan_v1_244 p
  on p.benefit_key=k.benefit_key;
 return jsonb_build_object('source','admin_owner_funding_read_v1_244',
  'rows',v_rows,'fundingSource','platform_owner','scope','monthly',
  'verifiedDepositCents',0,'moneyReservedCents',0,'moneyPaidCents',0,
  'newBenefitsEnabled',false,'noCharge',true,'readOnly',true);
end;$fn$;
revoke all on function public.admin_owner_funding_read_v1_244(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_funding_read_v1_244(uuid) to service_role;

do $guard$begin
 if has_table_privilege('anon','public.platform_incentive_funding_plan_v1_244','SELECT')
  or has_table_privilege('authenticated','public.platform_incentive_funding_plan_v1_244','INSERT')
  or has_table_privilege('service_role','public.platform_incentive_funding_plan_v1_244','UPDATE')
  or has_table_privilege('service_role','public.platform_incentive_funding_events_v1_244','INSERT')
  or has_function_privilege('anon','public.admin_owner_funding_read_v1_244(uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.admin_owner_funding_save_v1_244(uuid,text,bigint,bigint,text,text,integer,uuid)','EXECUTE')
  or not has_function_privilege('service_role','public.admin_owner_funding_read_v1_244(uuid)','EXECUTE')
 then raise exception 'FUNDING_ACL_DRIFT' using errcode='42501';end if;
end$guard$;
