-- V1.916: founder-only, non-monetary institutional campaigns.
-- Separate ledger and issuance from advertisers' fixed-price checkouts.
BEGIN;
CREATE TABLE public.ads_institutional_campaigns_v1_916(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 template_key text NOT NULL CHECK(template_key IN ('home','benefits','services')),
 title text NOT NULL CHECK(length(title) BETWEEN 12 AND 80),
 description text NOT NULL CHECK(length(description) BETWEEN 20 AND 240),
 destination_url text NOT NULL CHECK(destination_url IN
  ('https://tamao.com.br/','https://tamao.com.br/#learn','https://tamao.com.br/#rides')),
 city text NOT NULL DEFAULT 'São Gabriel' CHECK(city='São Gabriel'),
 state text NOT NULL DEFAULT 'RS' CHECK(state='RS'),
 duration_days integer NOT NULL CHECK(duration_days IN (7,15,30)),
 view_limit integer NOT NULL CHECK(view_limit IN (100,500,1000)),
 status text NOT NULL DEFAULT 'approved'
   CHECK(status IN('approved','active','paused','ended')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 run_started_at timestamptz,
 run_ends_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((run_started_at IS NULL AND run_ends_at IS NULL) OR
       (run_started_at IS NOT NULL AND run_ends_at>run_started_at))
);
CREATE INDEX ads_institutional_active_v1_916
 ON public.ads_institutional_campaigns_v1_916(status,state,city,run_ends_at);
CREATE TABLE public.ads_institutional_events_v1_916(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES public.ads_institutional_campaigns_v1_916(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN ('create','publish','pause','resume','end')),
 old_status text,
 new_status text NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.ads_institutional_challenges_v1_916(
 token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES public.ads_institutional_campaigns_v1_916(id),
 viewer_hash text NOT NULL CHECK(viewer_hash ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '90 seconds')
);
CREATE INDEX ads_institutional_issuerate_v1_916
 ON public.ads_institutional_challenges_v1_916(viewer_hash,issued_at DESC);
CREATE TABLE public.ads_institutional_signals_v1_916(
 token uuid PRIMARY KEY REFERENCES public.ads_institutional_challenges_v1_916(token),
 campaign_id uuid NOT NULL REFERENCES public.ads_institutional_campaigns_v1_916(id),
 viewer_hash text NOT NULL CHECK(viewer_hash ~ '^[0-9a-f]{64}$'),
 visible_ms integer NOT NULL CHECK(visible_ms BETWEEN 1000 AND 60000),
 visible_percent integer NOT NULL CHECK(visible_percent BETWEEN 50 AND 100),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 billable boolean NOT NULL DEFAULT false CHECK(billable=false)
);
CREATE INDEX ads_institutional_dedup_v1_916
 ON public.ads_institutional_signals_v1_916(campaign_id,viewer_hash,recorded_at DESC);
DO $acl$
DECLARE v text;
BEGIN
 FOREACH v IN ARRAY ARRAY[
 'ads_institutional_campaigns_v1_916','ads_institutional_events_v1_916',
 'ads_institutional_challenges_v1_916','ads_institutional_signals_v1_916'
 ] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',v);
 END LOOP;
END;$acl$;
GRANT SELECT,INSERT,UPDATE ON public.ads_institutional_campaigns_v1_916 TO service_role;
GRANT SELECT,INSERT ON public.ads_institutional_events_v1_916 TO service_role;
GRANT SELECT,INSERT ON public.ads_institutional_challenges_v1_916 TO service_role;
GRANT SELECT,INSERT ON public.ads_institutional_signals_v1_916 TO service_role;

CREATE FUNCTION public.admin_ads_institutional_manage_v1_916(
 p_actor uuid,p_action text,p_campaign uuid,p_expected_version integer,
 p_request uuid,p_template text,p_duration_days integer,p_view_limit integer,
 p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE c record; v_status text; v_title text; v_description text; v_url text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins
    WHERE user_id=p_actor AND active AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'ADS_INSTITUTIONAL_ADMIN_DENIED' USING errcode='42501'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
 THEN RAISE EXCEPTION 'ADS_INSTITUTIONAL_REASON_REQUIRED' USING errcode='22023'; END IF;
 IF p_action='create' THEN
  IF p_request IS NULL OR p_campaign IS NOT NULL OR p_expected_version IS NOT NULL
    OR p_template NOT IN('home','benefits','services')
    OR p_duration_days NOT IN(7,15,30) OR p_view_limit NOT IN(100,500,1000)
  THEN RAISE EXCEPTION 'ADS_INSTITUTIONAL_CREATE_INVALID' USING errcode='22023'; END IF;
  SELECT * INTO c FROM public.ads_institutional_campaigns_v1_916
   WHERE request_id=p_request;
  IF FOUND THEN
   IF c.created_by<>p_actor OR c.template_key<>p_template OR
       c.duration_days<>p_duration_days OR c.view_limit<>p_view_limit
   THEN RAISE EXCEPTION 'ADS_INSTITUTIONAL_REQUEST_CONFLICT' USING errcode='40001'; END IF;
   RETURN jsonb_build_object('source','admin_ads_institutional_manage_v1_916',
      'campaignId',c.id,'status',c.status,'version',c.version,
      'replayed',true,'paymentCreated',false,'billingEnabled',false);
  END IF;
  v_title:=CASE p_template
    WHEN 'home' THEN 'Conheça o TAMÃO em São Gabriel'
    WHEN 'benefits' THEN 'Conheça os benefícios do TAMÃO'
    ELSE 'Profissionais e caronas no TAMÃO' END;
  v_description:=CASE p_template
    WHEN 'home' THEN 'Conheça o TAMÃO e explore os serviços disponíveis para sua cidade.'
    WHEN 'benefits' THEN 'Confira cupons, vantagens e novidades do TAMÃO, respeitando as condições de cada benefício.'
    ELSE 'Encontre profissionais e ofertas de caronas publicados na plataforma, sujeitos à disponibilidade.' END;
  v_url:=CASE p_template WHEN 'home' THEN 'https://tamao.com.br/'
    WHEN 'benefits' THEN 'https://tamao.com.br/#learn'
    ELSE 'https://tamao.com.br/#rides' END;
  INSERT INTO public.ads_institutional_campaigns_v1_916(
   request_id,created_by,template_key,title,description,destination_url,duration_days,view_limit
  ) VALUES(p_request,p_actor,p_template,v_title,v_description,v_url,p_duration_days,p_view_limit)
  RETURNING * INTO c;
  INSERT INTO public.ads_institutional_events_v1_916(campaign_id,actor_user_id,action,new_status,reason)
   VALUES(c.id,p_actor,'create',c.status,btrim(p_reason));
  RETURN jsonb_build_object('source','admin_ads_institutional_manage_v1_916',
   'campaignId',c.id,'status',c.status,'version',c.version,
   'replayed',false,'paymentCreated',false,'billingEnabled',false);
 END IF;
 IF p_action NOT IN ('publish','pause','resume','end') OR p_campaign IS NULL
   OR p_expected_version IS NULL OR p_expected_version<1
   OR p_request IS NOT NULL OR p_template IS NOT NULL
   OR p_duration_days IS NOT NULL OR p_view_limit IS NOT NULL
 THEN RAISE EXCEPTION 'ADS_INSTITUTIONAL_ACTION_INVALID' USING errcode='22023'; END IF;
 SELECT * INTO c FROM public.ads_institutional_campaigns_v1_916
   WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADS_INSTITUTIONAL_NOT_FOUND' USING errcode='22023'; END IF;
 IF c.version<>p_expected_version THEN
  RAISE EXCEPTION 'ADS_INSTITUTIONAL_VERSION_CONFLICT' USING errcode='40001'; END IF;
 IF (p_action='publish' AND c.status<>'approved') OR
    (p_action='pause' AND (c.status<>'active' OR c.run_ends_at<=clock_timestamp())) OR
    (p_action='resume' AND (c.status<>'paused' OR c.run_ends_at<=clock_timestamp())) OR
    (p_action='end' AND c.status NOT IN ('approved','active','paused'))
 THEN RAISE EXCEPTION 'ADS_INSTITUTIONAL_TRANSITION_DENIED' USING errcode='40001';END IF;
 v_status:=CASE p_action WHEN 'publish' THEN 'active' WHEN 'pause' THEN 'paused'
    WHEN 'resume' THEN 'active' ELSE 'ended' END;
 UPDATE public.ads_institutional_campaigns_v1_916 SET
  status=v_status,version=version+1,updated_at=clock_timestamp(),
  run_started_at=CASE WHEN p_action='publish' THEN clock_timestamp() ELSE run_started_at END,
  run_ends_at=CASE WHEN p_action='publish' THEN clock_timestamp()+make_interval(days=>c.duration_days)
    ELSE run_ends_at END
 WHERE id=p_campaign RETURNING version INTO c.version;
 INSERT INTO public.ads_institutional_events_v1_916(
  campaign_id,actor_user_id,action,old_status,new_status,reason
 ) VALUES(p_campaign,p_actor,p_action,c.status,v_status,btrim(p_reason));
 RETURN jsonb_build_object('source','admin_ads_institutional_manage_v1_916',
   'campaignId',p_campaign,'status',v_status,'version',c.version,
   'paymentCreated',false,'billingEnabled',false);
END;$fn$;

CREATE FUNCTION public.admin_ads_institutional_read_v1_916(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins
  WHERE user_id=p_actor AND active AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'ADS_INSTITUTIONAL_ADMIN_DENIED' USING errcode='42501';END IF;
 RETURN jsonb_build_object('source','admin_ads_institutional_read_v1_916',
   'readOnly',true,'billingEnabled',false,'paymentCreated',false,'rows',
    coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',c.id,'title',c.title,'description',c.description,
    'city',c.city,'state',c.state,'status',c.status,'version',c.version,
    'durationDays',c.duration_days,'viewLimit',c.view_limit,
    'viewSignals',(SELECT count(*) FROM public.ads_institutional_signals_v1_916 s
      WHERE s.campaign_id=c.id),
    'runEndsAt',c.run_ends_at
    ) ORDER BY c.created_at DESC)
    FROM (SELECT * FROM public.ads_institutional_campaigns_v1_916
      ORDER BY created_at DESC LIMIT 30)c),'[]'::jsonb));
