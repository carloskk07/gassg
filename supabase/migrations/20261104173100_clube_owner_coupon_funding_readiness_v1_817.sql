-- TAMÃO V1.817: evidence-based readiness of the owner's coupon backing.
-- The founder personally guaranteed R$100 from coupon-sale proceeds;
-- that guarantee is NOT a deposit, reconciled bank receipt, available cash,
-- client wallet balance, revenue or a Pix payment.
-- Only the FUNDING source is approved by this migration. It does not assert
-- that legal terms / future merchant settlement are verified, nor enable sales.
DO $owner$
DECLARE p public.clube_coupon_paid_packages%rowtype;
        pool public.platform_clube_sponsor_pool_v1_807%rowtype;
BEGIN
 SELECT * INTO pool FROM public.platform_clube_sponsor_pool_v1_807
  WHERE benefit_key='clube_coupons' FOR UPDATE;
 IF NOT FOUND OR pool.authorized_cents<>10000
   OR pool.owner_guaranteed_cents<>10000 OR pool.reconciled_cents<>0
   OR pool.encumbered_cents<>0 OR pool.owner_guaranteed_at IS NULL
   OR pool.owner_guarantee_source IS NULL
 THEN RAISE EXCEPTION 'COUPON_OWNER_GUARANTEE_EVIDENCE_CHANGED'
    USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM public.clube_coupon_paid_packages
  WHERE package_key='all_products_3x5_sponsor' FOR UPDATE;
 IF NOT FOUND OR NOT p.sponsored_by_owner
   OR p.sale_price_cents<>890 OR p.coupon_face_cents<>500
   OR p.coupons_per_pack<>3 OR p.min_order_cents<>5000
   OR p.sale_enabled OR p.funding_verified OR p.legal_terms_verified
   OR p.redeem_settlement_verified
   OR EXISTS(SELECT 1 FROM public.clube_coupon_paid_invoices
       WHERE package_key='all_products_3x5_sponsor')
 THEN RAISE EXCEPTION 'COUPON_FUNDING_READINESS_SNAPSHOT_CHANGED'
    USING ERRCODE='23514'; END IF;
 UPDATE public.clube_coupon_paid_packages
 SET funding_verified=true,updated_at=clock_timestamp()
 WHERE package_key='all_products_3x5_sponsor';
END $owner$;
