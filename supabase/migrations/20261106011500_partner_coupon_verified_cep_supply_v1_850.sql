-- TAMÃO #850 — do not sell future paid coupons based only on merchant 'online'.
-- Reuse the canonical City Offer Scope (fresh stock/price, compliance, heartbeat,
-- launch mode, city activation and delivery payment) and opt-in agreement.
CREATE OR REPLACE FUNCTION public.clube_partner_coupon_sale_readiness_v1_849(p_package text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $readiness$
 SELECT pg_catalog.jsonb_build_object(
  'source','clube_partner_coupon_sale_readiness_v1_849',
  'packageKey',p_package,
  'merchantCount',(
    SELECT count(*) FROM public.merchant_coupon_consents_v1_845 c
    JOIN public.merchants m ON m.id=c.merchant_id
    JOIN public.merchant_billing_accounts a ON a.merchant_id=m.id
    JOIN public.merchant_business_details d ON d.merchant_id=m.id
    WHERE c.opted_in AND c.terms_version=1 AND m.status='active'
      AND m.online AND NOT a.sales_hold
      AND m.id=ANY(public.market_city_offer_scope(d.city,d.state))),
  'ready',(
   p_package='partner_general_3x5_849'
   AND (SELECT enabled FROM public.clube_partner_coupon_launch_v1_846 WHERE singleton) IS TRUE
   AND EXISTS(SELECT 1 FROM public.clube_coupon_paid_packages p
       WHERE p.package_key=p_package AND p.sale_enabled
         AND p.funding_verified AND p.legal_terms_verified AND p.redeem_settlement_verified
         AND NOT p.sponsored_by_owner AND p.coupon_face_cents BETWEEN 100 AND 500
         AND p.min_order_cents>=1000)
   AND EXISTS(SELECT 1 FROM public.clube_partner_coupon_sale_agreements_v1_849 s
       WHERE s.package_key=p_package AND s.sales_authorized)
   AND EXISTS(SELECT 1 FROM public.merchant_coupon_consents_v1_845 c
       JOIN public.merchants m ON m.id=c.merchant_id
       JOIN public.merchant_billing_accounts a ON a.merchant_id=m.id
    JOIN public.merchant_business_details d ON d.merchant_id=m.id
       WHERE c.opted_in AND c.terms_version=1 AND m.status='active'
         AND m.online AND NOT a.sales_hold
      AND m.id=ANY(public.market_city_offer_scope(d.city,d.state)))
  )
 );
$readiness$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_sale_readiness_v1_849(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_partner_coupon_sale_readiness_v1_849(text) TO service_role;

CREATE FUNCTION public.clube_partner_coupon_postal_supply_v1_850(p_postal text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $supply$
DECLARE
 v_zip public.postal_code_validation_cache%rowtype;
 v_scoped uuid[];
 v_count integer:=0;
BEGIN
 IF p_postal IS NULL OR p_postal !~ '^[0-9]{8}$'
 THEN RAISE EXCEPTION 'PARTNER_COUPON_POSTAL_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_zip FROM public.postal_code_validation_cache
 WHERE postal_code=p_postal
   AND verified_at>=statement_timestamp()-interval '30 days'
   AND btrim(coalesce(street,''))<>'' AND service_area_allowed IS TRUE;
 IF NOT FOUND THEN
   RETURN pg_catalog.jsonb_build_object(
     'source','clube_partner_coupon_postal_supply_v1_850',
     'postalCode',p_postal,'ready',false,'verified',false,
     'merchantCount',0,'reason','POSTAL_NOT_VERIFIED');
 END IF;
 v_scoped:=public.market_city_offer_scope(v_zip.city,v_zip.state);
 SELECT count(DISTINCT c.merchant_id) INTO v_count
 FROM public.merchant_coupon_consents_v1_845 c
 JOIN public.merchants m ON m.id=c.merchant_id
 JOIN public.merchant_billing_accounts a ON a.merchant_id=m.id
 JOIN public.merchant_coupon_terms_v1_845 t ON t.terms_version=c.terms_version
 WHERE c.opted_in AND c.terms_version=1 AND t.enabled
   AND m.status='active' AND m.online AND m.accepts_citywide
   AND NOT a.sales_hold AND c.merchant_id=ANY(v_scoped);
 RETURN pg_catalog.jsonb_build_object(
   'source','clube_partner_coupon_postal_supply_v1_850',
   'postalCode',p_postal,'ready',v_count>0,'verified',true,
   'merchantCount',v_count,'city',v_zip.city,'state',v_zip.state,
   'reason',CASE WHEN v_count>0 THEN null ELSE 'NO_ELIGIBLE_CITY_MERCHANT' END);
END;
$supply$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_postal_supply_v1_850(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_partner_coupon_postal_supply_v1_850(text) TO service_role;

-- Immutable buyer-region snapshot, scoped ONLY to the future #849 package.
ALTER TABLE public.clube_coupon_paid_invoices ADD COLUMN buyer_postal_code_v1_850 text;
ALTER TABLE public.clube_coupon_paid_invoices
 ADD CONSTRAINT clube_partner_coupon_postal_snapshot_v1_850 CHECK (
  CASE WHEN package_key='partner_general_3x5_849'
   THEN buyer_postal_code_v1_850 ~ '^[0-9]{8}$'
   ELSE buyer_postal_code_v1_850 IS NULL END
 );

CREATE FUNCTION public.clube_partner_coupon_invoice_postal_guard_v1_850()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $guard$
DECLARE v_supply jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF new.buyer_postal_code_v1_850 IS DISTINCT FROM old.buyer_postal_code_v1_850
   THEN RAISE EXCEPTION 'PARTNER_COUPON_PURCHASE_REGION_IMMUTABLE'
      USING ERRCODE='23514'; END IF;
   RETURN new;
 END IF;
 IF new.package_key<>'partner_general_3x5_849' THEN RETURN new; END IF;
 IF new.buyer_postal_code_v1_850 IS NULL
   OR new.buyer_postal_code_v1_850 !~ '^[0-9]{8}$'
 THEN RAISE EXCEPTION 'PARTNER_COUPON_PURCHASE_CEP_REQUIRED'
    USING ERRCODE='22023'; END IF;
 SELECT public.clube_partner_coupon_postal_supply_v1_850(new.buyer_postal_code_v1_850)
 INTO v_supply;
 IF v_supply->>'ready' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'PARTNER_COUPON_PURCHASE_REGION_UNAVAILABLE'
    USING ERRCODE='42501';END IF;
 RETURN new;
END;$guard$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_invoice_postal_guard_v1_850() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zzz_clube_partner_coupon_invoice_postal_guard_v1_850
 BEFORE INSERT ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_invoice_postal_guard_v1_850();
CREATE TRIGGER zzz_clube_partner_coupon_invoice_postal_immutable_v1_850
 BEFORE UPDATE OF buyer_postal_code_v1_850 ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_invoice_postal_guard_v1_850();
