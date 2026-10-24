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

 UPDATE public.clube_coupon_paid_invoices
 SET provider_payment_id='mp-identity-payment-1' WHERE id=first_invoice;
 BEGIN
  UPDATE public.clube_coupon_paid_invoices
  SET provider_payment_id='mp-identity-payment-1' WHERE id=second_invoice;
 EXCEPTION WHEN unique_violation THEN unique_payment_rejected:=true;
 END;
 IF NOT unique_payment_rejected THEN
   RAISE EXCEPTION 'COUPON_PSP_PAYMENT_REUSED_ACROSS_INVOICES';
 END IF;

 UPDATE public.clube_coupon_paid_invoices SET
 provider_payment_id='mp-identity-payment-2' WHERE id=second_invoice;
 UPDATE public.clube_coupon_paid_invoices SET
 net_proceeds_cents=1100,
 net_proceeds_reference='mp-release:identity-report.csv:mp-identity-payment-1',
 net_proceeds_verified_at=clock_timestamp() WHERE id=first_invoice;
 BEGIN
  UPDATE public.clube_coupon_paid_invoices SET
  net_proceeds_cents=1100,
  net_proceeds_reference='mp-release:identity-report.csv:mp-identity-payment-1',
  net_proceeds_verified_at=clock_timestamp() WHERE id=second_invoice;
 EXCEPTION WHEN unique_violation THEN unique_release_rejected:=true;
 END;
 IF NOT unique_release_rejected THEN
   RAISE EXCEPTION 'COUPON_NET_RECEIPT_REUSED_ACROSS_INVOICES';
 END IF;

 UPDATE public.clube_coupon_paid_invoices SET
 net_proceeds_cents=1100,
 net_proceeds_reference='mp-release:identity-report.csv:mp-identity-payment-2',
 net_proceeds_verified_at=clock_timestamp() WHERE id=second_invoice;
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
