-- Complete integration after the isolated V1.835 journeys with two
-- accepted/completed rides; no service provider calls or commercial users.
SET LOCAL ROLE postgres;
UPDATE public.mobility_billing_plans_v1_826
SET purchase_enabled=true
WHERE plan_key IN ('essential','popular','professional');

SET LOCAL ROLE service_role;
DO $t$
declare p jsonb; again jsonb; id uuid; summary jsonb;
begin
 p:=public.mobility_fee_pix_prepare_credit_v1_838(
 'dddddddd-1000-4000-8000-000000000001','essential');
 id:=(p->>'invoiceId')::uuid;
 if id is null or p->>'invoiceKind'<>'prepaid_credit'
  or p->>'planKey'<>'essential' or (p->>'amountCents')::integer<>990
 then raise exception 'PREPAID_INITIAL_INVOICE_WRONG';end if;
 again:=public.mobility_fee_pix_prepare_credit_v1_838(
 'dddddddd-1000-4000-8000-000000000001','essential');
 if again->>'invoiceId'<>id::text
  or (again->>'replayed')::boolean is distinct from true
 then raise exception 'PREPAID_IDEMPOTENCY_FAILED';end if;
 begin
  perform public.mobility_fee_pix_prepare_credit_v1_838(
   'dddddddd-1000-4000-8000-000000000001','popular');
  raise exception 'PREPAID_TWO_CONCURRENT_PLANS_ALLOWED';
 exception when unique_violation then null;end;
 if exists(select 1 from public.mobility_fee_prepaid_lots_v1_838
   where driver_id='dddddddd-1000-4000-8000-000000000001')
 then raise exception 'PREPAID_CREDIT_BEFORE_PSP_PAYMENT';end if;
 -- A prova é sintética e somente no banco DESCARTÁVEL.
 summary:=public.mobility_fee_pix_recover_paid_v1_837(
   id,'dddddddd-1000-4000-8000-000000000001',
   'ord838paid012345','pay838verified01',990,repeat('a',64));
 if summary->>'status'<>'paid' then
  raise exception 'PREPAID_PROVIDER_PROOF_NOT_APPLIED';end if;
 if (select funded_cents from public.mobility_fee_prepaid_lots_v1_838
     where invoice_id=id)<>990
 then raise exception 'PREPAID_NOT_CREDITED';end if;
 summary:=public.mobility_fee_pix_recover_paid_v1_837(
   id,'dddddddd-1000-4000-8000-000000000001',
   'ord838paid012345','pay838verified01',990,repeat('a',64));
 if (summary->>'replayed')::boolean is distinct from true
  or (select count(*) from public.mobility_fee_prepaid_lots_v1_838
      where invoice_id=id)<>1
 then raise exception 'PREPAID_DOUBLE_CREDIT';end if;
 perform set_config('tamao.ci.prepaid_838',id::text,true);
end $t$;

-- Cancellation returns reserved cents without changing plan economics.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000002';
SELECT set_config('tamao.ci.prepaid_cancel',
 public.mobility_create_request('dddddddd-2000-4000-8000-000000000001',
 'carro','Centro','Bairro Cancelado')::text,true);
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000001';
DO $t$ BEGIN
 IF public.mobility_transition(current_setting('tamao.ci.prepaid_cancel')::uuid,'accept')<>'accepted'
 THEN RAISE EXCEPTION 'PREPAID_CANCEL_ACCEPT_FAILED';END IF;
 PERFORM public.mobility_fare_propose_v1_826(
   current_setting('tamao.ci.prepaid_cancel')::uuid,2000);
END $t$;
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000002';
DO $t$ BEGIN
 PERFORM public.mobility_fare_accept_v1_826(
  current_setting('tamao.ci.prepaid_cancel')::uuid,1);
 IF (select fee_bps from public.mobility_fare_terms_v1_832
     where request_id=current_setting('tamao.ci.prepaid_cancel')::uuid) is not null
 THEN RAISE EXCEPTION 'BROWSER_READ_PREPAID_FARE_DIRECTLY';
 END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL; END $t$;
