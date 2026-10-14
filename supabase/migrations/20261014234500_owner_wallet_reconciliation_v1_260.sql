-- TAMÃO V1.260 — reconcile wallet transactions with order reward grants
-- and redeemed cashback, without pretending fungible credits have lot provenance.
create schema if not exists platform_funding_private_v1_260;
revoke all on schema platform_funding_private_v1_260 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_260 to service_role;

create or replace function platform_funding_private_v1_260.reconcile(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $body$
declare
 v_month date:=coalesce(p_month,date_trunc('month',
   clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_start timestamptz;
 v_end timestamptz;
 v_grants jsonb;
 v_spend jsonb;
 v_flows jsonb;
 v_rows jsonb;
 v_total bigint;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','finance')
 ) then raise exception 'OWNER_WALLET_RECONCILIATION_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
   or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
    +interval '2 months')::date
 then raise exception 'OWNER_WALLET_RECONCILIATION_MONTH_INVALID' using errcode='22023';end if;
 v_start:=v_month::timestamp at time zone 'America/Sao_Paulo';
 v_end:=(v_month+interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

 -- Cohort reconciliation: a reward grant is backed only by exactly one
 -- wallet event of the correct type, user, order and amount.
 with cohort as (
   select g.order_id,g.customer_id,g.referrer_user_id,
     g.cashback_cents,g.referral_pending_cents
   from public.order_reward_grants g
   where g.created_at>=v_start and g.created_at<v_end
 ), lines as (
   select g.*,w.cash_count,w.cash_cents,w.cash_bad_users,
     w.ref_count,w.ref_cents,w.ref_bad_users,
     (g.cashback_cents=0 and w.cash_count=0 or
       g.cashback_cents>0 and w.cash_count=1 and
       w.cash_cents=g.cashback_cents and w.cash_bad_users=0) cash_ok,
     (g.referral_pending_cents=0 and w.ref_count=0 or
       g.referral_pending_cents>0 and g.referrer_user_id is not null
       and w.ref_count=1 and w.ref_cents=g.referral_pending_cents
       and w.ref_bad_users=0) ref_ok
   from cohort g
   cross join lateral (
     select count(*) filter(where e.entry_type='cashback_earn')::bigint cash_count,
      coalesce(sum(e.amount_cents) filter(where e.entry_type='cashback_earn'),0)::bigint cash_cents,
      count(*) filter(where e.entry_type='cashback_earn'
         and e.user_id is distinct from g.customer_id)::bigint cash_bad_users,
      count(*) filter(where e.entry_type='referral_pending')::bigint ref_count,
      coalesce(sum(e.amount_cents) filter(where e.entry_type='referral_pending'),0)::bigint ref_cents,
      count(*) filter(where e.entry_type='referral_pending'
         and e.user_id is distinct from g.referrer_user_id)::bigint ref_bad_users
     from public.wallet_entries e where e.order_id=g.order_id
       and e.entry_type in ('cashback_earn','referral_pending')
   )w
 )
 select jsonb_build_object(
  'grantOrders',count(*)::bigint,
  'cashbackExpectedCents',coalesce(sum(cashback_cents),0)::bigint,
  'cashbackMatchedCents',coalesce(sum(cashback_cents) filter(where cash_ok),0)::bigint,
  'cashbackUnmatchedCents',coalesce(sum(cashback_cents) filter(where not cash_ok),0)::bigint,
  'referralExpectedCents',coalesce(sum(referral_pending_cents),0)::bigint,
  'referralMatchedCents',coalesce(sum(referral_pending_cents) filter(where ref_ok),0)::bigint,
  'referralUnmatchedCents',coalesce(sum(referral_pending_cents) filter(where not ref_ok),0)::bigint,
  'cashbackMismatchOrders',count(*) filter(where not cash_ok)::bigint,
  'referralMismatchOrders',count(*) filter(where not ref_ok)::bigint
 ) into v_grants from lines;

 -- Redemption is verified only when an original cashback_reserve wallet entry
 -- agrees with the settled order and no cashback_release exists. Reservation
 -- may precede settlement month: do not filter wallet entries by event date.
 with settled as (
   select o.id,o.customer_id,o.cashback_reserved_cents
   from public.orders o
   where o.settled_at>=v_start and o.settled_at<v_end
     and o.status='SETTLED' and o.financial_state='settled'
     and o.financial_reversed_at is null
     and o.payment_confirmed_at is not null
     and o.cashback_reserved_cents>0
 ), lines as (
   select o.cashback_reserved_cents,w.reserve_count,w.reserve_cents,
     w.bad_users,w.release_count,w.release_cents,
     (w.reserve_count=1 and w.reserve_cents=o.cashback_reserved_cents
      and w.bad_users=0 and w.release_count=0) verified
   from settled o cross join lateral (
     select
       count(*) filter(where e.entry_type='cashback_reserve')::bigint reserve_count,
       coalesce(-sum(e.amount_cents) filter(where e.entry_type='cashback_reserve'),0)::bigint reserve_cents,
       count(*) filter(where e.user_id is distinct from o.customer_id)::bigint bad_users,
       count(*) filter(where e.entry_type='cashback_release')::bigint release_count,
       coalesce(sum(e.amount_cents) filter(where e.entry_type='cashback_release'),0)::bigint release_cents
     from public.wallet_entries e
     where e.order_id=o.id and e.entry_type in ('cashback_reserve','cashback_release')
   ) w
 )
 select jsonb_build_object(
   'settledOrdersWithCashback',count(*)::bigint,
   'reservedInSettledOrdersCents',coalesce(sum(cashback_reserved_cents),0)::bigint,
   'verifiedUseCents',coalesce(sum(cashback_reserved_cents) filter(where verified),0)::bigint,
   'unverifiedUseCents',coalesce(sum(cashback_reserved_cents) filter(where not verified),0)::bigint,
   'verifiedOrders',count(*) filter(where verified)::bigint,
   'unverifiedOrders',count(*) filter(where not verified)::bigint
 ) into v_spend from lines;

 -- Wallet movement totals are per event month. They are NOT a cash statement:
 -- cashback seeds are promotional credits, referral_available is an internal
 -- maturity transfer, cashback_release may be cancellation or refund.
 select jsonb_build_object(
   'seedIssuedCents',coalesce(sum(w.amount_cents) filter(where w.entry_type='cashback_seed'),0)::bigint,
   'cashbackEarnedEntriesCents',coalesce(sum(w.amount_cents) filter(where w.entry_type='cashback_earn'),0)::bigint,
   'cashbackReservedEntriesCents',coalesce(-sum(w.amount_cents) filter(where w.entry_type='cashback_reserve'),0)::bigint,
   'cashbackReleasedEntriesCents',coalesce(sum(w.amount_cents) filter(where w.entry_type='cashback_release'),0)::bigint,
   'cashbackReversedEntriesCents',coalesce(-sum(w.amount_cents) filter(where w.entry_type='cashback_reversal'),0)::bigint,
   'referralPendingEntriesCents',coalesce(sum(w.amount_cents) filter(where w.entry_type='referral_pending'),0)::bigint,
   'referralPendingReleasedEntriesCents',coalesce(-sum(w.amount_cents) filter(where w.entry_type='referral_pending_release'),0)::bigint,
   'referralAvailableEntriesCents',coalesce(sum(w.amount_cents) filter(where w.entry_type='referral_available'),0)::bigint,
   'referralReversedEntriesCents',coalesce(-sum(w.amount_cents) filter(where w.entry_type='referral_reversal'),0)::bigint
 ) into v_flows
 from public.wallet_entries w
 where w.created_at>=v_start and w.created_at<v_end;

 select count(*)::bigint into v_total
 from public.platform_owner_budget_allocations_v1_247 a where a.month_key=v_month;

 -- Campaign trace is an optional, non-causal association only. No personal
 -- identifiers or specific order IDs leave this aggregated report.
 with selected as (
  select a.allocation_id,a.benefit_key,a.month_key,
    a.campaign_reference,a.campaign_label,a.created_at
  from public.platform_owner_budget_allocations_v1_247 a
  where a.month_key=v_month
  order by a.created_at desc,a.allocation_id limit 50
 ), issue_lines as (
  select s.allocation_id,g.order_id,g.customer_id,g.referrer_user_id,
    g.cashback_cents,g.referral_pending_cents
  from selected s
  join public.platform_owner_campaign_order_attributions_v1_252 t
    on t.allocation_id=s.allocation_id
  join public.order_reward_grants g on g.order_id=t.order_id
    and g.created_at>=v_start and g.created_at<v_end
 ), verified as (
  select l.allocation_id,l.order_id,l.cashback_cents,l.referral_pending_cents,
   (l.cashback_cents=0 and w.cash_count=0 or
    l.cashback_cents>0 and w.cash_count=1 and
    w.cash_cents=l.cashback_cents and w.cash_bad=0) cash_ok,
   (l.referral_pending_cents=0 and w.ref_count=0 or
    l.referral_pending_cents>0 and l.referrer_user_id is not null
    and w.ref_count=1 and w.ref_cents=l.referral_pending_cents and w.ref_bad=0) ref_ok
  from issue_lines l cross join lateral (
    select count(*) filter(where e.entry_type='cashback_earn')::bigint cash_count,
      coalesce(sum(e.amount_cents) filter(where e.entry_type='cashback_earn'),0)::bigint cash_cents,
      count(*) filter(where e.entry_type='cashback_earn'
        and e.user_id is distinct from l.customer_id)::bigint cash_bad,
      count(*) filter(where e.entry_type='referral_pending')::bigint ref_count,
      coalesce(sum(e.amount_cents) filter(where e.entry_type='referral_pending'),0)::bigint ref_cents,
      count(*) filter(where e.entry_type='referral_pending'
        and e.user_id is distinct from l.referrer_user_id)::bigint ref_bad
    from public.wallet_entries e where e.order_id=l.order_id
      and e.entry_type in ('cashback_earn','referral_pending')
  )w
 ), grouped as (
  select s.allocation_id,
    count(v.order_id)::bigint traced_orders,
    coalesce(sum(v.cashback_cents) filter(where v.cash_ok),0)::bigint cash_matched,
    coalesce(sum(v.cashback_cents) filter(where not v.cash_ok),0)::bigint cash_unmatched,
    coalesce(sum(v.referral_pending_cents) filter(where v.ref_ok),0)::bigint ref_matched,
    coalesce(sum(v.referral_pending_cents) filter(where not v.ref_ok),0)::bigint ref_unmatched,
    count(v.order_id) filter(where not v.cash_ok or not v.ref_ok)::bigint mismatch_orders
  from selected s left join verified v on v.allocation_id=s.allocation_id
  group by s.allocation_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'allocationId',s.allocation_id,
  'campaignTag','tam-'||s.benefit_key||'-'||to_char(s.month_key,'YYYYMM')||'-'||s.campaign_reference,
  'campaignLabel',s.campaign_label,
  'tracedGrantOrders',g.traced_orders,
  'matchedCashbackIssueCents',g.cash_matched,
  'unmatchedCashbackIssueCents',g.cash_unmatched,
  'matchedReferralIssueCents',g.ref_matched,
  'unmatchedReferralIssueCents',g.ref_unmatched,
  'mismatchOrders',g.mismatch_orders
 ) order by s.created_at desc,s.allocation_id),'[]'::jsonb) into v_rows
 from selected s join grouped g on g.allocation_id=s.allocation_id;

 return jsonb_build_object(
  'source','admin_owner_wallet_reconciliation_v1_260',
  'month',v_month,'timezone','America/Sao_Paulo',
  'grantCohort',v_grants,'settledUse',v_spend,'walletEventFlows',v_flows,
  'totalCampaigns',v_total,'limit',50,'truncated',v_total>50,'rows',v_rows,
  'spentCreditLotAttribution','unavailable_fungible_wallet',
  'settledOrderMatchBasis','wallet_reservation_and_unreversed_settlement',
  'walletFlowsAreCashPayments',false,
  'externalPaidBenefitsCents',null,'externalPayoutMeasured',false,
  'campaignAttributionIsCausal',false,'bankSettlementVerified',false,
  'profitMeasured',false,'roiMeasured',false,
  'readOnly',true,'noTransfers',true,'newBenefitsEnabled',false
 );
end;$body$;
revoke all on function platform_funding_private_v1_260.reconcile(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_260.reconcile(uuid,date) to service_role;

create or replace function public.admin_owner_wallet_reconciliation_v1_260(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_260.reconcile($1,$2)
$wrap$;
revoke all on function public.admin_owner_wallet_reconciliation_v1_260(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_wallet_reconciliation_v1_260(uuid,date)
 to service_role;

do $acl$begin
 if has_function_privilege('anon','public.admin_owner_wallet_reconciliation_v1_260(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_wallet_reconciliation_v1_260(uuid,date)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_owner_wallet_reconciliation_v1_260(uuid,date)','EXECUTE')
 then raise exception 'OWNER_WALLET_RECONCILIATION_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
