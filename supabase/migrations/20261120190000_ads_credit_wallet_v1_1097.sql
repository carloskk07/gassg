-- V1.1097: independent prepaid advertising ledger. Safe to install with all
-- commercial toggles OFF. Historical fixed-duration campaigns are untouched.
BEGIN;

CREATE TABLE public.ads_credit_controls_v1_1097 (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 recharge_enabled boolean NOT NULL DEFAULT false,
 view_debit_enabled boolean NOT NULL DEFAULT false,
 evidence_audited boolean NOT NULL DEFAULT false,
 cents_per_view integer NOT NULL DEFAULT 2 CHECK(cents_per_view BETWEEN 1 AND 25),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (NOT view_debit_enabled OR (recharge_enabled AND evidence_audited))
);
INSERT INTO public.ads_credit_controls_v1_1097(singleton) VALUES(true);

CREATE TABLE public.ads_credit_wallets_v1_1097 (
 owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 balance_cents bigint NOT NULL DEFAULT 0 CHECK(balance_cents>=0),
 total_loaded_cents bigint NOT NULL DEFAULT 0 CHECK(total_loaded_cents>=0),
 total_spent_cents bigint NOT NULL DEFAULT 0 CHECK(total_spent_cents>=0),
 disputed_cents bigint NOT NULL DEFAULT 0 CHECK(disputed_cents>=0),
 frozen boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.ads_credit_topups_v1_1097 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE,
 external_reference text NOT NULL UNIQUE
  CHECK(external_reference ~ '^tamao-ads-credit-[0-9a-f]{32}$'),
 amount_cents integer NOT NULL CHECK(amount_cents IN (1990,4990,9990,19990)),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN
  ('reserved','creating','pix_pending','approved','reversed','review_required')),
 pix_code text,
 pix_expires_at timestamptz,
 provider_payment_id text UNIQUE,
 collector_id text,
 provider_status text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 paid_at timestamptz,
 reversed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (status<>'pix_pending' OR
  (provider_payment_id IS NOT NULL AND pix_code IS NOT NULL AND pix_expires_at IS NOT NULL))
);
CREATE INDEX ads_credit_topups_owner_v1_1097 ON
 public.ads_credit_topups_v1_1097(owner_user_id,created_at DESC);

CREATE TABLE public.ads_credit_ledger_v1_1097 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES public.ads_credit_wallets_v1_1097(owner_user_id),
 event_key text NOT NULL UNIQUE CHECK(length(event_key) BETWEEN 8 AND 160),
 topup_id uuid REFERENCES public.ads_credit_topups_v1_1097(id),
 source_view_id uuid,
 operation text NOT NULL CHECK(operation IN ('topup','view','reversal')),
 delta_cents bigint NOT NULL,
 balance_after_cents bigint NOT NULL CHECK(balance_after_cents>=0),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((operation='topup' AND delta_cents>0)
  OR (operation IN('view','reversal') AND delta_cents<=0)),
 CHECK ((operation='topup' AND topup_id IS NOT NULL)
  OR (operation='reversal' AND topup_id IS NOT NULL)
  OR (operation='view' AND source_view_id IS NOT NULL))
);
CREATE INDEX ads_credit_ledger_owner_v1_1097 ON
 public.ads_credit_ledger_v1_1097(owner_user_id,id DESC);