SET LOCAL ROLE postgres;
DO $t$ BEGIN
 IF (select fee_bps from public.mobility_fare_terms_v1_832
     where request_id=current_setting('tamao.ci.prepaid_cancel')::uuid)<>600
 OR (select reserved_cents from public.mobility_fee_prepaid_lots_v1_838
      where invoice_id=current_setting('tamao.ci.prepaid_838')::uuid)<>120
 THEN RAISE EXCEPTION 'PREPAID_DISCOUNT_NOT_RESERVED';END IF;
END $t$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000002';
DO $t$ BEGIN
 IF public.mobility_transition(current_setting('tamao.ci.prepaid_cancel')::uuid,'cancel')<>'cancelled'
 THEN RAISE EXCEPTION 'PREPAID_CANCEL_TRANSITION_FAILED';END IF;
END $t$;
SET LOCAL ROLE postgres;
DO $t$ BEGIN
 IF (select reserved_cents from public.mobility_fee_prepaid_lots_v1_838
      where invoice_id=current_setting('tamao.ci.prepaid_838')::uuid)<>0
  OR (select status from public.mobility_fee_prepaid_uses_v1_838
      where request_id=current_setting('tamao.ci.prepaid_cancel')::uuid)<>'released'
 THEN RAISE EXCEPTION 'PREPAID_CANCEL_DID_NOT_REFUND_HOLD';END IF;
END $t$;

-- One accepted fare locks the plan rate; completion consumes exactly once.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000002';
SELECT set_config('tamao.ci.prepaid_completed',
 public.mobility_create_request('dddddddd-2000-4000-8000-000000000001',
 'carro','Centro','Bairro Comprido')::text,true);
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000001';
DO $t$ BEGIN
 IF public.mobility_transition(current_setting('tamao.ci.prepaid_completed')::uuid,'accept')<>'accepted'
 THEN RAISE EXCEPTION 'PREPAID_COMPLETE_ACCEPT_FAILED';END IF;
 PERFORM public.mobility_fare_propose_v1_826(
   current_setting('tamao.ci.prepaid_completed')::uuid,10000);
END $t$;
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000002';
DO $t$ BEGIN
 PERFORM public.mobility_fare_accept_v1_826(
   current_setting('tamao.ci.prepaid_completed')::uuid,1);
END $t$;
SET LOCAL ROLE postgres;
DO $t$ BEGIN
 IF (select fee_bps from public.mobility_fare_terms_v1_832
     where request_id=current_setting('tamao.ci.prepaid_completed')::uuid)<>600
 OR (select reserved_cents from public.mobility_fee_prepaid_lots_v1_838
     where invoice_id=current_setting('tamao.ci.prepaid_838')::uuid)<>600
 THEN RAISE EXCEPTION 'PREPAID_FARE_SNAPSHOT_WRONG';END IF;
END $t$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000001';
DO $t$ BEGIN
 IF public.mobility_transition(current_setting('tamao.ci.prepaid_completed')::uuid,'depart')<>'en_route'
 THEN RAISE EXCEPTION 'PREPAID_TRIP_NOT_DEPARTED';END IF;
 IF public.mobility_transition(current_setting('tamao.ci.prepaid_completed')::uuid,'arrive')<>'arrived'
 THEN RAISE EXCEPTION 'PREPAID_TRIP_NOT_ARRIVED';END IF;
 IF public.mobility_transition(current_setting('tamao.ci.prepaid_completed')::uuid,'finish')<>'completed'
 THEN RAISE EXCEPTION 'PREPAID_TRIP_NOT_COMPLETED';END IF;
