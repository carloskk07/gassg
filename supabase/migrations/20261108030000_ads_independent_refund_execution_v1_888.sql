-- V1.888 — one authorized provider refund attempt per paid independent campaign.
-- Fail closed on missing PSP evidence. Never infer bank credit from API response.
BEGIN;
CREATE TABLE public.ads_independent_refund_executions_v1_888 (
 case_id uuid PRIMARY KEY REFERENCES public.ads_independent_refund_cases_v1_887(id) ON DELETE RESTRICT,
 campaign_id uuid NOT NULL UNIQUE REFERENCES public.ads_independent_campaigns_v1_884(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 payment_id text NOT NULL CHECK(payment_id ~ '^[0-9]{5,30}$'),
 external_reference text NOT NULL CHECK(external_reference ~ '^tamao-ads-ind-[0-9a-f]{32}$'),
 amount_cents integer NOT NULL CHECK(amount_cents IN(1990,4990,9990,19990)),
 idempotency_key text NOT NULL UNIQUE CHECK(idempotency_key ~ '^tamao-ads-ind-refund-[0-9a-f]{32}$'),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','provider_refunded')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.ads_independent_refund_executions_v1_888 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ads_independent_refund_executions_v1_888 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.ads_independent_refund_executions_v1_888 TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ads_independent_refund_execution_v1_888(
 p_actor uuid,p_case uuid,p_expected_version integer,p_operation text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_case record;v_charge record;v_existing record;
 v_created boolean:=false;v_key text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins
   WHERE user_id=p_actor AND active AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'ADS_REFUND_EXEC_ADMIN_DENIED' USING errcode='42501';END IF;
 IF p_case IS NULL OR p_expected_version IS NULL OR p_expected_version<1
   OR p_operation NOT IN('execute','verify')
   OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
 THEN RAISE EXCEPTION 'ADS_REFUND_EXEC_INPUT_INVALID' USING errcode='22023';END IF;
 SELECT * INTO v_case FROM public.ads_independent_refund_cases_v1_887
 WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR v_case.version IS DISTINCT FROM p_expected_version
 THEN RAISE EXCEPTION 'ADS_REFUND_EXEC_VERSION_CONFLICT' USING errcode='40001';END IF;
 IF v_case.status<>'reviewing'
 THEN RAISE EXCEPTION 'ADS_REFUND_EXEC_REVIEW_REQUIRED' USING errcode='42501';END IF;
 SELECT * INTO v_charge FROM public.ads_independent_checkouts_v1_886
 WHERE campaign_id=v_case.campaign_id FOR UPDATE;
 IF NOT FOUND OR v_charge.owner_user_id<>v_case.owner_user_id
 OR v_charge.status NOT IN('payment_approved','payment_reversed')
 OR v_charge.payment_id IS NULL OR v_charge.collector_id IS NULL
 OR v_charge.amount_cents NOT IN(1990,4990,9990,19990)
 THEN RAISE EXCEPTION 'ADS_REFUND_EXEC_PAID_PROOF_REQUIRED' USING errcode='42501';END IF;
 SELECT * INTO v_existing FROM public.ads_independent_refund_executions_v1_888
 WHERE case_id=p_case FOR UPDATE;
 IF p_operation='execute' THEN
   IF v_charge.status<>'payment_approved'
   THEN RAISE EXCEPTION 'ADS_REFUND_EXEC_ALREADY_REVERSED' USING errcode='42501';END IF;
   IF NOT FOUND THEN
     v_key:='tamao-ads-ind-refund-'||replace(p_case::text,'-','');
     INSERT INTO public.ads_independent_refund_executions_v1_888(
       case_id,campaign_id,actor_user_id,payment_id,
       external_reference,amount_cents,idempotency_key,reason
     ) VALUES(p_case,v_case.campaign_id,p_actor,v_charge.payment_id,
       v_charge.external_reference,v_charge.amount_cents,v_key,btrim(p_reason))
     RETURNING * INTO v_existing;
     v_created:=true;
   END IF;
 END IF;
 IF v_existing.case_id IS NOT NULL AND (
    v_existing.payment_id<>v_charge.payment_id OR
    v_existing.amount_cents<>v_charge.amount_cents OR
    v_existing.external_reference<>v_charge.external_reference
 ) THEN RAISE EXCEPTION 'ADS_REFUND_EXEC_INCONSISTENT_PROOF' USING errcode='42501';END IF;
 RETURN jsonb_build_object(
   'source','admin_ads_independent_refund_execution_v1_888',
   'caseId',p_case,'campaignId',v_case.campaign_id,
   'created',v_created,'attemptExists',v_existing.case_id IS NOT NULL,
   'attemptStatus',coalesce(v_existing.status,'not_requested'),
   'paymentId',v_charge.payment_id,'collectorId',v_charge.collector_id,
   'externalReference',v_charge.external_reference,'amountCents',v_charge.amount_cents,
   'idempotencyKey',CASE WHEN v_existing.case_id IS NOT NULL THEN v_existing.idempotency_key ELSE null END,
   'providerReversalRecorded',v_charge.status='payment_reversed',
   'providerApiCalled',false,'moneyMoved',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_ads_independent_refund_execution_complete_v1_888(
 p_actor uuid,p_case uuid,p_expected_version integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_case record;v_attempt record;v_charge record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins
  WHERE user_id=p_actor AND active AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'ADS_REFUND_COMPLETE_ADMIN_DENIED' USING errcode='42501';END IF;
 SELECT * INTO v_case FROM public.ads_independent_refund_cases_v1_887
 WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR v_case.version IS DISTINCT FROM p_expected_version
 OR v_case.status<>'provider_reversed'
 THEN RAISE EXCEPTION 'ADS_REFUND_COMPLETE_UNCONFIRMED_CASE' USING errcode='42501';END IF;
 SELECT * INTO v_charge FROM public.ads_independent_checkouts_v1_886
 WHERE campaign_id=v_case.campaign_id FOR UPDATE;
 IF NOT FOUND OR v_charge.status<>'payment_reversed'
 THEN RAISE EXCEPTION 'ADS_REFUND_COMPLETE_UNCONFIRMED_PSP' USING errcode='42501';END IF;
 SELECT * INTO v_attempt FROM public.ads_independent_refund_executions_v1_888
 WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('source','admin_ads_independent_refund_execution_complete_v1_888',
   'recorded',false,'reason','external_manual_refund','moneyMoved',false);END IF;
 IF v_attempt.payment_id<>v_charge.payment_id
 THEN RAISE EXCEPTION 'ADS_REFUND_COMPLETE_PAYMENT_MISMATCH' USING errcode='42501';END IF;
 UPDATE public.ads_independent_refund_executions_v1_888
  SET status='provider_refunded',updated_at=clock_timestamp() WHERE case_id=p_case;
 RETURN jsonb_build_object('source','admin_ads_independent_refund_execution_complete_v1_888',
  'recorded',true,'status','provider_refunded','moneyMoved',false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_ads_independent_refund_execution_v1_888(uuid,uuid,integer,text,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_ads_independent_refund_execution_complete_v1_888(uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ads_independent_refund_execution_v1_888(uuid,uuid,integer,text,text)
 TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_ads_independent_refund_execution_complete_v1_888(uuid,uuid,integer)
 TO service_role;
COMMIT;
