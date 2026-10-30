-- TAMÃO #493: external payout provider reconciliation must use the SAME
-- order/paid-platform-fee gates as V1.493 referral owner declarations.
-- Existing immutable provider observations still record adverse evidence:
-- invalidated funding changes eligibleNow/providerTransactionSuccess to FALSE,
-- it does NOT delete prior observations or declare an external refund.
-- Preserve all V1.334-V1.345 read metrics, pagination and priority ordering.
-- These exact 3 function bodies are derived from current production, with
-- only matching eligibility joins/predicates added. No table changes or transfers.

-- Existing read RPC, eligibility hardened
CREATE OR REPLACE FUNCTION platform_payout_provider_private_v1_265.read(p_actor uuid, p_month date DEFAULT NULL::date)
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
     and g.referral_pending_cents=c.amount_cents
     and sale.status='SETTLED' and sale.financial_state='settled'
     and sale.financial_reversed_at is null and sale.payment_confirmed_at is not null
     and fee.status='paid' and fee.paid_at is not null
     and fee.platform_fee_cents>0 as success_now,
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
  left join public.orders sale on sale.id=c.order_id
  left join public.platform_receivables fee on fee.order_id=c.order_id
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
     and g.referral_pending_cents=c.amount_cents
     and sale.status='SETTLED' and sale.financial_state='settled'
     and sale.financial_reversed_at is null and sale.payment_confirmed_at is not null
     and fee.status='paid' and fee.paid_at is not null
     and fee.platform_fee_cents>0 as success_now,
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
  left join public.orders sale on sale.id=c.order_id
  left join public.platform_receivables fee on fee.order_id=c.order_id
  left join public.platform_referral_payout_proofs_v1_264 p on p.claim_id=c.claim_id
  left join lateral (
   select x.* from public.platform_referral_provider_observations_v1_265 x
    where x.claim_id=c.claim_id order by x.checked_at desc,x.observation_id desc limit 1
  ) o on true
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
  order by priority,c.reported_at desc,c.claim_id limit 30
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
  'triageV1335',true,'queueOrder','priority_then_reported_at',
  'queueCoverage','top_30_prioritized',
  'provider','mercado_pago_payouts_get','bankSettlementVerified',false,
  'recipientVerified',false,'providerTransactionIsBeneficiaryProof',false,
  'externalPaidBenefitsCents',null,'readOnly',true,'noTransfers',true
 );
end;$function$;

-- Existing record RPC, eligibility hardened
CREATE OR REPLACE FUNCTION platform_payout_provider_private_v1_265.record(p_actor uuid, p_claim uuid, p_payout text, p_transaction text, p_reference text, p_amount bigint, p_status text, p_detail text, p_updated timestamp with time zone, p_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v public.platform_referral_payout_claims_v1_263%rowtype;
v_active boolean;v_eligible boolean;v_ref boolean;v_amt boolean;v_success boolean;
v_id uuid;
begin
 perform platform_referral_payout_private_v1_263.assert_owner(p_actor);
 if p_claim is null or p_payout !~ '^POP[0-9A-Z]{10,45}$'
  or p_transaction !~ '^TOP[0-9A-Z]{10,45}$'
  or p_reference is null or length(p_reference) not between 8 and 120
  or p_amount is null or p_amount<0 or p_amount>100000000
  or p_status not in ('created','approved','pending','in_process',
    'success','error','canceled','unknown')
  or p_detail is null or length(p_detail)>100
  or p_digest !~ '^[0-9a-f]{64}$'
  or p_updated is null or p_updated>clock_timestamp()+interval '5 minutes'
 then raise exception 'PAYOUT_PROVIDER_INVALID' using errcode='22023';end if;
 -- Serialize by transaction and refuse reuse of one payout transaction as
 -- evidence on multiple independent claims.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'outbound-payout-provider-v1_265:'||p_payout||':'||p_transaction,0));
 if exists(select 1 from public.platform_referral_provider_observations_v1_265 o
  where o.payout_id=p_payout and o.transaction_id=p_transaction
   and o.claim_id<>p_claim)
 then raise exception 'PAYOUT_PROVIDER_TRANSACTION_REUSED' using errcode='23505';end if;
 select * into v from public.platform_referral_payout_claims_v1_263
  where claim_id=p_claim for share;
 if not found or v.provider<>'mercado_pago' then
  raise exception 'PAYOUT_PROVIDER_UNSUPPORTED_CLAIM' using errcode='22023';end if;
 select not exists(select 1 from public.platform_referral_payout_voids_v1_263
  where claim_id=p_claim) into v_active;
 select exists(
  select 1 from public.order_reward_grants g
  join public.orders sale on sale.id=g.order_id
  join public.platform_receivables fee on fee.order_id=g.order_id
  where g.order_id=v.order_id and g.referrer_user_id=v.beneficiary_user_id
   and g.referral_pending_cents=v.amount_cents
   and g.matured_at is not null and g.reversed_at is null
   and sale.status='SETTLED' and sale.financial_state='settled'
   and sale.financial_reversed_at is null and sale.payment_confirmed_at is not null
   and fee.status='paid' and fee.paid_at is not null
   and fee.platform_fee_cents>0
 ) into v_eligible;
 v_ref:=p_reference=v.provider_reference;
 v_amt:=p_amount=v.amount_cents;
 v_success:=p_status='success' and p_detail='accredited' and v_ref and v_amt
   and v_active and v_eligible;
 insert into public.platform_referral_provider_observations_v1_265(
  claim_id,payout_id,transaction_id,transaction_reference,provider_status,status_detail,
  amount_cents,provider_updated_at,response_sha256,reference_matches,
  amount_matches,claim_eligible_at_check,provider_transaction_success,checked_by)
 values(p_claim,p_payout,p_transaction,p_reference,p_status,p_detail,p_amount,
  p_updated,p_digest,v_ref,v_amt,v_active and v_eligible,v_success,p_actor)
 on conflict(claim_id,payout_id,transaction_id,response_sha256)
 do nothing returning observation_id into v_id;
 if v_id is null then
  select observation_id into v_id from public.platform_referral_provider_observations_v1_265
   where claim_id=p_claim and payout_id=p_payout and transaction_id=p_transaction
    and response_sha256=p_digest;
 end if;
 return jsonb_build_object('source','owner_payout_provider_observation_v1_265',
  'observationId',v_id,'claimId',p_claim,'status',p_status,
  'statusDetail',p_detail,'referenceMatches',v_ref,'amountMatches',v_amt,
  'eligibleNow',v_active and v_eligible,'providerTransactionSuccess',v_success,
  'recipientVerified',false,'bankSettlementVerified',false,'transferExecuted',false);
