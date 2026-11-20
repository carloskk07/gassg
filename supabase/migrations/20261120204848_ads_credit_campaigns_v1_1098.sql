-- TAMÃO V1.1098 — prepaid campaigns, server-issued view receipts, atomic debits.
-- No change to legacy fixed-duration ads; all commercial gates remain OFF.
BEGIN;

CREATE TABLE public.ads_credit_campaigns_v1_1098 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE,
 request_signature text NOT NULL CHECK(request_signature ~ '^[0-9a-f]{32}$'),
 advertiser_name text NOT NULL CHECK(length(advertiser_name) BETWEEN 2 AND 120),
 title text NOT NULL CHECK(length(title) BETWEEN 12 AND 80),
 description text NOT NULL CHECK(length(description) BETWEEN 20 AND 240),
 city text NOT NULL CHECK(length(city) BETWEEN 2 AND 100),
 state text NOT NULL CHECK(state ~ '^[A-Z]{2}$'),
 destination_url text NOT NULL CHECK(length(destination_url) BETWEEN 15 AND 300
  AND destination_url LIKE 'https://%' AND destination_url NOT LIKE '%@%'
  AND destination_url NOT LIKE '% %'),
 status text NOT NULL DEFAULT 'submitted'
  CHECK(status IN ('submitted','approved','active','paused','rejected','ended')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 reviewed_by uuid REFERENCES auth.users(id),
 review_reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ads_credit_campaigns_region_v1_1098
 ON public.ads_credit_campaigns_v1_1098(state,lower(city),status,created_at);
CREATE INDEX ads_credit_campaigns_owner_v1_1098
 ON public.ads_credit_campaigns_v1_1098(owner_user_id,created_at DESC);

CREATE TABLE public.ads_credit_challenges_v1_1098 (
 token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES public.ads_credit_campaigns_v1_1098(id) ON DELETE RESTRICT,
 viewer_hash text NOT NULL CHECK(viewer_hash ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '90 seconds')
);
CREATE INDEX ads_credit_challenges_rate_v1_1098 ON
 public.ads_credit_challenges_v1_1098(viewer_hash,issued_at DESC);

CREATE TABLE public.ads_credit_view_receipts_v1_1098 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token uuid NOT NULL UNIQUE REFERENCES public.ads_credit_challenges_v1_1098(token),
 campaign_id uuid NOT NULL REFERENCES public.ads_credit_campaigns_v1_1098(id),
 owner_user_id uuid NOT NULL REFERENCES auth.users(id),
 viewer_hash text NOT NULL CHECK(viewer_hash ~ '^[0-9a-f]{64}$'),
 visible_ms integer NOT NULL CHECK(visible_ms BETWEEN 1000 AND 60000),
 visible_percent integer NOT NULL CHECK(visible_percent BETWEEN 50 AND 100),
 charged_cents integer NOT NULL CHECK(charged_cents BETWEEN 1 AND 25),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ads_credit_view_receipts_dedup_v1_1098 ON
 public.ads_credit_view_receipts_v1_1098(campaign_id,viewer_hash,recorded_at DESC);
CREATE INDEX ads_credit_view_receipts_owner_v1_1098 ON
 public.ads_credit_view_receipts_v1_1098(owner_user_id,recorded_at DESC);

CREATE TABLE public.ads_credit_reviews_v1_1098 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES public.ads_credit_campaigns_v1_1098(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN ('approve','reject','publish','pause','resume','end','owner_pause','owner_resume')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 500),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $acl$ DECLARE item text;
BEGIN
 FOREACH item IN ARRAY ARRAY[
 'ads_credit_campaigns_v1_1098','ads_credit_challenges_v1_1098',
 'ads_credit_view_receipts_v1_1098','ads_credit_reviews_v1_1098'
 ] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',item);
 END LOOP;
END;$acl$;
GRANT SELECT,INSERT,UPDATE ON public.ads_credit_campaigns_v1_1098 TO service_role;
GRANT SELECT,INSERT ON public.ads_credit_challenges_v1_1098 TO service_role;
GRANT SELECT,INSERT ON public.ads_credit_view_receipts_v1_1098 TO service_role;
GRANT SELECT,INSERT ON public.ads_credit_reviews_v1_1098 TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.ads_credit_reviews_v1_1098_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.ads_credit_campaign_submit_v1_1098(
 p_owner uuid,p_request uuid,p_advertiser text,p_title text,p_description text,
 p_city text,p_state text,p_destination text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE signature text; prior record; result_id uuid;
BEGIN
 IF p_owner IS NULL OR p_request IS NULL OR NOT EXISTS(
 SELECT 1 FROM auth.users WHERE id=p_owner
  AND is_anonymous IS FALSE AND email_confirmed_at IS NOT NULL
 ) THEN RAISE EXCEPTION 'ADS_CREDIT_VERIFIED_ACCOUNT_REQUIRED' USING errcode='42501';END IF;
 IF length(btrim(coalesce(p_advertiser,''))) NOT BETWEEN 2 AND 120
  OR length(btrim(coalesce(p_title,''))) NOT BETWEEN 12 AND 80
  OR length(btrim(coalesce(p_description,''))) NOT BETWEEN 20 AND 240
  OR length(btrim(coalesce(p_city,''))) NOT BETWEEN 2 AND 100
  OR coalesce(p_state,'') !~ '^[A-Z]{2}$'
  OR length(btrim(coalesce(p_destination,''))) NOT BETWEEN 15 AND 300
  OR p_destination NOT LIKE 'https://%' OR p_destination LIKE '%@%'
  OR p_destination LIKE '% %'
 THEN RAISE EXCEPTION 'ADS_CREDIT_CREATIVE_INVALID' USING errcode='22023';END IF;
 signature:=md5(jsonb_build_object('owner',p_owner,'advertiser',btrim(p_advertiser),
  'title',btrim(p_title),'description',btrim(p_description),
  'city',btrim(p_city),'state',p_state,'destination',btrim(p_destination))::text);
 SELECT id,owner_user_id,request_signature INTO prior
 FROM public.ads_credit_campaigns_v1_1098 WHERE request_id=p_request FOR UPDATE;
 IF FOUND THEN
  IF prior.owner_user_id<>p_owner OR prior.request_signature<>signature
  THEN RAISE EXCEPTION 'ADS_CREDIT_REQUEST_CONFLICT' USING errcode='40001';END IF;
  RETURN jsonb_build_object('source','ads_credit_campaign_submit_v1_1098',
   'campaignId',prior.id,'replayed',true,'status','submitted');
 END IF;
 INSERT INTO public.ads_credit_campaigns_v1_1098(
  owner_user_id,request_id,request_signature,advertiser_name,title,description,
  city,state,destination_url
 ) VALUES(p_owner,p_request,signature,btrim(p_advertiser),btrim(p_title),
  btrim(p_description),btrim(p_city),p_state,btrim(p_destination))
 ON CONFLICT(request_id) DO NOTHING RETURNING id INTO result_id;
 IF result_id IS NULL THEN
  SELECT id,owner_user_id,request_signature INTO prior
    FROM public.ads_credit_campaigns_v1_1098 WHERE request_id=p_request;
  IF prior.owner_user_id<>p_owner OR prior.request_signature<>signature
  THEN RAISE EXCEPTION 'ADS_CREDIT_REQUEST_CONFLICT' USING errcode='40001';END IF;
  result_id:=prior.id;
 END IF;
 RETURN jsonb_build_object('source','ads_credit_campaign_submit_v1_1098',
  'campaignId',result_id,'replayed',false,'status','submitted');
END;$fn$;

CREATE OR REPLACE FUNCTION public.ads_credit_campaigns_mine_v1_1098(p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
BEGIN
 IF p_owner IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_owner
  AND u.is_anonymous IS FALSE AND u.email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'ADS_CREDIT_ACCOUNT_DENIED' USING errcode='42501';END IF;
 RETURN jsonb_build_object('source','ads_credit_campaigns_mine_v1_1098',
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',c.id,'advertiser',c.advertiser_name,'title',c.title,'description',c.description,
    'city',c.city,'state',c.state,'destination',c.destination_url,
    'status',c.status,'version',c.version,'createdAt',c.created_at,
    'views',(SELECT count(*) FROM public.ads_credit_view_receipts_v1_1098 v WHERE v.campaign_id=c.id),
    'spentCents',(SELECT coalesce(sum(v.charged_cents),0) FROM public.ads_credit_view_receipts_v1_1098 v WHERE v.campaign_id=c.id)
   ) ORDER BY c.created_at DESC)
   FROM (SELECT * FROM public.ads_credit_campaigns_v1_1098
     WHERE owner_user_id=p_owner ORDER BY created_at DESC LIMIT 30) c),'[]'::jsonb));
