-- TAMÃO Ads V1.884: real independent advertisers and non-billable delivery evidence.
-- Does NOT amend old merchant-only Ads or payment/revenue gates.
-- Browser visibility reports are NOT independently audited billable impressions.
BEGIN;

CREATE TABLE public.ads_independent_controls_v1_884(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 delivery_enabled boolean NOT NULL DEFAULT false,
 billing_enabled boolean NOT NULL DEFAULT false CHECK(billing_enabled=false),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.ads_independent_controls_v1_884(singleton) VALUES(true);

CREATE TABLE public.ads_independent_campaigns_v1_884(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE,
 request_signature text NOT NULL CHECK(request_signature ~ '^[0-9a-f]{32}$'),
 advertiser_name text NOT NULL CHECK(length(advertiser_name) BETWEEN 2 AND 120),
 title text NOT NULL CHECK(length(title) BETWEEN 12 AND 80),
 description text NOT NULL CHECK(length(description) BETWEEN 20 AND 240),
 city text NOT NULL CHECK(length(city) BETWEEN 2 AND 100),
 state text NOT NULL CHECK(state ~ '^[A-Z]{2}$'),
 destination_url text NOT NULL CHECK(
    length(destination_url) BETWEEN 15 AND 300
    AND destination_url LIKE 'https://%'
    AND destination_url NOT LIKE '%@%'
    AND destination_url NOT LIKE '% %'),
 budget_cents integer NOT NULL CHECK(budget_cents IN (1990,4990,9990,19990)),
 cpm_cents integer NOT NULL DEFAULT 1200 CHECK(cpm_cents=1200),
 duration_days integer NOT NULL CHECK(duration_days IN(7,15,30)),
 status text NOT NULL DEFAULT 'submitted'
    CHECK(status IN ('submitted','approved','active','paused','rejected','ended')),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 reviewed_by uuid REFERENCES auth.users(id),
 review_reason text,
 run_started_at timestamptz,
 run_ends_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(run_ends_at IS NULL OR (run_started_at IS NOT NULL AND run_ends_at>run_started_at))
);
CREATE INDEX ads_independent_campaigns_region_v1_884
 ON public.ads_independent_campaigns_v1_884(state,lower(city),status,run_ends_at);
CREATE INDEX ads_independent_campaigns_owner_v1_884
 ON public.ads_independent_campaigns_v1_884(owner_user_id,created_at DESC);

-- The only customer-facing token is a one-time random UUID; viewer hashes
-- are keyed on the server and never expose the raw address, UA or email.
CREATE TABLE public.ads_independent_challenges_v1_884(
 token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES public.ads_independent_campaigns_v1_884(id) ON DELETE RESTRICT,
 viewer_hash text NOT NULL CHECK(viewer_hash ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '90 seconds')
);
CREATE INDEX ads_independent_challenges_rate_v1_884
 ON public.ads_independent_challenges_v1_884(viewer_hash,issued_at DESC);
CREATE TABLE public.ads_independent_view_signals_v1_884(
 token uuid PRIMARY KEY REFERENCES public.ads_independent_challenges_v1_884(token),
 campaign_id uuid NOT NULL REFERENCES public.ads_independent_campaigns_v1_884(id),
 viewer_hash text NOT NULL CHECK(viewer_hash ~ '^[0-9a-f]{64}$'),
 visible_ms integer NOT NULL CHECK(visible_ms BETWEEN 1000 AND 60000),
 visible_percent integer NOT NULL CHECK(visible_percent BETWEEN 50 AND 100),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 billable boolean NOT NULL DEFAULT false CHECK(billable=false)
);
CREATE INDEX ads_independent_view_dedup_v1_884
 ON public.ads_independent_view_signals_v1_884(campaign_id,viewer_hash,recorded_at DESC);
CREATE TABLE public.ads_independent_review_events_v1_884(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid REFERENCES public.ads_independent_campaigns_v1_884(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN('approve','publish','pause','reject','enable_delivery','disable_delivery')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 500),
 old_status text,
 new_status text,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $acl$
DECLARE v text;
BEGIN
 FOREACH v IN ARRAY ARRAY[
   'ads_independent_controls_v1_884','ads_independent_campaigns_v1_884',
   'ads_independent_challenges_v1_884','ads_independent_view_signals_v1_884',
   'ads_independent_review_events_v1_884']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',v);
 END LOOP;
END;
$acl$;
GRANT SELECT,INSERT,UPDATE ON public.ads_independent_campaigns_v1_884 TO service_role;
GRANT SELECT,UPDATE ON public.ads_independent_controls_v1_884 TO service_role;
GRANT SELECT,INSERT ON public.ads_independent_challenges_v1_884 TO service_role;
GRANT SELECT,INSERT ON public.ads_independent_view_signals_v1_884 TO service_role;
GRANT SELECT,INSERT ON public.ads_independent_review_events_v1_884 TO service_role;

CREATE OR REPLACE FUNCTION public.ads_independent_submit_v1_884(
 p_owner uuid,p_request uuid,p_advertiser text,p_title text,p_description text,
 p_city text,p_state text,p_destination text,p_budget_cents integer,p_duration_days integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE
 v_signature text;
 v_old record;
 v_id uuid;
BEGIN
 IF p_owner IS NULL OR p_request IS NULL OR NOT EXISTS(
   SELECT 1 FROM auth.users u WHERE u.id=p_owner
     AND u.is_anonymous IS FALSE AND u.email_confirmed_at IS NOT NULL
 ) THEN RAISE EXCEPTION 'ADS_ACCOUNT_NOT_VERIFIED' USING errcode='42501'; END IF;
 IF length(btrim(coalesce(p_advertiser,''))) NOT BETWEEN 2 AND 120 OR
    length(btrim(coalesce(p_title,''))) NOT BETWEEN 12 AND 80 OR
    length(btrim(coalesce(p_description,''))) NOT BETWEEN 20 AND 240 OR
    length(btrim(coalesce(p_city,''))) NOT BETWEEN 2 AND 100 OR
    coalesce(p_state,'') !~ '^[A-Z]{2}$' OR
    length(btrim(coalesce(p_destination,''))) NOT BETWEEN 15 AND 300 OR
    p_destination NOT LIKE 'https://%' OR p_destination LIKE '%@%' OR
    p_destination LIKE '% %' OR
    p_budget_cents NOT IN (1990,4990,9990,19990) OR
    p_duration_days NOT IN (7,15,30)
 THEN RAISE EXCEPTION 'ADS_CAMPAIGN_INVALID' USING errcode='22023'; END IF;
 v_signature:=md5(jsonb_build_object(
  'owner',p_owner,'business',btrim(p_advertiser),'title',btrim(p_title),
  'description',btrim(p_description),'city',btrim(p_city),'state',p_state,
  'destination',btrim(p_destination),'budget',p_budget_cents,'days',p_duration_days)::text);
 SELECT id,owner_user_id,request_signature INTO v_old
  FROM public.ads_independent_campaigns_v1_884 WHERE request_id=p_request FOR UPDATE;
 IF FOUND THEN
  IF v_old.owner_user_id<>p_owner OR v_old.request_signature<>v_signature THEN
   RAISE EXCEPTION 'ADS_CAMPAIGN_IDEMPOTENCY_CONFLICT' USING errcode='40001';
  END IF;
  RETURN jsonb_build_object('source','ads_independent_submit_v1_884',
    'campaignId',v_old.id,'replayed',true,'status','submitted','paymentCreated',false);
 END IF;
 INSERT INTO public.ads_independent_campaigns_v1_884(
  owner_user_id,request_id,request_signature,advertiser_name,title,description,
  city,state,destination_url,budget_cents,duration_days
 ) VALUES (p_owner,p_request,v_signature,btrim(p_advertiser),btrim(p_title),
  btrim(p_description),btrim(p_city),p_state,btrim(p_destination),
  p_budget_cents,p_duration_days)
 ON CONFLICT (request_id) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN
  SELECT id,owner_user_id,request_signature INTO v_old
   FROM public.ads_independent_campaigns_v1_884 WHERE request_id=p_request;
  IF v_old.owner_user_id<>p_owner OR v_old.request_signature<>v_signature THEN
   RAISE EXCEPTION 'ADS_CAMPAIGN_IDEMPOTENCY_CONFLICT' USING errcode='40001';
  END IF;
  v_id:=v_old.id;
 END IF;
 RETURN jsonb_build_object('source','ads_independent_submit_v1_884',
  'campaignId',v_id,'replayed',false,'status','submitted','paymentCreated',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ads_independent_mine_v1_884(p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
BEGIN
 IF p_owner IS NULL THEN RAISE EXCEPTION 'ADS_LOGIN_REQUIRED' USING errcode='42501';END IF;
 RETURN jsonb_build_object('source','ads_independent_mine_v1_884',
   'rows',coalesce((
    SELECT jsonb_agg(jsonb_build_object(
     'id',c.id,'title',c.title,'city',c.city,'state',c.state,
     'status',c.status,'budgetCents',c.budget_cents,'cpmCents',c.cpm_cents,
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
    'city',c.city,'state',c.state,'status',c.status,'version',c.version,
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
    SELECT 1 FROM public.ads_independent_campaigns_v1_884 WHERE status IN ('approved','active')
  ) THEN RAISE EXCEPTION 'ADS_APPROVED_CAMPAIGN_REQUIRED' USING errcode='42501';END IF;
  UPDATE public.ads_independent_controls_v1_884 SET
    delivery_enabled=p_action='enable_delivery',updated_at=clock_timestamp()
  WHERE singleton;
  INSERT INTO public.ads_independent_review_events_v1_884(actor_user_id,action,reason)
   VALUES(p_actor,p_action,btrim(p_reason));
  RETURN jsonb_build_object('source','admin_ads_independent_action_v1_884',
    'deliveryEnabled',p_action='enable_delivery','billingEnabled',false,'paymentCreated',false);
 END IF;
 IF p_action NOT IN('approve','publish','pause','reject') OR p_campaign IS NULL THEN
  RAISE EXCEPTION 'ADS_ACTION_INVALID' USING errcode='22023';END IF;
 SELECT * INTO v_c FROM public.ads_independent_campaigns_v1_884
 WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADS_CAMPAIGN_MISSING' USING errcode='22023';END IF;
 IF v_c.version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'ADS_VERSION_CONFLICT' USING errcode='40001';END IF;
 IF (p_action='approve' AND v_c.status<>'submitted') OR
    (p_action='publish' AND v_c.status<>'approved') OR
    (p_action='pause' AND v_c.status<>'active') OR
    (p_action='reject' AND v_c.status NOT IN('submitted','approved')) THEN
  RAISE EXCEPTION 'ADS_INVALID_TRANSITION' USING errcode='40001';END IF;
 IF p_action='publish' AND NOT EXISTS(
    SELECT 1 FROM public.ads_independent_controls_v1_884 WHERE singleton AND delivery_enabled
 ) THEN RAISE EXCEPTION 'ADS_DELIVERY_DISABLED' USING errcode='42501';END IF;
 v_status:=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'publish' THEN 'active'
  WHEN 'pause' THEN 'paused' ELSE 'rejected' END;
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

CREATE OR REPLACE FUNCTION public.ads_independent_issue_v1_884(
 p_city text,p_state text,p_viewer_hash text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_c record; v_token uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ads_independent_controls_v1_884
    WHERE singleton AND delivery_enabled)
    OR length(btrim(coalesce(p_city,''))) NOT BETWEEN 2 AND 100
    OR p_state !~ '^[A-Z]{2}$' OR
    p_viewer_hash !~ '^[0-9a-f]{64}$'
 THEN RETURN jsonb_build_object('source','ads_independent_issue_v1_884',
    'slot',null,'billingEnabled',false,'noCharge',true);END IF;
 -- Bound issuance per keyed viewer without storing IP address or user-agent.
 IF (SELECT count(*) FROM public.ads_independent_challenges_v1_884
       WHERE viewer_hash=p_viewer_hash AND issued_at>clock_timestamp()-interval '1 hour')>=60
 THEN RETURN jsonb_build_object('source','ads_independent_issue_v1_884',
    'slot',null,'billingEnabled',false,'noCharge',true);END IF;
 SELECT c.* INTO v_c FROM public.ads_independent_campaigns_v1_884 c
 WHERE c.status='active' AND c.run_started_at<=clock_timestamp()
   AND c.run_ends_at>clock_timestamp()
   AND c.state=p_state AND lower(c.city)=lower(btrim(p_city))
   AND (SELECT count(*) FROM public.ads_independent_view_signals_v1_884 v
         WHERE v.campaign_id=c.id)<floor(c.budget_cents*1000.0/c.cpm_cents)
 ORDER BY (SELECT count(*) FROM public.ads_independent_view_signals_v1_884 v
         WHERE v.campaign_id=c.id) ASC,c.run_started_at ASC,c.id
 LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('source','ads_independent_issue_v1_884',
    'slot',null,'billingEnabled',false,'noCharge',true);END IF;
 INSERT INTO public.ads_independent_challenges_v1_884(campaign_id,viewer_hash)
 VALUES(v_c.id,p_viewer_hash) RETURNING token INTO v_token;
 RETURN jsonb_build_object('source','ads_independent_issue_v1_884',
  'slot',jsonb_build_object('campaignId',v_c.id,'challenge',v_token,
    'label','Patrocinado','advertiser',v_c.advertiser_name,'title',v_c.title,
    'description',v_c.description,'url',v_c.destination_url,'city',v_c.city,'state',v_c.state),
  'billingEnabled',false,'noCharge',true,'independentlyAudited',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ads_independent_confirm_v1_884(
 p_token uuid,p_viewer_hash text,p_visible_ms integer,p_visible_percent integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_token record;v_c record;v_count integer;
BEGIN
 IF p_viewer_hash !~ '^[0-9a-f]{64}$'
   OR p_visible_ms NOT BETWEEN 1000 AND 60000
   OR p_visible_percent NOT BETWEEN 50 AND 100
 THEN RETURN jsonb_build_object('countedForDiagnostics',false,'billable',false,'reason','invalid_claim');END IF;
 SELECT * INTO v_token FROM public.ads_independent_challenges_v1_884
 WHERE token=p_token AND viewer_hash=p_viewer_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('countedForDiagnostics',false,'billable',false,'reason','not_found');END IF;
 IF clock_timestamp()<v_token.issued_at+interval '1100 milliseconds'
  OR clock_timestamp()>v_token.expires_at
 THEN RETURN jsonb_build_object('countedForDiagnostics',false,'billable',false,'reason','timing');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ads_independent_controls_v1_884
   WHERE singleton AND delivery_enabled)
 THEN RETURN jsonb_build_object('countedForDiagnostics',false,'billable',false,'reason','paused');END IF;
 -- Serialize budget and 30-minute dedup on campaign row, not just the token.
 SELECT * INTO v_c FROM public.ads_independent_campaigns_v1_884
 WHERE id=v_token.campaign_id FOR UPDATE;
 IF NOT FOUND OR v_c.status<>'active' OR v_c.run_ends_at<=clock_timestamp()
 THEN RETURN jsonb_build_object('countedForDiagnostics',false,'billable',false,'reason','inactive');END IF;
 IF EXISTS(SELECT 1 FROM public.ads_independent_view_signals_v1_884
    WHERE token=p_token) THEN
  RETURN jsonb_build_object('countedForDiagnostics',false,'billable',false,'reason','replay');
 END IF;
 IF EXISTS(SELECT 1 FROM public.ads_independent_view_signals_v1_884
    WHERE campaign_id=v_c.id AND viewer_hash=p_viewer_hash
      AND recorded_at>clock_timestamp()-interval '30 minutes')
 THEN RETURN jsonb_build_object('countedForDiagnostics',false,'billable',false,'reason','duplicate');END IF;
 SELECT count(*) INTO v_count FROM public.ads_independent_view_signals_v1_884
   WHERE campaign_id=v_c.id;
 IF v_count>=floor(v_c.budget_cents*1000.0/v_c.cpm_cents)
 THEN RETURN jsonb_build_object('countedForDiagnostics',false,'billable',false,'reason','budget_cap');END IF;
 INSERT INTO public.ads_independent_view_signals_v1_884(
  token,campaign_id,viewer_hash,visible_ms,visible_percent
 ) VALUES(p_token,v_c.id,p_viewer_hash,p_visible_ms,p_visible_percent);
 RETURN jsonb_build_object('countedForDiagnostics',true,'billable',false,
   'independentlyAudited',false,'reason','viewability_reported');
END;
$fn$;

REVOKE ALL ON FUNCTION public.ads_independent_submit_v1_884(uuid,uuid,text,text,text,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ads_independent_mine_v1_884(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_ads_independent_read_v1_884(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_ads_independent_action_v1_884(uuid,text,uuid,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ads_independent_issue_v1_884(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ads_independent_confirm_v1_884(uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ads_independent_submit_v1_884(uuid,uuid,text,text,text,text,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ads_independent_mine_v1_884(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_ads_independent_read_v1_884(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_ads_independent_action_v1_884(uuid,text,uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ads_independent_issue_v1_884(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ads_independent_confirm_v1_884(uuid,text,integer,integer) TO service_role;
COMMIT;
