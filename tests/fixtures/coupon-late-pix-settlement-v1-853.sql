-- #853 isolated PostgreSQL settlement regression. The ONLY bypass is seeding
-- fictional invoices inside a rollback-only transaction; verified money path
-- and immutable package rules are exercised with triggers enabled again.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO public.clube_coupon_paid_packages(
 package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,
 valid_days,funding_verified,legal_terms_verified,redeem_settlement_verified,sale_enabled,sponsored_by_owner)
VALUES('ci_refund_late_853','Synthetic refunded-before-Pix coupons',1500,500,2,
 30,false,false,false,false,true)
ON CONFLICT (package_key) DO NOTHING;
INSERT INTO public.clube_coupon_paid_invoices(
 customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,
 coupons_per_pack,valid_days,provider_order_id,provider_payment_id,status,
 terms_version,terms_accepted_at,funding_mode_v1_846,funding_terms_version_v1_846,
 min_order_cents,buyer_postal_code_v1_850,
 seller_name,seller_tax_document,seller_address,seller_support_email)
SELECT user_id,'partner_general_3x5_849',gen_random_uuid(),890,500,3,180,
 'CI-853-WITHDRAWN','CI-853-PIX-WITHDRAWN','awaiting_payment',
 'clube_partner_coupon_terms_v1_846',clock_timestamp(),
 'partner_funded','clube_partner_coupon_terms_v1_846',1000,'97400998',
 'Synthetic seller CI','12345678901','Rua Sintética 123, Bairro Central, São Gabriel',
 'synthetic@example.invalid'
FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;
INSERT INTO public.clube_coupon_paid_invoices(
 customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,
 coupons_per_pack,valid_days,provider_order_id,provider_payment_id,status)
SELECT user_id,'ci_refund_late_853',gen_random_uuid(),1500,500,2,30,
 'CI-853-REFUND-FIRST','CI-853-PIX-REFUND-FIRST','awaiting_payment'
FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;
INSERT INTO public.clube_coupon_paid_invoices(
 customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,
 coupons_per_pack,valid_days,provider_order_id,provider_payment_id,status)
SELECT user_id,'ci_refund_late_853',gen_random_uuid(),1500,500,2,30,
 'CI-853-LEGACY-GOOD','CI-853-PIX-LEGACY-GOOD','awaiting_payment'
FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;
SET LOCAL session_replication_role = origin;
DO $test$
DECLARE
 v_partner uuid;
 v_refund uuid;
 v_legacy uuid;
 v_user uuid;
 v_result jsonb;
 v_replayed boolean:=false;
 v_refund_record jsonb;
