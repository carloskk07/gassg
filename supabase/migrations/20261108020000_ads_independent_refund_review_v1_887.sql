-- V1.887: consumer refund requests, immutable review, never invent provider reimbursement.
BEGIN;
CREATE TABLE public.ads_independent_refund_cases_v1_887(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL UNIQUE REFERENCES public.ads_independent_campaigns_v1_884(id) ON DELETE RESTRICT,
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE,
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 500),
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','reviewing','provider_refunded')),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 reviewed_by uuid REFERENCES auth.users(id),
 review_reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ads_independent_refund_cases_status_v1_887
 ON public.ads_independent_refund_cases_v1_887(status,created_at DESC);
CREATE TABLE public.ads_independent_refund_events_v1_887(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES public.ads_independent_campaigns_v1_884(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('request','review','confirm_provider_refund')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 500),
 old_status text,new_status text,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.ads_independent_refund_cases_v1_887 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_independent_refund_events_v1_887 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ads_independent_refund_cases_v1_887 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.ads_independent_refund_events_v1_887 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.ads_independent_refund_cases_v1_887 TO service_role;
GRANT SELECT,INSERT ON public.ads_independent_refund_events_v1_887 TO service_role;

CREATE OR REPLACE FUNCTION public.ads_independent_refund_request_v1_887(
 p_owner uuid,p_campaign uuid,p_request uuid,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_payment record;v_case record;v_id uuid;
BEGIN
 IF p_owner IS NULL OR p_campaign IS NULL OR p_request IS NULL
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
 THEN RAISE EXCEPTION 'ADS_REFUND_REQUEST_INVALID' USING errcode='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users
   WHERE id=p_owner AND is_anonymous IS FALSE AND email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'ADS_REFUND_OWNER_UNVERIFIED' USING errcode='42501';END IF;
 SELECT * INTO v_payment FROM public.ads_independent_checkouts_v1_886
 WHERE campaign_id=p_campaign AND owner_user_id=p_owner FOR UPDATE;
 IF NOT FOUND OR v_payment.status NOT IN ('payment_approved','payment_reversed')
 THEN RAISE EXCEPTION 'ADS_REFUND_PAYMENT_REQUIRED' USING errcode='42501';END IF;
 SELECT * INTO v_case FROM public.ads_independent_refund_cases_v1_887
 WHERE campaign_id=p_campaign FOR UPDATE;
 IF FOUND THEN
  RETURN jsonb_build_object('source','ads_independent_refund_request_v1_887',
    'caseId',v_case.id,'status',v_case.status,'replayed',true,
    'refundIssued',false,'providerRefundVerified',v_payment.status='payment_reversed');
 END IF;
 INSERT INTO public.ads_independent_refund_cases_v1_887(
  campaign_id,owner_user_id,request_id,reason
 ) VALUES(p_campaign,p_owner,p_request,btrim(p_reason)) RETURNING id INTO v_id;
 INSERT INTO public.ads_independent_refund_events_v1_887(
  campaign_id,actor_user_id,action,reason,old_status,new_status
 ) VALUES(p_campaign,p_owner,'request',btrim(p_reason),null,'submitted');
 -- Suspend the placement when a refund is requested. This is a service
 -- delivery action only, NEVER proof that the provider returned funds.
 UPDATE public.ads_independent_campaigns_v1_884
 SET status='paused',version=version+1,updated_at=clock_timestamp()
 WHERE id=p_campaign AND status='active';
 RETURN jsonb_build_object('source','ads_independent_refund_request_v1_887',
  'caseId',v_id,'status','submitted','replayed',false,
  'refundIssued',false,'providerRefundVerified',v_payment.status='payment_reversed');
END;$fn$;

CREATE OR REPLACE FUNCTION public.admin_ads_independent_refunds_read_v1_887(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins
  WHERE user_id=p_actor AND active AND admin_role IN('superadmin','operations','finance','compliance'))
 THEN RAISE EXCEPTION 'ADS_REFUND_ADMIN_DENIED' USING errcode='42501';END IF;
 RETURN jsonb_build_object('source','admin_ads_independent_refunds_read_v1_887',
 'readOnly',true,'refundMoneyMoved',false,
 'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'caseId',r.id,'campaignId',r.campaign_id,'status',r.status,
   'version',r.version,'reason',r.reason,'reviewReason',r.review_reason,
   'createdAt',r.created_at,'title',c.title,'advertiser',c.advertiser_name,
   'amountCents',ch.amount_cents,
   'providerRefundVerified',ch.status='payment_reversed'
 ) ORDER BY r.created_at DESC) FROM (
  SELECT * FROM public.ads_independent_refund_cases_v1_887
  ORDER BY created_at DESC LIMIT 50
 ) r JOIN public.ads_independent_campaigns_v1_884 c ON c.id=r.campaign_id
 JOIN public.ads_independent_checkouts_v1_886 ch ON ch.campaign_id=r.campaign_id),
 '[]'::jsonb));
