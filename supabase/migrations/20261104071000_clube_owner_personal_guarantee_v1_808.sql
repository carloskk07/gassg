-- TAMÃO V1.808: OWNER'S PERSONAL GUARANTEE, not a fictitious bank deposit.
-- The owner explicitly assumes a one-time R$100 liability from the account
-- receiving the coupon-sale proceeds; a self-transfer would be meaningless.
-- See issue #493, owner's Nov 4, 2026 statement.
-- Guarantee is a contractual/operational commitment only, NOT a confirmed
-- transfer, PSP receipt, bank balance, or general platform credit.
-- No invoice, voucher, sale, or payout is created by this migration.
--
-- The existing 100% face-value concurrent-reservation rule remains in place;
-- the bank-reconciled and guaranteed amounts share EXACTLY the same R$100 cap.
ALTER TABLE public.platform_clube_sponsor_pool_v1_807
 ADD COLUMN owner_guaranteed_cents integer NOT NULL DEFAULT 0
   CHECK(owner_guaranteed_cents BETWEEN 0 AND 10000),
 ADD COLUMN owner_guarantee_source text,
 ADD COLUMN owner_guaranteed_at timestamptz;
ALTER TABLE public.platform_clube_sponsor_pool_v1_807
 DROP CONSTRAINT clube_sponsor_cash_conservation;
ALTER TABLE public.platform_clube_sponsor_pool_v1_807
 ADD CONSTRAINT clube_sponsor_owner_liability_conservation
 CHECK (
   reconciled_cents+owner_guaranteed_cents<=authorized_cents
   AND encumbered_cents<=reconciled_cents+owner_guaranteed_cents
 );
-- Owner's explicit instruction already exists, so record an owner-guarantee
-- (not `reconciled_cents`) without inventing payment evidence or an actor UUID.
UPDATE public.platform_clube_sponsor_pool_v1_807
 SET owner_guaranteed_cents=10000,
     owner_guarantee_source='owner_direct_instruction_2026-11-04_issue_493',
     owner_guaranteed_at=clock_timestamp(),
     version=version+1,
     updated_at=clock_timestamp()
 WHERE benefit_key='clube_coupons'
   AND authorized_cents=10000
   AND reconciled_cents=0 AND encumbered_cents=0
   AND owner_guaranteed_cents=0;
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_clube_sponsor_pool_v1_807
     WHERE benefit_key='clube_coupons'
       AND owner_guaranteed_cents=10000
       AND reconciled_cents=0
       AND encumbered_cents=0
       AND owner_guarantee_source='owner_direct_instruction_2026-11-04_issue_493')
 THEN RAISE EXCEPTION 'OWNER_GUARANTEE_INITIAL_STATE_CHANGED' USING ERRCODE='23514'; END IF;
END $guard$;

-- Preserve existing bank-revocation checks; a different source of coverage is
-- now accepted for one immutable 10000-cent envelope. Never combine them into 20000.
CREATE OR REPLACE FUNCTION public.clube_coupon_sponsor_invoice_before_v1_807()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 IF EXISTS(SELECT 1 FROM public.platform_clube_sponsor_receipts_v1_807 rr
   JOIN public.platform_owner_contributions_v1_246 c
     ON c.contribution_id=rr.contribution_id
   WHERE c.status<>'manual_reconciled' OR c.reviewed_at IS NULL
     OR c.bank_statement_reference IS DISTINCT FROM rr.bank_statement_reference)
 THEN RAISE EXCEPTION 'COUPON_SPONSOR_BANK_RECONCILIATION_REVOKED'
     USING ERRCODE='42501'; END IF;
 IF NOT FOUND OR face_total>10000 OR
    pool.reconciled_cents+pool.owner_guaranteed_cents<pool.encumbered_cents+face_total
 THEN RAISE EXCEPTION 'COUPON_SPONSOR_FUNDS_NOT_VERIFIED_OR_EXHAUSTED'
       USING ERRCODE='42501'; END IF;
 UPDATE public.platform_clube_sponsor_pool_v1_807 SET
  encumbered_cents=encumbered_cents+face_total,
  version=version+1,updated_at=clock_timestamp()
  WHERE benefit_key='clube_coupons';
 NEW.sponsor_covered_cents:=face_total::integer;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.clube_coupon_sponsor_covered_v1_807(p_invoice uuid, p_required bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS (
  SELECT 1 FROM public.clube_coupon_paid_invoices i
  JOIN public.clube_coupon_sponsor_reservations_v1_807 r
    ON r.invoice_id=i.id
  JOIN public.platform_clube_sponsor_pool_v1_807 p ON p.benefit_key='clube_coupons'
  WHERE i.id=p_invoice AND i.status='paid' AND r.status='captured'
    AND i.sponsor_covered_cents=r.face_covered_cents
    AND p.reconciled_cents+p.owner_guaranteed_cents>=p.encumbered_cents
    AND r.face_covered_cents>=p_required AND p_required>0
    AND NOT EXISTS(
      SELECT 1 FROM public.platform_clube_sponsor_receipts_v1_807 rr
      JOIN public.platform_owner_contributions_v1_246 c
        ON c.contribution_id=rr.contribution_id
      WHERE c.status<>'manual_reconciled' OR c.reviewed_at IS NULL
        OR c.bank_statement_reference IS DISTINCT FROM rr.bank_statement_reference
    )
 )
$function$;

CREATE OR REPLACE FUNCTION public.admin_clube_sponsor_reconcile_owner_v1_807(p_actor uuid, p_contribution uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 IF pool.reconciled_cents+pool.owner_guaranteed_cents+c.amount_cents>pool.authorized_cents
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
END $function$;

-- Privileged RPCs and trigger entrypoints are not client-accessible.
REVOKE ALL ON FUNCTION public.clube_coupon_sponsor_invoice_before_v1_807() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clube_coupon_sponsor_covered_v1_807(uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_clube_sponsor_reconcile_owner_v1_807(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_coupon_sponsor_covered_v1_807(uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_clube_sponsor_reconcile_owner_v1_807(uuid,uuid,uuid) TO service_role;
