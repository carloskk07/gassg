-- TAMÃO V1.819 — activation of owner-funded digital coupon sales without
-- requiring a merchant to exist. A real seller signs public disclosures.
-- No record represents a completed Pix, bank deposit or merchant payout.
-- Immutable supplier disclosure belongs to the PURCHASE, not just today's
-- merchant-facing seller configuration. Earlier invoices remain unchanged.
ALTER TABLE public.clube_coupon_paid_invoices
 ADD COLUMN seller_name text,
 ADD COLUMN seller_tax_document text,
 ADD COLUMN seller_address text,
 ADD COLUMN seller_support_email text;
CREATE FUNCTION public.clube_coupon_invoice_seller_immutable_v1_819()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $
BEGIN
 IF NEW.seller_name IS DISTINCT FROM OLD.seller_name OR
    NEW.seller_tax_document IS DISTINCT FROM OLD.seller_tax_document OR
    NEW.seller_address IS DISTINCT FROM OLD.seller_address OR
    NEW.seller_support_email IS DISTINCT FROM OLD.seller_support_email THEN
   RAISE EXCEPTION 'COUPON_SELLER_SNAPSHOT_IMMUTABLE'
     USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $;
CREATE TRIGGER clube_coupon_invoice_seller_immutable_v1_819
 BEFORE UPDATE ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_invoice_seller_immutable_v1_819();
REVOKE ALL ON FUNCTION public.clube_coupon_invoice_seller_immutable_v1_819()
 FROM PUBLIC,anon,authenticated;

