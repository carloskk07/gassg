-- V1.892: one controlled, real-price advertising homologation while public sales stay closed.
-- Founder authorization is necessary but not evidence of PSP payment or settlement.
BEGIN;
ALTER TABLE public.ads_independent_sales_controls_v1_886
 ADD COLUMN homologation_campaign_id uuid REFERENCES public.ads_independent_campaigns_v1_884(id) ON DELETE RESTRICT,
 ADD COLUMN homologation_expires_at timestamptz,
 ADD COLUMN homologation_approved_by uuid REFERENCES auth.users(id),
 ADD CONSTRAINT ads_independent_homologation_complete_v1_892 CHECK (
  (homologation_campaign_id IS NULL AND homologation_expires_at IS NULL AND homologation_approved_by IS NULL)
  OR (homologation_campaign_id IS NOT NULL AND homologation_expires_at IS NOT NULL
      AND homologation_approved_by IS NOT NULL)
 );
CREATE TABLE public.ads_independent_homologation_events_v1_892 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 campaign_id uuid REFERENCES public.ads_independent_campaigns_v1_884(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.ads_independent_homologation_events_v1_892 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ads_independent_homologation_events_v1_892 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.ads_independent_homologation_events_v1_892 TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ads_independent_homologation_v1_892(
 p_actor uuid,p_campaign uuid,p_enabled boolean,p_expected_version integer,
 p_reason text,p_confirmation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v_controls record;v_campaign record;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.platform_admins
    WHERE user_id=p_actor AND active AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'ADS_HOMOLOGATION_ADMIN_DENIED' USING errcode='42501';END IF;
 IF p_enabled IS NULL OR p_expected_version IS NULL OR p_expected_version<1
   OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
   OR (p_enabled AND (p_campaign IS NULL OR p_confirmation IS DISTINCT FROM 'HOMOLOGAR'))
   OR (NOT p_enabled AND (p_campaign IS NOT NULL OR p_confirmation IS DISTINCT FROM 'CANCELAR'))
 THEN RAISE EXCEPTION 'ADS_HOMOLOGATION_CONFIRMATION_INVALID' USING errcode='22023';END IF;
 SELECT * INTO v_controls FROM public.ads_independent_sales_controls_v1_886
 WHERE singleton FOR UPDATE;
 IF NOT FOUND OR v_controls.version IS DISTINCT FROM p_expected_version
 THEN RAISE EXCEPTION 'ADS_HOMOLOGATION_VERSION_CONFLICT' USING errcode='40001';END IF;
 IF v_controls.sales_enabled THEN
   RAISE EXCEPTION 'ADS_HOMOLOGATION_PUBLIC_SALES_OPEN' USING errcode='42501';END IF;
 IF p_enabled THEN
   SELECT * INTO v_campaign FROM public.ads_independent_campaigns_v1_884
   WHERE id=p_campaign FOR UPDATE;
   IF NOT FOUND OR v_campaign.status<>'approved'
      OR v_campaign.budget_cents<>1990 OR v_campaign.duration_days<>7
      OR NOT EXISTS(SELECT 1 FROM auth.users
         WHERE id=v_campaign.owner_user_id AND is_anonymous IS FALSE
           AND email_confirmed_at IS NOT NULL)
   THEN RAISE EXCEPTION 'ADS_HOMOLOGATION_CAMPAIGN_UNVERIFIED' USING errcode='42501';END IF;
   IF v_controls.homologation_campaign_id IS NOT NULL
     AND v_controls.homologation_expires_at>clock_timestamp()
   THEN RAISE EXCEPTION 'ADS_HOMOLOGATION_ALREADY_ACTIVE' USING errcode='40001';END IF;
   -- At most one financial test; never replace a campaign with pending money.
   IF EXISTS(SELECT 1 FROM public.ads_independent_checkouts_v1_886)
   THEN RAISE EXCEPTION 'ADS_HOMOLOGATION_EXISTING_CHECKOUT_REVIEW' USING errcode='42501';END IF;
 END IF;
 UPDATE public.ads_independent_sales_controls_v1_886 SET
  homologation_campaign_id=CASE WHEN p_enabled THEN p_campaign ELSE NULL END,
  homologation_expires_at=CASE WHEN p_enabled THEN clock_timestamp()+interval '72 hours' ELSE NULL END,
  homologation_approved_by=CASE WHEN p_enabled THEN p_actor ELSE NULL END,
  version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
 WHERE singleton;
 INSERT INTO public.ads_independent_homologation_events_v1_892(
  actor_user_id,campaign_id,enabled,reason)
 VALUES(p_actor,CASE WHEN p_enabled THEN p_campaign ELSE v_controls.homologation_campaign_id END,
        p_enabled,btrim(p_reason));
 RETURN (SELECT jsonb_build_object('source','admin_ads_independent_homologation_v1_892',
    'salesEnabled',sales_enabled,'homologationAuthorized',p_enabled,
    'homologationCampaignId',homologation_campaign_id,
    'homologationExpiresAt',homologation_expires_at,
    'version',version,'billingEnabled',false,'newChargesCreated',false)
  FROM public.ads_independent_sales_controls_v1_886 WHERE singleton);
END;$fn$;

REVOKE ALL ON FUNCTION public.admin_ads_independent_homologation_v1_892(
 uuid,uuid,boolean,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ads_independent_homologation_v1_892(
 uuid,uuid,boolean,integer,text,text) TO service_role;

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
 -- Serialize authorization/revocation with reservation. The control row is
 -- locked BEFORE the campaign, matching the Admin lock order.
 PERFORM singleton FROM public.ads_independent_sales_controls_v1_886
 WHERE singleton FOR SHARE;
 SELECT * INTO v_campaign FROM public.ads_independent_campaigns_v1_884
 WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND OR v_campaign.owner_user_id<>p_owner OR v_campaign.status<>'approved'
 THEN RAISE EXCEPTION 'ADS_APPROVED_OWNER_REQUIRED' USING errcode='42501';END IF;
 -- Outside public sales, permit just the named, unexpired, founder-authorized
 -- campaign. This is a genuine LIVE purchase and never a simulated PSP charge.
 IF NOT EXISTS(SELECT 1 FROM public.ads_independent_sales_controls_v1_886
   WHERE singleton AND (sales_enabled OR
      (homologation_campaign_id=p_campaign AND
       homologation_expires_at>clock_timestamp())))
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
     'expiresAt',v_checkout.expires_at,
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
   'externalReference',v_reference,'expiresAt',
   (SELECT expires_at FROM public.ads_independent_checkouts_v1_886 WHERE campaign_id=p_campaign),
   'checkoutUrl',null,
   'amountCents',v_campaign.budget_cents);
END;$fn$;




REVOKE ALL ON FUNCTION public.ads_independent_checkout_reserve_v1_886(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ads_independent_checkout_reserve_v1_886(uuid,uuid,uuid)
 TO service_role;
COMMIT;
