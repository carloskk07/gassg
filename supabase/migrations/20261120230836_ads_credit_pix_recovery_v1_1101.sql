-- Keep provider settlement independent of QR delivery. No commercial control is changed.
BEGIN;
ALTER TABLE public.ads_credit_topups_v1_1097
 DROP CONSTRAINT ads_credit_topups_v1_1097_status_check,
 ADD CONSTRAINT ads_credit_topups_v1_1097_status_check CHECK(status IN
 ('reserved','creating','pix_pending','approved','reversed','review_required','unpaid','closed_unissued')),
 ADD COLUMN admin_pilot boolean NOT NULL DEFAULT false,
 ADD COLUMN reversed_cents integer NOT NULL DEFAULT 0 CHECK(reversed_cents BETWEEN 0 AND amount_cents);
CREATE INDEX ads_credit_pilot_created_v1_1101 ON public.ads_credit_topups_v1_1097(created_at DESC) WHERE admin_pilot;
UPDATE public.ads_credit_topups_v1_1097 SET reversed_cents=amount_cents WHERE status='reversed';

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
    'id',t.id,'requestId',t.request_id,'amountCents',t.amount_cents,'status',t.status,
    'createdAt',t.created_at,'paidAt',t.paid_at,
    'pixCode',CASE WHEN t.status='pix_pending' AND
     t.pix_expires_at>clock_timestamp()+interval '60 seconds'
     THEN t.pix_code ELSE null END,
    'expiresAt',CASE WHEN t.status='pix_pending' THEN
     t.pix_expires_at ELSE null END) ORDER BY t.created_at DESC)
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
 IF p_amount IS NULL OR p_amount NOT IN(1990,4990,9990,19990)
 THEN RAISE EXCEPTION 'ADS_CREDIT_AMOUNT_INVALID' USING errcode='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ads_credit_controls_v1_1097
  WHERE singleton AND recharge_enabled AND view_debit_enabled AND evidence_audited)
 THEN RAISE EXCEPTION 'ADS_CREDIT_RECHARGE_DISABLED' USING errcode='42501';END IF;
 INSERT INTO public.ads_credit_wallets_v1_1097(owner_user_id) VALUES(p_owner)
  ON CONFLICT(owner_user_id) DO NOTHING;
 PERFORM 1 FROM public.ads_credit_wallets_v1_1097 WHERE owner_user_id=p_owner FOR UPDATE;
 -- Re-read the request after serializing simultaneous tabs, including the same UUID.
 SELECT * INTO v FROM public.ads_credit_topups_v1_1097 WHERE request_id=p_request;
 IF FOUND THEN
  IF v.owner_user_id<>p_owner OR v.amount_cents<>p_amount
  THEN RAISE EXCEPTION 'ADS_CREDIT_REQUEST_REUSED' USING errcode='40001';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.ads_credit_wallets_v1_1097
   WHERE owner_user_id=p_owner AND frozen)
  THEN RAISE EXCEPTION 'ADS_CREDIT_WALLET_FROZEN' USING errcode='42501';END IF;
  IF EXISTS(SELECT 1 FROM public.ads_credit_topups_v1_1097
    WHERE owner_user_id=p_owner AND status IN('reserved','creating','pix_pending','review_required'))
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


CREATE OR REPLACE FUNCTION public.ads_credit_topup_claim_v1_1097(
 p_owner uuid,p_topup uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE t public.ads_credit_topups_v1_1097%ROWTYPE; allowed boolean;
BEGIN
 SELECT * INTO t FROM public.ads_credit_topups_v1_1097
  WHERE id=p_topup AND owner_user_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADS_CREDIT_TOPUP_DENIED' USING errcode='42501';END IF;
 SELECT recharge_enabled INTO allowed FROM public.ads_credit_controls_v1_1097
  WHERE singleton AND view_debit_enabled AND evidence_audited;
 IF allowed IS DISTINCT FROM true AND NOT (t.admin_pilot AND t.amount_cents=1990 AND
   EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=p_owner AND active AND admin_role='superadmin'))
 THEN RAISE EXCEPTION 'ADS_CREDIT_RECHARGE_DISABLED' USING errcode='42501';END IF;
 IF t.status='reserved' AND t.created_at+interval '1 day'>clock_timestamp()+interval '1 minute' THEN
  PERFORM 1 FROM public.ads_credit_wallets_v1_1097 WHERE owner_user_id=p_owner AND NOT frozen FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADS_CREDIT_WALLET_FROZEN' USING errcode='42501';END IF;
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
 IF p_payment !~ '^[0-9]{5,30}$' OR p_collector !~ '^[0-9]{4,20}$'
 OR length(coalesce(p_code,'')) NOT BETWEEN 20 AND 1500 OR
 p_expires<=clock_timestamp()+interval '60 seconds'
 OR p_expires>clock_timestamp()+interval '3 days'
 THEN RAISE EXCEPTION 'ADS_CREDIT_PIX_PROOF_INVALID' USING errcode='42501';END IF;
 SELECT * INTO t FROM public.ads_credit_topups_v1_1097
  WHERE id=p_topup AND owner_user_id=p_owner FOR UPDATE;
 IF NOT FOUND OR t.status='reserved'
 THEN RAISE EXCEPTION 'ADS_CREDIT_TOPUP_NOT_CREATING' USING errcode='42501';END IF;
 IF (t.provider_payment_id IS NOT NULL AND t.provider_payment_id<>p_payment)
  OR (t.collector_id IS NOT NULL AND t.collector_id<>p_collector)
 THEN RAISE EXCEPTION 'ADS_CREDIT_PIX_CONFLICT' USING errcode='40001';END IF;
 IF t.status NOT IN ('creating','pix_pending') THEN
  RETURN jsonb_build_object('source','ads_credit_topup_attach_v1_1097',
   'status',t.status,'topupId',t.id,'amountCents',t.amount_cents);
 END IF;
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

