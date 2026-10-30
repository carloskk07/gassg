-- TAMÃO #493: prevent external payout *declarations* when a matured
-- referral is no longer backed by a settled, unreversed order and a paid
-- platform receivable. Existing claim/void tables, protected RPCs, owner
-- authorization, no real transfer, and bank-proof flags are unchanged.
-- Original functions come from migration V1.263; only eligibility guards
-- and matching read-side eligibility were added. All historical records
-- remain intact. Atomic read locks prevent concurrent reversal from
-- creating a new claim against an already invalidated economic event.
create or replace function platform_referral_payout_private_v1_263.record_claim(
 p_actor uuid,p_order_id uuid,p_amount_cents bigint,p_provider text,
 p_reference text,p_paid_on date,p_proof_sha256 text default null
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare
 v_grant public.order_reward_grants%rowtype;
 v_order public.orders%rowtype;
 v_receivable public.platform_receivables%rowtype;
 v_prior public.platform_referral_payout_claims_v1_263%rowtype;
 v_claim_id uuid;
 v_digest text:=nullif(lower(trim(coalesce(p_proof_sha256,''))),'');
begin
 perform platform_referral_payout_private_v1_263.assert_owner(p_actor);
 if p_order_id is null or p_amount_cents is null or p_amount_cents<=0
    or p_amount_cents>100000000
    or p_provider not in ('pix','bank_transfer','mercado_pago','other')
    or p_reference is null or p_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
    or p_paid_on is null or p_paid_on> (clock_timestamp() at time zone 'America/Sao_Paulo')::date
    or p_paid_on<date '2026-01-01'
    or (v_digest is not null and v_digest !~ '^[0-9a-f]{64}$')
 then raise exception 'PAYOUT_CLAIM_INVALID' using errcode='22023';end if;

 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('benefit-payout-claim:'||p_order_id::text,0));

 -- Acquire the order first, matching the settlement/reversal lock order.
 -- Matured wallet state alone is NOT proof that its originating sale and
 -- TAMÃO fee still support a beneficiary payout declaration.
 select * into v_order from public.orders
  where id=p_order_id for share;
 if not found or v_order.status<>'SETTLED'
   or v_order.financial_state<>'settled'
   or v_order.financial_reversed_at is not null
   or v_order.payment_confirmed_at is null
 then raise exception 'PAYOUT_GRANT_NOT_ELIGIBLE' using errcode='22023';end if;

 select * into v_grant from public.order_reward_grants
  where order_id=p_order_id for share;
 if not found or v_grant.referrer_user_id is null
   or v_grant.referral_pending_cents<=0 or v_grant.matured_at is null
   or v_grant.reversed_at is not null
   or p_amount_cents<>v_grant.referral_pending_cents
   or p_paid_on<(v_grant.matured_at at time zone 'America/Sao_Paulo')::date
 then raise exception 'PAYOUT_GRANT_NOT_ELIGIBLE' using errcode='22023';end if;

 -- A cash-on-delivery attestation can settle an order while TAMÃO's fee
 -- remains an OPEN receivable. Never declare a payout on that unpaid fee,
 -- including if an already-matured grant has drifted out of coverage.
 select * into v_receivable from public.platform_receivables
  where order_id=p_order_id for share;
 if not found or v_receivable.status<>'paid'
   or v_receivable.paid_at is null
   or v_receivable.platform_fee_cents<=0
 then raise exception 'PAYOUT_GRANT_NOT_ELIGIBLE' using errcode='22023';end if;

 -- Never register more than one currently active claim against a grant.
 select c.* into v_prior from public.platform_referral_payout_claims_v1_263 c
 left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
 where c.order_id=p_order_id and v.claim_id is null
 order by c.reported_at desc limit 1;
 if found then
  if v_prior.amount_cents=p_amount_cents and v_prior.provider=p_provider
     and v_prior.provider_reference=p_reference and v_prior.paid_on=p_paid_on
     and v_prior.proof_sha256 is not distinct from v_digest then
   return jsonb_build_object('source','admin_owner_referral_payout_claim_v1_263',
    'claimId',v_prior.claim_id,'alreadyRecorded',true,
    'bankVerified',false,'transferExecuted',false);
  end if;
  raise exception 'PAYOUT_ACTIVE_CLAIM_EXISTS' using errcode='23505';
 end if;
 if exists(select 1 from public.platform_referral_payout_claims_v1_263 c
   where c.provider=p_provider and c.provider_reference=p_reference)
 then raise exception 'PAYOUT_REFERENCE_ALREADY_USED' using errcode='23505';end if;

 insert into public.platform_referral_payout_claims_v1_263(
  order_id,beneficiary_user_id,amount_cents,provider,provider_reference,
  paid_on,proof_sha256,reported_by)
 values(p_order_id,v_grant.referrer_user_id,p_amount_cents,p_provider,p_reference,
  p_paid_on,v_digest,p_actor) returning claim_id into v_claim_id;
 return jsonb_build_object('source','admin_owner_referral_payout_claim_v1_263',
   'claimId',v_claim_id,'alreadyRecorded',false,'bankVerified',false,
   'transferExecuted',false);
