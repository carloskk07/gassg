-- #850: transaction-only synthetic postal candidate, no real merchant or PSP.
BEGIN;
DO $fixture$
DECLARE
 v_bad boolean:=false;
 v_mutation boolean:=false;
 v_expected integer:=0;
 v_supp jsonb;
 v_old uuid;
BEGIN
 IF has_function_privilege('authenticated',
    'public.clube_partner_coupon_postal_supply_v1_850(text)','EXECUTE')
 OR NOT has_function_privilege('service_role',
    'public.clube_partner_coupon_postal_supply_v1_850(text)','EXECUTE')
 THEN RAISE EXCEPTION 'SUPPLY_CHECK_EXPOSED_TO_BROWSER'; END IF;
 BEGIN
  PERFORM public.clube_partner_coupon_postal_supply_v1_850('12a123');
 EXCEPTION WHEN SQLSTATE '22023' THEN v_bad:=true; END;
 IF NOT v_bad THEN RAISE EXCEPTION 'INVALID_CEP_ACCEPTED'; END IF;
 v_supp:=public.clube_partner_coupon_postal_supply_v1_850('00000000');
 IF v_supp->>'ready'<>'false' OR v_supp->>'verified'<>'false'
   OR (v_supp->>'merchantCount')::integer<>0
 THEN RAISE EXCEPTION 'NONEXISTENT_POSTAL_SUPPLY_FAKE'; END IF;

 INSERT INTO public.postal_code_validation_cache(
   postal_code,city,state,provider,service_area_allowed,street,verified_at)
 VALUES('97400998','São Gabriel','RS','viacep',true,'Rua do Teste Isolado',clock_timestamp())
 ON CONFLICT (postal_code) DO UPDATE SET
   city=excluded.city,state=excluded.state,provider=excluded.provider,
   service_area_allowed=true,street=excluded.street,
   verified_at=clock_timestamp();
 v_supp:=public.clube_partner_coupon_postal_supply_v1_850('97400998');
 SELECT count(DISTINCT c.merchant_id) INTO v_expected
 FROM public.merchant_coupon_consents_v1_845 c
 JOIN public.merchants m ON m.id=c.merchant_id
 JOIN public.merchant_billing_accounts a ON a.merchant_id=m.id
 JOIN public.merchant_coupon_terms_v1_845 t ON t.terms_version=c.terms_version
 WHERE c.opted_in AND c.terms_version=1 AND t.enabled
  AND m.status='active' AND m.online AND m.accepts_citywide
  AND NOT a.sales_hold
  AND c.merchant_id=ANY(public.market_city_offer_scope('São Gabriel','RS'));
 IF v_supp->>'verified'<>'true'
    OR (v_supp->>'merchantCount')::integer<>v_expected
    OR (v_supp->>'ready'='true') IS DISTINCT FROM (v_expected>0)
 THEN RAISE EXCEPTION 'BUYER_REGION_SUPPLY_MUST_MATCH_REAL_OFFER_SCOPE';END IF;
 UPDATE public.postal_code_validation_cache
  SET service_area_allowed=false WHERE postal_code='97400998';
 v_supp:=public.clube_partner_coupon_postal_supply_v1_850('97400998');
 IF v_supp->>'ready'<>'false' OR v_supp->>'verified'<>'false'
 THEN RAISE EXCEPTION 'POSTAL_REGION_WITHDRAWAL_IGNORED';END IF;
 UPDATE public.postal_code_validation_cache
  SET service_area_allowed=true,verified_at=clock_timestamp()-interval '31 days'
  WHERE postal_code='97400998';
 v_supp:=public.clube_partner_coupon_postal_supply_v1_850('97400998');
 IF v_supp->>'ready'<>'false' OR v_supp->>'verified'<>'false'
 THEN RAISE EXCEPTION 'STALE_BUYER_CEP_WAS_ACCEPTED';END IF;

 SELECT id INTO v_old FROM public.clube_coupon_paid_invoices
  WHERE package_key<>'partner_general_3x5_849' LIMIT 1;
 IF v_old IS NOT NULL THEN
  BEGIN
   UPDATE public.clube_coupon_paid_invoices
    SET buyer_postal_code_v1_850='97400998' WHERE id=v_old;
  EXCEPTION WHEN SQLSTATE '23514' THEN v_mutation:=true; END;
  IF NOT v_mutation
   THEN RAISE EXCEPTION 'LEGACY_INVOICE_CEP_MUTATION_ALLOWED';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.clube_coupon_paid_invoices
   WHERE package_key='partner_general_3x5_849')
 THEN RAISE EXCEPTION 'PREPARATION_EMITTED_REAL_PROGRAM_INVOICE';END IF;
END;$fixture$;
ROLLBACK;
