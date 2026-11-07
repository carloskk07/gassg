-- V1.886: advertiser-owned fixed fee checkout ledger; no impression-based charging.
-- Strictly separate from merchant platform_ads_* and daily merchant billing.
BEGIN;
CREATE TABLE public.ads_independent_sales_controls_v1_886(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 sales_enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 updated_by uuid REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.ads_independent_sales_controls_v1_886(singleton) VALUES (true);

CREATE TABLE public.ads_independent_checkouts_v1_886(
 campaign_id uuid PRIMARY KEY REFERENCES public.ads_independent_campaigns_v1_884(id) ON DELETE RESTRICT,
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE,
 external_reference text NOT NULL UNIQUE
   CHECK(external_reference ~ '^tamao-ads-ind-[0-9a-f]{32}$'),
 amount_cents integer NOT NULL CHECK(amount_cents IN (1990,4990,9990,19990)),
 terms_version integer NOT NULL DEFAULT 1 CHECK(terms_version=1),
 terms_accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 duration_days integer NOT NULL CHECK(duration_days IN (7,15,30)),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN
   ('reserved','checkout_ready','payment_approved','payment_reversed','review_required')),
 preference_id text UNIQUE,
 checkout_url text,
 payment_id text UNIQUE,
 collector_id text,
 provider_status text,
 provider_status_detail text,
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '24 hours'),
 approved_at timestamptz,
 reversed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (
 (status='reserved' AND preference_id IS NULL AND checkout_url IS NULL AND payment_id IS NULL)
 OR (status='checkout_ready' AND preference_id IS NOT NULL AND checkout_url IS NOT NULL AND payment_id IS NULL)
 OR (status IN ('payment_approved','payment_reversed','review_required') AND preference_id IS NOT NULL AND payment_id IS NOT NULL)
 )
);
CREATE INDEX ads_independent_checkouts_owner_v1_886
 ON public.ads_independent_checkouts_v1_886(owner_user_id,status,updated_at DESC);

