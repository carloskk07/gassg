-- TAMÃO V1.262 — reconcile referral commissions by originating order.
-- Existing order_reward_grants + wallet_entries are authoritative. No new
-- transfers, balances, payouts, approvals, disbursements or reward grants.
create schema if not exists platform_referral_trace_private_v1_262;
revoke all on schema platform_referral_trace_private_v1_262 from public,anon,authenticated;
grant usage on schema platform_referral_trace_private_v1_262 to service_role;

-- Distinguishes pre-maturity reversal from the similarly named internal
-- referral_pending_release generated during ordinary maturity.
create or replace function platform_referral_trace_private_v1_262.stage(
 p_matured_at timestamptz,p_reversed_at timestamptz
) returns text language sql immutable strict security invoker
set search_path=pg_catalog as $stage$
 select case
  when $2 is not null and $1 is null then 'reversed_before_maturity'
  when $2 is not null and $1 is not null then 'reversed_after_maturity'
  when $1 is not null then 'available'
  else 'pending'
 end
$stage$;
-- STRICT makes NULL arguments short circuit, so replace with non-strict.
create or replace function platform_referral_trace_private_v1_262.stage(
 p_matured_at timestamptz,p_reversed_at timestamptz
) returns text language sql immutable security invoker
set search_path=pg_catalog as $stage$
 select case
  when $2 is not null and $1 is null then 'reversed_before_maturity'
  when $2 is not null and $1 is not null then 'reversed_after_maturity'
  when $1 is not null then 'available'
  else 'pending'
 end
