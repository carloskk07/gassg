-- TAMÃO V1.266: privacy-preserving beneficiary receipt evidence gaps.
-- Read-only: maps existing owner claims, referral ledger, proof metadata, official GET observations.
-- Never upgrades an outgoing payout status to verified beneficiary/bank settlement.
create schema if not exists platform_recipient_proof_private_v1_266;
revoke all on schema platform_recipient_proof_private_v1_266 from public,anon,authenticated;
grant usage on schema platform_recipient_proof_private_v1_266 to service_role;

create or replace function platform_recipient_proof_private_v1_266.report(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare
 v_month date:=coalesce(p_month,
  date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_start date;
 v_end date;
 v_totals jsonb;
 v_rows jsonb;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','finance')
 ) then raise exception 'RECIPIENT_PROOF_ACCESS_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
  or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
    +interval '2 months')::date
 then raise exception 'RECIPIENT_PROOF_MONTH_INVALID' using errcode='22023';end if;
 v_start:=v_month;
 v_end:=(v_month+interval '1 month')::date;

 with claims as (
  select c.claim_id,c.order_id,c.beneficiary_user_id,
   c.amount_cents,c.provider,c.paid_on,c.provider_reference,
   c.reported_at, v.claim_id is not null voided,
   (g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id
     and g.referral_pending_cents=c.amount_cents
     and g.matured_at is not null and g.reversed_at is null) grant_valid,
   (g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id) internal_recipient_matches,
   p.claim_id is not null proof_attached,
   o.checked_at,
   (o.observation_id is not null) provider_observed,
   (o.observation_id is not null and o.provider_status='success'
      and o.status_detail='accredited'
      and o.reference_matches and o.amount_matches
      and o.provider_transaction_success
      and o.transaction_reference=c.provider_reference
      and o.amount_cents=c.amount_cents
      and o.claim_eligible_at_check) provider_matched_at_check,
   (
    g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id
    and e.bad_entries=0
    and e.pending_count=1 and e.pending_cents=c.amount_cents
    and e.release_count=1 and e.release_cents=c.amount_cents
    and e.available_count=1 and e.available_cents=c.amount_cents
    and e.reversal_count=0
   ) wallet_verified
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v
   on v.claim_id=c.claim_id
  left join public.order_reward_grants g
   on g.order_id=c.order_id
  left join public.platform_referral_payout_proofs_v1_264 p
   on p.claim_id=c.claim_id
  left join lateral (
   select o.* from public.platform_referral_provider_observations_v1_265 o
   where o.claim_id=c.claim_id
   order by o.checked_at desc,o.observation_id desc limit 1
  ) o on true
  cross join lateral (
   select
    count(*) filter(where w.user_id is distinct from c.beneficiary_user_id
      or (w.entry_type in ('referral_pending','referral_pending_release')
           and w.bucket<>'commission_pending')
      or (w.entry_type in ('referral_available','referral_reversal')
           and w.bucket<>'commission_available'))::bigint bad_entries,
    count(*) filter(where w.entry_type='referral_pending')::bigint pending_count,
    coalesce(sum(w.amount_cents) filter(
     where w.entry_type='referral_pending'),0)::bigint pending_cents,
    count(*) filter(where w.entry_type='referral_pending_release')::bigint release_count,
    coalesce(-sum(w.amount_cents) filter(
     where w.entry_type='referral_pending_release'),0)::bigint release_cents,
    count(*) filter(where w.entry_type='referral_available')::bigint available_count,
    coalesce(sum(w.amount_cents) filter(
     where w.entry_type='referral_available'),0)::bigint available_cents,
    count(*) filter(where w.entry_type='referral_reversal')::bigint reversal_count
   from public.wallet_entries w
   where w.order_id=c.order_id and
    w.entry_type in ('referral_pending','referral_pending_release',
                     'referral_available','referral_reversal')
  ) e
  where c.paid_on>=v_start and c.paid_on<v_end
 ), evaluated as (
  select *,
   (not voided and grant_valid and wallet_verified
     and provider='mercado_pago' and provider_matched_at_check) as provider_reconciled_now,
   (not voided and grant_valid and wallet_verified
     and provider='mercado_pago' and provider_matched_at_check
     and proof_attached) as ready_for_recipient_proof,
   array_remove(array[
     case when voided then 'claim_voided'::text end,
     case when not internal_recipient_matches then 'recipient_grant_identity_mismatch'::text end,
     case when not grant_valid then 'commission_not_currently_eligible'::text end,
     case when not wallet_verified then 'commission_wallet_not_reconciled'::text end,
     case when provider<>'mercado_pago' then 'outgoing_provider_not_supported'::text end,
     case when provider='mercado_pago' and not provider_observed
       then 'official_outgoing_transaction_not_queried'::text end,
     case when provider='mercado_pago' and provider_observed
           and not provider_matched_at_check
       then 'outgoing_transaction_status_or_reference_mismatch'::text end,
     case when not proof_attached then 'payout_document_missing'::text end,
     'recipient_destination_not_independently_verified'::text
   ],null::text) reasons
  from claims
 )
 select jsonb_build_object(
  'totalClaims',count(*)::bigint,
  'activeClaims',count(*) filter(where not voided)::bigint,
  'voidedClaims',count(*) filter(where voided)::bigint,
  'eligibleClaims',count(*) filter(where not voided and grant_valid)::bigint,
  'walletReconciledClaims',count(*) filter(where wallet_verified)::bigint,
  'internalIdentityMatches',count(*) filter(where internal_recipient_matches)::bigint,
  'documentedClaims',count(*) filter(where proof_attached)::bigint,
  'providerObservedClaims',count(*) filter(where provider_observed)::bigint,
  'providerReconciledClaims',count(*) filter(where provider_reconciled_now)::bigint,
  'readyForRecipientProof',count(*) filter(where ready_for_recipient_proof)::bigint,
  'beneficiaryVerifiedClaims',0,
  'bankSettlementVerifiedClaims',0
 ) into v_totals from evaluated;

 with claims as (
  select c.claim_id,c.order_id,c.beneficiary_user_id,
   c.amount_cents,c.provider,c.paid_on,c.provider_reference,c.reported_at,
   (v.claim_id is not null) voided,
   (g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id
     and g.referral_pending_cents=c.amount_cents
     and g.matured_at is not null and g.reversed_at is null) grant_valid,
   (g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id) internal_recipient_matches,
   (p.claim_id is not null) proof_attached,
   o.checked_at,(o.observation_id is not null) provider_observed,
   (o.observation_id is not null and o.provider_status='success'
      and o.status_detail='accredited'
      and o.reference_matches and o.amount_matches
      and o.provider_transaction_success
      and o.transaction_reference=c.provider_reference
      and o.amount_cents=c.amount_cents
      and o.claim_eligible_at_check) provider_matched_at_check,
   (g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id
     and e.bad_entries=0 and e.pending_count=1 and e.pending_cents=c.amount_cents
     and e.release_count=1 and e.release_cents=c.amount_cents
     and e.available_count=1 and e.available_cents=c.amount_cents
     and e.reversal_count=0) wallet_verified
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  left join public.platform_referral_payout_proofs_v1_264 p on p.claim_id=c.claim_id
  left join lateral (
   select o.* from public.platform_referral_provider_observations_v1_265 o
   where o.claim_id=c.claim_id order by o.checked_at desc,o.observation_id desc limit 1
  ) o on true
  cross join lateral (
   select
    count(*) filter(where w.user_id is distinct from c.beneficiary_user_id
     or (w.entry_type in ('referral_pending','referral_pending_release')
      and w.bucket<>'commission_pending')
     or (w.entry_type in ('referral_available','referral_reversal')
      and w.bucket<>'commission_available'))::bigint bad_entries,
    count(*) filter(where w.entry_type='referral_pending')::bigint pending_count,
    coalesce(sum(w.amount_cents) filter(where w.entry_type='referral_pending'),0)::bigint pending_cents,
    count(*) filter(where w.entry_type='referral_pending_release')::bigint release_count,
    coalesce(-sum(w.amount_cents) filter(where w.entry_type='referral_pending_release'),0)::bigint release_cents,
    count(*) filter(where w.entry_type='referral_available')::bigint available_count,
    coalesce(sum(w.amount_cents) filter(where w.entry_type='referral_available'),0)::bigint available_cents,
    count(*) filter(where w.entry_type='referral_reversal')::bigint reversal_count
   from public.wallet_entries w where w.order_id=c.order_id and
    w.entry_type in ('referral_pending','referral_pending_release',
                     'referral_available','referral_reversal')
  )e
  where c.paid_on>=v_start and c.paid_on<v_end
  order by c.reported_at desc,c.claim_id limit 50
 ), evaluated as (
  select *,
   (not voided and grant_valid and wallet_verified
     and provider='mercado_pago' and provider_matched_at_check) as provider_reconciled_now,
   (not voided and grant_valid and wallet_verified
     and provider='mercado_pago' and provider_matched_at_check and proof_attached)
     as ready_for_recipient_proof,
   array_remove(array[
    case when voided then 'claim_voided'::text end,
    case when not internal_recipient_matches then 'recipient_grant_identity_mismatch'::text end,
    case when not grant_valid then 'commission_not_currently_eligible'::text end,
    case when not wallet_verified then 'commission_wallet_not_reconciled'::text end,
    case when provider<>'mercado_pago' then 'outgoing_provider_not_supported'::text end,
    case when provider='mercado_pago' and not provider_observed
     then 'official_outgoing_transaction_not_queried'::text end,
    case when provider='mercado_pago' and provider_observed
       and not provider_matched_at_check
     then 'outgoing_transaction_status_or_reference_mismatch'::text end,
    case when not proof_attached then 'payout_document_missing'::text end,
    'recipient_destination_not_independently_verified'::text
   ],null::text) reasons
  from claims
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'claimId',claim_id,'amountCents',amount_cents,'provider',provider,
   'paidOn',paid_on,'voided',voided,'grantEligibleNow',grant_valid,
   'internalRecipientMatchesGrant',internal_recipient_matches,
   'walletVerified',wallet_verified,'proofAttached',proof_attached,
   'providerObserved',provider_observed,'providerMatchedNow',provider_reconciled_now,
   'readyForRecipientProof',ready_for_recipient_proof,
   'beneficiaryVerified',false,'bankSettlementVerified',false,
   'lastProviderCheckAt',checked_at,'missingEvidence',to_jsonb(reasons)
 ) order by reported_at desc,claim_id),'[]'::jsonb)
 into v_rows from evaluated;

 return jsonb_build_object(
  'source','admin_owner_recipient_evidence_gaps_v1_266',
  'month',v_month,'timezone','America/Sao_Paulo',
  'scope','owner_reported_referral_outgoing_claims',
  'totals',v_totals,'rows',v_rows,'limit',50,
  'truncated',(v_totals->>'totalClaims')::bigint>50,
  'destinationIdentityAvailableFromProvider',false,
  'recipientVerified',false,'bankSettlementVerified',false,
  'externalPaidBenefitsCents',null,'readOnly',true,
  'noTransfers',true,'noIdentityCollection',true,'newBenefitsEnabled',false
 );
end;$fn$;
revoke all on function platform_recipient_proof_private_v1_266.report(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_recipient_proof_private_v1_266.report(uuid,date)
 to service_role;
create or replace function public.admin_owner_recipient_evidence_gaps_v1_266(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrapper$
 select platform_recipient_proof_private_v1_266.report($1,$2)
$wrapper$;
revoke all on function public.admin_owner_recipient_evidence_gaps_v1_266(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_recipient_evidence_gaps_v1_266(uuid,date)
 to service_role;
do $acl$ begin
 if has_function_privilege('anon',
   'public.admin_owner_recipient_evidence_gaps_v1_266(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.admin_owner_recipient_evidence_gaps_v1_266(uuid,date)','EXECUTE')
 or not has_function_privilege('service_role',
   'public.admin_owner_recipient_evidence_gaps_v1_266(uuid,date)','EXECUTE')
 then raise exception 'RECIPIENT_EVIDENCE_ACL_DRIFT' using errcode='42501';end if;
end $acl$;