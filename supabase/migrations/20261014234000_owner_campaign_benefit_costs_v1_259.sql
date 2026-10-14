-- TAMÃO V1.259 — benefit issuance, reversal and observed use without false payout claims.
-- Independent sources: monthly issuance cohort, order settlement activity, and
-- UTM campaign linkage. These dimensions MUST NOT be added to each other.
create schema if not exists platform_funding_private_v1_259;
revoke all on schema platform_funding_private_v1_259 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_259 to service_role;

create or replace function platform_funding_private_v1_259.benefit_costs(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare
 v_month date:=coalesce(p_month,
  date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_start timestamptz;
 v_end timestamptz;
 v_total bigint;
 v_cash_granted bigint;
 v_cash_reversed bigint;
 v_ref_granted bigint;
 v_ref_reversed bigint;
 v_cash_used bigint;
 v_ref_available bigint;
 v_ref_available_reversed bigint;
 v_rows jsonb;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'OWNER_BENEFIT_COSTS_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
    or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
         +interval '2 months')::date
 then raise exception 'OWNER_BENEFIT_COSTS_MONTH_INVALID' using errcode='22023';end if;
 v_start:=v_month::timestamp at time zone 'America/Sao_Paulo';
 v_end:=(v_month+interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

 -- Cohort = grants CREATED within this month, including ones reversed later.
 select coalesce(sum(g.cashback_cents),0)::bigint,
  coalesce(sum(g.cashback_cents) filter(where g.reversed_at is not null),0)::bigint,
  coalesce(sum(g.referral_pending_cents),0)::bigint,
  coalesce(sum(g.referral_pending_cents) filter(where g.reversed_at is not null),0)::bigint
 into v_cash_granted,v_cash_reversed,v_ref_granted,v_ref_reversed
 from public.order_reward_grants g
 where g.created_at>=v_start and g.created_at<v_end;

 -- Usage is not tied to the issuance cohort. Only CURRENTLY settled orders
 -- with payment confirmed; reversed orders cannot count as spent credit.
 select coalesce(sum(o.cashback_reserved_cents),0)::bigint into v_cash_used
 from public.orders o
 where o.settled_at>=v_start and o.settled_at<v_end
  and o.status='SETTLED' and o.financial_state='settled'
  and o.payment_confirmed_at is not null;

 -- Wallet maturity is a transfer between internal buckets, NOT a payout.
 select
   coalesce(sum(w.amount_cents) filter(where w.entry_type='referral_available'),0)::bigint,
   coalesce(-sum(w.amount_cents) filter(where w.entry_type='referral_reversal'),0)::bigint
 into v_ref_available,v_ref_available_reversed
 from public.wallet_entries w
 where w.created_at>=v_start and w.created_at<v_end;

 select count(*)::bigint into v_total
 from public.platform_owner_budget_allocations_v1_247 a
 where a.month_key=v_month;

 -- Attribution describes orders whose checkout carried a validated campaign tag.
 -- It does not establish incremental sales or funding responsibility.
 with selected as (
   select a.allocation_id,a.benefit_key,a.campaign_label,a.campaign_reference,
    a.month_key,a.amount_cents,a.created_at
   from public.platform_owner_budget_allocations_v1_247 a
   where a.month_key=v_month
   order by a.created_at desc,a.allocation_id limit 50
 ), campaign_grants as (
   select s.allocation_id,
     count(g.order_id)::bigint as grant_count,
     coalesce(sum(g.cashback_cents),0)::bigint as cash_granted,
     coalesce(sum(g.cashback_cents) filter(where g.reversed_at is not null),0)::bigint as cash_reversed,
     coalesce(sum(g.referral_pending_cents),0)::bigint as ref_granted,
     coalesce(sum(g.referral_pending_cents) filter(where g.reversed_at is not null),0)::bigint as ref_reversed
   from selected s
   left join public.platform_owner_campaign_order_attributions_v1_252 att
      on att.allocation_id=s.allocation_id
   left join public.order_reward_grants g
      on g.order_id=att.order_id and g.created_at>=v_start and g.created_at<v_end
   group by s.allocation_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'allocationId',s.allocation_id,
  'campaignTag','tam-'||s.benefit_key||'-'||to_char(s.month_key,'YYYYMM')||'-'||s.campaign_reference,
  'campaignLabel',s.campaign_label,
  'benefitKey',s.benefit_key,
  'plannedIncentiveBudgetCents',s.amount_cents,
  'attributedGrantOrders',c.grant_count,
  'cashbackGrantedCents',c.cash_granted,
  'cashbackReversedCents',c.cash_reversed,
  'cashbackNetGrantedCents',c.cash_granted-c.cash_reversed,
  'referralGrantedCents',c.ref_granted,
  'referralReversedCents',c.ref_reversed,
  'referralNetGrantedCents',c.ref_granted-c.ref_reversed
 )order by s.created_at desc,s.allocation_id),'[]'::jsonb)
 into v_rows
 from selected s join campaign_grants c on c.allocation_id=s.allocation_id;

 return jsonb_build_object(
   'source','admin_owner_campaign_benefit_costs_v1_259',
   'month',v_month,'timezone','America/Sao_Paulo',
   'totalCampaigns',v_total,'limit',50,'truncated',v_total>50,
   'rows',v_rows,
   'cashbackGrantedCents',v_cash_granted,
   'cashbackReversedCents',v_cash_reversed,
   'cashbackNetGrantedCents',v_cash_granted-v_cash_reversed,
   'referralGrantedCents',v_ref_granted,
   'referralReversedCents',v_ref_reversed,
   'referralNetGrantedCents',v_ref_granted-v_ref_reversed,
   'cashbackUsedInSettledOrdersCents',v_cash_used,
   'referralMovedToAvailableCents',v_ref_available,
   'referralAvailableReversedCents',v_ref_available_reversed,
   'merchantReferralPaidCents',null,
   'clubeCouponPaidCents',null,
   'externalPaidBenefitsCents',null,
   'externalPayoutMeasured',false,
   'benefitsUsedAreIssuanceCohort',false,
   'metricMeaning','grant_cohort_vs_settlement_activity_non_causal',
   'campaignAttributionIsCausal',false,
   'bankSettlementVerified',false,
   'profitMeasured',false,'roiMeasured',false,
   'newBenefitsEnabled',false,'noTransfers',true,'readOnly',true
 );
end;$fn$;

revoke all on function platform_funding_private_v1_259.benefit_costs(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_259.benefit_costs(uuid,date)
 to service_role;
create or replace function public.admin_owner_campaign_benefit_costs_v1_259(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrapper$
 select platform_funding_private_v1_259.benefit_costs($1,$2)
$wrapper$;
revoke all on function public.admin_owner_campaign_benefit_costs_v1_259(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_campaign_benefit_costs_v1_259(uuid,date)
 to service_role;

do $acl$ begin
 if has_function_privilege('anon',
  'public.admin_owner_campaign_benefit_costs_v1_259(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated',
  'public.admin_owner_campaign_benefit_costs_v1_259(uuid,date)','EXECUTE')
 or not has_function_privilege('service_role',
  'public.admin_owner_campaign_benefit_costs_v1_259(uuid,date)','EXECUTE')
 then raise exception 'OWNER_BENEFIT_COSTS_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