$stage$;
revoke all on function platform_referral_trace_private_v1_262.stage(timestamptz,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function platform_referral_trace_private_v1_262.stage(timestamptz,timestamptz) to service_role;

create or replace function platform_referral_trace_private_v1_262.report(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $body$
declare
 v_month date:=coalesce(p_month,
  date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_start timestamptz;
 v_end timestamptz;
 v_cohort jsonb;
 v_flows jsonb;
 v_rows jsonb;
 v_total bigint;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','finance')
 ) then raise exception 'OWNER_REFERRAL_TRACE_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
  or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
   + interval '2 months')::date
 then raise exception 'OWNER_REFERRAL_TRACE_MONTH_INVALID' using errcode='22023';end if;
 v_start:=v_month::timestamp at time zone 'America/Sao_Paulo';
 v_end:=(v_month+interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

 -- Issuance cohort: include rewards later matured or reversed. Stages are the
 -- CURRENT states of those originating grants (not events in the month).
 with cohort as (
  select g.order_id,g.referrer_user_id,g.referral_pending_cents as value_cents,
   g.created_at,g.matured_at,g.reversed_at
  from public.order_reward_grants g
  where g.created_at>=v_start and g.created_at<v_end
   and g.referral_pending_cents>0
 ), matched as (
  select g.*,
   platform_referral_trace_private_v1_262.stage(g.matured_at,g.reversed_at) as stage,
   (
    g.referrer_user_id is not null and e.invalid_users=0
    and e.pending_count=1 and e.pending_cents=g.value_cents
    and (
      (g.matured_at is null and g.reversed_at is null and
       e.release_count=0 and e.available_count=0 and e.reversal_count=0)
      or
      (g.matured_at is null and g.reversed_at is not null and
       e.release_count=1 and e.release_cents=g.value_cents and
       e.available_count=0 and e.reversal_count=0)
      or
      (g.matured_at is not null and g.reversed_at is null and
       e.release_count=1 and e.release_cents=g.value_cents and
       e.available_count=1 and e.available_cents=g.value_cents and
       e.reversal_count=0)
      or
      (g.matured_at is not null and g.reversed_at is not null and
       e.release_count=1 and e.release_cents=g.value_cents and
       e.available_count=1 and e.available_cents=g.value_cents and
       e.reversal_count=1 and e.reversal_cents=g.value_cents)
    )
   ) as verified
  from cohort g
  cross join lateral (
   select
    count(*) filter(where w.user_id is distinct from g.referrer_user_id
       or (w.entry_type in ('referral_pending','referral_pending_release')
            and w.bucket<>'commission_pending')
       or (w.entry_type in ('referral_available','referral_reversal')
            and w.bucket<>'commission_available'))::bigint invalid_users,
    count(*) filter(where w.entry_type='referral_pending')::bigint pending_count,
    coalesce(sum(w.amount_cents) filter(where w.entry_type='referral_pending'),0)::bigint pending_cents,
    count(*) filter(where w.entry_type='referral_pending_release')::bigint release_count,
    coalesce(-sum(w.amount_cents) filter(where w.entry_type='referral_pending_release'),0)::bigint release_cents,
    count(*) filter(where w.entry_type='referral_available')::bigint available_count,
    coalesce(sum(w.amount_cents) filter(where w.entry_type='referral_available'),0)::bigint available_cents,
    count(*) filter(where w.entry_type='referral_reversal')::bigint reversal_count,
    coalesce(-sum(w.amount_cents) filter(where w.entry_type='referral_reversal'),0)::bigint reversal_cents
   from public.wallet_entries w
   where w.order_id=g.order_id
    and w.entry_type in (
      'referral_pending','referral_pending_release','referral_available','referral_reversal')
  )e
 )
 select jsonb_build_object(
  'grantOrders',count(*)::bigint,
  'issuedCents',coalesce(sum(value_cents),0)::bigint,
  'verifiedLifecycleCents',coalesce(sum(value_cents) filter(where verified),0)::bigint,
  'unverifiedLifecycleCents',coalesce(sum(value_cents) filter(where not verified),0)::bigint,
  'verifiedOrders',count(*) filter(where verified)::bigint,
  'unverifiedOrders',count(*) filter(where not verified)::bigint,
  'pendingCents',coalesce(sum(value_cents) filter(where stage='pending'),0)::bigint,
  'availableCents',coalesce(sum(value_cents) filter(where stage='available'),0)::bigint,
  'verifiedAvailableCents',coalesce(sum(value_cents) filter(
    where stage='available' and verified),0)::bigint,
  'reversedBeforeMaturityCents',coalesce(sum(value_cents) filter(
    where stage='reversed_before_maturity'),0)::bigint,
  'reversedAfterMaturityCents',coalesce(sum(value_cents) filter(
    where stage='reversed_after_maturity'),0)::bigint,
  'pendingOrders',count(*) filter(where stage='pending')::bigint,
  'availableOrders',count(*) filter(where stage='available')::bigint,
  'reversedBeforeMaturityOrders',count(*) filter(
    where stage='reversed_before_maturity')::bigint,
  'reversedAfterMaturityOrders',count(*) filter(
    where stage='reversed_after_maturity')::bigint
 ) into v_cohort
 from matched;

 -- Calendar-month movements are distinct from the grant cohort above.
 -- pending_release may be maturity OR pre-maturity reversal. Never sum
 -- wallet events with grants to claim additional cash expenditure.
 select jsonb_build_object(
   'totalEvents',count(*)::bigint,
   'pendingCreatedCents',coalesce(sum(w.amount_cents) filter(
     where w.entry_type='referral_pending'),0)::bigint,
   'pendingReleasedCents',coalesce(-sum(w.amount_cents) filter(
     where w.entry_type='referral_pending_release'),0)::bigint,
   'availableCreatedCents',coalesce(sum(w.amount_cents) filter(
     where w.entry_type='referral_available'),0)::bigint,
   'availableReversedCents',coalesce(-sum(w.amount_cents) filter(
     where w.entry_type='referral_reversal'),0)::bigint,
   'eventsWithoutValidGrant',count(*) filter(
     where g.order_id is null or g.referrer_user_id is distinct from w.user_id
       or g.referral_pending_cents<=0)::bigint
 ) into v_flows
 from public.wallet_entries w
 left join public.order_reward_grants g on g.order_id=w.order_id
 where w.created_at>=v_start and w.created_at<v_end
  and w.entry_type in (
    'referral_pending','referral_pending_release','referral_available','referral_reversal');

 select count(*)::bigint into v_total
 from public.platform_owner_budget_allocations_v1_247 a where a.month_key=v_month;
 with selected as (
  select a.allocation_id,a.benefit_key,a.month_key,a.campaign_reference,
    a.campaign_label,a.created_at
  from public.platform_owner_budget_allocations_v1_247 a
  where a.month_key=v_month
  order by a.created_at desc,a.allocation_id limit 50
 ), campaign_grants as (
  select s.allocation_id,
   count(g.order_id)::bigint grant_orders,
   coalesce(sum(g.referral_pending_cents),0)::bigint issued,
   coalesce(sum(g.referral_pending_cents) filter(
    where g.matured_at is null and g.reversed_at is null),0)::bigint pending,
   coalesce(sum(g.referral_pending_cents) filter(
    where g.matured_at is not null and g.reversed_at is null),0)::bigint available,
   coalesce(sum(g.referral_pending_cents) filter(
    where g.reversed_at is not null),0)::bigint reversed
  from selected s
  left join public.platform_owner_campaign_order_attributions_v1_252 att
   on att.allocation_id=s.allocation_id
  left join public.order_reward_grants g on g.order_id=att.order_id
   and g.created_at>=v_start and g.created_at<v_end
   and g.referral_pending_cents>0
  group by s.allocation_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'allocationId',s.allocation_id,
  'campaignTag','tam-'||s.benefit_key||'-'||to_char(s.month_key,'YYYYMM')||'-'||s.campaign_reference,
  'campaignLabel',s.campaign_label,
  'referralGrantOrders',c.grant_orders,
  'referralIssuedCents',c.issued,
  'referralPendingCents',c.pending,
  'referralAvailableCents',c.available,
  'referralReversedCents',c.reversed
 ) order by s.created_at desc,s.allocation_id),'[]'::jsonb)
 into v_rows from selected s join campaign_grants c on c.allocation_id=s.allocation_id;

 return jsonb_build_object(
  'source','admin_owner_referral_lifecycle_v1_262',
  'month',v_month,'timezone','America/Sao_Paulo',
  'cohort',v_cohort,'walletEventFlows',v_flows,
  'totalCampaigns',v_total,'limit',50,'truncated',v_total>50,'rows',v_rows,
  'issuerOrderTraceAvailable',true,
  'pendingReleaseIsAmbiguousWithoutGrantState',true,
  'cohortStagesCurrentNotHistorical',true,
  'walletFlowsAreCashPayments',false,
  'externalPaidReferralCents',null,'externalPayoutMeasured',false,
  'campaignAttributionIsCausal',false,'bankSettlementVerified',false,
  'profitMeasured',false,'roiMeasured',false,
  'newBenefitsEnabled',false,'noTransfers',true,'readOnly',true
 );
end;$body$;
revoke all on function platform_referral_trace_private_v1_262.report(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_referral_trace_private_v1_262.report(uuid,date)
 to service_role;

create or replace function public.admin_owner_referral_lifecycle_v1_262(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrapper$
 select platform_referral_trace_private_v1_262.report($1,$2)
$wrapper$;
revoke all on function public.admin_owner_referral_lifecycle_v1_262(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_referral_lifecycle_v1_262(uuid,date)
 to service_role;
do $acl$ begin
 if has_function_privilege('anon',
   'public.admin_owner_referral_lifecycle_v1_262(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.admin_owner_referral_lifecycle_v1_262(uuid,date)','EXECUTE')
 or not has_function_privilege('service_role',
   'public.admin_owner_referral_lifecycle_v1_262(uuid,date)','EXECUTE')
 then raise exception 'OWNER_REFERRAL_TRACE_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
