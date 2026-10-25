-- Run ONLY in disposable PostgreSQL 17 after coupon finance migrations.
-- Never use this fixture against real invoices, PSP orders or money.
DO $tamao_coupon_payment_identity_test$
DECLARE
 u uuid;
 first_invoice uuid;
 second_invoice uuid;
 unique_payment_rejected boolean:=false;
 unique_release_rejected boolean:=false;
BEGIN
 SELECT id INTO u FROM auth.users ORDER BY id LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'COUPON_IDENTITY_TEST_NEEDS_USER'; END IF;
 INSERT INTO public.clube_coupon_paid_packages
 (package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days)
 VALUES ('identity_proof_test','Identity proof test',1500,500,2,60);

 INSERT INTO public.clube_coupon_paid_invoices
 (customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,
  coupons_per_pack,valid_days,provider_order_id,status)
 VALUES (u,'identity_proof_test',gen_random_uuid(),1500,500,2,60,
         'identity-provider-order-A','awaiting_payment') RETURNING id INTO first_invoice;
 INSERT INTO public.clube_coupon_paid_invoices
 (customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,
  coupons_per_pack,valid_days,provider_order_id,status)
 VALUES (u,'identity_proof_test',gen_random_uuid(),1500,500,2,60,
         'identity-provider-order-B','awaiting_payment') RETURNING id INTO second_invoice;

 -- Unattributed, not-yet-paid Pix references remain legitimately NULL.
 IF (SELECT count(*) FROM public.clube_coupon_paid_invoices WHERE id in
 (first_invoice,second_invoice) AND provider_payment_id IS NULL AND
 net_proceeds_reference IS NULL)<>2 THEN
   RAISE EXCEPTION 'COUPON_PENDING_INVOICES_FORBIDDEN';
 END IF;

 -- Exercise the ACTUAL payment verification RPC so a conflict aborts
 -- voucher issuance as well as the provider payment binding.
 PERFORM public.clube_coupon_paid_payment_verify(
   first_invoice,'identity-provider-order-A','mp-identity-payment-1',1500);
 BEGIN
  PERFORM public.clube_coupon_paid_payment_verify(
   second_invoice,'identity-provider-order-B','mp-identity-payment-1',1500);
 EXCEPTION WHEN unique_violation THEN unique_payment_rejected:=true;
 END;
 IF NOT unique_payment_rejected THEN
   RAISE EXCEPTION 'COUPON_PSP_PAYMENT_REUSED_ACROSS_INVOICES';
 END IF;
 IF (SELECT status FROM public.clube_coupon_paid_invoices
      WHERE id=second_invoice)<>'awaiting_payment' OR
    (SELECT count(*) FROM public.clube_coupon_paid_issuances
      WHERE invoice_id=second_invoice)<>0 THEN
   RAISE EXCEPTION 'COUPON_PAYMENT_CONFLICT_ISSUED_VOUCHERS';
 END IF;
 PERFORM public.clube_coupon_paid_payment_verify(
   second_invoice,'identity-provider-order-B','mp-identity-payment-2',1500);

 -- The ordinary finance RPC is privileged. The existing Admin wrapper
 -- authenticates the actor/MP report before invoking this method.
 PERFORM public.clube_coupon_paid_net_proceeds_verify(
   first_invoice,'identity-provider-order-A',1100,
   'mp-release:identity-report.csv:mp-identity-payment-1');
 BEGIN
  PERFORM public.clube_coupon_paid_net_proceeds_verify(
   second_invoice,'identity-provider-order-B',1100,
   'mp-release:identity-report.csv:mp-identity-payment-1');
 EXCEPTION WHEN unique_violation THEN unique_release_rejected:=true;
 END;
 IF NOT unique_release_rejected THEN
   RAISE EXCEPTION 'COUPON_NET_RECEIPT_REUSED_ACROSS_INVOICES';
 END IF;
 IF (SELECT net_proceeds_reference FROM public.clube_coupon_paid_invoices
     WHERE id=second_invoice) IS NOT NULL THEN
   RAISE EXCEPTION 'COUPON_RELEASE_CONFLICT_REGISTERED_PROOF';
 END IF;
 PERFORM public.clube_coupon_paid_net_proceeds_verify(
   second_invoice,'identity-provider-order-B',1100,
   'mp-release:identity-report.csv:mp-identity-payment-2');
 IF (SELECT count(distinct provider_payment_id)
  FROM public.clube_coupon_paid_invoices
  WHERE id IN (first_invoice,second_invoice))<>2 OR
 (SELECT count(distinct net_proceeds_reference)
  FROM public.clube_coupon_paid_invoices
  WHERE id IN (first_invoice,second_invoice))<>2 THEN
   RAISE EXCEPTION 'COUPON_VALID_SEPARATE_PAYMENTS_REJECTED';
 END IF;
 IF has_table_privilege('anon','public.clube_coupon_paid_invoices','SELECT')
  OR has_table_privilege('authenticated','public.clube_coupon_paid_invoices','UPDATE')
  THEN RAISE EXCEPTION 'COUPON_FINANCE_ACL_DRIFT'; END IF;
END
$tamao_coupon_payment_identity_test$;


-- Keep the original financial authority across duplicate PSP callbacks.
-- These cases had no coverage: a held coupon was changed from "reserved"
-- to "review_required", then a second full-refund callback incorrectly
-- promoted the invoice to "refunded". Entirely synthetic, disposable PG17.
DO $coupon_refund_review_replay_test$
DECLARE
 u uuid;
 package_key text:='identity_proof_test';
 held_invoice uuid;
 partial_invoice uuid;
 clean_invoice uuid;
 first_voucher uuid;
 result jsonb;
 invoice_state text;
 refunded_time timestamptz;
 held_count integer;
