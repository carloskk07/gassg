-- TAMÃO paid voucher quote reservation, PostgreSQL 17.
-- In the isolated CI fixture, quotes is intentionally absent and we create
-- a minimal representation; on the live Supabase project only permission
-- and fail-closed contract tests run under BEGIN ... ROLLBACK.
DO $prepare_coupon_quote_fixture$
BEGIN
  IF to_regclass('public.quotes') IS NULL THEN
    EXECUTE 'create table public.quotes (
      id uuid primary key default gen_random_uuid(),
      customer_id uuid not null,
      gross_total_cents integer not null,
      consumed_at timestamptz,
      expires_at timestamptz not null
    )';
    -- Session-local (not transaction-local): two separate DO statements in
    -- the same psql -f connection must share this flag in disposable PG17 CI.
    -- The live migration dry run is wrapped in ROLLBACK, so it cannot persist.
    PERFORM pg_catalog.set_config('tamao.coupon.isolated_quote_fixture','true',false);
  ELSE
    PERFORM pg_catalog.set_config('tamao.coupon.isolated_quote_fixture','false',true);
  END IF;
END
$prepare_coupon_quote_fixture$;

DO $coupon_quote_reservation_test$
DECLARE
 v_user uuid;
 v_other uuid;
 v_invoice uuid;
 v_first uuid;
 v_second uuid;
 v_quote uuid;
 v_other_quote uuid;
 v_expired_quote uuid;
 v_small_quote uuid;
 v_result jsonb;
 v_status text;
 v_count integer;