end;$fn$;

create or replace function platform_referral_payout_private_v1_263.read_claims(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare
 v_month date:=coalesce(p_month,date_trunc('month',
  clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_metrics jsonb;
 v_total bigint;v_rows jsonb;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a where a.user_id=p_actor
  and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'PAYOUT_READ_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
  or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
    +interval '2 months')::date
 then raise exception 'PAYOUT_MONTH_INVALID' using errcode='22023';end if;

 with claims as (
  select c.*,v.claim_id is not null voided,
   (g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id
    and g.matured_at is not null and g.reversed_at is null
    and g.referral_pending_cents=c.amount_cents
    and o.status='SETTLED' and o.financial_state='settled'
    and o.financial_reversed_at is null and o.payment_confirmed_at is not null
    and r.status='paid' and r.paid_at is not null
    and r.platform_fee_cents>0) eligible_now
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  left join public.orders o on o.id=c.order_id
  left join public.platform_receivables r on r.order_id=c.order_id
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
 )
 select jsonb_build_object(
  'totalClaims',count(*)::bigint,
  'activeClaims',count(*) filter(where not voided)::bigint,
  'voidedClaims',count(*) filter(where voided)::bigint,
  'reportedActiveCents',coalesce(sum(amount_cents) filter(where not voided),0)::bigint,
  'reportedEligibleNowCents',coalesce(sum(amount_cents) filter(
    where not voided and eligible_now),0)::bigint,
  'reportedNowIneligibleCents',coalesce(sum(amount_cents) filter(
    where not voided and not eligible_now),0)::bigint,
  'reportedVoidedCents',coalesce(sum(amount_cents) filter(where voided),0)::bigint,
  'activeWithoutProofFingerprint',count(*) filter(
    where not voided and proof_sha256 is null)::bigint
 ) into v_metrics from claims;

 select count(*)::bigint into v_total from public.platform_referral_payout_claims_v1_263 c
 where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date;

 with selected as (
  select c.claim_id,c.order_id,c.amount_cents,c.provider,c.provider_reference,
   c.paid_on,c.proof_sha256,c.reported_at,c.beneficiary_user_id,
   v.claim_id is not null voided,
   (g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id
    and g.matured_at is not null and g.reversed_at is null
    and g.referral_pending_cents=c.amount_cents
    and o.status='SETTLED' and o.financial_state='settled'
    and o.financial_reversed_at is null and o.payment_confirmed_at is not null
    and r.status='paid' and r.paid_at is not null
    and r.platform_fee_cents>0) eligible_now
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  left join public.orders o on o.id=c.order_id
  left join public.platform_receivables r on r.order_id=c.order_id
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
  order by c.reported_at desc,c.claim_id limit 30
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'claimId',claim_id,'orderId',order_id,'amountCents',amount_cents,
  'provider',provider,'referenceMasked',
    left(provider_reference,4)||'…'||right(provider_reference,4),
  'paidOn',paid_on,'proofFingerprintPresent',proof_sha256 is not null,
  'voided',voided,'eligibleNow',eligible_now
 )order by reported_at desc,claim_id),'[]'::jsonb) into v_rows from selected;

 return jsonb_build_object(
  'source','admin_owner_referral_payout_claims_v1_263',
  'month',v_month,'timezone','America/Sao_Paulo',
  'reportedByOwnerOnly',true,'providerSettlementConfirmed',false,
  'reportMetricMeaning','owner_reported_external_claims_not_bank_verified',
  'metrics',v_metrics,'totalRecords',v_total,'limit',30,'truncated',v_total>30,
  'rows',v_rows,'externalPaidBenefitsCents',null,
  'externalPayoutMeasured',false,'bankSettlementVerified',false,
  'profitMeasured',false,'roiMeasured',false,
  'noTransfers',true,'newBenefitsEnabled',false,'readOnly',true
 );
end;$fn$;

-- Explicit fail-closed privileges: never expose SECURITY DEFINER inner RPCs
-- through the browser roles or PostgreSQL's default PUBLIC EXECUTE.
revoke all on function platform_referral_payout_private_v1_263.record_claim(
 uuid,uuid,bigint,text,text,date,text) from public,anon,authenticated;
grant execute on function platform_referral_payout_private_v1_263.record_claim(
 uuid,uuid,bigint,text,text,date,text) to service_role;
revoke all on function platform_referral_payout_private_v1_263.read_claims(
 uuid,date) from public,anon,authenticated;
grant execute on function platform_referral_payout_private_v1_263.read_claims(
 uuid,date) to service_role;