END;$fn$;

CREATE OR REPLACE FUNCTION public.ads_credit_campaign_owner_action_v1_1098(
 p_owner uuid,p_campaign uuid,p_expected_version integer,p_action text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE c public.ads_credit_campaigns_v1_1098%ROWTYPE;
 price integer; balance bigint;
BEGIN
 IF p_action NOT IN('pause','resume') THEN
  RAISE EXCEPTION 'ADS_CREDIT_OWNER_ACTION_INVALID' USING errcode='22023';END IF;
 SELECT * INTO c FROM public.ads_credit_campaigns_v1_1098
  WHERE id=p_campaign AND owner_user_id=p_owner FOR UPDATE;
 IF NOT FOUND OR c.version<>p_expected_version
 THEN RAISE EXCEPTION 'ADS_CREDIT_OWNER_VERSION_CONFLICT' USING errcode='40001';END IF;
 IF (p_action='pause' AND c.status<>'active')
  OR (p_action='resume' AND c.status<>'paused')
 THEN RAISE EXCEPTION 'ADS_CREDIT_OWNER_STATE_INVALID' USING errcode='40001';END IF;
 IF p_action='resume' THEN
  SELECT cents_per_view INTO price FROM public.ads_credit_controls_v1_1097
   WHERE singleton AND view_debit_enabled AND recharge_enabled AND evidence_audited;
  SELECT balance_cents INTO balance FROM public.ads_credit_wallets_v1_1097
   WHERE owner_user_id=p_owner AND NOT frozen;
  IF price IS NULL OR coalesce(balance,0)<price
  THEN RAISE EXCEPTION 'ADS_CREDIT_INSUFFICIENT_BALANCE' USING errcode='42501';END IF;
 END IF;
 UPDATE public.ads_credit_campaigns_v1_1098
  SET status=CASE WHEN p_action='pause' THEN 'paused' ELSE 'active' END,
   version=version+1,updated_at=clock_timestamp() WHERE id=c.id;
 INSERT INTO public.ads_credit_reviews_v1_1098(
  campaign_id,actor_user_id,action,reason)
 VALUES(c.id,p_owner,'owner_'||p_action,
  CASE WHEN p_action='pause' THEN 'Campanha pausada pelo próprio anunciante.'
   ELSE 'Campanha retomada após conferência do crédito disponível.' END);
 RETURN jsonb_build_object('source','ads_credit_campaign_owner_action_v1_1098',
  'campaignId',c.id,'status',CASE WHEN p_action='pause' THEN 'paused' ELSE 'active' END,
  'version',c.version+1);
END;$fn$;

CREATE OR REPLACE FUNCTION public.ads_credit_admin_read_v1_1098(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins
  WHERE user_id=p_actor AND active
  AND admin_role IN('superadmin','operations','compliance','finance','readonly'))
 THEN RAISE EXCEPTION 'ADS_CREDIT_ADMIN_DENIED' USING errcode='42501';END IF;
 RETURN jsonb_build_object('source','ads_credit_admin_read_v1_1098',
  'gate',(SELECT jsonb_build_object('rechargeEnabled',recharge_enabled,
   'billingEnabled',view_debit_enabled,'evidenceEnabled',evidence_audited,
   'centsPerView',cents_per_view,'version',version)
    FROM public.ads_credit_controls_v1_1097 WHERE singleton),
  'wallets',(SELECT count(*) FROM public.ads_credit_wallets_v1_1097),
  'loadedCents',(SELECT coalesce(sum(total_loaded_cents),0) FROM public.ads_credit_wallets_v1_1097),
  'spentCents',(SELECT coalesce(sum(total_spent_cents),0) FROM public.ads_credit_wallets_v1_1097),
  'remainingCents',(SELECT coalesce(sum(balance_cents),0) FROM public.ads_credit_wallets_v1_1097),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',c.id,'advertiser',c.advertiser_name,'title',c.title,
   'description',c.description,'city',c.city,'state',c.state,'destination',c.destination_url,
   'status',c.status,'version',c.version,'createdAt',c.created_at,
   'views',(SELECT count(*) FROM public.ads_credit_view_receipts_v1_1098 v WHERE v.campaign_id=c.id))
    ORDER BY c.created_at DESC)
    FROM (SELECT * FROM public.ads_credit_campaigns_v1_1098 ORDER BY created_at DESC LIMIT 50) c),'[]'::jsonb));
