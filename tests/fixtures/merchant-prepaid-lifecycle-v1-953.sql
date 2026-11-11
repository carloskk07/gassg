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
  RAISE NOTICE 'V953_PASS: four plans, replay, cancel, no money before approval, one synthetic credit ledger, downgrade denied';
END $case$;
ROLLBACK;
