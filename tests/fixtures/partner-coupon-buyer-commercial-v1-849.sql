-- #849 fully disposable contract validation: starts and ends with ROLLBACK.
BEGIN;
DO $test$
DECLARE
 v_admin uuid;
 v_actor uuid;
 v_req uuid:=gen_random_uuid();
 v_result jsonb;
 v_count integer;
 v_tampered boolean:=false;
 v_mutation boolean:=false;
 v_invalid boolean:=false;
 v_old integer;
BEGIN
 SELECT user_id INTO v_admin FROM public.platform_admins
 WHERE active AND admin_role='superadmin' LIMIT 1;
 IF v_admin IS NULL THEN RAISE EXCEPTION 'CI_ADMIN_NOT_SEEDED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clube_coupon_paid_packages
   WHERE package_key='partner_general_3x5_849'
    AND sale_price_cents=890 AND coupon_face_cents=500 AND coupons_per_pack=3
    AND min_order_cents=1000 AND valid_days=180
    AND sponsored_by_owner=false
    AND NOT sale_enabled AND NOT legal_terms_verified
    AND NOT funding_verified AND NOT redeem_settlement_verified)
 THEN RAISE EXCEPTION 'PARTNER_COUPON_DRAFT_NOT_SAFE';END IF;
 IF (SELECT enabled FROM public.clube_partner_coupon_launch_v1_846 WHERE singleton)
 THEN RAISE EXCEPTION 'PARTNER_COUPON_GLOBAL_SALE_UNEXPECTED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clube_partner_coupon_buyer_terms_v1_849
   WHERE terms_version='clube_partner_coupon_terms_v1_846'
   AND length(contract_text)>600)
 THEN RAISE EXCEPTION 'PARTNER_COUPON_TERMS_NOT_VISIBLE';END IF;
 IF has_table_privilege('authenticated',
    'public.clube_partner_coupon_sale_agreements_v1_849','SELECT')
    OR has_table_privilege('authenticated',
    'public.clube_partner_coupon_buyer_terms_v1_849','SELECT')
    OR has_function_privilege('authenticated',
    'public.admin_clube_partner_coupon_prepare_v1_849(uuid,uuid,text,text,text,text,boolean,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'PARTNER_COUPON_EXPOSED_PRIVILEGED_DATA';END IF;
 v_result:=public.clube_partner_coupon_sale_readiness_v1_849('partner_general_3x5_849');
 IF v_result->>'ready' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'PARTNER_COUPON_OFFER_MUST_NOT_BE_ACTIVE'; END IF;
 v_result:=public.admin_clube_partner_coupon_prepare_v1_849(
   v_admin,v_req,'Seller verified only in disposable CI','12345678901',
   'Rua fictícia 123, São Gabriel, RS, Brasil',
   'seller-synthetic@example.invalid',true,true);
 IF v_result->>'ok'<>'true' OR v_result->>'sellerDisclosed'<>'true'
    OR v_result->>'salesAuthorized'<>'false'
    OR v_result->>'pixCreated'<>'false'
 THEN RAISE EXCEPTION 'PARTNER_COUPON_PREPARED_FALSE_SUCCESS';END IF;
 SELECT count(*) INTO v_count FROM public.clube_partner_coupon_sale_agreements_v1_849
 WHERE request_id=v_req AND sales_authorized=false;
 IF v_count<>1 THEN RAISE EXCEPTION 'PARTNER_COUPON_SIGNATURE_NOT_DURABLE';END IF;
 v_result:=public.admin_clube_partner_coupon_prepare_v1_849(
   v_admin,v_req,'Seller verified only in disposable CI','12345678901',
   'Rua fictícia 123, São Gabriel, RS, Brasil',
   'seller-synthetic@example.invalid',true,true);
 IF v_result->>'ok'<>'true'
 THEN RAISE EXCEPTION 'PARTNER_COUPON_REPLAY_NOT_RECONCILED';END IF;
 SELECT count(*) INTO v_count FROM public.clube_partner_coupon_sale_agreements_v1_849
 WHERE request_id=v_req;
 IF v_count<>1 THEN RAISE EXCEPTION 'PARTNER_COUPON_REPLAY_INSERTED_ANOTHER_RECORD';END IF;
 BEGIN
  PERFORM public.admin_clube_partner_coupon_prepare_v1_849(
    v_admin,v_req,'Altered after prior signature','12345678901',
    'Rua fictícia 123, São Gabriel, RS, Brasil',
    'seller-synthetic@example.invalid',true,true);
 EXCEPTION WHEN SQLSTATE '23505' THEN v_tampered:=true;
 END;
 IF NOT v_tampered THEN RAISE EXCEPTION 'PARTNER_COUPON_SIGNATURE_REPLAY_TAMPER_ALLOWED';END IF;
 BEGIN
  UPDATE public.clube_partner_coupon_sale_agreements_v1_849
    SET sales_authorized=true WHERE request_id=v_req;
 EXCEPTION WHEN SQLSTATE '23514' THEN v_mutation:=true;
 END;
 IF NOT v_mutation THEN RAISE EXCEPTION 'PARTNER_COUPON_SIGNED_APPROVAL_MUTATED';END IF;
 BEGIN
  PERFORM public.admin_clube_partner_coupon_prepare_v1_849(
    v_admin,gen_random_uuid(),'Seller verified only in disposable CI','12345678901',
    'Rua fictícia 123, São Gabriel, RS, Brasil',
    'seller-synthetic@example.invalid',true,false);
 EXCEPTION WHEN SQLSTATE '22023' THEN v_invalid:=true;
 END;
 IF NOT v_invalid THEN RAISE EXCEPTION 'PARTNER_COUPON_MISSING_NONREIMBURSEMENT_ACCEPTED';END IF;
 IF (public.clube_partner_coupon_sale_readiness_v1_849('partner_general_3x5_849')->>'ready')<>'false'
 THEN RAISE EXCEPTION 'PARTNER_COUPON_SELLER_SIGNATURE_WAS_TREATED_AS_LIVE_APPROVAL';END IF;
 -- Contract signing never charges a buyer, changes previous receipts,
 -- enables commerce, alters reimbursable coupons or creates synthetic money.
 IF EXISTS(SELECT 1 FROM public.clube_coupon_paid_invoices
   WHERE package_key='partner_general_3x5_849')
 THEN RAISE EXCEPTION 'PARTNER_COUPON_PREPARE_CREATED_INVOICE';END IF;
 IF (SELECT enabled FROM public.clube_partner_coupon_launch_v1_846 WHERE singleton)
 THEN RAISE EXCEPTION 'PARTNER_COUPON_SELLER_SIGNATURE_CHANGED_LAUNCH';END IF;
END;
$test$;
ROLLBACK;