end;$function$;

-- Existing target RPC, eligibility hardened
CREATE OR REPLACE FUNCTION platform_payout_provider_private_v1_265.target(p_actor uuid, p_claim uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v public.platform_referral_payout_claims_v1_263%rowtype;
v_active boolean;v_eligible boolean;
begin
 perform platform_referral_payout_private_v1_263.assert_owner(p_actor);
 select * into v from public.platform_referral_payout_claims_v1_263
  where claim_id=p_claim;
 if not found then raise exception 'PAYOUT_PROVIDER_CLAIM_NOT_FOUND' using errcode='P0002';end if;
 select not exists(select 1 from public.platform_referral_payout_voids_v1_263
  where claim_id=p_claim) into v_active;
 select exists(
  select 1 from public.order_reward_grants g
  join public.orders sale on sale.id=g.order_id
  join public.platform_receivables fee on fee.order_id=g.order_id
  where g.order_id=v.order_id and g.referrer_user_id=v.beneficiary_user_id
   and g.referral_pending_cents=v.amount_cents
   and g.matured_at is not null and g.reversed_at is null
   and sale.status='SETTLED' and sale.financial_state='settled'
   and sale.financial_reversed_at is null and sale.payment_confirmed_at is not null
   and fee.status='paid' and fee.paid_at is not null
   and fee.platform_fee_cents>0
 ) into v_eligible;
 return jsonb_build_object('source','owner_payout_provider_target_v1_265',
  'claimId',p_claim,'provider',v.provider,
  'reference',v.provider_reference,'amountCents',v.amount_cents,
  'active',v_active,'eligible',v_eligible,
  'bankVerified',false,'recipientVerified',false);
end;$function$;

-- Supabase defaults on function CREATE OR REPLACE must never relax ACL.
revoke all on function platform_payout_provider_private_v1_265.target(uuid,uuid)
 from public,anon,authenticated;
revoke all on function platform_payout_provider_private_v1_265.record(
 uuid,uuid,text,text,text,bigint,text,text,timestamptz,text)
 from public,anon,authenticated;
revoke all on function platform_payout_provider_private_v1_265.read(uuid,date)
 from public,anon,authenticated;
grant execute on function platform_payout_provider_private_v1_265.target(uuid,uuid) to service_role;
grant execute on function platform_payout_provider_private_v1_265.record(
 uuid,uuid,text,text,text,bigint,text,text,timestamptz,text) to service_role;
grant execute on function platform_payout_provider_private_v1_265.read(uuid,date) to service_role;