-- Reviewable delivery evidence is not the same as arbitrary browser claims.
-- No one can mark a view as audited through the public client.
CREATE TABLE public.ads_credit_verified_views_v1_1097 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES public.ads_credit_wallets_v1_1097(owner_user_id),
 campaign_id uuid NOT NULL,
 issued_token uuid NOT NULL UNIQUE,
 viewer_hash text NOT NULL CHECK(viewer_hash ~ '^[0-9a-f]{64}$'),
 eligible boolean NOT NULL DEFAULT false,
 reviewed_by uuid REFERENCES auth.users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(eligible=false OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX ads_credit_views_campaign_v1_1097 ON
 public.ads_credit_verified_views_v1_1097(campaign_id,created_at DESC);

DO $policy$ DECLARE item text;
BEGIN
 FOREACH item IN ARRAY ARRAY[
 'ads_credit_controls_v1_1097','ads_credit_wallets_v1_1097',
 'ads_credit_topups_v1_1097','ads_credit_ledger_v1_1097',
 'ads_credit_verified_views_v1_1097'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',item);
 END LOOP;
END;$policy$;
GRANT SELECT ON public.ads_credit_controls_v1_1097 TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.ads_credit_wallets_v1_1097 TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.ads_credit_topups_v1_1097 TO service_role;
GRANT SELECT,INSERT ON public.ads_credit_ledger_v1_1097 TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.ads_credit_verified_views_v1_1097 TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.ads_credit_ledger_v1_1097_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.ads_credit_balance_v1_1097(p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE w record; gate record;
BEGIN
 IF p_owner IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users u
  WHERE u.id=p_owner AND u.is_anonymous IS FALSE AND u.email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'ADS_CREDIT_ACCOUNT_NOT_VERIFIED' USING errcode='42501';END IF;
 SELECT * INTO gate FROM public.ads_credit_controls_v1_1097 WHERE singleton;
 SELECT * INTO w FROM public.ads_credit_wallets_v1_1097 WHERE owner_user_id=p_owner;
 RETURN jsonb_build_object('source','ads_credit_balance_v1_1097',
  'balanceCents',coalesce(w.balance_cents,0),
  'totalLoadedCents',coalesce(w.total_loaded_cents,0),
  'totalSpentCents',coalesce(w.total_spent_cents,0),
  'frozen',coalesce(w.frozen,false),
  'rechargeEnabled',gate.recharge_enabled,'billingEnabled',gate.view_debit_enabled,
  'centsPerView',gate.cents_per_view,
  'topups',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',t.id,'amountCents',t.amount_cents,'status',t.status,
    'createdAt',t.created_at,'paidAt',t.paid_at) ORDER BY t.created_at DESC)
    FROM (SELECT * FROM public.ads_credit_topups_v1_1097
      WHERE owner_user_id=p_owner ORDER BY created_at DESC LIMIT 20)t),'[]'::jsonb),
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'operation',l.operation,'deltaCents',l.delta_cents,
    'balanceAfterCents',l.balance_after_cents,'at',l.recorded_at)
    ORDER BY l.id DESC) FROM
    (SELECT * FROM public.ads_credit_ledger_v1_1097
      WHERE owner_user_id=p_owner ORDER BY id DESC LIMIT 40) l),'[]'::jsonb));
END;$fn$;

CREATE OR REPLACE FUNCTION public.ads_credit_topup_reserve_v1_1097(
 p_owner uuid,p_request uuid,p_amount integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE v public.ads_credit_topups_v1_1097%ROWTYPE;
BEGIN
 IF p_owner IS NULL OR p_request IS NULL OR
  NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_owner
    AND u.is_anonymous IS FALSE AND u.email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'ADS_CREDIT_VERIFIED_OWNER_REQUIRED' USING errcode='42501';END IF;
 IF p_amount NOT IN(1990,4990,9990,19990)
 THEN RAISE EXCEPTION 'ADS_CREDIT_AMOUNT_INVALID' USING errcode='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ads_credit_controls_v1_1097
  WHERE singleton AND recharge_enabled AND view_debit_enabled
   AND evidence_audited)
 THEN RAISE EXCEPTION 'ADS_CREDIT_RECHARGE_DISABLED' USING errcode='42501';END IF;
 SELECT * INTO v FROM public.ads_credit_topups_v1_1097
  WHERE request_id=p_request FOR UPDATE;
 IF FOUND THEN
  IF v.owner_user_id<>p_owner OR v.amount_cents<>p_amount
  THEN RAISE EXCEPTION 'ADS_CREDIT_REQUEST_REUSED' USING errcode='40001';END IF;
 ELSE
  INSERT INTO public.ads_credit_wallets_v1_1097(owner_user_id) VALUES(p_owner)
   ON CONFLICT(owner_user_id) DO NOTHING;
  IF EXISTS(SELECT 1 FROM public.ads_credit_wallets_v1_1097
   WHERE owner_user_id=p_owner AND frozen)
  THEN RAISE EXCEPTION 'ADS_CREDIT_WALLET_FROZEN' USING errcode='42501';END IF;
  IF EXISTS(SELECT 1 FROM public.ads_credit_topups_v1_1097
    WHERE owner_user_id=p_owner AND status IN('reserved','creating','pix_pending')
     AND created_at>clock_timestamp()-interval '3 days')
  THEN RAISE EXCEPTION 'ADS_CREDIT_PENDING_TOPUP_EXISTS' USING errcode='42501';END IF;
  INSERT INTO public.ads_credit_topups_v1_1097(
   owner_user_id,request_id,external_reference,amount_cents)
  VALUES(p_owner,p_request,'tamao-ads-credit-'||replace(p_request::text,'-',''),p_amount)
  ON CONFLICT(request_id) DO NOTHING;
  SELECT * INTO v FROM public.ads_credit_topups_v1_1097
   WHERE request_id=p_request FOR UPDATE;
  IF v.owner_user_id<>p_owner OR v.amount_cents<>p_amount
  THEN RAISE EXCEPTION 'ADS_CREDIT_REQUEST_REUSED' USING errcode='40001';END IF;
 END IF;
 RETURN jsonb_build_object('source','ads_credit_topup_reserve_v1_1097',
  'topupId',v.id,'externalReference',v.external_reference,'amountCents',v.amount_cents,
  'status',v.status,'paymentId',v.provider_payment_id);
