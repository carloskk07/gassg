-- V1.885 — resumable independent ads, irreversible end and honest expiry display.
-- No change to non-billable view signals, PSP, or billing fail-closed controls.
BEGIN;
ALTER TABLE public.ads_independent_review_events_v1_884
 DROP CONSTRAINT ads_independent_review_events_v1_884_action_check;
ALTER TABLE public.ads_independent_review_events_v1_884
 ADD CONSTRAINT ads_independent_review_events_v1_884_action_check
 CHECK (action IN ('approve','publish','pause','resume','end','reject','enable_delivery','disable_delivery'));

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
     'billableImpressions',0,'chargeCents',0
    ) ORDER BY c.created_at DESC) FROM (
     SELECT * FROM public.ads_independent_campaigns_v1_884
     WHERE owner_user_id=p_owner ORDER BY created_at DESC LIMIT 30
    ) c),'[]'::jsonb),'noCharge',true);
END;
$fn$;


CREATE OR REPLACE FUNCTION public.admin_ads_independent_read_v1_884(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_enabled boolean;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.platform_admins
   WHERE user_id=p_actor AND active AND admin_role IN ('superadmin','operations','compliance','finance','readonly')
 ) THEN RAISE EXCEPTION 'ADS_ADMIN_DENIED' USING errcode='42501'; END IF;
 SELECT delivery_enabled INTO v_enabled FROM public.ads_independent_controls_v1_884 WHERE singleton;
 RETURN jsonb_build_object('source','admin_ads_independent_read_v1_884',
  'deliveryEnabled',coalesce(v_enabled,false),'billingEnabled',false,'revenueCents',0,
  'independentlyAuditedImpressions',0,'readOnly',true,
  'rows',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
    'id',c.id,'advertiser',c.advertiser_name,'title',c.title,
    'description',c.description,'destination',c.destination_url,
    'city',c.city,'state',c.state,'status',c.status,
    'effectiveStatus',CASE WHEN c.status IN ('active','paused') AND c.run_ends_at<=clock_timestamp() THEN 'ended' ELSE c.status END,
    'runStartedAt',c.run_started_at,'runEndsAt',c.run_ends_at,'version',c.version,
    'budgetCents',c.budget_cents,'durationDays',c.duration_days,
    'reportedViewSignals',(SELECT count(*) FROM public.ads_independent_view_signals_v1_884 v WHERE v.campaign_id=c.id),
    'createdAt',c.created_at
   ) ORDER BY c.created_at DESC)
   FROM (SELECT * FROM public.ads_independent_campaigns_v1_884
     ORDER BY created_at DESC LIMIT 50) c
  ),'[]'::jsonb));
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


COMMIT;