CREATE TABLE public.clube_coupon_commercial_release_v1_819(
 package_key text PRIMARY KEY REFERENCES public.clube_coupon_paid_packages(package_key),
 enabled boolean NOT NULL DEFAULT false,
 seller_name text NOT NULL CHECK(length(btrim(seller_name)) BETWEEN 5 AND 150),
 seller_tax_document text NOT NULL CHECK(seller_tax_document ~ '^[0-9]{11}$|^[0-9]{14}$'),
 seller_address text NOT NULL CHECK(length(btrim(seller_address)) BETWEEN 20 AND 260),
 seller_support_email text NOT NULL CHECK(length(btrim(seller_support_email)) BETWEEN 6 AND 180),
 signed_terms_version text NOT NULL CHECK(signed_terms_version='clube_coupon_terms_v1_813'),
 owner_accepts_refund boolean NOT NULL CHECK(owner_accepts_refund),
 owner_accepts_merchant_reimbursement boolean NOT NULL CHECK(owner_accepts_merchant_reimbursement),
 owner_accepts_no_merchant_yet boolean NOT NULL CHECK(owner_accepts_no_merchant_yet),
 signed_by uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL UNIQUE,
 signed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.clube_coupon_commercial_events_v1_819(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 package_key text NOT NULL REFERENCES public.clube_coupon_paid_packages(package_key),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN ('activate','suspend')),
 request_id uuid NOT NULL UNIQUE,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.clube_coupon_commercial_release_v1_819 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clube_coupon_commercial_events_v1_819 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clube_coupon_commercial_release_v1_819 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.clube_coupon_commercial_events_v1_819 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.clube_coupon_commercial_release_v1_819 TO service_role;
GRANT SELECT ON public.clube_coupon_commercial_events_v1_819 TO service_role;

CREATE FUNCTION public.admin_clube_coupon_commercial_release_v1_819(
 p_actor uuid,p_seller_name text,p_seller_tax_document text,
 p_seller_address text,p_seller_support_email text,
 p_accept_refund boolean,p_accept_merchant_reimbursement boolean,
 p_accept_no_merchant_yet boolean,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pkg public.clube_coupon_paid_packages%rowtype;
 pool public.platform_clube_sponsor_pool_v1_807%rowtype;
 release public.clube_coupon_commercial_release_v1_819%rowtype;
 v_key text:='all_products_3x5_sponsor';
BEGIN
 IF p_actor IS NULL OR p_request_id IS NULL OR
    p_seller_name IS NULL OR length(btrim(p_seller_name)) NOT BETWEEN 5 AND 150 OR
    p_seller_tax_document IS NULL OR p_seller_tax_document !~ '^[0-9]{11}$|^[0-9]{14}$' OR
    p_seller_address IS NULL OR length(btrim(p_seller_address)) NOT BETWEEN 20 AND 260 OR
    p_seller_support_email IS NULL OR length(btrim(p_seller_support_email)) NOT BETWEEN 6 AND 180 OR
    p_seller_support_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR
    p_accept_refund IS DISTINCT FROM TRUE OR
    p_accept_merchant_reimbursement IS DISTINCT FROM TRUE OR
    p_accept_no_merchant_yet IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'COUPON_SELLER_DISCLOSURE_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.platform_admins
     WHERE user_id=p_actor AND active=TRUE AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'COUPON_ACTOR_NOT_SUPERADMIN' USING ERRCODE='42501'; END IF;
 -- Lock order: sponsor pool, then package, then release. Same sponsor-pool
 -- lock serializes buyer invoice holds and activation.
 SELECT * INTO pool FROM public.platform_clube_sponsor_pool_v1_807
  WHERE benefit_key='clube_coupons' FOR UPDATE;
 SELECT * INTO pkg FROM public.clube_coupon_paid_packages
  WHERE package_key=v_key FOR UPDATE;
 IF NOT FOUND OR pkg.sale_price_cents<>890 OR pkg.coupon_face_cents<>500
    OR pkg.coupons_per_pack<>3 OR pkg.min_order_cents<>5000 OR pkg.valid_days<>180
    OR NOT pkg.sponsored_by_owner OR NOT pkg.funding_verified
    OR pkg.sale_enabled THEN
   RAISE EXCEPTION 'COUPON_PACKAGE_RELEASE_NOT_READY' USING ERRCODE='42501'; END IF;
 IF pool.benefit_key IS NULL OR pool.authorized_cents<10000 OR pool.owner_guaranteed_cents<10000
    OR pool.encumbered_cents>8500
    OR pool.owner_guaranteed_at IS NULL
 THEN RAISE EXCEPTION 'COUPON_OWNER_BUDGET_NOT_READY' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_launch_control
     WHERE singleton AND operation_mode IN ('PRELAUNCH','PILOT','LIVE'))
 THEN RAISE EXCEPTION 'COUPON_PLATFORM_PAUSED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.clube_coupon_commercial_release_v1_819 WHERE package_key=v_key AND enabled)
 THEN RAISE EXCEPTION 'COUPON_ALREADY_RELEASED' USING ERRCODE='23505'; END IF;
 INSERT INTO public.clube_coupon_commercial_release_v1_819
 (package_key,enabled,seller_name,seller_tax_document,seller_address,seller_support_email,
  signed_terms_version,owner_accepts_refund,owner_accepts_merchant_reimbursement,
  owner_accepts_no_merchant_yet,signed_by,request_id)
 VALUES(v_key,TRUE,btrim(p_seller_name),p_seller_tax_document,
  btrim(p_seller_address),lower(btrim(p_seller_support_email)),
  'clube_coupon_terms_v1_813',TRUE,TRUE,TRUE,p_actor,p_request_id)
 ON CONFLICT(package_key) DO UPDATE SET
 enabled=TRUE,seller_name=EXCLUDED.seller_name,
 seller_tax_document=EXCLUDED.seller_tax_document,
 seller_address=EXCLUDED.seller_address,
 seller_support_email=EXCLUDED.seller_support_email,
 signed_terms_version=EXCLUDED.signed_terms_version,
 signed_by=EXCLUDED.signed_by,request_id=EXCLUDED.request_id,
 signed_at=clock_timestamp(),updated_at=clock_timestamp();
 UPDATE public.clube_coupon_paid_packages SET
   legal_terms_verified=TRUE,
   redeem_settlement_verified=TRUE,
   sale_enabled=TRUE,
   updated_at=clock_timestamp()
 WHERE package_key=v_key AND funding_verified
   AND sponsored_by_owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_PACKAGE_RELEASE_UPDATE_FAILED' USING ERRCODE='42501'; END IF;
 INSERT INTO public.clube_coupon_commercial_events_v1_819
   (package_key,actor_user_id,action,request_id)
 VALUES (v_key,p_actor,'activate',p_request_id);
 RETURN pg_catalog.jsonb_build_object('ok',TRUE,'packageKey',v_key,
   'salesEnabled',TRUE,'sellerDisclosureRecorded',TRUE,'merchantNeededToSell',FALSE,
   'moneyMoved',FALSE,'refundPaid',FALSE,'merchantPayoutMade',FALSE);
END $$;

CREATE FUNCTION public.admin_clube_coupon_commercial_suspend_v1_819(
 p_actor uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_key text:='all_products_3x5_sponsor';
BEGIN
 IF p_actor IS NULL OR p_request_id IS NULL OR
    NOT EXISTS(SELECT 1 FROM public.platform_admins
      WHERE user_id=p_actor AND active=TRUE AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'COUPON_SUSPEND_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.clube_coupon_paid_packages WHERE package_key=v_key FOR UPDATE;
 UPDATE public.clube_coupon_commercial_release_v1_819
  SET enabled=FALSE,updated_at=clock_timestamp() WHERE package_key=v_key;
 UPDATE public.clube_coupon_paid_packages SET sale_enabled=FALSE,
  updated_at=clock_timestamp() WHERE package_key=v_key;
 INSERT INTO public.clube_coupon_commercial_events_v1_819
   (package_key,actor_user_id,action,request_id)
 VALUES(v_key,p_actor,'suspend',p_request_id);
 RETURN pg_catalog.jsonb_build_object('ok',TRUE,'salesEnabled',FALSE,
  'moneyMoved',FALSE,'merchantPayoutMade',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.admin_clube_coupon_commercial_release_v1_819(uuid,text,text,text,text,boolean,boolean,boolean,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_clube_coupon_commercial_suspend_v1_819(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clube_coupon_commercial_release_v1_819(uuid,text,text,text,text,boolean,boolean,boolean,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_clube_coupon_commercial_suspend_v1_819(uuid,uuid) TO service_role;
