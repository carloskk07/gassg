-- V1.890: return authoritative checkout expiry, give Pix payment settlement time,
-- and allow provider GET reconciliation after a lost preference response.
BEGIN;
ALTER TABLE public.ads_independent_checkouts_v1_886
 ALTER COLUMN expires_at SET DEFAULT (clock_timestamp()+interval '72 hours');

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
