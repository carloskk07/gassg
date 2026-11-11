-- V1.953: disposable PostgreSQL only; all synthetic user/payment records ROLLBACK.
-- No production access, Pix, provider calls or persistent credit.
BEGIN;
SET LOCAL statement_timeout='60s';
DO $case$
DECLARE
  v_merchant uuid;
  v_admin uuid := 'a9530000-0000-4000-8000-000000000001';
  v_owner uuid := 'a9530000-0000-4000-8000-000000000002';
  v_plan public.merchant_billing_plans%rowtype;
  v_result jsonb;
  v_replay jsonb;
  v_id uuid;
  v_checks integer := 0;
  v_customer uuid := 'a9530000-0000-4000-8000-000000000003';
  v_order uuid;
  v_version integer;
  v_pin text;
  v_order_result jsonb;
  v_fee bigint;
  v_downgrade_denied boolean := false;
  v_old_denied boolean := false;
BEGIN
  -- The CI database is intentionally empty at this step; bootstrap a
  -- temporary owner/merchant inside this transaction, never in production.
  INSERT INTO auth.users(id,instance_id,aud,role,is_sso_user,is_anonymous,email,email_confirmed_at)
  VALUES(v_owner,'00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated',false,false,'v953-owner@example.invalid',clock_timestamp());
  INSERT INTO public.merchants(
    name,cnpj,status,online,accepts_citywide,last_seen_at,
    delivery_fee_confirmed_at,delivery_fee_cents
  ) VALUES('V953 ISOLATED PREPAID TEST','00000000000002','pending',false,true,
    clock_timestamp(),clock_timestamp(),0) RETURNING id INTO v_merchant;
  INSERT INTO public.merchant_members(merchant_id,user_id,member_role,active)
  VALUES(v_merchant,v_owner,'owner',true);
  INSERT INTO public.merchant_billing_accounts(merchant_id,plan_key)
  VALUES(v_merchant,'flex_daily')
  ON CONFLICT(merchant_id) DO NOTHING;

  INSERT INTO auth.users(id,instance_id,aud,role,is_sso_user,is_anonymous,email,email_confirmed_at)
  VALUES(v_admin,'00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated',false,false,'v953-local-admin@example.invalid',clock_timestamp());
  INSERT INTO public.platform_admins(user_id,active,admin_role)
  VALUES(v_admin,true,'superadmin');

  IF (SELECT plan_key FROM public.merchant_billing_accounts
      WHERE merchant_id=v_merchant)<>'flex_daily'
    OR (SELECT credit_balance_cents FROM public.merchant_billing_accounts
      WHERE merchant_id=v_merchant)<>0
  THEN RAISE EXCEPTION 'V953_SEEDED_ACCOUNT_NOT_FLEX_ZERO'; END IF;

  FOR v_plan IN SELECT * FROM public.merchant_billing_plans
     WHERE active AND billing_mode='prepaid_credit' ORDER BY sort_order LOOP
    v_result:=public.merchant_billing_request_action(
      v_owner,v_merchant,'submit-package',v_plan.plan_key,
      null::uuid,null::uuid,null::uuid,'synthetic-no-payment',
      'V953-'||v_plan.plan_key||'-request',repeat('a',64));
    v_replay:=public.merchant_billing_request_action(
      v_owner,v_merchant,'submit-package',v_plan.plan_key,
      null::uuid,null::uuid,null::uuid,'synthetic-no-payment',
      'V953-'||v_plan.plan_key||'-request',repeat('a',64));
    IF v_replay IS DISTINCT FROM v_result
      OR v_result->>'status'<>'pending'
      OR (v_result->>'expectedAmountCents')::bigint<>v_plan.purchase_amount_cents
    THEN RAISE EXCEPTION 'V953_REQUEST_REPLAY_OR_SNAPSHOT:%',v_plan.plan_key; END IF;
    v_id:=(v_result->>'paymentRequestId')::uuid;
    IF (SELECT count(*) FROM public.merchant_fee_credit_ledger WHERE merchant_id=v_merchant)<>0
      OR (SELECT credit_balance_cents FROM public.merchant_billing_accounts WHERE merchant_id=v_merchant)<>0
    THEN RAISE EXCEPTION 'V953_UNPAID_PLAN_CREDITED'; END IF;
    v_result:=public.merchant_billing_request_action(
      v_owner,v_merchant,'cancel-request',null::text,
      null::uuid,null::uuid,v_id,null::text,
      'V953-'||v_plan.plan_key||'-cancel',repeat('b',64));
    IF v_result->>'status'<>'cancelled'
      OR (SELECT status FROM public.merchant_billing_payment_requests WHERE id=v_id)<>'cancelled'
    THEN RAISE EXCEPTION 'V953_CANCEL_FAIL:%',v_plan.plan_key; END IF;
    v_checks:=v_checks+1;
  END LOOP;
  IF v_checks<>4 THEN RAISE EXCEPTION 'V953_EXPECTED_FOUR_PLANS:%',v_checks; END IF;

  BEGIN
    PERFORM public.merchant_billing_request_action(
      v_owner,v_merchant,'submit-package','credit_300',
      null::uuid,null::uuid,null::uuid,'synthetic-no-payment',
      'V953-legacy-rejected',repeat('c',64));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_old_denied:=true;
  END;
  IF NOT v_old_denied THEN RAISE EXCEPTION 'V953_LEGACY_PLAN_ACCEPTED'; END IF;

  -- Synthetic confirmation is allowed ONLY on this disposable DB; not PSP proof.
  v_result:=public.merchant_billing_request_action(
    v_owner,v_merchant,'submit-package','credit_19990',
    null::uuid,null::uuid,null::uuid,'synthetic-no-payment',
    'V953-funded-request',repeat('d',64));
  v_id:=(v_result->>'paymentRequestId')::uuid;
  IF (SELECT count(*) FROM public.merchant_fee_credit_ledger WHERE merchant_id=v_merchant)<>0
  THEN RAISE EXCEPTION 'V953_MONEY_BEFORE_APPROVAL'; END IF;

  v_result:=public.admin_merchant_billing_payment_request_action(
    v_admin,v_id,'approve','SYNTHETIC-ISOLATED-ONLY',
    'V953-synthetic-approval',repeat('e',64));
  IF (SELECT credit_balance_cents FROM public.merchant_billing_accounts
      WHERE merchant_id=v_merchant)<>19990
    OR (SELECT plan_key FROM public.merchant_billing_accounts
      WHERE merchant_id=v_merchant)<>'credit_19990'
    OR (SELECT count(*) FROM public.merchant_fee_credit_ledger
      WHERE merchant_id=v_merchant AND entry_type='package_credit'
        AND amount_cents=19990 AND payment_request_id=v_id)<>1
  THEN RAISE EXCEPTION 'V953_APPROVAL_LEDGER_ACCOUNT_MISMATCH'; END IF;

  v_replay:=public.admin_merchant_billing_payment_request_action(
    v_admin,v_id,'approve','SYNTHETIC-ISOLATED-ONLY',
    'V953-synthetic-approval',repeat('e',64));
  IF v_replay IS DISTINCT FROM v_result
    OR (SELECT count(*) FROM public.merchant_fee_credit_ledger
      WHERE merchant_id=v_merchant AND entry_type='package_credit')<>1
  THEN RAISE EXCEPTION 'V953_APPROVAL_DOUBLE_CREDIT'; END IF;

  BEGIN
    UPDATE public.merchant_billing_accounts
    SET plan_key='credit_01990' WHERE merchant_id=v_merchant;
  EXCEPTION WHEN SQLSTATE '40001' THEN v_downgrade_denied:=true;
  END;
  IF NOT v_downgrade_denied
  THEN RAISE EXCEPTION 'V953_DOWNGRADE_WITH_CREDIT_ALLOWED'; END IF;
  PERFORM public.assert_merchant_fee_credit_account_equation(v_merchant);

  -- Exercise the REAL merchant order/PIN/settlement engine against the
  -- synthetically funded account; this is still ONLY disposable CI data.
  INSERT INTO auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
  VALUES(v_customer,'authenticated','authenticated',false,
    'v953-buyer@example.invalid',clock_timestamp());
  UPDATE public.platform_launch_control
  SET commerce_enabled=true,operation_mode='LIVE',
      enabled_at=clock_timestamp(),enabled_by=v_owner,
      portals_source_sha=repeat('a',40),mode_source_sha=repeat('a',40)
  WHERE singleton=true;
  INSERT INTO public.merchant_compliance(
    merchant_id,cnpj_status,cnpj_verified_at,anp_status
  ) VALUES(v_merchant,'verified',clock_timestamp(),'pending');
  UPDATE public.merchants SET status='active',online=true WHERE id=v_merchant;
  INSERT INTO public.catalog_items(
    merchant_id,product_code,product_name,price_cents,
    min_price_cents,max_price_cents,available_stock,active,price_confirmed_at
  ) VALUES(v_merchant,'CHARCOAL4','Carvão 4 kg',12000,12000,12000,4,true,clock_timestamp());
  INSERT INTO public.merchant_payment_methods(
    merchant_id,payment_method,active,confirmed_at
  ) VALUES(v_merchant,'cash',true,clock_timestamp());
  INSERT INTO public.merchant_payment_routes(
    merchant_id,payment_method,provider,channel,verification_mode,
    active,customer_label,metadata
  ) VALUES(v_merchant,'cash','manual','delivery','merchant_confirmed',
    true,'Dinheiro na entrega','{"fundsOwner":"merchant"}'::jsonb);
  INSERT INTO public.orders(
    public_code,customer_id,status,address_text,address_number,postal_code,
    customer_phone_digits,payment_method,gross_total_cents,total_cents,
    delivery_fee_cents_snapshot,merchant_id,attempted_merchant_ids,
    offer_expires_at,version
  ) VALUES(
    'V953-ORDER',v_customer,'OFFERED_TO_MERCHANT',
    'Rua Teste 20 - São Gabriel/RS','20','97300000','51999998888',
    'cash',12000,12000,0,v_merchant,array[v_merchant],
    clock_timestamp()+interval '10 minutes',1
  ) RETURNING id INTO v_order;
  INSERT INTO public.order_items(order_id,product_code,product_name,quantity,
    unit_price_cents,line_total_cents)
  VALUES(v_order,'CHARCOAL4','Carvão 4 kg',1,12000,12000);
  v_order_result:=public.merchant_order_action(
    v_owner,v_order,'accept',1,'V953-order-accept',repeat('1',64));
  IF v_order_result->>'status'<>'PREPARING'
  THEN RAISE EXCEPTION 'V953_ORDER_ACCEPT_FAIL:%',v_order_result; END IF;
  SELECT version INTO v_version FROM public.orders WHERE id=v_order;
  v_order_result:=public.merchant_order_action(
    v_owner,v_order,'dispatch',v_version,'V953-order-dispatch',repeat('2',64));
  IF v_order_result->>'status'<>'OUT_FOR_DELIVERY'
  THEN RAISE EXCEPTION 'V953_ORDER_DISPATCH_FAIL:%',v_order_result; END IF;
  SELECT pin_code INTO v_pin FROM public.order_delivery_secrets WHERE order_id=v_order;
  IF v_pin IS NULL OR v_pin!~'^[0-9]{4}$'
  THEN RAISE EXCEPTION 'V953_ORDER_PIN_NOT_CREATED'; END IF;
  SELECT version INTO v_version FROM public.orders WHERE id=v_order;
  v_order_result:=public.merchant_order_action(
    v_owner,v_order,'arriving',v_version,'V953-order-arriving',repeat('3',64));
  IF v_order_result->>'status'<>'ARRIVING'
  THEN RAISE EXCEPTION 'V953_ORDER_ARRIVING_FAIL'; END IF;
  SELECT version INTO v_version FROM public.orders WHERE id=v_order;
  v_order_result:=public.complete_order_delivery(
    v_owner,v_order,v_pin,v_version,'V953-order-complete',repeat('4',64),true);
  IF v_order_result->>'status'<>'SETTLED'
  THEN RAISE EXCEPTION 'V953_ORDER_SETTLEMENT_FAIL:%',v_order_result; END IF;
  PERFORM public.process_deferred_settlement_accounting();
  SELECT platform_fee_cents INTO v_fee FROM public.platform_receivables
  WHERE order_id=v_order;
  IF v_fee<>780
  THEN RAISE EXCEPTION 'V953_EXPECTED_650BPS_ON_12000_GOT:%',v_fee; END IF;
  IF (SELECT credit_balance_cents FROM public.merchant_billing_accounts
        WHERE merchant_id=v_merchant)<>19990-v_fee
    OR (SELECT credit_reserved_cents FROM public.merchant_billing_accounts
        WHERE merchant_id=v_merchant)<>0
    OR (SELECT count(*) FROM public.merchant_fee_credit_ledger
        WHERE merchant_id=v_merchant AND entry_type='fee_consumption'
          AND order_id=v_order AND amount_cents=-v_fee)<>1
  THEN RAISE EXCEPTION 'V953_PREPAID_FEE_CONSUMPTION_NOT_RECONCILED'; END IF;
  PERFORM public.assert_merchant_fee_credit_account_equation(v_merchant);
  PERFORM public.process_deferred_settlement_accounting();
  IF (SELECT count(*) FROM public.platform_receivables WHERE order_id=v_order)<>1
    OR (SELECT count(*) FROM public.merchant_fee_credit_ledger
       WHERE order_id=v_order AND entry_type='fee_consumption')<>1
  THEN RAISE EXCEPTION 'V953_DUPLICATE_SETTLEMENT_OR_FEE_CONSUMPTION'; END IF;

  RAISE NOTICE 'V953_PASS: four plans, request replay, cancel, synthetic credit, downgrade protection, actual settled order fee 6.5 percent, one debit, rollback';
END $case$;
ROLLBACK;
