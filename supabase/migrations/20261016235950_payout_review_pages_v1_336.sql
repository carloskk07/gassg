-- TAMÃO V1.336: explicit read-only pagination for referral payout review.
-- Original V1.335 query and monthly aggregate totals are preserved.
-- Public wrapper is strictly service_role only, with actor verification inside RPC.
CREATE OR REPLACE FUNCTION platform_payout_provider_private_v1_265.read_page(p_actor uuid, p_month date DEFAULT NULL::date, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_month date:=coalesce(p_month,date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_rows jsonb;v_total bigint;v_checked bigint;v_success bigint;v_unmatched bigint;
 v_reversed_active bigint;v_reversed_active_cents bigint;
 v_prior_success_reversed bigint;v_prior_success_reversed_active bigint;
begin
 if p_offset is null or p_offset<0 or p_offset>999990 or p_offset%30<>0
 then raise exception 'PAYOUT_PAGE_INVALID' using errcode='22023';end if;
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'PAYOUT_PROVIDER_READ_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
  or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
    +interval '2 months')::date
 then raise exception 'PAYOUT_PROVIDER_MONTH_INVALID' using errcode='22023';end if;
 with claims as (
  select c.claim_id,c.reported_at,c.amount_cents,v.claim_id is not null voided,
   o.provider_status,o.status_detail,o.reference_matches,o.amount_matches,
   o.provider_transaction_success,o.checked_at,
   o.payout_id,o.transaction_id,
   coalesce(o.provider_transaction_success,false) and v.claim_id is null
     and g.reversed_at is null and g.matured_at is not null
     and g.referrer_user_id=c.beneficiary_user_id
     and g.referral_pending_cents=c.amount_cents as success_now,
   p.claim_id is not null proof_present,
   g.reversed_at is not null as grant_reversed,
   exists(
     select 1 from public.platform_referral_provider_observations_v1_265 historical
     where historical.claim_id=c.claim_id
       and historical.provider_transaction_success is true
   ) as prior_provider_success_observed
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  left join public.platform_referral_payout_proofs_v1_264 p on p.claim_id=c.claim_id
  left join lateral (
   select x.* from public.platform_referral_provider_observations_v1_265 x
    where x.claim_id=c.claim_id order by x.checked_at desc,x.observation_id desc limit 1
  ) o on true
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
 )
 select count(*)::bigint,
  count(*) filter(where checked_at is not null)::bigint,
  count(*) filter(where success_now)::bigint,
  count(*) filter(where checked_at is not null and not success_now)::bigint,
  count(*) filter(where grant_reversed and not voided)::bigint,
  coalesce(sum(amount_cents) filter(where grant_reversed and not voided),0)::bigint,
  count(*) filter(where grant_reversed and prior_provider_success_observed)::bigint,
  count(*) filter(where grant_reversed and prior_provider_success_observed and not voided)::bigint
 into v_total,v_checked,v_success,v_unmatched,
   v_reversed_active,v_reversed_active_cents,
   v_prior_success_reversed,v_prior_success_reversed_active from claims;
 with selected as (
  select c.claim_id,c.order_id,c.paid_on,c.reported_at,c.amount_cents,v.claim_id is not null voided,
   o.provider_status,o.status_detail,o.reference_matches,o.amount_matches,
   o.provider_transaction_success,o.checked_at,
   o.payout_id,o.transaction_id,
   coalesce(o.provider_transaction_success,false) and v.claim_id is null
     and g.reversed_at is null and g.matured_at is not null
     and g.referrer_user_id=c.beneficiary_user_id
     and g.referral_pending_cents=c.amount_cents as success_now,
   p.claim_id is not null proof_present,
   g.reversed_at is not null as grant_reversed,
   exists(
     select 1 from public.platform_referral_provider_observations_v1_265 historical
     where historical.claim_id=c.claim_id
       and historical.provider_transaction_success is true
   ) as prior_provider_success_observed,
   case
    when g.reversed_at is not null and v.claim_id is null
      and exists(select 1 from public.platform_referral_provider_observations_v1_265 history
                 where history.claim_id=c.claim_id and history.provider_transaction_success is true)
      then 0
    when g.reversed_at is not null and v.claim_id is null then 1
    when v.claim_id is null and o.checked_at is not null
      and (o.reference_matches is not true or o.amount_matches is not true) then 2
    when v.claim_id is null and o.checked_at is null then 3
    when v.claim_id is null and p.claim_id is null then 4
    else 5
   end as priority
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  left join public.platform_referral_payout_proofs_v1_264 p on p.claim_id=c.claim_id
  left join lateral (
   select x.* from public.platform_referral_provider_observations_v1_265 x
    where x.claim_id=c.claim_id order by x.checked_at desc,x.observation_id desc limit 1
  ) o on true
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
  order by priority,c.reported_at desc,c.claim_id limit 30 offset p_offset
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'claimId',claim_id,'orderId',order_id,'reportedAmountCents',amount_cents,
  'paidOn',paid_on,'reportedAt',reported_at,'priority',priority,
  'checkedAt',checked_at,
  'status',provider_status,'detail',status_detail,
  'referenceMatches',reference_matches,'amountMatches',amount_matches,
  'successNow',success_now,'proofPresent',proof_present,
  'voided',voided,'payoutId',payout_id,'transactionId',transaction_id,
  'grantReversedNow',grant_reversed,
  'historicalProviderSuccessObserved',prior_provider_success_observed,
  'requiresReversalReview',
    grant_reversed and prior_provider_success_observed and not voided
 )order by priority,reported_at desc,claim_id),'[]'::jsonb) into v_rows from selected;
 return jsonb_build_object(
  'source','owner_payout_provider_reconciliation_v1_265',
  'month',v_month,'timezone','America/Sao_Paulo','totalClaims',v_total,
  'checkedClaims',v_checked,'providerSuccessClaims',v_success,
  'checkedUnmatchedClaims',v_unmatched,'unqueriedClaims',v_total-v_checked,
  'activeReversedClaims',v_reversed_active,
  'activeReversedReportedCents',v_reversed_active_cents,
  'reversedWithHistoricalProviderSuccessClaims',v_prior_success_reversed,
  'activeReversedWithHistoricalProviderSuccessClaims',v_prior_success_reversed_active,
  'historicalProviderSuccessIsBankProof',false,
  'automaticRecoveryExecuted',false,
  'limit',30,'truncated',v_total>30,'rows',v_rows,
  'triageV1335',true,'triageV1336',true,
  'pageOffset',p_offset,'pageLimit',30,
  'hasPrevious',p_offset>0,
  'hasMore',p_offset+jsonb_array_length(v_rows)<v_total,
  'queueOrder','priority_then_reported_at',
  'queueCoverage','paginated_30_prioritized',
  'provider','mercado_pago_payouts_get','bankSettlementVerified',false,
  'recipientVerified',false,'providerTransactionIsBeneficiaryProof',false,
  'externalPaidBenefitsCents',null,'readOnly',true,'noTransfers',true
 );
end;$function$;

create or replace function public.admin_owner_payout_provider_page_v1_336(
 p_actor uuid,p_month date,p_offset integer
) returns jsonb
language sql stable security definer
set search_path to 'pg_catalog'
as $wrapper$
 select platform_payout_provider_private_v1_265.read_page(p_actor,p_month,p_offset);
$wrapper$;
revoke all on function platform_payout_provider_private_v1_265.read_page(uuid,date,integer) from public,anon,authenticated;
revoke all on function public.admin_owner_payout_provider_page_v1_336(uuid,date,integer) from public,anon,authenticated;
grant execute on function public.admin_owner_payout_provider_page_v1_336(uuid,date,integer) to service_role;
notify pgrst,'reload schema';
