-- TAMÃO Ads V1.232 — demand validation only, no ads, billing, ranking or payment.
-- Only an authenticated owner/manager may voluntarily register or withdraw interest.
create table if not exists public.merchant_ads_interest_v1_232 (
 merchant_id uuid primary key references public.merchants(id) on delete cascade,
 interested boolean not null default false,
 goal text check(goal is null or goal in ('new_customers','local_visibility','new_area','unsure')),
 budget_band text check(budget_band is null or budget_band in ('unsure','upto_99','100_299','300_999','1000_plus')),
 consented_at timestamptz,
 updated_by uuid not null references auth.users(id) on delete restrict,
 updated_at timestamptz not null default clock_timestamp(),
 check(interested=false or (goal is not null and budget_band is not null and consented_at is not null))
);
create index if not exists merchant_ads_interest_active_v1_232
 on public.merchant_ads_interest_v1_232(updated_at desc, merchant_id) where interested;

create table if not exists public.merchant_ads_interest_events_v1_232 (
 id uuid primary key default gen_random_uuid(),
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 event text not null check(event in ('register','withdraw')),
 goal text,
 budget_band text,
 created_at timestamptz not null default clock_timestamp(),
 check(event <> 'register' or (goal is not null and budget_band is not null))
);
create index if not exists merchant_ads_interest_events_merchant_v1_232
 on public.merchant_ads_interest_events_v1_232(merchant_id,created_at desc,id desc);

alter table public.merchant_ads_interest_v1_232 enable row level security;
alter table public.merchant_ads_interest_events_v1_232 enable row level security;
revoke all on table public.merchant_ads_interest_v1_232 from public,anon,authenticated,service_role;
revoke all on table public.merchant_ads_interest_events_v1_232 from public,anon,authenticated,service_role;
grant select on table public.merchant_ads_interest_v1_232 to service_role;

-- Writes are not available through the Data API, even with service_role:
-- the privileged implementation is in a schema outside the exposed API.
create schema if not exists growth_internal_v1_232;
revoke all on schema growth_internal_v1_232 from public,anon,authenticated;
grant usage on schema growth_internal_v1_232 to service_role;

