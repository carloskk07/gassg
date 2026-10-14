-- TAMÃO V1.245: real evidence for owner-funded incentive planning.
-- Read-only reward GRANT cohort analysis; NOT a cash, PSP, payout or budget reservation balance.
-- Report only rewards already granted by the engine, never invented forecast/clients.
create schema if not exists platform_funding_private_v1_245;
revoke all on schema platform_funding_private_v1_245 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_245 to service_role;

create or replace function platform_funding_private_v1_245.pulse(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $body$
declare
 v_start timestamptz;
 v_finish timestamptz;
 v_cash_gross bigint;
 v_cash_reversed bigint;
 v_ref_gross bigint;
 v_ref_reversed bigint;
 v_rewards bigint;
 v_reversed bigint;
 v_cash_policy boolean;
 v_ref_policy boolean;
 v_merchant_policy boolean;
 v_clube_policy boolean;
 v_rows jsonb;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active
     and a.admin_role in ('superadmin','finance')
 ) then raise exception 'OWNER_PULSE_ACCESS_DENIED' using errcode='42501';end if;

 -- Bound the cohort to the month in São Paulo; no lifetime/mixed-timezone sums.
 v_start:=date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
           at time zone 'America/Sao_Paulo';
 v_finish:=(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
             + interval '1 month') at time zone 'America/Sao_Paulo';
 select count(*)::bigint,
        count(*) filter(where g.reversed_at is not null)::bigint,
        coalesce(sum(greatest(g.cashback_cents,0)),0)::bigint,
        coalesce(sum(greatest(g.cashback_cents,0)) filter(where g.reversed_at is not null),0)::bigint,
        coalesce(sum(greatest(g.referral_pending_cents,0)),0)::bigint,
        coalesce(sum(greatest(g.referral_pending_cents,0)) filter(where g.reversed_at is not null),0)::bigint
 into v_rewards,v_reversed,v_cash_gross,v_cash_reversed,v_ref_gross,v_ref_reversed
 from public.order_reward_grants g
 where g.created_at>=v_start and g.created_at<v_finish;

 select exists(select 1 from public.reward_policy where policy_key='default' and active)
 into v_cash_policy;
 v_ref_policy:=v_cash_policy;
 select exists(select 1 from public.growth_merchant_benefit_policy_v1_228
               where policy_key='merchant_first_level_v1' and reward_enabled)
 into v_merchant_policy;
 select exists(select 1 from public.clube_package_drafts_v1_239
               where sales_enabled or redemption_enabled)
 into v_clube_policy;

 with keys(benefit_key) as (
   values('customer_cashback'::text),('customer_referral'::text),
         ('merchant_referral'::text),('clube_coupons'::text)
 ),
 statuses as (
 select k.benefit_key,
        coalesce(p.version,0) plan_version,
        coalesce(p.status,'planning') plan_status,
        coalesce(p.planned_budget_cents,0)::bigint plan_budget,
        coalesce(p.beneficiary_limit_cents,0)::bigint person_limit,
        case k.benefit_key
          when 'customer_cashback' then v_cash_gross
          when 'customer_referral' then v_ref_gross
          else 0::bigint end gross_granted,
        case k.benefit_key
          when 'customer_cashback' then v_cash_reversed
          when 'customer_referral' then v_ref_reversed
          else 0::bigint end reversed_grants,
        case k.benefit_key
          when 'customer_cashback' then v_cash_policy
          when 'customer_referral' then v_ref_policy
          when 'merchant_referral' then v_merchant_policy
          when 'clube_coupons' then v_clube_policy end policy_enabled
 from keys k left join public.platform_incentive_funding_plan_v1_244 p
   on p.benefit_key=k.benefit_key
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'benefitKey',s.benefit_key,
  'planVersion',s.plan_version,
  'planStatus',s.plan_status,
  'plannedBudgetCents',s.plan_budget,
  'perPersonCapCents',s.person_limit,
  'grossGrantedCents',s.gross_granted,
  'reversedGrantedCents',s.reversed_grants,
  'netGrantedCents',greatest(0,s.gross_granted-s.reversed_grants),
  'policyEnabled',s.policy_enabled,
  'grossVsPlannedPct',case when s.plan_budget>0
     then round(100.0*s.gross_granted/s.plan_budget,1) else null end,
  'planningSignal',case
   when s.plan_budget=0 then 'budget_not_defined'
   when s.gross_granted>s.plan_budget then 'gross_exceeds_plan'
   when s.gross_granted*100>=s.plan_budget*80 then 'near_planned_limit'
   else 'within_planned_limit' end
 ) order by s.benefit_key),'[]'::jsonb)
 into v_rows from statuses s;

 return jsonb_build_object(
  'source','admin_owner_funding_pulse_v1_245',
  'monthStart',to_char(v_start at time zone 'America/Sao_Paulo','YYYY-MM-DD'),
  'periodEndExclusive',to_char(v_finish at time zone 'America/Sao_Paulo','YYYY-MM-DD'),
  'timezone','America/Sao_Paulo',
  'grantsCount',v_rewards,'reversedGrantsCount',v_reversed,
  'rows',v_rows,
  'metricMeaning','grants_created_this_month_not_bank_spending',
  'budgetMeaning','owner_plan_not_funds_deposited',
  'moneyReservedCents',0,'verifiedDepositCents',0,
  'payoutsMeasured',false,'newBenefitsActivated',false,
  'readOnly',true,'noCharge',true
 );
end;$body$;
revoke all on function platform_funding_private_v1_245.pulse(uuid)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_245.pulse(uuid) to service_role;

create or replace function public.admin_owner_funding_pulse_v1_245(p_actor uuid)
returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select platform_funding_private_v1_245.pulse($1)
$wrapper$;
revoke all on function public.admin_owner_funding_pulse_v1_245(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_funding_pulse_v1_245(uuid) to service_role;

do $acl$begin
 if has_function_privilege('anon',
    'public.admin_owner_funding_pulse_v1_245(uuid)','EXECUTE')
 or has_function_privilege('authenticated',
    'public.admin_owner_funding_pulse_v1_245(uuid)','EXECUTE')
 or not has_function_privilege('service_role',
    'public.admin_owner_funding_pulse_v1_245(uuid)','EXECUTE')
 then raise exception 'OWNER_PULSE_ACL_DRIFT' using errcode='42501';end if;
end;$acl$;