END;$fn$;

CREATE FUNCTION public.ads_institutional_issue_v1_916(
 p_city text,p_state text,p_viewer_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE c record; v_token uuid;
BEGIN
 IF lower(btrim(coalesce(p_city,'')))<>'são gabriel' OR p_state<>'RS'
    OR p_viewer_hash !~ '^[0-9a-f]{64}$'
 THEN RETURN jsonb_build_object('source','ads_institutional_issue_v1_916',
  'slot',null,'noCharge',true,'billingEnabled',false);END IF;
 IF (SELECT count(*) FROM public.ads_institutional_challenges_v1_916
   WHERE viewer_hash=p_viewer_hash AND issued_at>clock_timestamp()-interval '1 hour')>=60
 THEN RETURN jsonb_build_object('source','ads_institutional_issue_v1_916',
  'slot',null,'noCharge',true,'billingEnabled',false);END IF;
 SELECT c0.* INTO c FROM public.ads_institutional_campaigns_v1_916 c0
 WHERE c0.status='active' AND c0.run_ends_at>clock_timestamp()
   AND c0.run_started_at<=clock_timestamp()
   AND (SELECT count(*) FROM public.ads_institutional_signals_v1_916 s
      WHERE s.campaign_id=c0.id)<c0.view_limit
 ORDER BY (SELECT count(*) FROM public.ads_institutional_signals_v1_916 s
      WHERE s.campaign_id=c0.id),c0.created_at,c0.id LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('source','ads_institutional_issue_v1_916',
  'slot',null,'noCharge',true,'billingEnabled',false);END IF;
 INSERT INTO public.ads_institutional_challenges_v1_916(campaign_id,viewer_hash)
 VALUES(c.id,p_viewer_hash) RETURNING token INTO v_token;
 RETURN jsonb_build_object('source','ads_institutional_issue_v1_916',
  'slot',jsonb_build_object('campaignId',c.id,'challenge',v_token,
   'label','Institucional','advertiser','TAMÃO',
   'title',c.title,'description',c.description,'url',c.destination_url,
   'city',c.city,'state',c.state),'noCharge',true,'billingEnabled',false,
  'independentlyAudited',false);
END;$fn$;

CREATE FUNCTION public.ads_institutional_confirm_v1_916(
 p_token uuid,p_viewer_hash text,p_visible_ms integer,p_visible_percent integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE t record;c record;n integer;
BEGIN
 IF p_viewer_hash !~ '^[0-9a-f]{64}$' OR
  p_visible_ms NOT BETWEEN 1000 AND 60000 OR p_visible_percent NOT BETWEEN 50 AND 100
 THEN RETURN jsonb_build_object('recognized',false,'countedForDiagnostics',false,
  'billable',false,'reason','invalid_claim');END IF;
 SELECT * INTO t FROM public.ads_institutional_challenges_v1_916
  WHERE token=p_token AND viewer_hash=p_viewer_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('recognized',false,
  'countedForDiagnostics',false,'billable',false,'reason','not_found'); END IF;
 IF clock_timestamp()<t.issued_at+interval '1100 milliseconds'
   OR clock_timestamp()>t.expires_at
 THEN RETURN jsonb_build_object('recognized',true,
  'countedForDiagnostics',false,'billable',false,'reason','timing');END IF;
 SELECT * INTO c FROM public.ads_institutional_campaigns_v1_916
  WHERE id=t.campaign_id FOR UPDATE;
 IF NOT FOUND OR c.status<>'active' OR c.run_ends_at<=clock_timestamp()
 THEN RETURN jsonb_build_object('recognized',true,
  'countedForDiagnostics',false,'billable',false,'reason','paused');END IF;
 IF EXISTS(SELECT 1 FROM public.ads_institutional_signals_v1_916 WHERE token=p_token)
 THEN RETURN jsonb_build_object('recognized',true,
  'countedForDiagnostics',false,'billable',false,'reason','replay');END IF;
 IF EXISTS(SELECT 1 FROM public.ads_institutional_signals_v1_916
   WHERE campaign_id=c.id AND viewer_hash=p_viewer_hash
   AND recorded_at>clock_timestamp()-interval '30 minutes')
 THEN RETURN jsonb_build_object('recognized',true,
  'countedForDiagnostics',false,'billable',false,'reason','duplicate');END IF;
 SELECT count(*) INTO n FROM public.ads_institutional_signals_v1_916 WHERE campaign_id=c.id;
 IF n>=c.view_limit THEN RETURN jsonb_build_object('recognized',true,
  'countedForDiagnostics',false,'billable',false,'reason','limit');END IF;
 INSERT INTO public.ads_institutional_signals_v1_916(
   token,campaign_id,viewer_hash,visible_ms,visible_percent
 ) VALUES(p_token,c.id,p_viewer_hash,p_visible_ms,p_visible_percent);
 RETURN jsonb_build_object('recognized',true,'countedForDiagnostics',true,
  'billable',false,'independentlyAudited',false,'reason','viewability_reported');
END;$fn$;

REVOKE ALL ON FUNCTION public.admin_ads_institutional_manage_v1_916(uuid,text,uuid,integer,uuid,text,integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_ads_institutional_read_v1_916(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ads_institutional_issue_v1_916(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ads_institutional_confirm_v1_916(uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ads_institutional_manage_v1_916(uuid,text,uuid,integer,uuid,text,integer,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_ads_institutional_read_v1_916(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ads_institutional_issue_v1_916(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ads_institutional_confirm_v1_916(uuid,text,integer,integer) TO service_role;
COMMIT;