BEGIN
 SELECT id,customer_user_id INTO v_partner,v_user FROM public.clube_coupon_paid_invoices
  WHERE provider_order_id='CI-853-WITHDRAWN';
 SELECT id INTO v_refund FROM public.clube_coupon_paid_invoices
  WHERE provider_order_id='CI-853-REFUND-FIRST';
 SELECT id INTO v_legacy FROM public.clube_coupon_paid_invoices
  WHERE provider_order_id='CI-853-LEGACY-GOOD';
 IF v_partner IS NULL OR v_refund IS NULL OR v_legacy IS NULL OR v_user IS NULL
 THEN RAISE EXCEPTION 'CI_853_INVOICE_SETUP_FAILED'; END IF;
 IF has_function_privilege('authenticated',
    'public.clube_coupon_paid_payment_verify(uuid,text,text,integer)','EXECUTE')
    OR NOT has_function_privilege('service_role',
    'public.clube_coupon_paid_payment_verify(uuid,text,text,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'CI_853_PAYMENT_RPC_EXPOSED'; END IF;

 -- No merchant and no partner coupon launch authorization. A provider-paid
 -- Pix must be recorded but not turn into three spendable benefits.
 v_result:=public.clube_coupon_paid_payment_verify(
  v_partner,'CI-853-WITHDRAWN','CI-853-PIX-WITHDRAWN',890);
 IF v_result->>'reviewRequired'<>'true'
    OR v_result->>'providerPaymentRecorded'<>'true'
    OR v_result->>'reason'<>'PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT'
    OR (v_result->>'issued')::integer<>0
 THEN RAISE EXCEPTION 'CI_853_LOST_SUPPLY_MINTED_COUPONS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clube_coupon_paid_invoices
    WHERE id=v_partner AND status='review_required'
      AND paid_at IS NOT NULL AND provider_payment_id='CI-853-PIX-WITHDRAWN'
      AND coupon_settlement_hold_reason_v1_853='PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT'
      AND pix_br_code IS NULL AND payment_url IS NULL)
    OR EXISTS(SELECT 1 FROM public.clube_coupon_paid_issuances WHERE invoice_id=v_partner)
 THEN RAISE EXCEPTION 'CI_853_PARTNER_LATE_PAYMENT_NOT_QUARANTINED';END IF;
 -- Repeated *identical* provider confirmation is a safe, audited ACK.
 -- It must not rewrite the first paid_at or issue any voucher.
 v_result:=public.clube_coupon_paid_payment_verify(
   v_partner,'CI-853-WITHDRAWN','CI-853-PIX-WITHDRAWN',890);
 IF v_result->>'replayed'<>'true'
    OR v_result->>'reviewRequired'<>'true'
    OR v_result->>'providerPaymentRecorded'<>'true'
    OR v_result->>'reason'<>'PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT'
    OR (v_result->>'issued')::integer<>0
    OR EXISTS(SELECT 1 FROM public.clube_coupon_paid_issuances
       WHERE invoice_id=v_partner)
 THEN RAISE EXCEPTION 'CI_859_REPLAY_RESURRECTED_WITHDRAWN_COUPONS';END IF;
 -- A different Pix ID is a real proof conflict, not an idempotent replay.
 BEGIN
   PERFORM public.clube_coupon_paid_payment_verify(
     v_partner,'CI-853-WITHDRAWN','CI-859-WRONG-PAYMENT',890);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
   v_replayed:=(SQLERRM='COUPON_PAYMENT_PROOF_MISMATCH');
 END;
 IF NOT v_replayed THEN RAISE EXCEPTION 'CI_859_CONFLICTING_PIX_ACKED';END IF;

 -- Cancellation requested while original Pix still exists outside the app.
 -- It must be held for refund analysis even on the old owner-backed package.
 v_refund_record:=public.clube_coupon_refund_request_v1_814(
   v_user,v_refund,gen_random_uuid(),'arrependimento');
 IF v_refund_record->>'ok'<>'true' THEN
   RAISE EXCEPTION 'CI_853_REFUND_REQUEST_NOT_DURABLE';END IF;
 v_result:=public.clube_coupon_paid_payment_verify(
  v_refund,'CI-853-REFUND-FIRST','CI-853-PIX-REFUND-FIRST',1500);
 IF v_result->>'reviewRequired'<>'true'
    OR v_result->>'reason'<>'COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT'
    OR (v_result->>'issued')::integer<>0
 THEN RAISE EXCEPTION 'CI_853_REFUND_PENDING_STILL_CREATED_COUPON'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clube_coupon_paid_invoices
   WHERE id=v_refund AND status='review_required' AND paid_at IS NOT NULL
     AND coupon_settlement_hold_reason_v1_853='COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT')
   OR EXISTS(SELECT 1 FROM public.clube_coupon_paid_issuances WHERE invoice_id=v_refund)
 THEN RAISE EXCEPTION 'CI_853_REFUND_HOLD_MISSING';END IF; 
 v_result:=public.clube_coupon_paid_payment_verify(
  v_refund,'CI-853-REFUND-FIRST','CI-853-PIX-REFUND-FIRST',1500);
 IF v_result->>'replayed'<>'true'
   OR v_result->>'reason'<>'COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT'
   OR (v_result->>'issued')::integer<>0
 THEN RAISE EXCEPTION 'CI_859_REFUND_FIRST_REPLAY_UNSAFE';END IF;

 -- Unaffected old coupon paid with no earlier refund continues issuing once.
 v_result:=public.clube_coupon_paid_payment_verify(
  v_legacy,'CI-853-LEGACY-GOOD','CI-853-PIX-LEGACY-GOOD',1500);
 IF v_result->>'ok'<>'true' OR (v_result->>'issued')::integer<>2
 THEN RAISE EXCEPTION 'CI_853_OLD_SPONSORED_INVOICE_BLOCKED'; END IF;
 v_result:=public.clube_coupon_paid_payment_verify(
  v_legacy,'CI-853-LEGACY-GOOD','CI-853-PIX-LEGACY-GOOD',1500);
 IF v_result->>'replayed'<>'true'
    OR (SELECT count(*) FROM public.clube_coupon_paid_issuances
        WHERE invoice_id=v_legacy)<>2
 THEN RAISE EXCEPTION 'CI_853_LEGACY_REPLAY_NOT_IDEMPOTENT'; END IF;
END;
$test$;
ROLLBACK;