END $t$;
SET LOCAL ROLE postgres;
DO $t$
declare v jsonb;BEGIN
 IF (select spent_cents from public.mobility_fee_prepaid_lots_v1_838
     where invoice_id=current_setting('tamao.ci.prepaid_838')::uuid)<>600
  OR (select reserved_cents from public.mobility_fee_prepaid_lots_v1_838
     where invoice_id=current_setting('tamao.ci.prepaid_838')::uuid)<>0
  OR (select fee_cents from public.mobility_platform_fee_accruals_v1_835
     where request_id=current_setting('tamao.ci.prepaid_completed')::uuid)<>600
  OR (select status from public.mobility_fee_prepaid_uses_v1_838
     where request_id=current_setting('tamao.ci.prepaid_completed')::uuid)<>'spent'
 THEN RAISE EXCEPTION 'PREPAID_COMPLETED_FEE_NOT_PAID_FROM_LOT';END IF;
 SET LOCAL ROLE authenticated;
 perform set_config('request.jwt.claim.sub',
   'dddddddd-1000-4000-8000-000000000001',true);
 v:=public.mobility_billing_catalog_v1_826();
 if (v->'prepaid'->>'availableCents')::integer<>390
 OR (v->'prepaid'->>'spentCents')::integer<>600
 OR (v->'billing'->>'collectedCents')::integer<>600
 OR NOT exists(select 1 from jsonb_array_elements(v->'billing'->'entries') e
    where e->>'collectionStatus'='prepaid_credit'
      and e->>'requestId'=current_setting('tamao.ci.prepaid_completed'))
 THEN RAISE EXCEPTION 'PREPAID_AUTHENTICATED_READBACK_WRONG';END IF;
END $t$;

-- Insufficient wallet cannot promise a discounted fee. Falling back to
-- existing benefit terms must never overspend the old prepaid lot.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000002';
SELECT set_config('tamao.ci.prepaid_fallback',
 public.mobility_create_request('dddddddd-2000-4000-8000-000000000001',
 'carro','Centro','Bairro Alto')::text,true);
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000001';
DO $t$ BEGIN
 IF public.mobility_transition(current_setting('tamao.ci.prepaid_fallback')::uuid,'accept')<>'accepted'
 THEN RAISE EXCEPTION 'PREPAID_FALLBACK_ACCEPT_FAILED';END IF;
 PERFORM public.mobility_fare_propose_v1_826(
   current_setting('tamao.ci.prepaid_fallback')::uuid,10000);
END $t$;
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000002';
DO $t$ BEGIN
 PERFORM public.mobility_fare_accept_v1_826(
   current_setting('tamao.ci.prepaid_fallback')::uuid,1);
END $t$;
SET LOCAL ROLE postgres;
DO $t$ BEGIN
 IF (select fee_bps from public.mobility_fare_terms_v1_832
     where request_id=current_setting('tamao.ci.prepaid_fallback')::uuid)<>800
 OR exists(select 1 from public.mobility_fee_prepaid_uses_v1_838
  where request_id=current_setting('tamao.ci.prepaid_fallback')::uuid)
 THEN RAISE EXCEPTION 'PREPAID_WALLET_PROMISED_UNFUNDED_DISCOUNT';END IF;
END $t$;

-- After a provider reversal, remaining credits freeze; previous consumed
-- amount is explicitly excluded from "proved collected" and must be reviewed.
SET LOCAL ROLE service_role;
DO $t$ DECLARE b jsonb;BEGIN
 b:=public.mobility_fee_pix_apply_proof_v1_837(
  current_setting('tamao.ci.prepaid_838')::uuid,
  'ord838paid012345','pay838verified01',990,
  'review_required',repeat('b',64));
 IF b->>'status'<>'review_required' OR
 (select status from public.mobility_fee_prepaid_lots_v1_838
  where invoice_id=current_setting('tamao.ci.prepaid_838')::uuid)<>'under_review'
 THEN RAISE EXCEPTION 'PREPAID_REFUND_WALLET_NOT_FROZEN';END IF;
END $t$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='dddddddd-1000-4000-8000-000000000001';
DO $t$ DECLARE v jsonb;BEGIN
 v:=public.mobility_billing_catalog_v1_826();
 IF (v->'prepaid'->>'availableCents')::integer<>0
 OR (v->'prepaid'->>'underReviewCents')::integer<>990
 OR (v->'billing'->>'collectedCents')::integer<>0
 THEN RAISE EXCEPTION 'PREPAID_REFUND_STILL_SHOWN_AS_PAID';END IF;
END $t$;