create or replace function growth_internal_v1_232.ads_interest_v1_232(
 p_actor_user_id uuid,p_merchant_id uuid,p_operation text,
 p_goal text,p_budget_band text,p_consent boolean
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_prev public.merchant_ads_interest_v1_232%rowtype;
 v_changed boolean:=false;
 v_now timestamptz:=clock_timestamp();
begin
 if p_actor_user_id is null or p_merchant_id is null
    or not exists(select 1 from public.merchant_members mm
       where mm.merchant_id=p_merchant_id and mm.user_id=p_actor_user_id
         and mm.active and mm.member_role in ('owner','manager')) then
   raise exception 'ADS_INTEREST_ACCESS_DENIED' using errcode='42501';
 end if;
 if p_operation is null or p_operation not in ('view','register','withdraw') then
   raise exception 'ADS_INTEREST_INVALID_ACTION' using errcode='22023';
 end if;
 if p_operation='register' then
   if p_consent is distinct from true
      or p_goal is null or p_goal not in ('new_customers','local_visibility','new_area','unsure')
      or p_budget_band is null
      or p_budget_band not in ('unsure','upto_99','100_299','300_999','1000_plus') then
     raise exception 'ADS_INTEREST_CONSENT_REQUIRED' using errcode='22023';
   end if;
 end if;
 if p_operation<>'view' then
   perform pg_catalog.pg_advisory_xact_lock(
     pg_catalog.hashtextextended('ads-interest-v1-232:'||p_merchant_id::text,0));
 end if;
 select * into v_prev from public.merchant_ads_interest_v1_232
  where merchant_id=p_merchant_id;
 if p_operation='register' then
   if not found or v_prev.interested is distinct from true
      or v_prev.goal is distinct from p_goal
      or v_prev.budget_band is distinct from p_budget_band then
     insert into public.merchant_ads_interest_v1_232
       (merchant_id,interested,goal,budget_band,consented_at,updated_by,updated_at)
     values(p_merchant_id,true,p_goal,p_budget_band,v_now,p_actor_user_id,v_now)
     on conflict (merchant_id) do update
       set interested=true,goal=excluded.goal,budget_band=excluded.budget_band,
           consented_at=excluded.consented_at,updated_by=excluded.updated_by,
           updated_at=excluded.updated_at;
     insert into public.merchant_ads_interest_events_v1_232
       (merchant_id,actor_user_id,event,goal,budget_band)
     values(p_merchant_id,p_actor_user_id,'register',p_goal,p_budget_band);
     v_changed:=true;
   end if;
 elsif p_operation='withdraw' then
   if found and v_prev.interested then
     update public.merchant_ads_interest_v1_232
       set interested=false,goal=null,budget_band=null,consented_at=null,
           updated_by=p_actor_user_id,updated_at=v_now
       where merchant_id=p_merchant_id;
     insert into public.merchant_ads_interest_events_v1_232
       (merchant_id,actor_user_id,event)
     values(p_merchant_id,p_actor_user_id,'withdraw');
     v_changed:=true;
   end if;
 end if;
 select * into v_prev from public.merchant_ads_interest_v1_232
   where merchant_id=p_merchant_id;
 return jsonb_build_object(
  'source','merchant_ads_interest_v1_232','merchantId',p_merchant_id,
  'interested',coalesce(v_prev.interested,false),
  'goal',case when v_prev.interested then v_prev.goal else null end,
  'budgetBand',case when v_prev.interested then v_prev.budget_band else null end,
  'updatedAt',v_prev.updated_at,
  'changed',v_changed,'noCharge',true,'adsLive',false,'readOnly',p_operation='view'
 );
end;
$fn$;
revoke all on function growth_internal_v1_232.ads_interest_v1_232(
 uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function growth_internal_v1_232.ads_interest_v1_232(
 uuid,uuid,text,text,text,boolean) to service_role;

create or replace function public.merchant_ads_interest_v1_232(
 p_actor_user_id uuid,p_merchant_id uuid,p_operation text,
 p_goal text default null,p_budget_band text default null,p_consent boolean default false
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrapper$
 select growth_internal_v1_232.ads_interest_v1_232($1,$2,$3,$4,$5,$6)
$wrapper$;
revoke all on function public.merchant_ads_interest_v1_232(
 uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.merchant_ads_interest_v1_232(
 uuid,uuid,text,text,text,boolean) to service_role;

-- Demand visibility only. No contacts, payment information or personal identifiers.
create or replace function public.admin_ads_demand_v1_232(p_actor_user_id uuid)
 returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog as $fn$
declare
 v_total bigint;
 v_recent bigint;
 v_rows jsonb;
begin
 if p_actor_user_id is null
    or not exists(select 1 from public.platform_admins a
       where a.user_id=p_actor_user_id and a.active
       and a.admin_role in ('superadmin','operations','compliance','finance','readonly')) then
   raise exception 'ADS_DEMAND_ADMIN_DENIED' using errcode='42501';
 end if;
 select count(*),count(*) filter(where a.updated_at>=statement_timestamp()-interval '30 days')
 into v_total,v_recent from public.merchant_ads_interest_v1_232 a where a.interested;
 select coalesce(jsonb_agg(jsonb_build_object(
    'merchantId',x.merchant_id,'companyName',x.company_name,
    'city',x.city,'state',x.state,'goal',x.goal,
    'budgetBand',x.budget_band,'updatedAt',x.updated_at
   ) order by x.updated_at desc,x.merchant_id),'[]'::jsonb)
 into v_rows
 from (
  select a.merchant_id,left(m.name,120) as company_name,
         left(coalesce(d.city,''),100) as city,
         left(coalesce(d.state,''),2) as state,
         a.goal,a.budget_band,a.updated_at
  from public.merchant_ads_interest_v1_232 a
  join public.merchants m on m.id=a.merchant_id
  left join public.merchant_business_details d on d.merchant_id=m.id
  where a.interested
  order by a.updated_at desc,a.merchant_id desc limit 50
 ) x;
 return jsonb_build_object('source','admin_ads_demand_v1_232',
   'totalInterested',v_total,'recent30d',v_recent,'rows',v_rows,
   'noRevenue',true,'adsLive',false,'noCharge',true);
end;
$fn$;
revoke all on function public.admin_ads_demand_v1_232(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_ads_demand_v1_232(uuid)
 to service_role;

do $acl$
begin
 if has_table_privilege('anon','public.merchant_ads_interest_v1_232','SELECT')
 or has_table_privilege('authenticated','public.merchant_ads_interest_v1_232','INSERT')
 or has_table_privilege('service_role','public.merchant_ads_interest_v1_232','INSERT')
 or has_table_privilege('service_role','public.merchant_ads_interest_events_v1_232','INSERT')
 or has_function_privilege('anon','public.merchant_ads_interest_v1_232(uuid,uuid,text,text,text,boolean)','EXECUTE')
 or has_function_privilege('authenticated','public.merchant_ads_interest_v1_232(uuid,uuid,text,text,text,boolean)','EXECUTE')
 or has_function_privilege('anon','public.admin_ads_demand_v1_232(uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_ads_demand_v1_232(uuid)','EXECUTE')
 then raise exception 'ADS_INTEREST_PERMISSION_DRIFT' using errcode='42501';
 end if;
end;
$acl$;