END;$fn$;

-- Only one open payment intention per owner: recover instead of creating a
-- second Pix. A timed-out provider POST is NEVER retried blindly.
CREATE OR REPLACE FUNCTION public.ads_credit_topup_claim_v1_1097(
 p_owner uuid,p_topup uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE t public.ads_credit_topups_v1_1097%ROWTYPE; allowed boolean;
BEGIN
 SELECT recharge_enabled INTO allowed FROM public.ads_credit_controls_v1_1097
  WHERE singleton AND view_debit_enabled AND evidence_audited;
 IF allowed IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'ADS_CREDIT_RECHARGE_DISABLED' USING errcode='42501';END IF;
 SELECT * INTO t FROM public.ads_credit_topups_v1_1097
  WHERE id=p_topup AND owner_user_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADS_CREDIT_TOPUP_DENIED' USING errcode='42501';END IF;
 IF t.status='reserved' THEN
  UPDATE public.ads_credit_topups_v1_1097 SET status='creating',
   updated_at=clock_timestamp() WHERE id=t.id;
  RETURN jsonb_build_object('source','ads_credit_topup_claim_v1_1097',
   'canCreate',true,'topupId',t.id,'amountCents',t.amount_cents,
   'externalReference',t.external_reference);
 END IF;
 RETURN jsonb_build_object('source','ads_credit_topup_claim_v1_1097',
  'canCreate',false,'status',t.status,'topupId',t.id,
  'amountCents',t.amount_cents,'externalReference',t.external_reference);
END;$fn$;

CREATE OR REPLACE FUNCTION public.ads_credit_topup_attach_v1_1097(
 p_owner uuid,p_topup uuid,p_payment text,p_collector text,p_code text,
 p_expires timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE t public.ads_credit_topups_v1_1097%ROWTYPE;
BEGIN
 IF p_payment !~ '^[0-9]{5,30}
-- The event is idempotent, and every wallet mutation happens in one transaction.
CREATE OR REPLACE FUNCTION public.ads_credit_payment_fact_v1_1097(
 p_event_key text,p_reference text,p_payment text,p_collector text,p_amount integer,
 p_status text,p_status_detail text,p_live boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE t public.ads_credit_topups_v1_1097%ROWTYPE;
 w public.ads_credit_wallets_v1_1097%ROWTYPE;
 v_status text; v_delta bigint:=0; v_recorded bigint;
BEGIN
 IF p_event_key !~ '^[0-9a-f]{64}$' OR
  p_payment !~ '^[0-9]{5,30}$' OR p_collector !~ '^[0-9]{4,20}$'
  OR p_live IS DISTINCT FROM true OR
  p_status NOT IN ('approved','refunded','charged_back','pending','in_process','cancelled','rejected')
  OR length(coalesce(p_status_detail,''))>120
 THEN RAISE EXCEPTION 'ADS_CREDIT_PROVIDER_EVIDENCE_INVALID' USING errcode='42501';END IF;
 SELECT * INTO t FROM public.ads_credit_topups_v1_1097
  WHERE external_reference=p_reference FOR UPDATE;
 IF NOT FOUND OR t.amount_cents<>p_amount OR
   t.status NOT IN('pix_pending','approved','reversed','review_required')
 THEN RAISE EXCEPTION 'ADS_CREDIT_REFERENCE_INVALID' USING errcode='42501';END IF;
 IF t.collector_id IS NOT NULL AND t.collector_id<>p_collector OR
   t.provider_payment_id IS NOT NULL AND t.provider_payment_id<>p_payment
 THEN RAISE EXCEPTION 'ADS_CREDIT_PAYMENT_IDENTITY_CONFLICT' USING errcode='42501';END IF;
 SELECT * INTO w FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=t.owner_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADS_CREDIT_WALLET_MISSING' USING errcode='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.ads_credit_ledger_v1_1097 WHERE event_key=p_event_key)
 THEN RETURN jsonb_build_object('source','ads_credit_payment_fact_v1_1097',
  'replayed',true,'status',t.status,'balanceCents',w.balance_cents);END IF;
 v_status:=t.status;
 IF p_status='approved' AND p_status_detail='accredited' AND t.status='pix_pending' THEN
  v_delta:=t.amount_cents;
  UPDATE public.ads_credit_wallets_v1_1097 SET
   balance_cents=balance_cents+v_delta,
   total_loaded_cents=total_loaded_cents+v_delta,
   updated_at=clock_timestamp()
   WHERE owner_user_id=t.owner_user_id;
  v_status:='approved';
  UPDATE public.ads_credit_topups_v1_1097 SET
   status=v_status,provider_payment_id=p_payment,collector_id=p_collector,
   provider_status=p_status,paid_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE id=t.id;
 ELSIF p_status IN ('refunded','charged_back') AND t.status='approved' THEN
  v_delta:=-least(w.balance_cents,t.amount_cents::bigint);
  UPDATE public.ads_credit_wallets_v1_1097 SET
   balance_cents=balance_cents+v_delta,
   disputed_cents=disputed_cents+(t.amount_cents+v_delta),
   frozen=true,updated_at=clock_timestamp()
   WHERE owner_user_id=t.owner_user_id;
  v_status:='reversed';
  UPDATE public.ads_credit_topups_v1_1097 SET
   status=v_status,provider_status=p_status,reversed_at=clock_timestamp(),
   updated_at=clock_timestamp() WHERE id=t.id;
 ELSE
  RETURN jsonb_build_object('source','ads_credit_payment_fact_v1_1097',
   'recorded',false,'status',v_status,'balanceCents',w.balance_cents);
 END IF;
 SELECT balance_cents INTO v_recorded FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=t.owner_user_id;
 INSERT INTO public.ads_credit_ledger_v1_1097(
  owner_user_id,event_key,topup_id,operation,delta_cents,balance_after_cents)
 VALUES(t.owner_user_id,p_event_key,t.id,
  CASE WHEN v_status='approved' THEN 'topup' ELSE 'reversal' END,v_delta,v_recorded);
 RETURN jsonb_build_object('source','ads_credit_payment_fact_v1_1097',
  'recorded',true,'status',v_status,'balanceCents',v_recorded);
END;$fn$;

-- Billable views require a distinct audited proof and explicit commercial
-- activation. Browser "confirm" claims are NEVER fed into this procedure.
CREATE OR REPLACE FUNCTION public.ads_credit_debit_verified_v1_1097(
 p_view uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE v public.ads_credit_verified_views_v1_1097%ROWTYPE;
 w public.ads_credit_wallets_v1_1097%ROWTYPE; price integer;
 key text; new_balance bigint;
BEGIN
 SELECT * INTO v FROM public.ads_credit_verified_views_v1_1097
  WHERE id=p_view FOR UPDATE;
 IF NOT FOUND OR v.eligible IS DISTINCT FROM true OR
  v.reviewed_at IS NULL OR v.reviewed_by IS NULL
 THEN RAISE EXCEPTION 'ADS_CREDIT_AUDITED_PROOF_REQUIRED' USING errcode='42501';END IF;
 SELECT cents_per_view INTO price FROM public.ads_credit_controls_v1_1097
  WHERE singleton AND view_debit_enabled AND evidence_audited;
 IF price IS NULL THEN
  RAISE EXCEPTION 'ADS_CREDIT_BILLING_DISABLED' USING errcode='42501';END IF;
 key:='verified-view:'||v.id::text;
 SELECT * INTO w FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=v.owner_user_id FOR UPDATE;
 IF NOT FOUND OR w.frozen THEN
  RAISE EXCEPTION 'ADS_CREDIT_WALLET_LOCKED' USING errcode='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.ads_credit_ledger_v1_1097 WHERE event_key=key)
 THEN RETURN jsonb_build_object('source','ads_credit_debit_verified_v1_1097',
   'replayed',true,'balanceCents',w.balance_cents);END IF;
 IF w.balance_cents<price THEN RETURN jsonb_build_object(
  'source','ads_credit_debit_verified_v1_1097','charged',false,
  'reason','insufficient_balance','balanceCents',w.balance_cents);END IF;
 UPDATE public.ads_credit_wallets_v1_1097 SET
  balance_cents=balance_cents-price,total_spent_cents=total_spent_cents+price,
  updated_at=clock_timestamp() WHERE owner_user_id=v.owner_user_id
 RETURNING balance_cents INTO new_balance;
 INSERT INTO public.ads_credit_ledger_v1_1097(
  owner_user_id,event_key,source_view_id,operation,delta_cents,balance_after_cents)
 VALUES(v.owner_user_id,key,v.id,'view',-price,new_balance);
 RETURN jsonb_build_object('source','ads_credit_debit_verified_v1_1097',
  'charged',true,'chargedCents',price,'balanceCents',new_balance);
END;$fn$;

DO $perm$ DECLARE f record;
BEGIN
 FOR f IN SELECT oid::regprocedure::text AS signature
  FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname IN('ads_credit_balance_v1_1097',
     'ads_credit_topup_reserve_v1_1097','ads_credit_topup_claim_v1_1097',
     'ads_credit_topup_attach_v1_1097','ads_credit_payment_fact_v1_1097',
     'ads_credit_debit_verified_v1_1097') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';
 END LOOP;
END;$perm$;
COMMIT;
 OR p_collector !~ '^[0-9]{4,20}
-- The event is idempotent, and every wallet mutation happens in one transaction.
CREATE OR REPLACE FUNCTION public.ads_credit_payment_fact_v1_1097(
 p_event_key text,p_reference text,p_payment text,p_collector text,p_amount integer,
 p_status text,p_status_detail text,p_live boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE t public.ads_credit_topups_v1_1097%ROWTYPE;
 w public.ads_credit_wallets_v1_1097%ROWTYPE;
 v_status text; v_delta bigint:=0; v_recorded bigint;
BEGIN
 IF p_event_key !~ '^[0-9a-f]{64}$' OR
  p_payment !~ '^[0-9]{5,30}$' OR p_collector !~ '^[0-9]{4,20}$'
  OR p_live IS DISTINCT FROM true OR
  p_status NOT IN ('approved','refunded','charged_back','pending','in_process','cancelled','rejected')
  OR length(coalesce(p_status_detail,''))>120
 THEN RAISE EXCEPTION 'ADS_CREDIT_PROVIDER_EVIDENCE_INVALID' USING errcode='42501';END IF;
 SELECT * INTO t FROM public.ads_credit_topups_v1_1097
  WHERE external_reference=p_reference FOR UPDATE;
 IF NOT FOUND OR t.amount_cents<>p_amount OR
   t.status NOT IN('pix_pending','approved','reversed','review_required')
 THEN RAISE EXCEPTION 'ADS_CREDIT_REFERENCE_INVALID' USING errcode='42501';END IF;
 IF t.collector_id IS NOT NULL AND t.collector_id<>p_collector OR
   t.provider_payment_id IS NOT NULL AND t.provider_payment_id<>p_payment
 THEN RAISE EXCEPTION 'ADS_CREDIT_PAYMENT_IDENTITY_CONFLICT' USING errcode='42501';END IF;
 SELECT * INTO w FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=t.owner_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADS_CREDIT_WALLET_MISSING' USING errcode='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.ads_credit_ledger_v1_1097 WHERE event_key=p_event_key)
 THEN RETURN jsonb_build_object('source','ads_credit_payment_fact_v1_1097',
  'replayed',true,'status',t.status,'balanceCents',w.balance_cents);END IF;
 v_status:=t.status;
 IF p_status='approved' AND p_status_detail='accredited' AND t.status='pix_pending' THEN
  v_delta:=t.amount_cents;
  UPDATE public.ads_credit_wallets_v1_1097 SET
   balance_cents=balance_cents+v_delta,
   total_loaded_cents=total_loaded_cents+v_delta,
   updated_at=clock_timestamp()
   WHERE owner_user_id=t.owner_user_id;
  v_status:='approved';
  UPDATE public.ads_credit_topups_v1_1097 SET
   status=v_status,provider_payment_id=p_payment,collector_id=p_collector,
   provider_status=p_status,paid_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE id=t.id;
 ELSIF p_status IN ('refunded','charged_back') AND t.status='approved' THEN
  v_delta:=-least(w.balance_cents,t.amount_cents::bigint);
  UPDATE public.ads_credit_wallets_v1_1097 SET
   balance_cents=balance_cents+v_delta,
   disputed_cents=disputed_cents+(t.amount_cents+v_delta),
   frozen=true,updated_at=clock_timestamp()
   WHERE owner_user_id=t.owner_user_id;
  v_status:='reversed';
  UPDATE public.ads_credit_topups_v1_1097 SET
   status=v_status,provider_status=p_status,reversed_at=clock_timestamp(),
   updated_at=clock_timestamp() WHERE id=t.id;
 ELSE
  RETURN jsonb_build_object('source','ads_credit_payment_fact_v1_1097',
   'recorded',false,'status',v_status,'balanceCents',w.balance_cents);
 END IF;
 SELECT balance_cents INTO v_recorded FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=t.owner_user_id;
 INSERT INTO public.ads_credit_ledger_v1_1097(
  owner_user_id,event_key,topup_id,operation,delta_cents,balance_after_cents)
 VALUES(t.owner_user_id,p_event_key,t.id,
  CASE WHEN v_status='approved' THEN 'topup' ELSE 'reversal' END,v_delta,v_recorded);
 RETURN jsonb_build_object('source','ads_credit_payment_fact_v1_1097',
  'recorded',true,'status',v_status,'balanceCents',v_recorded);
END;$fn$;

-- Billable views require a distinct audited proof and explicit commercial
-- activation. Browser "confirm" claims are NEVER fed into this procedure.
CREATE OR REPLACE FUNCTION public.ads_credit_debit_verified_v1_1097(
 p_view uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE v public.ads_credit_verified_views_v1_1097%ROWTYPE;
 w public.ads_credit_wallets_v1_1097%ROWTYPE; price integer;
 key text; new_balance bigint;
BEGIN
 SELECT * INTO v FROM public.ads_credit_verified_views_v1_1097
  WHERE id=p_view FOR UPDATE;
 IF NOT FOUND OR v.eligible IS DISTINCT FROM true OR
  v.reviewed_at IS NULL OR v.reviewed_by IS NULL
 THEN RAISE EXCEPTION 'ADS_CREDIT_AUDITED_PROOF_REQUIRED' USING errcode='42501';END IF;
 SELECT cents_per_view INTO price FROM public.ads_credit_controls_v1_1097
  WHERE singleton AND view_debit_enabled AND evidence_audited;
 IF price IS NULL THEN
  RAISE EXCEPTION 'ADS_CREDIT_BILLING_DISABLED' USING errcode='42501';END IF;
 key:='verified-view:'||v.id::text;
 SELECT * INTO w FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=v.owner_user_id FOR UPDATE;
 IF NOT FOUND OR w.frozen THEN
  RAISE EXCEPTION 'ADS_CREDIT_WALLET_LOCKED' USING errcode='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.ads_credit_ledger_v1_1097 WHERE event_key=key)
 THEN RETURN jsonb_build_object('source','ads_credit_debit_verified_v1_1097',
   'replayed',true,'balanceCents',w.balance_cents);END IF;
 IF w.balance_cents<price THEN RETURN jsonb_build_object(
  'source','ads_credit_debit_verified_v1_1097','charged',false,
  'reason','insufficient_balance','balanceCents',w.balance_cents);END IF;
 UPDATE public.ads_credit_wallets_v1_1097 SET
  balance_cents=balance_cents-price,total_spent_cents=total_spent_cents+price,
  updated_at=clock_timestamp() WHERE owner_user_id=v.owner_user_id
 RETURNING balance_cents INTO new_balance;
 INSERT INTO public.ads_credit_ledger_v1_1097(
  owner_user_id,event_key,source_view_id,operation,delta_cents,balance_after_cents)
 VALUES(v.owner_user_id,key,v.id,'view',-price,new_balance);
 RETURN jsonb_build_object('source','ads_credit_debit_verified_v1_1097',
  'charged',true,'chargedCents',price,'balanceCents',new_balance);
END;$fn$;

DO $perm$ DECLARE f record;
BEGIN
 FOR f IN SELECT oid::regprocedure::text AS signature
  FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname IN('ads_credit_balance_v1_1097',
     'ads_credit_topup_reserve_v1_1097','ads_credit_payment_fact_v1_1097',
     'ads_credit_debit_verified_v1_1097') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';
 END LOOP;
END;$perm$;
COMMIT;

 OR length(coalesce(p_code,'')) NOT BETWEEN 20 AND 1500 OR
 p_expires<=clock_timestamp()+interval '60 seconds'
 OR p_expires>clock_timestamp()+interval '3 days'
 THEN RAISE EXCEPTION 'ADS_CREDIT_PIX_PROOF_INVALID' USING errcode='42501';END IF;
 SELECT * INTO t FROM public.ads_credit_topups_v1_1097
  WHERE id=p_topup AND owner_user_id=p_owner FOR UPDATE;
 IF NOT FOUND OR t.status NOT IN('creating','pix_pending')
 THEN RAISE EXCEPTION 'ADS_CREDIT_TOPUP_NOT_CREATING' USING errcode='42501';END IF;
 IF t.status='pix_pending' THEN
  IF t.provider_payment_id<>p_payment OR t.collector_id<>p_collector OR
    t.pix_code<>p_code OR t.pix_expires_at<>p_expires
  THEN RAISE EXCEPTION 'ADS_CREDIT_PIX_CONFLICT' USING errcode='40001';END IF;
 ELSE
  UPDATE public.ads_credit_topups_v1_1097 SET status='pix_pending',
   provider_payment_id=p_payment,collector_id=p_collector,
   pix_code=p_code,pix_expires_at=p_expires,updated_at=clock_timestamp()
   WHERE id=t.id;
 END IF;
 RETURN jsonb_build_object('source','ads_credit_topup_attach_v1_1097',
  'status','pix_pending','topupId',t.id,'amountCents',t.amount_cents,
  'pixCode',p_code,'expiresAt',p_expires);
END;$fn$;

-- This can only be called by a trusted Edge worker after a GET of Mercado Pago.
-- The event is idempotent, and every wallet mutation happens in one transaction.
CREATE OR REPLACE FUNCTION public.ads_credit_payment_fact_v1_1097(
 p_event_key text,p_reference text,p_payment text,p_collector text,p_amount integer,
 p_status text,p_status_detail text,p_live boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE t public.ads_credit_topups_v1_1097%ROWTYPE;
 w public.ads_credit_wallets_v1_1097%ROWTYPE;
 v_status text; v_delta bigint:=0; v_recorded bigint;
BEGIN
 IF p_event_key !~ '^[0-9a-f]{64}$' OR
  p_payment !~ '^[0-9]{5,30}$' OR p_collector !~ '^[0-9]{4,20}$'
  OR p_live IS DISTINCT FROM true OR
  p_status NOT IN ('approved','refunded','charged_back','pending','in_process','cancelled','rejected')
  OR length(coalesce(p_status_detail,''))>120
 THEN RAISE EXCEPTION 'ADS_CREDIT_PROVIDER_EVIDENCE_INVALID' USING errcode='42501';END IF;
 SELECT * INTO t FROM public.ads_credit_topups_v1_1097
  WHERE external_reference=p_reference FOR UPDATE;
 IF NOT FOUND OR t.amount_cents<>p_amount OR
   t.status NOT IN('pix_pending','approved','reversed','review_required')
 THEN RAISE EXCEPTION 'ADS_CREDIT_REFERENCE_INVALID' USING errcode='42501';END IF;
 IF t.collector_id IS NOT NULL AND t.collector_id<>p_collector OR
   t.provider_payment_id IS NOT NULL AND t.provider_payment_id<>p_payment
 THEN RAISE EXCEPTION 'ADS_CREDIT_PAYMENT_IDENTITY_CONFLICT' USING errcode='42501';END IF;
 SELECT * INTO w FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=t.owner_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADS_CREDIT_WALLET_MISSING' USING errcode='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.ads_credit_ledger_v1_1097 WHERE event_key=p_event_key)
 THEN RETURN jsonb_build_object('source','ads_credit_payment_fact_v1_1097',
  'replayed',true,'status',t.status,'balanceCents',w.balance_cents);END IF;
 v_status:=t.status;
 IF p_status='approved' AND p_status_detail='accredited' AND t.status='pix_pending' THEN
  v_delta:=t.amount_cents;
  UPDATE public.ads_credit_wallets_v1_1097 SET
   balance_cents=balance_cents+v_delta,
   total_loaded_cents=total_loaded_cents+v_delta,
   updated_at=clock_timestamp()
   WHERE owner_user_id=t.owner_user_id;
  v_status:='approved';
  UPDATE public.ads_credit_topups_v1_1097 SET
   status=v_status,provider_payment_id=p_payment,collector_id=p_collector,
   provider_status=p_status,paid_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE id=t.id;
 ELSIF p_status IN ('refunded','charged_back') AND t.status='approved' THEN
  v_delta:=-least(w.balance_cents,t.amount_cents::bigint);
  UPDATE public.ads_credit_wallets_v1_1097 SET
   balance_cents=balance_cents+v_delta,
   disputed_cents=disputed_cents+(t.amount_cents+v_delta),
   frozen=true,updated_at=clock_timestamp()
   WHERE owner_user_id=t.owner_user_id;
  v_status:='reversed';
  UPDATE public.ads_credit_topups_v1_1097 SET
   status=v_status,provider_status=p_status,reversed_at=clock_timestamp(),
   updated_at=clock_timestamp() WHERE id=t.id;
 ELSE
  RETURN jsonb_build_object('source','ads_credit_payment_fact_v1_1097',
   'recorded',false,'status',v_status,'balanceCents',w.balance_cents);
 END IF;
 SELECT balance_cents INTO v_recorded FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=t.owner_user_id;
 INSERT INTO public.ads_credit_ledger_v1_1097(
  owner_user_id,event_key,topup_id,operation,delta_cents,balance_after_cents)
 VALUES(t.owner_user_id,p_event_key,t.id,
  CASE WHEN v_status='approved' THEN 'topup' ELSE 'reversal' END,v_delta,v_recorded);
 RETURN jsonb_build_object('source','ads_credit_payment_fact_v1_1097',
  'recorded',true,'status',v_status,'balanceCents',v_recorded);
END;$fn$;

-- Billable views require a distinct audited proof and explicit commercial
-- activation. Browser "confirm" claims are NEVER fed into this procedure.
CREATE OR REPLACE FUNCTION public.ads_credit_debit_verified_v1_1097(
 p_view uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE v public.ads_credit_verified_views_v1_1097%ROWTYPE;
 w public.ads_credit_wallets_v1_1097%ROWTYPE; price integer;
 key text; new_balance bigint;
BEGIN
 SELECT * INTO v FROM public.ads_credit_verified_views_v1_1097
  WHERE id=p_view FOR UPDATE;
 IF NOT FOUND OR v.eligible IS DISTINCT FROM true OR
  v.reviewed_at IS NULL OR v.reviewed_by IS NULL
 THEN RAISE EXCEPTION 'ADS_CREDIT_AUDITED_PROOF_REQUIRED' USING errcode='42501';END IF;
 SELECT cents_per_view INTO price FROM public.ads_credit_controls_v1_1097
  WHERE singleton AND view_debit_enabled AND evidence_audited;
 IF price IS NULL THEN
  RAISE EXCEPTION 'ADS_CREDIT_BILLING_DISABLED' USING errcode='42501';END IF;
 key:='verified-view:'||v.id::text;
 SELECT * INTO w FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=v.owner_user_id FOR UPDATE;
 IF NOT FOUND OR w.frozen THEN
  RAISE EXCEPTION 'ADS_CREDIT_WALLET_LOCKED' USING errcode='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.ads_credit_ledger_v1_1097 WHERE event_key=key)
 THEN RETURN jsonb_build_object('source','ads_credit_debit_verified_v1_1097',
   'replayed',true,'balanceCents',w.balance_cents);END IF;
 IF w.balance_cents<price THEN RETURN jsonb_build_object(
  'source','ads_credit_debit_verified_v1_1097','charged',false,
  'reason','insufficient_balance','balanceCents',w.balance_cents);END IF;
 UPDATE public.ads_credit_wallets_v1_1097 SET
  balance_cents=balance_cents-price,total_spent_cents=total_spent_cents+price,
  updated_at=clock_timestamp() WHERE owner_user_id=v.owner_user_id
 RETURNING balance_cents INTO new_balance;
 INSERT INTO public.ads_credit_ledger_v1_1097(
  owner_user_id,event_key,source_view_id,operation,delta_cents,balance_after_cents)
 VALUES(v.owner_user_id,key,v.id,'view',-price,new_balance);
 RETURN jsonb_build_object('source','ads_credit_debit_verified_v1_1097',
  'charged',true,'chargedCents',price,'balanceCents',new_balance);
END;$fn$;

DO $perm$ DECLARE f record;
BEGIN
 FOR f IN SELECT oid::regprocedure::text AS signature
  FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname IN('ads_credit_balance_v1_1097',
     'ads_credit_topup_reserve_v1_1097','ads_credit_payment_fact_v1_1097',
     'ads_credit_debit_verified_v1_1097') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';
 END LOOP;
END;$perm$;
COMMIT;