BEGIN
 SELECT id INTO u FROM auth.users ORDER BY id LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'REFUND_REPLAY_NEEDS_FIXTURE_USER'; END IF;

 INSERT INTO public.clube_coupon_paid_invoices(
   customer_user_id,package_key,request_id,sale_price_cents,
   coupon_face_cents,coupons_per_pack,valid_days,provider_order_id,status)
 VALUES (u,package_key,gen_random_uuid(),1500,500,2,60,
   'refund-review-held-order','awaiting_payment')
 RETURNING id INTO held_invoice;
 PERFORM public.clube_coupon_paid_payment_verify(
   held_invoice,'refund-review-held-order','refund-review-held-payment',1500);
 SELECT id INTO first_voucher FROM public.clube_coupon_paid_issuances
 WHERE invoice_id=held_invoice AND ordinal=1;
 UPDATE public.clube_coupon_paid_issuances
 SET status='reserved',reserved_quote_id=gen_random_uuid(),
     reserved_at=clock_timestamp()
 WHERE id=first_voucher;

 result:=public.clube_coupon_paid_payment_refund(
   held_invoice,'refund-review-held-order');
 IF (result->>'reviewRequired')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'RESERVED_REFUND_NOT_REVIEWED'; END IF;
 result:=public.clube_coupon_paid_payment_refund(
   held_invoice,'refund-review-held-order');
 SELECT status,refunded_at INTO invoice_state,refunded_time
 FROM public.clube_coupon_paid_invoices WHERE id=held_invoice;
 SELECT count(*) INTO held_count FROM public.clube_coupon_paid_issuances
 WHERE invoice_id=held_invoice AND status='review_required';
 IF invoice_state<>'review_required' OR refunded_time IS NOT NULL
    OR held_count<>2
    OR (result->>'reviewRequired')::boolean IS DISTINCT FROM true
    OR (result->>'refunded')::boolean IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'REPLAY_FALSIFIED_REFUND_AFTER_RESERVED_VOUCHER'; END IF;

 -- A partial refund / dispute already marked for review must also remain
 -- open if a later provider message says the gross amount was refunded.
 INSERT INTO public.clube_coupon_paid_invoices(
   customer_user_id,package_key,request_id,sale_price_cents,
   coupon_face_cents,coupons_per_pack,valid_days,provider_order_id,status)
 VALUES (u,package_key,gen_random_uuid(),1500,500,2,60,
   'refund-review-partial-order','awaiting_payment')
 RETURNING id INTO partial_invoice;
 PERFORM public.clube_coupon_paid_payment_verify(
   partial_invoice,'refund-review-partial-order','refund-review-partial-payment',1500);
 PERFORM public.clube_coupon_paid_payment_review(
   partial_invoice,'refund-review-partial-order');
 result:=public.clube_coupon_paid_payment_refund(
   partial_invoice,'refund-review-partial-order');
 SELECT status,refunded_at INTO invoice_state,refunded_time
 FROM public.clube_coupon_paid_invoices WHERE id=partial_invoice;
 IF invoice_state<>'review_required' OR refunded_time IS NOT NULL
    OR (result->>'reviewRequired')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'PARTIAL_REFUND_REVIEW_SILENTLY_CLOSED'; END IF;

 -- Clean, never-reserved vouchers remain eligible for a real full refund:
 -- exactly one voiding, idempotent retry, no review queue growth.
 INSERT INTO public.clube_coupon_paid_invoices(
   customer_user_id,package_key,request_id,sale_price_cents,
   coupon_face_cents,coupons_per_pack,valid_days,provider_order_id,status)
 VALUES (u,package_key,gen_random_uuid(),1500,500,2,60,
   'refund-review-clean-order','awaiting_payment')
 RETURNING id INTO clean_invoice;
 PERFORM public.clube_coupon_paid_payment_verify(
   clean_invoice,'refund-review-clean-order','refund-review-clean-payment',1500);
 result:=public.clube_coupon_paid_payment_refund(
   clean_invoice,'refund-review-clean-order');
 IF (result->>'refunded')::boolean IS DISTINCT FROM true
    OR (result->>'replayed')::boolean IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'CLEAN_REFUND_BLOCKED'; END IF;
 result:=public.clube_coupon_paid_payment_refund(
   clean_invoice,'refund-review-clean-order');
 IF (result->>'refunded')::boolean IS DISTINCT FROM true
    OR (result->>'replayed')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'CLEAN_REFUND_REPLAY_NOT_IDEMPOTENT'; END IF;
 SELECT count(*) INTO held_count FROM public.clube_coupon_paid_issuances
 WHERE invoice_id=clean_invoice AND status='void';
 IF held_count<>2 THEN RAISE EXCEPTION 'CLEAN_REFUND_CREDIT_NOT_VOIDED'; END IF;

 IF has_function_privilege('anon',
     'public.clube_coupon_paid_payment_refund(uuid,text)','EXECUTE')
    OR has_function_privilege('authenticated',
     'public.clube_coupon_paid_payment_refund(uuid,text)','EXECUTE')
    OR NOT has_function_privilege('service_role',
     'public.clube_coupon_paid_payment_refund(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'REFUND_REPLAY_RPC_PERMISSIONS_CHANGED'; END IF;
END $coupon_refund_review_replay_test$;
