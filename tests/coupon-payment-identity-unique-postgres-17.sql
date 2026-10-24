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