END;$fn$;

CREATE OR REPLACE FUNCTION public.admin_ads_independent_refund_action_v1_887(
 p_actor uuid,p_case uuid,p_expected_version integer,p_operation text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_case record;v_payment record;v_status text;v_version integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins
  WHERE user_id=p_actor AND active AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'ADS_REFUND_SUPERADMIN_REQUIRED' USING errcode='42501';END IF;
 IF p_case IS NULL OR p_expected_version IS NULL OR p_expected_version<1
 OR p_operation NOT IN ('review','confirm_provider_refund')
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
 THEN RAISE EXCEPTION 'ADS_REFUND_ACTION_INVALID' USING errcode='22023';END IF;
 SELECT * INTO v_case FROM public.ads_independent_refund_cases_v1_887
 WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR v_case.version<>p_expected_version
 THEN RAISE EXCEPTION 'ADS_REFUND_CASE_VERSION_CONFLICT' USING errcode='40001';END IF;
 IF (p_operation='review' AND v_case.status<>'submitted')
 OR (p_operation='confirm_provider_refund' AND v_case.status NOT IN('submitted','reviewing'))
 THEN RAISE EXCEPTION 'ADS_REFUND_TRANSITION_INVALID' USING errcode='40001';END IF;
 IF p_operation='confirm_provider_refund' THEN
  SELECT * INTO v_payment FROM public.ads_independent_checkouts_v1_886
  WHERE campaign_id=v_case.campaign_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status<>'payment_reversed'
  THEN RAISE EXCEPTION 'ADS_REFUND_PROVIDER_PROOF_REQUIRED' USING errcode='42501';END IF;
 END IF;
 v_status:=CASE WHEN p_operation='review' THEN 'reviewing' ELSE 'provider_refunded' END;
 UPDATE public.ads_independent_refund_cases_v1_887
 SET status=v_status,version=version+1,reviewed_by=p_actor,
  review_reason=btrim(p_reason),updated_at=clock_timestamp()
 WHERE id=p_case RETURNING version INTO v_version;
 INSERT INTO public.ads_independent_refund_events_v1_887(
  campaign_id,actor_user_id,action,reason,old_status,new_status)
 VALUES(v_case.campaign_id,p_actor,p_operation,btrim(p_reason),v_case.status,v_status);
 RETURN jsonb_build_object('source','admin_ads_independent_refund_action_v1_887',
   'caseId',p_case,'status',v_status,'version',v_version,
   'moneyMoved',false,'providerRefundVerified',v_status='provider_refunded');
END;$fn$;

CREATE OR REPLACE FUNCTION public.ads_independent_mine_v1_884(p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
BEGIN
 IF p_owner IS NULL THEN RAISE EXCEPTION 'ADS_LOGIN_REQUIRED' USING errcode='42501';END IF;
 RETURN jsonb_build_object('source','ads_independent_mine_v1_884',
   'rows',coalesce((
    SELECT jsonb_agg(jsonb_build_object(
     'id',c.id,'title',c.title,'city',c.city,'state',c.state,
     'status',c.status,'effectiveStatus',CASE WHEN c.status IN ('active','paused') AND c.run_ends_at<=clock_timestamp() THEN 'ended' ELSE c.status END,
     'runStartedAt',c.run_started_at,'runEndsAt',c.run_ends_at,'budgetCents',c.budget_cents,'cpmCents',c.cpm_cents,
     'durationDays',c.duration_days,'version',c.version,
     'reportedViewSignals',(SELECT count(*) FROM public.ads_independent_view_signals_v1_884 v WHERE v.campaign_id=c.id),
     'billableImpressions',0,'chargeCents',0,
     'refundCaseStatus',(SELECT r.status FROM public.ads_independent_refund_cases_v1_887 r WHERE r.campaign_id=c.id),
     'refundCaseId',(SELECT r.id FROM public.ads_independent_refund_cases_v1_887 r WHERE r.campaign_id=c.id),
     'fixedFeeStatus',(SELECT ch.status FROM public.ads_independent_checkouts_v1_886 ch WHERE ch.campaign_id=c.id),
     'fixedFeeCheckoutUrl',(SELECT ch.checkout_url FROM public.ads_independent_checkouts_v1_886 ch WHERE ch.campaign_id=c.id AND ch.status='checkout_ready' AND ch.expires_at>clock_timestamp()),
     'fixedFeeApprovedCents',(SELECT CASE WHEN ch.status='payment_approved' THEN ch.amount_cents ELSE 0 END FROM public.ads_independent_checkouts_v1_886 ch WHERE ch.campaign_id=c.id)
    ) ORDER BY c.created_at DESC) FROM (
     SELECT * FROM public.ads_independent_campaigns_v1_884
     WHERE owner_user_id=p_owner ORDER BY created_at DESC LIMIT 30
    ) c),'[]'::jsonb),'noCharge',true,
   'fixedFeeSalesEnabled',(SELECT sales_enabled FROM public.ads_independent_sales_controls_v1_886 WHERE singleton));
END;
$fn$;




CREATE OR REPLACE FUNCTION public.admin_ads_independent_action_v1_884(
 p_actor uuid,p_action text,p_campaign uuid,p_expected_version integer,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_role text; v_c record; v_status text; v_version integer;
BEGIN
 SELECT admin_role INTO v_role FROM public.platform_admins
 WHERE user_id=p_actor AND active AND admin_role IN ('superadmin','compliance');
 IF v_role IS NULL THEN RAISE EXCEPTION 'ADS_ADMIN_DENIED' USING errcode='42501';END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500 THEN
  RAISE EXCEPTION 'ADS_REASON_REQUIRED' USING errcode='22023';
 END IF;
 IF p_action IN('enable_delivery','disable_delivery') THEN
  IF v_role<>'superadmin' OR p_campaign IS NOT NULL THEN
   RAISE EXCEPTION 'ADS_OWNER_ONLY' USING errcode='42501';
  END IF;
  IF p_action='enable_delivery' AND NOT EXISTS(
    SELECT 1 FROM public.ads_independent_campaigns_v1_884 WHERE status IN ('approved','active','paused')
  ) THEN RAISE EXCEPTION 'ADS_APPROVED_CAMPAIGN_REQUIRED' USING errcode='42501';END IF;
  UPDATE public.ads_independent_controls_v1_884 SET
    delivery_enabled=p_action='enable_delivery',updated_at=clock_timestamp()
  WHERE singleton;
  INSERT INTO public.ads_independent_review_events_v1_884(actor_user_id,action,reason)
   VALUES(p_actor,p_action,btrim(p_reason));
  RETURN jsonb_build_object('source','admin_ads_independent_action_v1_884',
    'deliveryEnabled',p_action='enable_delivery','billingEnabled',false,'paymentCreated',false);
 END IF;
 IF p_action NOT IN('approve','publish','pause','resume','end','reject') OR p_campaign IS NULL THEN
  RAISE EXCEPTION 'ADS_ACTION_INVALID' USING errcode='22023';END IF;
 SELECT * INTO v_c FROM public.ads_independent_campaigns_v1_884
 WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADS_CAMPAIGN_MISSING' USING errcode='22023';END IF;
 IF v_c.version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'ADS_VERSION_CONFLICT' USING errcode='40001';END IF;
 IF (p_action='approve' AND v_c.status<>'submitted') OR
    (p_action='publish' AND v_c.status<>'approved') OR
    (p_action='pause' AND (v_c.status<>'active' OR v_c.run_ends_at<=clock_timestamp())) OR
    (p_action='resume' AND (v_c.status<>'paused' OR v_c.run_started_at IS NULL OR v_c.run_ends_at<=clock_timestamp())) OR
    (p_action='end' AND v_c.status NOT IN ('active','paused')) OR
    (p_action='reject' AND v_c.status NOT IN('submitted','approved')) THEN
  RAISE EXCEPTION 'ADS_INVALID_TRANSITION' USING errcode='40001';END IF;
 IF p_action IN('publish','resume') AND NOT EXISTS(
    SELECT 1 FROM public.ads_independent_controls_v1_884 WHERE singleton AND delivery_enabled
 ) THEN RAISE EXCEPTION 'ADS_DELIVERY_DISABLED' USING errcode='42501';END IF;
 IF p_action IN ('publish','resume') AND (
    EXISTS(SELECT 1 FROM public.ads_independent_sales_controls_v1_886 WHERE singleton AND sales_enabled)
    OR EXISTS(SELECT 1 FROM public.ads_independent_checkouts_v1_886 WHERE campaign_id=p_campaign)
  ) AND NOT EXISTS(SELECT 1 FROM public.ads_independent_checkouts_v1_886
    WHERE campaign_id=p_campaign AND status='payment_approved') THEN
    RAISE EXCEPTION 'ADS_PAID_CAMPAIGN_REQUIRED' USING errcode='42501';
 END IF;
 IF p_action IN ('publish','resume') AND EXISTS(
    SELECT 1 FROM public.ads_independent_refund_cases_v1_887 r
    WHERE r.campaign_id=p_campaign AND r.status IN('submitted','reviewing')
 ) THEN RAISE EXCEPTION 'ADS_REFUND_CASE_OPEN' USING errcode='42501';END IF;
 v_status:=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'publish' THEN 'active'
  WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'active'
  WHEN 'end' THEN 'ended' ELSE 'rejected' END;
 UPDATE public.ads_independent_campaigns_v1_884
 SET status=v_status,version=version+1,review_reason=btrim(p_reason),
  reviewed_by=p_actor,updated_at=clock_timestamp(),
  run_started_at=CASE WHEN p_action='publish' THEN clock_timestamp() ELSE run_started_at END,
  run_ends_at=CASE WHEN p_action='publish' THEN clock_timestamp()+make_interval(days=>v_c.duration_days)
    ELSE run_ends_at END
 WHERE id=p_campaign RETURNING version INTO v_version;
 INSERT INTO public.ads_independent_review_events_v1_884(
  campaign_id,actor_user_id,action,reason,old_status,new_status
 ) VALUES(p_campaign,p_actor,p_action,btrim(p_reason),v_c.status,v_status);
 RETURN jsonb_build_object('source','admin_ads_independent_action_v1_884',
  'campaignId',p_campaign,'status',v_status,'version',v_version,
  'billingEnabled',false,'paymentCreated',false);
END;
$fn$;



REVOKE ALL ON FUNCTION public.ads_independent_refund_request_v1_887(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_ads_independent_refunds_read_v1_887(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_ads_independent_refund_action_v1_887(uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ads_independent_refund_request_v1_887(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_ads_independent_refunds_read_v1_887(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_ads_independent_refund_action_v1_887(uuid,uuid,integer,text,text) TO service_role;
COMMIT;
