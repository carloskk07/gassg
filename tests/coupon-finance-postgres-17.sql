-- Run only in a disposable PostgreSQL 17 test database, or inside:
-- BEGIN; <20261019170000_clube_coupon_paid_pix_financial_foundation.sql>;
-- <this script>; ROLLBACK;
-- Never run these fictional provider events against an installed financial
-- schema outside an enclosing ROLLBACK. No external Mercado Pago calls.
DO $coupon_finance_test$
DECLARE
  v_user uuid;
  v_invoice uuid;
  v_invoice_two uuid;
  v_invoice_three uuid;
  v_result jsonb;
  v_count integer;
  v_status text;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY id LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'COUPON_TEST_NEEDS_AUTH_USER_FIXTURE';
  END IF;

  IF has_table_privilege('anon','public.clube_coupon_paid_invoices','SELECT')
     OR has_table_privilege('authenticated','public.clube_coupon_paid_issuances','INSERT')
     OR has_function_privilege('authenticated',
        'public.clube_coupon_paid_payment_verify(uuid,text,text,integer)','EXECUTE')
     OR has_function_privilege('anon',
        'public.clube_coupon_paid_payment_refund(uuid,text)','EXECUTE')
    THEN RAISE EXCEPTION 'COUPON_FINANCIAL_ROLE_LEAK'; END IF;
  IF NOT has_function_privilege('service_role',
    'public.clube_coupon_paid_payment_verify(uuid,text,text,integer)','EXECUTE')
    THEN RAISE EXCEPTION 'COUPON_SERVICE_RECONCILIATION_MISSING'; END IF;

  BEGIN
    INSERT INTO public.clube_coupon_paid_packages
    (package_key,title,sale_price_cents,coupon_face_cents,
     coupons_per_pack,valid_days,sale_enabled)
    VALUES ('test_unfunded','Sem custeio teste',1000,500,2,90,true);
    RAISE EXCEPTION 'UNFUNDED_COUPON_WAS_ENABLED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- All Boolean approvals are insufficient if money cannot cover the
  -- sum of the vouchers: never sell a R$10 package worth R$20.
  BEGIN
    INSERT INTO public.clube_coupon_paid_packages
    (package_key,title,sale_price_cents,coupon_face_cents,
     coupons_per_pack,valid_days,sale_enabled,
     funding_verified,legal_terms_verified,redeem_settlement_verified)
    VALUES ('test_underfunded','Teste sem lastro suficiente',1000,1000,2,90,
      true,true,true,true);
    RAISE EXCEPTION 'UNDERFUNDED_COUPON_PACKAGE_SELLABLE';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.clube_coupon_paid_packages
  (package_key,title,sale_price_cents,coupon_face_cents,
   coupons_per_pack,valid_days)
  VALUES ('test_finance','Pacote teste financeiro',1000,500,2,90);

  INSERT INTO public.clube_coupon_paid_invoices
  (customer_user_id,package_key,request_id,sale_price_cents,
   coupon_face_cents,coupons_per_pack,valid_days,provider_order_id,status)
  VALUES (v_user,'test_finance',gen_random_uuid(),1000,500,2,90,
   'test-mp-order-1','awaiting_payment')
  RETURNING id INTO v_invoice;

  BEGIN
    PERFORM public.clube_coupon_paid_payment_verify(
      v_invoice,'test-mp-order-1','mp-payment-1',999);
    RAISE EXCEPTION 'WRONG_AMOUNT_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COUPON_PAYMENT_PROOF_MISMATCH%' THEN RAISE; END IF;
  END;

  v_result:=public.clube_coupon_paid_payment_verify(
    v_invoice,'test-mp-order-1','mp-payment-1',1000);
  IF (v_result->>'issued')::integer<>2 THEN
    RAISE EXCEPTION 'COUPONS_NOT_ISSUED';
  END IF;
  SELECT count(*) INTO v_count FROM public.clube_coupon_paid_issuances
   WHERE invoice_id=v_invoice;
  IF v_count<>2 THEN RAISE EXCEPTION 'COUPON_DOUBLE_OR_MISSING_ISSUANCE'; END IF;

  v_result:=public.clube_coupon_paid_payment_verify(
    v_invoice,'test-mp-order-1','mp-payment-1',1000);
  IF (v_result->>'replayed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'COUPON_REPLAY_NOT_IDEMPOTENT';
  END IF;
  SELECT count(*) INTO v_count FROM public.clube_coupon_paid_issuances
   WHERE invoice_id=v_invoice;
  IF v_count<>2 THEN RAISE EXCEPTION 'COUPON_DUPLICATE_ON_REPLAY'; END IF;

  BEGIN
    PERFORM public.clube_coupon_paid_payment_verify(
      v_invoice,'test-mp-order-1','mp-payment-2',1000);
    RAISE EXCEPTION 'PAYMENT_ID_REPLAY_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COUPON_PAYMENT_PROOF_MISMATCH%' THEN RAISE; END IF;
  END;

  -- Reserve state must block automatic refund of a potentially consumed
  -- voucher and trigger financial review instead of hidden forgiveness.
  UPDATE public.clube_coupon_paid_issuances
   SET status='reserved',reserved_quote_id=gen_random_uuid(),reserved_at=clock_timestamp()
   WHERE invoice_id=v_invoice AND ordinal=1;
  v_result:=public.clube_coupon_paid_payment_refund(v_invoice,'test-mp-order-1');
  IF (v_result->>'reviewRequired')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RESERVED_COUPON_REFUND_NOT_HELD';
  END IF;
  SELECT status INTO v_status FROM public.clube_coupon_paid_invoices WHERE id=v_invoice;
  IF v_status<>'review_required' THEN RAISE EXCEPTION 'INVOICE_REVIEW_MISSING'; END IF;

  INSERT INTO public.clube_coupon_paid_invoices
  (customer_user_id,package_key,request_id,sale_price_cents,
   coupon_face_cents,coupons_per_pack,valid_days,provider_order_id,status)
  VALUES (v_user,'test_finance',gen_random_uuid(),1000,500,2,90,
   'test-mp-order-2','awaiting_payment')
  RETURNING id INTO v_invoice_two;
  PERFORM public.clube_coupon_paid_payment_verify(
    v_invoice_two,'test-mp-order-2','mp-payment-3',1000);
  v_result:=public.clube_coupon_paid_payment_refund(
    v_invoice_two,'test-mp-order-2');
  SELECT count(*) INTO v_count FROM public.clube_coupon_paid_issuances
    WHERE invoice_id=v_invoice_two AND status='void';
  IF (v_result->>'refunded')::boolean IS DISTINCT FROM true OR v_count<>2
    THEN RAISE EXCEPTION 'FULL_REFUND_DID_NOT_VOID_COUPONS'; END IF;
  BEGIN
    PERFORM public.clube_coupon_paid_payment_verify(
      v_invoice_two,'test-mp-order-2','mp-payment-3',1000);
    RAISE EXCEPTION 'REFUND_COUPONS_REISSUED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COUPON_PAYMENT_STATE_INVALID%' THEN RAISE; END IF;
  END;

  INSERT INTO public.clube_coupon_paid_invoices
  (customer_user_id,package_key,request_id,sale_price_cents,
   coupon_face_cents,coupons_per_pack,valid_days,provider_order_id,status)
  VALUES (v_user,'test_finance',gen_random_uuid(),1000,500,2,90,
   'test-mp-order-3','awaiting_payment')
  RETURNING id INTO v_invoice_three;
  PERFORM public.clube_coupon_paid_payment_verify(
    v_invoice_three,'test-mp-order-3','mp-payment-4',1000);
  v_result:=public.clube_coupon_paid_payment_review(
    v_invoice_three,'test-mp-order-3');
  SELECT count(*) INTO v_count FROM public.clube_coupon_paid_issuances
    WHERE invoice_id=v_invoice_three AND status='review_required';
  IF (v_result->>'reviewRequired')::boolean IS DISTINCT FROM true OR v_count<>2
    THEN RAISE EXCEPTION 'PARTIAL_REFUND_REVIEW_NOT_ENFORCED'; END IF;
END
$coupon_finance_test$;