CREATE TABLE public.ads_independent_payment_events_v1_886(
 event_key text PRIMARY KEY CHECK(event_key ~ '^[0-9a-f]{64}$'),
 campaign_id uuid NOT NULL REFERENCES public.ads_independent_campaigns_v1_884(id) ON DELETE RESTRICT,
 payment_id text NOT NULL,
 provider_status text NOT NULL,
 provider_status_detail text,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ads_independent_payment_events_campaign_v1_886
 ON public.ads_independent_payment_events_v1_886(campaign_id,recorded_at DESC);

CREATE TABLE public.ads_independent_sales_events_v1_886(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 500),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $acl$ DECLARE v text;
BEGIN
 FOREACH v IN ARRAY ARRAY['ads_independent_sales_controls_v1_886','ads_independent_checkouts_v1_886',
  'ads_independent_payment_events_v1_886','ads_independent_sales_events_v1_886']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',v);
 END LOOP;
END;
$acl$;
GRANT SELECT,UPDATE ON public.ads_independent_sales_controls_v1_886 TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.ads_independent_checkouts_v1_886 TO service_role;
GRANT SELECT,INSERT ON public.ads_independent_payment_events_v1_886 TO service_role;
GRANT SELECT,INSERT ON public.ads_independent_sales_events_v1_886 TO service_role;

CREATE OR REPLACE FUNCTION public.ads_independent_checkout_reserve_v1_886(
 p_owner uuid,p_campaign uuid,p_request uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_campaign record; v_checkout record; v_reference text;
BEGIN
 IF p_owner IS NULL OR p_campaign IS NULL OR p_request IS NULL
 OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_owner
   AND is_anonymous IS FALSE AND email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'ADS_VERIFIED_OWNER_REQUIRED' USING errcode='42501';END IF;
 SELECT * INTO v_campaign FROM public.ads_independent_campaigns_v1_884
 WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND OR v_campaign.owner_user_id<>p_owner OR v_campaign.status<>'approved'
 THEN RAISE EXCEPTION 'ADS_APPROVED_OWNER_REQUIRED' USING errcode='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ads_independent_sales_controls_v1_886
   WHERE singleton AND sales_enabled)
 THEN RAISE EXCEPTION 'ADS_SALES_DISABLED' USING errcode='42501';END IF;
 -- Fixed fee for duration, not charged for impressions. Only product definitions agreed at checkout.
 IF (v_campaign.budget_cents,v_campaign.duration_days) NOT IN (
   (1990,7),(4990,15),(9990,30),(19990,30))
 THEN RAISE EXCEPTION 'ADS_FIXED_PLAN_UNAVAILABLE' USING errcode='22023';END IF;
 SELECT * INTO v_checkout FROM public.ads_independent_checkouts_v1_886
 WHERE campaign_id=p_campaign FOR UPDATE;
 IF FOUND THEN
   IF v_checkout.owner_user_id<>p_owner OR v_checkout.amount_cents<>v_campaign.budget_cents
     OR v_checkout.duration_days<>v_campaign.duration_days
   THEN RAISE EXCEPTION 'ADS_CHECKOUT_CONFLICT' USING errcode='40001';END IF;
   RETURN jsonb_build_object('source','ads_independent_checkout_reserve_v1_886',
     'created',false,'campaignId',p_campaign,'status',v_checkout.status,
     'externalReference',v_checkout.external_reference,
     'checkoutUrl',CASE WHEN v_checkout.status='checkout_ready'
       AND v_checkout.expires_at>clock_timestamp() THEN v_checkout.checkout_url ELSE null END,
     'amountCents',v_checkout.amount_cents);
 END IF;
 v_reference:='tamao-ads-ind-'||replace(p_campaign::text,'-','');
 INSERT INTO public.ads_independent_checkouts_v1_886(
   campaign_id,owner_user_id,request_id,external_reference,amount_cents,duration_days
 ) VALUES (p_campaign,p_owner,p_request,v_reference,v_campaign.budget_cents,v_campaign.duration_days);
 RETURN jsonb_build_object('source','ads_independent_checkout_reserve_v1_886',
   'created',true,'campaignId',p_campaign,'status','reserved',
   'externalReference',v_reference,'checkoutUrl',null,
   'amountCents',v_campaign.budget_cents);
END;$fn$;

CREATE OR REPLACE FUNCTION public.ads_independent_checkout_attach_v1_886(
 p_campaign uuid,p_external_reference text,p_preference text,p_checkout_url text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v record;
BEGIN
 IF p_campaign IS NULL OR p_preference IS NULL OR length(p_preference) NOT BETWEEN 5 AND 120
 OR p_checkout_url !~ '^https://([a-z0-9-]+\.)*mercadopago\.com(\.br)?/[^[:space:]]+$'
 OR length(p_checkout_url)>1500
 THEN RAISE EXCEPTION 'ADS_PROVIDER_CHECKOUT_INVALID' USING errcode='22023';END IF;
 SELECT * INTO v FROM public.ads_independent_checkouts_v1_886
 WHERE campaign_id=p_campaign FOR UPDATE;
 IF NOT FOUND OR v.external_reference IS DISTINCT FROM p_external_reference
 THEN RAISE EXCEPTION 'ADS_CHECKOUT_IDENTITY_MISMATCH' USING errcode='42501';END IF;
 IF v.status='checkout_ready' AND v.preference_id=p_preference
   AND v.checkout_url=p_checkout_url
 THEN RETURN jsonb_build_object('source','ads_independent_checkout_attach_v1_886',
   'status','checkout_ready','checkoutUrl',v.checkout_url,'replayed',true);END IF;
 IF v.status<>'reserved' OR v.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'ADS_CHECKOUT_NOT_RESERVED' USING errcode='40001';END IF;
 UPDATE public.ads_independent_checkouts_v1_886
 SET status='checkout_ready',preference_id=p_preference,checkout_url=p_checkout_url,
 updated_at=clock_timestamp() WHERE campaign_id=p_campaign;
 RETURN jsonb_build_object('source','ads_independent_checkout_attach_v1_886',
   'status','checkout_ready','checkoutUrl',p_checkout_url,'replayed',false);
END;$fn$;

CREATE OR REPLACE FUNCTION public.ads_independent_payment_fact_v1_886(
 p_event_key text,p_external_reference text,p_payment_id text,p_collector_id text,
 p_amount_cents integer,p_currency text,p_provider_status text,p_status_detail text,
 p_live_mode boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v record;v_outcome text;v_new_status text;v_recorded integer;
BEGIN
 IF p_event_key !~ '^[0-9a-f]{64}$' OR p_payment_id !~ '^[0-9]{5,30}$'
 OR p_collector_id !~ '^[0-9]{4,20}$' OR p_currency<>'BRL'
 OR p_live_mode IS DISTINCT FROM true OR
 p_provider_status NOT IN ('approved','refunded','charged_back','cancelled','rejected','pending','in_process')
 OR length(coalesce(p_status_detail,''))>120
 THEN RAISE EXCEPTION 'ADS_PAYMENT_PROOF_INVALID' USING errcode='42501';END IF;
 SELECT * INTO v FROM public.ads_independent_checkouts_v1_886
 WHERE external_reference=p_external_reference FOR UPDATE;
 IF NOT FOUND OR v.amount_cents IS DISTINCT FROM p_amount_cents
 OR v.status='reserved'
 THEN RAISE EXCEPTION 'ADS_PAYMENT_REFERENCE_MISMATCH' USING errcode='42501';END IF;
 -- Provider payment identity can never be switched to another payment ID.
 IF v.collector_id IS NOT NULL AND v.collector_id<>p_collector_id
 THEN RAISE EXCEPTION 'ADS_COLLECTOR_MISMATCH' USING errcode='42501';END IF;
 IF v.payment_id IS NOT NULL AND v.payment_id<>p_payment_id
 THEN RAISE EXCEPTION 'ADS_DIFFERENT_PAYMENT_REVIEW_REQUIRED' USING errcode='42501';END IF;
 INSERT INTO public.ads_independent_payment_events_v1_886(
   event_key,campaign_id,payment_id,provider_status,provider_status_detail
 ) VALUES(p_event_key,v.campaign_id,p_payment_id,p_provider_status,p_status_detail)
 ON CONFLICT(event_key) DO NOTHING;
 GET DIAGNOSTICS v_recorded = ROW_COUNT;
 IF v_recorded=0 THEN RETURN jsonb_build_object('source','ads_independent_payment_fact_v1_886',
  'recorded',false,'paymentApproved',v.status='payment_approved','status',v.status,
   'autoPublished',false,'netSettlementVerified',false);END IF;
 v_outcome:=CASE
   WHEN p_provider_status='approved' AND p_status_detail='accredited' THEN 'approved'
   WHEN p_provider_status IN ('refunded','charged_back')
     OR (p_provider_status='approved' AND p_status_detail='partially_refunded') THEN 'reversed'
   ELSE 'unverified' END;
 v_new_status:=v.status;
 IF v_outcome='approved' AND v.status='checkout_ready' THEN
  v_new_status:='payment_approved';
  UPDATE public.ads_independent_checkouts_v1_886 SET
   status=v_new_status,payment_id=p_payment_id,collector_id=p_collector_id,
   provider_status=p_provider_status,provider_status_detail=p_status_detail,
   approved_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE campaign_id=v.campaign_id;
 ELSIF v_outcome='reversed' AND v.status IN ('payment_approved','checkout_ready') THEN
  v_new_status:='payment_reversed';
  UPDATE public.ads_independent_checkouts_v1_886 SET
   status=v_new_status,payment_id=p_payment_id,collector_id=p_collector_id,
   provider_status=p_provider_status,provider_status_detail=p_status_detail,
   reversed_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE campaign_id=v.campaign_id;
  UPDATE public.ads_independent_campaigns_v1_884 SET
    status='paused',version=version+1,updated_at=clock_timestamp()
   WHERE id=v.campaign_id AND status='active';
 END IF;
 RETURN jsonb_build_object('source','ads_independent_payment_fact_v1_886',
   'recorded',true,'paymentApproved',v_new_status='payment_approved',
   'status',v_new_status,'autoPublished',false,'netSettlementVerified',false);
END;$fn$;

CREATE OR REPLACE FUNCTION public.admin_ads_independent_sales_toggle_v1_886(
 p_actor uuid,p_enabled boolean,p_expected_version integer,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins
   WHERE user_id=p_actor AND active AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'ADS_SALES_ADMIN_DENIED' USING errcode='42501';END IF;
 IF p_enabled IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
 THEN RAISE EXCEPTION 'ADS_SALES_REASON_REQUIRED' USING errcode='22023';END IF;
 SELECT * INTO v FROM public.ads_independent_sales_controls_v1_886
 WHERE singleton FOR UPDATE;
 IF NOT FOUND OR v.version IS DISTINCT FROM p_expected_version
 THEN RAISE EXCEPTION 'ADS_SALES_VERSION_CONFLICT' USING errcode='40001';END IF;
 UPDATE public.ads_independent_sales_controls_v1_886 SET
  sales_enabled=p_enabled,version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
 WHERE singleton;
 INSERT INTO public.ads_independent_sales_events_v1_886(actor_user_id,enabled,reason)
 VALUES(p_actor,p_enabled,btrim(p_reason));
 RETURN jsonb_build_object('source','admin_ads_independent_sales_toggle_v1_886',
   'salesEnabled',p_enabled,'version',v.version+1,'newChargesCreated',false);
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
  'fixedFeeSalesEnabled',(SELECT sales_enabled FROM public.ads_independent_sales_controls_v1_886 WHERE singleton),
  'fixedFeeSalesVersion',(SELECT version FROM public.ads_independent_sales_controls_v1_886 WHERE singleton),
  'providerApprovedGrossCents',coalesce((SELECT sum(amount_cents) FROM public.ads_independent_checkouts_v1_886 WHERE status='payment_approved'),0),
  'rows',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
    'id',c.id,'advertiser',c.advertiser_name,'title',c.title,
    'description',c.description,'destination',c.destination_url,
    'city',c.city,'state',c.state,'status',c.status,
    'effectiveStatus',CASE WHEN c.status IN ('active','paused') AND c.run_ends_at<=clock_timestamp() THEN 'ended' ELSE c.status END,
    'runStartedAt',c.run_started_at,'runEndsAt',c.run_ends_at,'version',c.version,
    'budgetCents',c.budget_cents,'durationDays',c.duration_days,
    'reportedViewSignals',(SELECT count(*) FROM public.ads_independent_view_signals_v1_884 v WHERE v.campaign_id=c.id),
    'createdAt',c.created_at,
    'fixedFeeStatus',(SELECT ch.status FROM public.ads_independent_checkouts_v1_886 ch WHERE ch.campaign_id=c.id)
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
 IF p_action IN ('publish','resume') AND (
    EXISTS(SELECT 1 FROM public.ads_independent_sales_controls_v1_886 WHERE singleton AND sales_enabled)
    OR EXISTS(SELECT 1 FROM public.ads_independent_checkouts_v1_886 WHERE campaign_id=p_campaign)
  ) AND NOT EXISTS(SELECT 1 FROM public.ads_independent_checkouts_v1_886
    WHERE campaign_id=p_campaign AND status='payment_approved') THEN
    RAISE EXCEPTION 'ADS_PAID_CAMPAIGN_REQUIRED' USING errcode='42501';
 END IF;
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


REVOKE ALL ON FUNCTION public.ads_independent_checkout_reserve_v1_886(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ads_independent_checkout_attach_v1_886(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ads_independent_payment_fact_v1_886(text,text,text,text,integer,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_ads_independent_sales_toggle_v1_886(uuid,boolean,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ads_independent_checkout_reserve_v1_886(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ads_independent_checkout_attach_v1_886(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ads_independent_payment_fact_v1_886(text,text,text,text,integer,text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_ads_independent_sales_toggle_v1_886(uuid,boolean,integer,text) TO service_role;
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
   AND (NOT EXISTS(SELECT 1 FROM public.ads_independent_sales_controls_v1_886 WHERE singleton AND sales_enabled)
     OR EXISTS(SELECT 1 FROM public.ads_independent_checkouts_v1_886 ch
       WHERE ch.campaign_id=c.id AND ch.status='payment_approved'))
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
 IF EXISTS(SELECT 1 FROM public.ads_independent_sales_controls_v1_886 WHERE singleton AND sales_enabled)
   AND NOT EXISTS(SELECT 1 FROM public.ads_independent_checkouts_v1_886 ch
     WHERE ch.campaign_id=v_c.id AND ch.status='payment_approved')
 THEN RETURN jsonb_build_object('countedForDiagnostics',false,'billable',false,'reason','not_paid');END IF;
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


COMMIT;