-- Used only after a complete, empty search of the original reference at the seller.
-- A provider payment already attached can only be closed by a provider status.
CREATE FUNCTION public.ads_credit_close_unissued_v1_1101(p_owner uuid,p_topup uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $fn$
DECLARE t public.ads_credit_topups_v1_1097%ROWTYPE;
BEGIN
 SELECT * INTO STRICT t FROM public.ads_credit_topups_v1_1097
  WHERE id=p_topup AND owner_user_id=p_owner FOR UPDATE;
 IF t.status IN ('creating','reserved') AND t.provider_payment_id IS NULL
    AND (t.created_at<=clock_timestamp()-interval '3 days' OR
         (t.status='reserved' AND t.created_at+interval '1 day'<=clock_timestamp()+interval '1 minute')) THEN
  UPDATE public.ads_credit_topups_v1_1097 SET status='closed_unissued',
   updated_at=clock_timestamp() WHERE id=t.id RETURNING * INTO t;
 END IF;
 RETURN jsonb_build_object('source','ads_credit_close_unissued_v1_1101','status',t.status);
END;$fn$;

CREATE FUNCTION public.ads_credit_apply_payment_v1_1101(
 p_event_key text,p_reference text,p_payment text,p_collector text,p_amount integer,
 p_status text,p_status_detail text,p_live boolean,p_refunded_cents integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $fn$
DECLARE
 t public.ads_credit_topups_v1_1097%ROWTYPE;
 w public.ads_credit_wallets_v1_1097%ROWTYPE;
 next_status text; cumulative integer; refund_delta integer; debit bigint;
 partial_proof boolean; full_proof boolean; review boolean; recorded boolean:=false;
BEGIN
 IF coalesce(p_event_key,'') !~ '^[0-9a-f]{64}$' OR
    coalesce(p_payment,'') !~ '^[0-9]{5,30}$' OR coalesce(p_collector,'') !~ '^[0-9]{4,20}$' OR
    p_live IS DISTINCT FROM true OR p_amount IS NULL OR p_refunded_cents NOT BETWEEN 0 AND p_amount OR
    coalesce(p_status,'') NOT IN ('approved','refunded','charged_back','pending','in_process',
      'authorized','in_mediation','cancelled','rejected') OR length(coalesce(p_status_detail,''))>120
 THEN RAISE EXCEPTION 'ADS_CREDIT_PROVIDER_EVIDENCE_INVALID' USING errcode='42501';END IF;
 SELECT * INTO t FROM public.ads_credit_topups_v1_1097
  WHERE external_reference=p_reference FOR UPDATE;
 IF NOT FOUND OR t.amount_cents<>p_amount OR t.status='reserved'
 THEN RAISE EXCEPTION 'ADS_CREDIT_REFERENCE_INVALID' USING errcode='42501';END IF;
 IF (t.collector_id IS NOT NULL AND t.collector_id<>p_collector) OR
    (t.provider_payment_id IS NOT NULL AND t.provider_payment_id<>p_payment)
 THEN RAISE EXCEPTION 'ADS_CREDIT_PAYMENT_IDENTITY_CONFLICT' USING errcode='42501';END IF;
 SELECT * INTO STRICT w FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=t.owner_user_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.ads_credit_ledger_v1_1097 WHERE event_key=p_event_key AND topup_id=t.id)
 THEN RETURN jsonb_build_object('source','ads_credit_apply_payment_v1_1101',
  'replayed',true,'status',t.status,'balanceCents',w.balance_cents);END IF;

 next_status:=t.status;
 partial_proof:=p_status='approved' AND (coalesce(p_status_detail,'')='partially_refunded' OR coalesce(p_refunded_cents,0)>0);
 full_proof:=p_status='charged_back' OR
   (p_status='refunded' AND (p_refunded_cents IS NULL OR p_refunded_cents=p_amount));
 review:=p_status='in_mediation' OR (partial_proof AND coalesce(p_refunded_cents,0)=0)
   OR (p_status='refunded' AND NOT full_proof);
 cumulative:=CASE WHEN full_proof THEN p_amount WHEN partial_proof THEN p_refunded_cents END;

 IF t.status<>'reversed' THEN
  -- An approved partial can be the first observed payment. Journal the verified
  -- gross and the cumulative reversal in the same transaction; no spendable gap.
  IF t.paid_at IS NULL AND p_status='approved' AND NOT review AND
     (partial_proof OR (p_status_detail='accredited' AND t.status<>'review_required')) THEN
   UPDATE public.ads_credit_wallets_v1_1097 SET balance_cents=balance_cents+p_amount,
    total_loaded_cents=total_loaded_cents+p_amount,updated_at=clock_timestamp()
    WHERE owner_user_id=t.owner_user_id RETURNING * INTO w;
   INSERT INTO public.ads_credit_ledger_v1_1097
    (owner_user_id,event_key,topup_id,operation,delta_cents,balance_after_cents)
    VALUES(t.owner_user_id,CASE WHEN partial_proof THEN 'credit-load:'||t.id ELSE p_event_key END,
     t.id,'topup',p_amount,w.balance_cents);
   t.paid_at:=clock_timestamp();next_status:='approved';recorded:=true;
  END IF;

  IF review OR cumulative>t.reversed_cents THEN
   IF cumulative>t.reversed_cents AND t.paid_at IS NOT NULL THEN
    refund_delta:=cumulative-t.reversed_cents;
    debit:=least(w.balance_cents,refund_delta);
    UPDATE public.ads_credit_wallets_v1_1097 SET balance_cents=balance_cents-debit,
     disputed_cents=disputed_cents+refund_delta-debit,frozen=true,updated_at=clock_timestamp()
     WHERE owner_user_id=t.owner_user_id RETURNING * INTO w;
    INSERT INTO public.ads_credit_ledger_v1_1097
     (owner_user_id,event_key,topup_id,operation,delta_cents,balance_after_cents)
     VALUES(t.owner_user_id,p_event_key,t.id,'reversal',-debit,w.balance_cents);
    recorded:=true;
   ELSIF NOT w.frozen THEN
    UPDATE public.ads_credit_wallets_v1_1097 SET frozen=true,updated_at=clock_timestamp()
     WHERE owner_user_id=t.owner_user_id RETURNING * INTO w;
   END IF;
   IF cumulative>t.reversed_cents THEN t.reversed_cents:=cumulative;END IF;
   next_status:=CASE WHEN t.reversed_cents=p_amount THEN 'reversed' ELSE 'review_required' END;
  ELSIF p_status IN ('cancelled','rejected') AND t.paid_at IS NULL AND
        t.status IN ('creating','pix_pending','closed_unissued') THEN
   next_status:='unpaid';
  END IF;
 END IF;
 IF next_status IS DISTINCT FROM t.status OR t.provider_payment_id IS NULL OR recorded THEN
  UPDATE public.ads_credit_topups_v1_1097 SET status=next_status,provider_payment_id=p_payment,
   collector_id=p_collector,provider_status=p_status,paid_at=t.paid_at,reversed_cents=t.reversed_cents,
   reversed_at=CASE WHEN next_status='reversed' THEN coalesce(reversed_at,clock_timestamp()) ELSE reversed_at END,
   updated_at=clock_timestamp() WHERE id=t.id;
  recorded:=true;
 END IF;
 RETURN jsonb_build_object('source','ads_credit_apply_payment_v1_1101','recorded',recorded,
  'status',next_status,'balanceCents',w.balance_cents);
END;$fn$;

-- One real founder checkout on the existing ledger. Reading or opening the Admin
-- never creates a wallet or intention. The public reserve and all view gates stay closed.
CREATE FUNCTION public.admin_ads_credit_pilot_v1_1101(p_actor uuid,p_operation text,p_previous uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $fn$
DECLARE
 t public.ads_credit_topups_v1_1097%ROWTYPE;
 gate public.ads_credit_controls_v1_1097%ROWTYPE;
 req uuid; fresh boolean; balance bigint; frozen_wallet boolean;
BEGIN
 IF p_operation IS NULL OR p_operation NOT IN ('read','prepare') OR NOT EXISTS(
  SELECT 1 FROM public.platform_admins a JOIN auth.users u ON u.id=a.user_id
   WHERE a.user_id=p_actor AND a.active AND a.admin_role='superadmin'
    AND u.email_confirmed_at IS NOT NULL AND u.is_anonymous IS FALSE)
 THEN RAISE EXCEPTION 'ADS_CREDIT_PILOT_DENIED' USING errcode='42501';END IF;
 IF p_operation='prepare' THEN
  SELECT * INTO STRICT gate FROM public.ads_credit_controls_v1_1097 WHERE singleton FOR UPDATE;
 ELSE
  SELECT * INTO STRICT gate FROM public.ads_credit_controls_v1_1097 WHERE singleton;
 END IF;
 SELECT * INTO t FROM public.ads_credit_topups_v1_1097 WHERE admin_pilot
  ORDER BY created_at DESC,id DESC LIMIT 1;
 IF t.id IS NOT NULL AND t.owner_user_id<>p_actor THEN
  RETURN jsonb_build_object('source','admin_ads_credit_pilot_v1_1101','status','other_owner','canStart',false);
 END IF;
 SELECT balance_cents,frozen INTO balance,frozen_wallet FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=p_actor;
 fresh:=NOT gate.recharge_enabled AND NOT coalesce(frozen_wallet,false) AND
  (t.id IS NULL OR t.status IN ('unpaid','closed_unissued')) AND
  NOT EXISTS(SELECT 1 FROM public.ads_credit_topups_v1_1097
    WHERE owner_user_id=p_actor AND status IN ('reserved','creating','pix_pending','review_required'))
  AND NOT EXISTS(SELECT 1 FROM public.ads_credit_topups_v1_1097
    WHERE admin_pilot AND (paid_at IS NOT NULL OR status='reversed'));
 IF p_operation='prepare' AND fresh AND p_previous IS NOT DISTINCT FROM t.id THEN
  INSERT INTO public.ads_credit_wallets_v1_1097(owner_user_id) VALUES(p_actor) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.ads_credit_wallets_v1_1097 WHERE owner_user_id=p_actor AND NOT frozen FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADS_CREDIT_WALLET_FROZEN' USING errcode='42501';END IF;
  IF EXISTS(SELECT 1 FROM public.ads_credit_topups_v1_1097 WHERE owner_user_id=p_actor
    AND status IN ('reserved','creating','pix_pending','review_required'))
  THEN RAISE EXCEPTION 'ADS_CREDIT_PENDING_TOPUP_EXISTS' USING errcode='42501';END IF;
  req:=gen_random_uuid();
  INSERT INTO public.ads_credit_topups_v1_1097(owner_user_id,request_id,external_reference,amount_cents,admin_pilot)
   VALUES(p_actor,req,'tamao-ads-credit-'||replace(req::text,'-',''),1990,true) RETURNING * INTO t;
  fresh:=false;
 END IF;
 RETURN jsonb_build_object('source','admin_ads_credit_pilot_v1_1101','status',coalesce(t.status,'idle'),
  'canStart',fresh,'topupId',t.id,'requestId',t.request_id,'externalReference',t.external_reference,
  'amountCents',1990,'balanceCents',coalesce(balance,0),'expiresAt',t.pix_expires_at,
  'pixCode',CASE WHEN t.status='pix_pending' AND t.pix_expires_at>clock_timestamp()+interval '1 minute'
   THEN t.pix_code ELSE NULL END);
END;$fn$;
REVOKE ALL ON FUNCTION public.admin_ads_credit_pilot_v1_1101(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ads_credit_pilot_v1_1101(uuid,text,uuid) TO service_role;

-- Older workers and the original RPC continue to use the same transaction and response contract.
CREATE OR REPLACE FUNCTION public.ads_credit_payment_fact_v1_1097(
 p_event_key text,p_reference text,p_payment text,p_collector text,p_amount integer,
 p_status text,p_status_detail text,p_live boolean
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $fn$
 SELECT public.ads_credit_apply_payment_v1_1101(p_event_key,p_reference,p_payment,p_collector,
  p_amount,p_status,p_status_detail,p_live,NULL) ||
  jsonb_build_object('source','ads_credit_payment_fact_v1_1097');
$fn$;
REVOKE ALL ON FUNCTION public.ads_credit_close_unissued_v1_1101(uuid,uuid),
 public.ads_credit_apply_payment_v1_1101(text,text,text,text,integer,text,text,boolean,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ads_credit_close_unissued_v1_1101(uuid,uuid),
 public.ads_credit_apply_payment_v1_1101(text,text,text,text,integer,text,text,boolean,integer)
 TO service_role;
COMMIT;