END;$fn$;

CREATE OR REPLACE FUNCTION public.ads_credit_admin_action_v1_1098(
 p_actor uuid,p_campaign uuid,p_expected_version integer,p_action text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE c public.ads_credit_campaigns_v1_1098%ROWTYPE;
 price integer; balance bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=p_actor
  AND active AND admin_role IN('superadmin','compliance'))
 THEN RAISE EXCEPTION 'ADS_CREDIT_ADMIN_DENIED' USING errcode='42501';END IF;
 IF p_action NOT IN ('approve','reject','publish','pause','resume','end')
  OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
 THEN RAISE EXCEPTION 'ADS_CREDIT_ADMIN_ACTION_INVALID' USING errcode='22023';END IF;
 SELECT * INTO c FROM public.ads_credit_campaigns_v1_1098
  WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND OR c.version<>p_expected_version
 THEN RAISE EXCEPTION 'ADS_CREDIT_ADMIN_VERSION_CONFLICT' USING errcode='40001';END IF;
 IF (p_action='approve' AND c.status<>'submitted')
  OR (p_action='reject' AND c.status NOT IN ('submitted','approved'))
  OR (p_action='publish' AND c.status<>'approved')
  OR (p_action='pause' AND c.status<>'active')
  OR (p_action='resume' AND c.status<>'paused')
  OR (p_action='end' AND c.status NOT IN('active','paused','approved'))
 THEN RAISE EXCEPTION 'ADS_CREDIT_ADMIN_TRANSITION_INVALID' USING errcode='40001';END IF;
 IF p_action IN('publish','resume') THEN
  SELECT cents_per_view INTO price FROM public.ads_credit_controls_v1_1097
    WHERE singleton AND recharge_enabled AND view_debit_enabled AND evidence_audited;
  SELECT balance_cents INTO balance FROM public.ads_credit_wallets_v1_1097
    WHERE owner_user_id=c.owner_user_id AND NOT frozen;
  IF price IS NULL OR coalesce(balance,0)<price
  THEN RAISE EXCEPTION 'ADS_CREDIT_INSUFFICIENT_BALANCE' USING errcode='42501';END IF;
 END IF;
 UPDATE public.ads_credit_campaigns_v1_1098 SET
  status=CASE p_action WHEN 'approve' THEN 'approved'
   WHEN 'publish' THEN 'active' WHEN 'resume' THEN 'active'
   WHEN 'pause' THEN 'paused' WHEN 'end' THEN 'ended' ELSE 'rejected' END,
  reviewed_by=p_actor,review_reason=btrim(p_reason),
  version=version+1,updated_at=clock_timestamp() WHERE id=c.id;
 INSERT INTO public.ads_credit_reviews_v1_1098(campaign_id,actor_user_id,action,reason)
 VALUES(c.id,p_actor,p_action,btrim(p_reason));
 RETURN jsonb_build_object('source','ads_credit_admin_action_v1_1098',
  'campaignId',c.id,'action',p_action,'version',c.version+1);
