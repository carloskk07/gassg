-- TAMÃO V1.807 — single-use founder sponsorship for paid coupons.
-- This migration prepares R$100 of AUTHORIZED budget, never fabricates cash.
-- Only a separately reconciled real bank contribution becomes backing.
-- The sponsor conservatively reserves 100% of a package's voucher face,
-- not merely the nominal price discount; fees and refunds cannot overspend it.

CREATE TABLE public.platform_clube_sponsor_pool_v1_807(
  benefit_key text PRIMARY KEY CHECK (benefit_key='clube_coupons'),
  authorized_cents integer NOT NULL CHECK (authorized_cents=10000),
  reconciled_cents integer NOT NULL DEFAULT 0 CHECK (reconciled_cents BETWEEN 0 AND 10000),
  encumbered_cents integer NOT NULL DEFAULT 0 CHECK (encumbered_cents>=0),
  version integer NOT NULL DEFAULT 0 CHECK(version>=0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT clube_sponsor_cash_conservation CHECK (encumbered_cents<=reconciled_cents)
);
INSERT INTO public.platform_clube_sponsor_pool_v1_807
  (benefit_key,authorized_cents,reconciled_cents,encumbered_cents)
VALUES ('clube_coupons',10000,0,0);

CREATE TABLE public.platform_clube_sponsor_receipts_v1_807(
  contribution_id uuid PRIMARY KEY REFERENCES public.platform_owner_contributions_v1_246(contribution_id),
  request_id uuid NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK(amount_cents>0 AND amount_cents<=10000),
  bank_statement_reference text NOT NULL CHECK(length(bank_statement_reference) BETWEEN 12 AND 100),
  confirmed_by uuid NOT NULL REFERENCES auth.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.clube_coupon_sponsor_reservations_v1_807(
  invoice_id uuid PRIMARY KEY REFERENCES public.clube_coupon_paid_invoices(id),
  face_covered_cents integer NOT NULL CHECK(face_covered_cents>0 AND face_covered_cents<=10000),
  status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','captured','released')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.platform_clube_sponsor_pool_v1_807 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_clube_sponsor_receipts_v1_807 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clube_coupon_sponsor_reservations_v1_807 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_clube_sponsor_pool_v1_807 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.platform_clube_sponsor_receipts_v1_807 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.clube_coupon_sponsor_reservations_v1_807 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.platform_clube_sponsor_pool_v1_807 TO service_role;
GRANT SELECT ON public.platform_clube_sponsor_receipts_v1_807 TO service_role;
GRANT SELECT ON public.clube_coupon_sponsor_reservations_v1_807 TO service_role;

ALTER TABLE public.clube_coupon_paid_packages
 ADD COLUMN sponsored_by_owner boolean NOT NULL DEFAULT false;
ALTER TABLE public.clube_coupon_paid_invoices
 ADD COLUMN sponsor_covered_cents integer NOT NULL DEFAULT 0 CHECK(sponsor_covered_cents BETWEEN 0 AND 10000);
ALTER TABLE public.clube_coupon_paid_packages
 DROP CONSTRAINT coupon_sale_requires_verification;
ALTER TABLE public.clube_coupon_paid_packages
 ADD CONSTRAINT coupon_sale_requires_verification CHECK (
   NOT sale_enabled OR (
     funding_verified AND legal_terms_verified AND redeem_settlement_verified
     AND (sponsored_by_owner
          OR sale_price_cents::bigint>=coupon_face_cents::bigint*coupons_per_pack::bigint))
 );

-- Every invoice INSERT is an all-or-nothing sponsor hold. A paid Pix is never
-- initiated before this transaction succeeded. The pool row lock serializes
-- concurrent buyers across different users / packages.
CREATE FUNCTION public.clube_coupon_sponsor_invoice_before_v1_807()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.clube_coupon_paid_packages%rowtype;
        pool public.platform_clube_sponsor_pool_v1_807%rowtype;
        face_total bigint;
BEGIN
 SELECT * INTO p FROM public.clube_coupon_paid_packages WHERE package_key=NEW.package_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_PACKAGE_NOT_FOUND' USING ERRCODE='23503'; END IF;
 IF NEW.sponsor_covered_cents<>0 THEN
   RAISE EXCEPTION 'COUPON_SPONSOR_CLIENT_CANNOT_SET_CREDIT' USING ERRCODE='42501';
 END IF;
 IF NOT p.sponsored_by_owner THEN RETURN NEW; END IF;
 IF NOT (p.sale_enabled AND p.funding_verified AND
         p.legal_terms_verified AND p.redeem_settlement_verified)
    OR NEW.sale_price_cents<>p.sale_price_cents
    OR NEW.coupon_face_cents<>p.coupon_face_cents
    OR NEW.coupons_per_pack<>p.coupons_per_pack
    OR NEW.valid_days<>p.valid_days
    OR NEW.status<>'prepared'
 THEN RAISE EXCEPTION 'COUPON_SPONSOR_PACKAGE_NOT_READY' USING ERRCODE='42501'; END IF;
 face_total:=p.coupon_face_cents::bigint*p.coupons_per_pack::bigint;
 SELECT * INTO pool FROM public.platform_clube_sponsor_pool_v1_807
  WHERE benefit_key='clube_coupons' FOR UPDATE;
 IF NOT FOUND OR face_total>10000 OR
    pool.reconciled_cents<pool.encumbered_cents+face_total
 THEN RAISE EXCEPTION 'COUPON_SPONSOR_FUNDS_NOT_VERIFIED_OR_EXHAUSTED'
       USING ERRCODE='42501'; END IF;
 UPDATE public.platform_clube_sponsor_pool_v1_807 SET
  encumbered_cents=encumbered_cents+face_total,
  version=version+1,updated_at=clock_timestamp()
  WHERE benefit_key='clube_coupons';
 NEW.sponsor_covered_cents:=face_total::integer;
 RETURN NEW;
END $$;
CREATE TRIGGER clube_coupon_sponsor_invoice_before_v1_807
 BEFORE INSERT ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_sponsor_invoice_before_v1_807();

CREATE FUNCTION public.clube_coupon_sponsor_invoice_after_v1_807()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.sponsor_covered_cents>0 THEN
  INSERT INTO public.clube_coupon_sponsor_reservations_v1_807
   (invoice_id,face_covered_cents,status)
  VALUES(NEW.id,NEW.sponsor_covered_cents,'held');
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER clube_coupon_sponsor_invoice_after_v1_807
 AFTER INSERT ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_sponsor_invoice_after_v1_807();

CREATE FUNCTION public.clube_coupon_sponsor_invoice_update_v1_807()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.clube_coupon_sponsor_reservations_v1_807%rowtype;
BEGIN
 IF OLD.sponsor_covered_cents IS DISTINCT FROM NEW.sponsor_covered_cents
    OR (OLD.sponsor_covered_cents>0 AND (
      OLD.customer_user_id IS DISTINCT FROM NEW.customer_user_id
      OR OLD.package_key IS DISTINCT FROM NEW.package_key
      OR OLD.sale_price_cents IS DISTINCT FROM NEW.sale_price_cents
      OR OLD.coupon_face_cents IS DISTINCT FROM NEW.coupon_face_cents
      OR OLD.coupons_per_pack IS DISTINCT FROM NEW.coupons_per_pack
      OR OLD.request_id IS DISTINCT FROM NEW.request_id
    ))
 THEN RAISE EXCEPTION 'COUPON_SPONSOR_IMMUTABLE_INVOICE' USING ERRCODE='23514'; END IF;
 IF OLD.sponsor_covered_cents=0 OR OLD.status=NEW.status THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.clube_coupon_sponsor_reservations_v1_807
  WHERE invoice_id=OLD.id FOR UPDATE;
 IF NOT FOUND OR r.face_covered_cents<>OLD.sponsor_covered_cents
 THEN RAISE EXCEPTION 'COUPON_SPONSOR_RESERVATION_MISSING' USING ERRCODE='23514'; END IF;
 IF NEW.status='paid' AND r.status='held' AND
    OLD.status IN ('prepared','awaiting_payment') THEN
   UPDATE public.clube_coupon_sponsor_reservations_v1_807
      SET status='captured',updated_at=clock_timestamp() WHERE invoice_id=OLD.id;
 ELSIF (NEW.status IN ('expired','cancelled') AND
          OLD.status IN ('prepared','awaiting_payment') AND r.status='held')
   OR (NEW.status='refunded' AND r.status='captured' AND
       NOT EXISTS (SELECT 1 FROM public.clube_coupon_paid_issuances c
                   WHERE c.invoice_id=OLD.id AND
                         c.status IN ('reserved','redeemed','review_required')))
 THEN
   UPDATE public.platform_clube_sponsor_pool_v1_807
     SET encumbered_cents=encumbered_cents-r.face_covered_cents,
         version=version+1,updated_at=clock_timestamp()
     WHERE benefit_key='clube_coupons' AND encumbered_cents>=r.face_covered_cents;
   IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_SPONSOR_POOL_DRIFT' USING ERRCODE='23514'; END IF;
   UPDATE public.clube_coupon_sponsor_reservations_v1_807
     SET status='released',updated_at=clock_timestamp() WHERE invoice_id=OLD.id;
 ELSIF NEW.status='paid' AND r.status='released' THEN
   RAISE EXCEPTION 'COUPON_SPONSOR_RELEASED_CANNOT_BE_PAID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clube_coupon_sponsor_invoice_update_v1_807
 BEFORE UPDATE ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_sponsor_invoice_update_v1_807();

-- Trigger helpers have no legitimate browser/API callers. PostgreSQL grants
-- EXECUTE to PUBLIC by default; deny the executable RPC surface explicitly.
REVOKE ALL ON FUNCTION public.clube_coupon_sponsor_invoice_before_v1_807()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clube_coupon_sponsor_invoice_after_v1_807()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clube_coupon_sponsor_invoice_update_v1_807()
 FROM PUBLIC,anon,authenticated;

-- Sponsor coverage is strictly invoice-linked, already reconciled and captured.
-- No arbitrary client-supplied amount is part of the decision.
CREATE FUNCTION public.clube_coupon_sponsor_covered_v1_807(p_invoice uuid,p_required bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.clube_coupon_paid_invoices i
  JOIN public.clube_coupon_sponsor_reservations_v1_807 r
    ON r.invoice_id=i.id
  JOIN public.platform_clube_sponsor_pool_v1_807 p ON p.benefit_key='clube_coupons'
  WHERE i.id=p_invoice AND i.status='paid' AND r.status='captured'
    AND i.sponsor_covered_cents=r.face_covered_cents
    AND p.reconciled_cents>=p.encumbered_cents
    AND r.face_covered_cents>=p_required AND p_required>0
 )
$$;
REVOKE ALL ON FUNCTION public.clube_coupon_sponsor_covered_v1_807(uuid,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_coupon_sponsor_covered_v1_807(uuid,bigint)
  TO service_role;

-- Superadmin-only bridge from an existing, manually bank-reconciled
-- owner contribution. Deduplication by original contribution AND request.
-- Never credit the budget using an unverified promise or recurring plan.
CREATE FUNCTION public.admin_clube_sponsor_reconcile_owner_v1_807(
 p_actor uuid,p_contribution uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.platform_owner_contributions_v1_246%rowtype;
        pool public.platform_clube_sponsor_pool_v1_807%rowtype;
        previous public.platform_clube_sponsor_receipts_v1_807%rowtype;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.platform_admins a WHERE a.user_id=p_actor
      AND a.active AND a.admin_role='superadmin'
 ) THEN RAISE EXCEPTION 'COUPON_SPONSOR_SUPERADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_contribution IS NULL OR p_request IS NULL
 THEN RAISE EXCEPTION 'COUPON_SPONSOR_REQUEST_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.platform_owner_contributions_v1_246
  WHERE contribution_id=p_contribution;
 IF NOT FOUND OR c.benefit_key<>'clube_coupons'
     OR c.status<>'manual_reconciled'
     OR c.reviewer_id IS NULL OR c.reviewed_at IS NULL
     OR c.bank_statement_reference IS NULL
     OR length(btrim(c.bank_statement_reference)) NOT BETWEEN 12 AND 100
     OR c.amount_cents IS NULL OR c.amount_cents<=0
     OR c.amount_cents>10000
 THEN RAISE EXCEPTION 'COUPON_SPONSOR_REAL_BANK_EVIDENCE_REQUIRED'
   USING ERRCODE='42501'; END IF;
 SELECT * INTO pool FROM public.platform_clube_sponsor_pool_v1_807
  WHERE benefit_key='clube_coupons' FOR UPDATE;
 SELECT * INTO previous FROM public.platform_clube_sponsor_receipts_v1_807
  WHERE contribution_id=p_contribution OR request_id=p_request;
 IF FOUND THEN
  IF previous.contribution_id<>p_contribution OR previous.request_id<>p_request
     OR previous.amount_cents<>c.amount_cents OR
     previous.bank_statement_reference<>c.bank_statement_reference
  THEN RAISE EXCEPTION 'COUPON_SPONSOR_REPLAY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,
      'creditedCents',previous.amount_cents,'poolVersion',pool.version);
 END IF;
 IF pool.reconciled_cents+c.amount_cents>pool.authorized_cents
 THEN RAISE EXCEPTION 'COUPON_SPONSOR_BUDGET_CEILING' USING ERRCODE='23514'; END IF;
 INSERT INTO public.platform_clube_sponsor_receipts_v1_807
 (contribution_id,request_id,amount_cents,bank_statement_reference,confirmed_by)
 VALUES(p_contribution,p_request,c.amount_cents,c.bank_statement_reference,p_actor);
 UPDATE public.platform_clube_sponsor_pool_v1_807
  SET reconciled_cents=reconciled_cents+c.amount_cents,
    version=version+1,updated_at=clock_timestamp()
  WHERE benefit_key='clube_coupons';
 INSERT INTO public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 VALUES(p_actor,'clube_coupon_owner_sponsor_reconciled',
  'platform_owner_contribution',p_contribution::text,
  jsonb_build_object('amountCents',c.amount_cents,
   'statementReference',c.bank_statement_reference,'requestId',p_request));
 RETURN jsonb_build_object('ok',true,'replayed',false,
   'creditedCents',c.amount_cents,'poolVersion',pool.version+1);
END $$;
REVOKE ALL ON FUNCTION public.admin_clube_sponsor_reconcile_owner_v1_807(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clube_sponsor_reconcile_owner_v1_807(uuid,uuid,uuid)
  TO service_role;

-- The two offer models were previously internal drafts only. These are
-- separate *non-selling* paid-package definitions until legal, merchant,
-- funding, Pix reconciliation, and portal testing all pass.
INSERT INTO public.clube_coupon_paid_packages
 (package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,
 valid_days,sponsored_by_owner,funding_verified,legal_terms_verified,
 redeem_settlement_verified,sale_enabled)
VALUES
 ('gas_3x5_sponsor','Gás: 3 cupons de R$ 5',890,500,3,180,true,false,false,false,false),
 ('water_5x2_sponsor','Água: 5 cupons de R$ 2',490,200,5,90,true,false,false,false,false);
