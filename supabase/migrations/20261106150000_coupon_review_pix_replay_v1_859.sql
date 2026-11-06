-- TAMÃO #859: idempotent replay of a genuinely verified off-site Pix.
-- #853 already quarantines the original payment with no spendable vouchers.
-- This replaces ONLY the RPC. No new privileges, package release or data edits.
-- A reviewed invoice without original #853 evidence still fails closed.
CREATE OR REPLACE FUNCTION public.clube_coupon_paid_payment_verify(
 p_invoice_id uuid,p_provider_order_id text,p_payment_id text,p_amount_cents integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $verified_coupon$
DECLARE
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_reason text:=null;
 v_readiness jsonb;
 v_supply jsonb;
BEGIN
 SELECT * INTO v_invoice FROM public.clube_coupon_paid_invoices
 WHERE id=p_invoice_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_INVOICE_NOT_FOUND'; END IF;
 IF v_invoice.provider_order_id IS DISTINCT FROM p_provider_order_id
    OR v_invoice.sale_price_cents IS DISTINCT FROM p_amount_cents
    OR p_payment_id IS NULL OR length(p_payment_id)<3
    OR (v_invoice.provider_payment_id IS NOT NULL
        AND v_invoice.provider_payment_id<>p_payment_id)
 THEN RAISE EXCEPTION 'COUPON_PAYMENT_PROOF_MISMATCH'; END IF;
 IF v_invoice.status='paid' THEN
   RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,
      'invoiceId',v_invoice.id);
 END IF;
 -- A concurrently delivered Mercado Pago webhook may have read the invoice
 -- before another delivery recorded the real Pix in manual review.
 -- Replays of this SAME immutable provider proof must be acknowledged without
 -- issuing any coupon, changing paid_at or lifting the financial hold.
 IF v_invoice.status='review_required' THEN
   IF v_invoice.coupon_settlement_hold_reason_v1_853 IN (
        'PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT',
        'COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT')
      AND v_invoice.provider_payment_id=p_payment_id
      AND v_invoice.paid_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.clube_coupon_paid_issuances i
        WHERE i.invoice_id=v_invoice.id
          AND i.status IN ('issued','reserved'))
   THEN
     RETURN pg_catalog.jsonb_build_object(
       'ok',false,'replayed',true,'reviewRequired',true,
       'providerPaymentRecorded',true,
       'reason',v_invoice.coupon_settlement_hold_reason_v1_853,
       'issued',0,'invoiceId',v_invoice.id);
   END IF;
   RAISE EXCEPTION 'COUPON_PAYMENT_REVIEW_STATE_UNVERIFIED';
 END IF;
 IF v_invoice.status NOT IN ('awaiting_payment','prepared') THEN
   RAISE EXCEPTION 'COUPON_PAYMENT_STATE_INVALID'; END IF;

 -- A cancellation was accepted BEFORE this off-site Pix was processed:
 -- never create a spendable voucher which the buyer asked to cancel.
 IF EXISTS(SELECT 1 FROM public.clube_coupon_refund_requests_v1_814 r
   WHERE r.invoice_id=v_invoice.id AND r.customer_user_id=v_invoice.customer_user_id
     AND r.status<>'closed')
 THEN v_reason:='COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT'; END IF;

 -- New #849 buyer contract ONLY. Older, independently funded packages are
 -- untouched; do not reinterpret historical owner reimbursement contracts.
 IF v_reason IS NULL AND v_invoice.package_key='partner_general_3x5_849'
   AND v_invoice.funding_mode_v1_846='partner_funded' THEN
   v_readiness:=public.clube_partner_coupon_sale_readiness_v1_849(v_invoice.package_key);
   v_supply:=public.clube_partner_coupon_postal_supply_v1_850(
     v_invoice.buyer_postal_code_v1_850);
   IF v_readiness->>'ready' IS DISTINCT FROM 'true'
      OR v_supply->>'ready' IS DISTINCT FROM 'true'
      OR v_supply->>'verified' IS DISTINCT FROM 'true'
      OR v_supply->>'postalCode' IS DISTINCT FROM v_invoice.buyer_postal_code_v1_850
      OR NOT EXISTS(SELECT 1 FROM public.platform_launch_control
         WHERE singleton AND operation_mode IN ('PRELAUNCH','PILOT','LIVE'))
   THEN v_reason:='PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT'; END IF;
 END IF;

 IF v_reason IS NOT NULL THEN
   UPDATE public.clube_coupon_paid_invoices SET
     status='review_required',
     coupon_settlement_hold_reason_v1_853=v_reason,
     provider_payment_id=p_payment_id,paid_at=clock_timestamp(),
     pix_br_code=NULL,payment_url=NULL,updated_at=clock_timestamp()
   WHERE id=v_invoice.id;
   -- Fail closed even if an inconsistent earlier event created an issuance.
   UPDATE public.clube_coupon_paid_issuances
     SET status='review_required',reserved_quote_id=NULL,reserved_at=NULL
   WHERE invoice_id=v_invoice.id AND status IN ('issued','reserved');
   RETURN pg_catalog.jsonb_build_object(
     'ok',false,'reviewRequired',true,'providerPaymentRecorded',true,
     'reason',v_reason,'issued',0,'invoiceId',v_invoice.id);
 END IF;

 UPDATE public.clube_coupon_paid_invoices
 SET status='paid',paid_at=clock_timestamp(),provider_payment_id=p_payment_id,
     updated_at=clock_timestamp()
 WHERE id=v_invoice.id;
 INSERT INTO public.clube_coupon_paid_issuances
   (invoice_id,ordinal,customer_user_id,face_cents,expires_at)
 SELECT v_invoice.id,g,v_invoice.customer_user_id,v_invoice.coupon_face_cents,
   clock_timestamp()+pg_catalog.make_interval(days=>v_invoice.valid_days)
 FROM pg_catalog.generate_series(1,v_invoice.coupons_per_pack) AS g
 ON CONFLICT(invoice_id,ordinal) DO NOTHING;
 RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',false,
   'invoiceId',v_invoice.id,'issued',v_invoice.coupons_per_pack);
END
$verified_coupon$;
REVOKE ALL ON FUNCTION public.clube_coupon_paid_payment_verify(uuid,text,text,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_coupon_paid_payment_verify(uuid,text,text,integer)
 TO service_role;