BEGIN
  IF has_function_privilege('anon',
     'public.clube_coupon_paid_quote_reserve(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
     'public.clube_coupon_paid_quote_reserve(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon',
     'public.clube_coupon_paid_quote_release(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
     'public.clube_coupon_paid_quote_release(uuid,uuid,uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'COUPON_QUOTE_SERVICE_ONLY_GRANT_FAILED'; END IF;

  -- All checks that depend on constructing a synthetic quote run only in
  -- PostgreSQL CI: never create an artificial commerce quote in production.
  -- A fake-quote marker on this database means that positive tests MUST run:
  -- silently skipping them would create a false-green CI.
  IF current_setting('tamao.coupon.isolated_quote_fixture',true)<>'true' THEN
    IF to_regclass('public.quotes') IS NOT NULL
      AND EXISTS(
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid='public.quotes'::regclass
          AND a.attname='gross_total_cents'
          AND NOT a.attisdropped
      )
      AND NOT EXISTS(
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid='public.quotes'::regclass
          AND a.attname='merchant_id'
          AND NOT a.attisdropped
      )
    THEN RAISE EXCEPTION 'COUPON_QUOTE_FIXTURE_FLAG_LOST'; END IF;
    RETURN;
  END IF;
  SELECT id INTO v_user FROM auth.users ORDER BY id LIMIT 1;
  SELECT id INTO v_other FROM auth.users WHERE id<>v_user ORDER BY id LIMIT 1;
  IF v_user IS NULL OR v_other IS NULL
  THEN RAISE EXCEPTION 'COUPON_QUOTE_FIXTURE_USERS_MISSING'; END IF;

  INSERT INTO public.clube_coupon_paid_packages
    (package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,
     valid_days,funding_verified,legal_terms_verified,redeem_settlement_verified)
  VALUES
    ('quote_funded','Quote reservation test',1000,500,2,60,true,true,true);
  INSERT INTO public.clube_coupon_paid_invoices
    (customer_user_id,package_key,request_id,sale_price_cents,
     coupon_face_cents,coupons_per_pack,valid_days,provider_order_id,status)
  VALUES
    (v_user,'quote_funded',gen_random_uuid(),1000,500,2,60,
     'quote-provider-order','awaiting_payment')
  RETURNING id INTO v_invoice;
  PERFORM public.clube_coupon_paid_payment_verify(
    v_invoice,'quote-provider-order','quote-provider-payment',1000);

  SELECT id INTO v_first FROM public.clube_coupon_paid_issuances
   WHERE invoice_id=v_invoice AND ordinal=1;
  SELECT id INTO v_second FROM public.clube_coupon_paid_issuances
   WHERE invoice_id=v_invoice AND ordinal=2;

  INSERT INTO public.quotes(customer_id,gross_total_cents,expires_at)
    VALUES (v_user,1500,clock_timestamp()+interval '5 minutes')
    RETURNING id INTO v_quote;
  INSERT INTO public.quotes(customer_id,gross_total_cents,expires_at)
    VALUES (v_other,1500,clock_timestamp()+interval '5 minutes')
    RETURNING id INTO v_other_quote;
  INSERT INTO public.quotes(customer_id,gross_total_cents,expires_at)
    VALUES (v_user,1500,clock_timestamp()-interval '1 second')
    RETURNING id INTO v_expired_quote;
  INSERT INTO public.quotes(customer_id,gross_total_cents,expires_at)
    VALUES (v_user,400,clock_timestamp()+interval '5 minutes')
    RETURNING id INTO v_small_quote;

  BEGIN
    PERFORM public.clube_coupon_paid_quote_reserve(v_other,v_first,v_other_quote);
    RAISE EXCEPTION 'CROSS_OWNER_COUPON_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.clube_coupon_paid_quote_reserve(v_user,v_first,v_other_quote);
    RAISE EXCEPTION 'CROSS_OWNER_QUOTE_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.clube_coupon_paid_quote_reserve(v_user,v_first,v_expired_quote);
    RAISE EXCEPTION 'EXPIRED_QUOTE_ACCEPTED';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    PERFORM public.clube_coupon_paid_quote_reserve(v_user,v_first,v_small_quote);
    RAISE EXCEPTION 'COUPON_EXCEEDS_QUOTE_ALLOWED';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  v_result:=public.clube_coupon_paid_quote_reserve(v_user,v_first,v_quote);
  IF (v_result->>'reserved')::boolean IS DISTINCT FROM true
    OR (v_result->>'appliedCents')::integer<>0
  THEN RAISE EXCEPTION 'QUOTE_RESERVATION_SHOULD_NOT_CHARGE'; END IF;
  v_result:=public.clube_coupon_paid_quote_reserve(v_user,v_first,v_quote);
  IF (v_result->>'replayed')::boolean IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'COUPON_RESERVATION_REPLAY_FAILED'; END IF;
  BEGIN
    PERFORM public.clube_coupon_paid_quote_reserve(v_user,v_second,v_quote);
    RAISE EXCEPTION 'DOUBLE_VOUCHER_SAME_QUOTE';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.clube_coupon_paid_quote_release(v_other,v_first,v_quote);
    RAISE EXCEPTION 'CROSS_OWNER_RELEASE_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_result:=public.clube_coupon_paid_quote_release(v_user,v_first,v_quote);
  IF (v_result->>'released')::boolean IS DISTINCT FROM true
    OR (v_result->>'replayed')::boolean IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'COUPON_RELEASE_FAILED'; END IF;
  v_result:=public.clube_coupon_paid_quote_reserve(v_user,v_second,v_quote);
  IF (v_result->>'reserved')::boolean IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'REASSIGN_DIFFERENT_VOUCHER_FAILED'; END IF;
  -- Payment dispute must freeze the held coupon and clear stale reservation.
  PERFORM public.clube_coupon_paid_payment_review(v_invoice,'quote-provider-order');
  SELECT status INTO v_status FROM public.clube_coupon_paid_issuances
    WHERE id=v_second;
  IF v_status<>'review_required' THEN
    RAISE EXCEPTION 'COUPON_REFUND_DID_NOT_FREEZE_RESERVATION'; END IF;
  SELECT count(*) INTO v_count FROM public.clube_coupon_paid_issuances
    WHERE id=v_second AND reserved_quote_id IS NOT NULL;
  IF v_count<>0 THEN RAISE EXCEPTION 'COUPON_REFUND_LEFT_ACTIVE_RESERVATION'; END IF;
  BEGIN
    PERFORM public.clube_coupon_paid_quote_release(v_user,v_second,v_quote);
    RAISE EXCEPTION 'DISPUTED_COUPON_RELEASE_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$coupon_quote_reservation_test$;