END;$fn$;

-- Only the server creates a short-lived token tied to the HMAC viewer identity.
CREATE OR REPLACE FUNCTION public.ads_credit_issue_v1_1098(
 p_city text,p_state text,p_viewer_hash text,p_viewer_user uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE c public.ads_credit_campaigns_v1_1098%ROWTYPE; token_id uuid; price integer;
BEGIN
 SELECT cents_per_view INTO price FROM public.ads_credit_controls_v1_1097
  WHERE singleton AND recharge_enabled AND view_debit_enabled AND evidence_audited;
 IF price IS NULL OR length(btrim(coalesce(p_city,''))) NOT BETWEEN 2 AND 100
  OR p_state !~ '^[A-Z]{2}$' OR p_viewer_hash !~ '^[0-9a-f]{64}$'
 THEN RETURN jsonb_build_object('source','ads_credit_issue_v1_1098',
  'slot',null,'billingEnabled',false,'noCharge',true);END IF;
 IF (SELECT count(*) FROM public.ads_credit_challenges_v1_1098
    WHERE viewer_hash=p_viewer_hash AND issued_at>clock_timestamp()-interval '1 hour')>=40
 THEN RETURN jsonb_build_object('source','ads_credit_issue_v1_1098',
  'slot',null,'billingEnabled',false,'noCharge',true);END IF;
 SELECT * INTO c FROM public.ads_credit_campaigns_v1_1098
  WHERE status='active' AND state=p_state AND lower(city)=lower(btrim(p_city))
   AND (p_viewer_user IS NULL OR owner_user_id<>p_viewer_user)
   AND EXISTS(SELECT 1 FROM public.ads_credit_wallets_v1_1097 w
    WHERE w.owner_user_id=ads_credit_campaigns_v1_1098.owner_user_id
     AND NOT w.frozen AND w.balance_cents>=price)
   AND NOT EXISTS(SELECT 1 FROM public.ads_credit_view_receipts_v1_1098 v
    WHERE v.campaign_id=ads_credit_campaigns_v1_1098.id AND v.viewer_hash=p_viewer_hash
    AND v.recorded_at>clock_timestamp()-interval '24 hours')
   -- Defensive pilot cap: even a rotation of addresses cannot consume the
   -- campaign balance without bound in a day. This is NOT a time-based fee.
   AND (SELECT count(*) FROM public.ads_credit_view_receipts_v1_1098 v
    WHERE v.campaign_id=ads_credit_campaigns_v1_1098.id
      AND v.recorded_at>clock_timestamp()-interval '24 hours')<200
  ORDER BY (SELECT count(*) FROM public.ads_credit_view_receipts_v1_1098 v
     WHERE v.campaign_id=ads_credit_campaigns_v1_1098.id
       AND v.recorded_at>clock_timestamp()-interval '24 hours') ASC,
    created_at ASC,id ASC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('source','ads_credit_issue_v1_1098',
  'slot',null,'billingEnabled',false,'noCharge',true);END IF;
 INSERT INTO public.ads_credit_challenges_v1_1098(campaign_id,viewer_hash)
 VALUES(c.id,p_viewer_hash) RETURNING token INTO token_id;
 RETURN jsonb_build_object('source','ads_credit_issue_v1_1098',
  'slot',jsonb_build_object('campaignId',c.id,'challenge',token_id,
   'label','Patrocinado','advertiser',c.advertiser_name,'title',c.title,
   'description',c.description,'url',c.destination_url,'city',c.city,'state',c.state),
  'billingEnabled',true,'noCharge',false,'pricingMode','prepaid_per_view');
END;$fn$;

-- A claimed browser-visible view is not a third-party audited audience figure.
-- It becomes one charge only after server challenge, hold time, owner exclusion,
-- 24h hashed-viewer dedup, wallet balance and gates are verified atomically.
CREATE OR REPLACE FUNCTION public.ads_credit_confirm_v1_1098(
 p_token uuid,p_viewer_hash text,p_visible_ms integer,p_visible_percent integer,
 p_viewer_user uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $fn$
DECLARE ch public.ads_credit_challenges_v1_1098%ROWTYPE;
 c public.ads_credit_campaigns_v1_1098%ROWTYPE;
 price integer; w public.ads_credit_wallets_v1_1097%ROWTYPE;
 receipt_id uuid; next_balance bigint;
BEGIN
 IF p_token IS NULL OR p_viewer_hash !~ '^[0-9a-f]{64}$'
  OR p_visible_ms NOT BETWEEN 1000 AND 60000
  OR p_visible_percent NOT BETWEEN 50 AND 100
 THEN RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',false,'charged',false,'reason','invalid_claim');END IF;
 SELECT * INTO ch FROM public.ads_credit_challenges_v1_1098
  WHERE token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',false,'charged',false,'reason','unknown_token');END IF;
 IF ch.viewer_hash<>p_viewer_hash
  OR clock_timestamp()<ch.issued_at+interval '1200 milliseconds'
  OR clock_timestamp()>ch.expires_at
 THEN RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',true,'charged',false,'reason','identity_or_time');END IF;
 SELECT * INTO c FROM public.ads_credit_campaigns_v1_1098
  WHERE id=ch.campaign_id FOR UPDATE;
 IF NOT FOUND OR c.status<>'active' OR (p_viewer_user IS NOT NULL AND c.owner_user_id=p_viewer_user)
 THEN RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',true,'charged',false,'reason','not_eligible');END IF;
 SELECT cents_per_view INTO price FROM public.ads_credit_controls_v1_1097
  WHERE singleton AND recharge_enabled AND view_debit_enabled AND evidence_audited;
 IF price IS NULL THEN RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',true,'charged',false,'reason','billing_paused');END IF;
 SELECT * INTO w FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=c.owner_user_id FOR UPDATE;
 IF NOT FOUND OR w.frozen OR w.balance_cents<price
 THEN RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',true,'charged',false,'reason','insufficient_balance');END IF;
 IF EXISTS(SELECT 1 FROM public.ads_credit_view_receipts_v1_1098 WHERE token=p_token)
 THEN RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',true,'charged',false,'reason','replay');END IF;
 IF EXISTS(SELECT 1 FROM public.ads_credit_view_receipts_v1_1098
  WHERE campaign_id=c.id AND viewer_hash=p_viewer_hash
   AND recorded_at>clock_timestamp()-interval '24 hours')
 THEN RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',true,'charged',false,'reason','duplicate_viewer');END IF;
 IF (SELECT count(*) FROM public.ads_credit_view_receipts_v1_1098
  WHERE campaign_id=c.id AND recorded_at>clock_timestamp()-interval '24 hours')>=200
 THEN RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',true,'charged',false,'reason','daily_safety_limit');END IF;
 INSERT INTO public.ads_credit_view_receipts_v1_1098(
  token,campaign_id,owner_user_id,viewer_hash,visible_ms,visible_percent,charged_cents)
 VALUES(p_token,c.id,c.owner_user_id,p_viewer_hash,p_visible_ms,p_visible_percent,price)
 RETURNING id INTO receipt_id;
 UPDATE public.ads_credit_wallets_v1_1097 SET balance_cents=balance_cents-price,
  total_spent_cents=total_spent_cents+price,updated_at=clock_timestamp()
 WHERE owner_user_id=c.owner_user_id RETURNING balance_cents INTO next_balance;
 INSERT INTO public.ads_credit_ledger_v1_1097(
  owner_user_id,event_key,source_view_id,operation,delta_cents,balance_after_cents)
 VALUES(c.owner_user_id,'credit-view:'||receipt_id::text,receipt_id,'view',-price,next_balance);
 -- Stop delivery as soon as the balance cannot cover one more view.
 -- The owner may resume later after a verified top-up.
 IF next_balance<price THEN
  UPDATE public.ads_credit_campaigns_v1_1098 SET
   status='paused',version=version+1,updated_at=clock_timestamp()
   WHERE id=c.id;
 END IF;
 RETURN jsonb_build_object('source','ads_credit_confirm_v1_1098',
  'recognized',true,'charged',true,'chargedCents',price,'balanceCents',next_balance);
END;$fn$;

-- Service-role-only RPCs: browser cannot approve, bill, or create a challenge.
DO $perms$ DECLARE fn record;
BEGIN
 FOR fn IN SELECT oid::regprocedure::text AS signature FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND
 proname IN ('ads_credit_campaign_submit_v1_1098','ads_credit_campaigns_mine_v1_1098',
  'ads_credit_campaign_owner_action_v1_1098','ads_credit_admin_read_v1_1098',
  'ads_credit_admin_action_v1_1098','ads_credit_issue_v1_1098',
  'ads_credit_confirm_v1_1098') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||fn.signature||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn.signature||' TO service_role';
 END LOOP;
END;$perms$;
COMMIT;
