-- TAMÃO #865: start a human review of a refund request with an atomic audit.
-- This does not refund Pix, close a protocol, grant a voucher or settle a merchant.
-- Reuses canonical v814 refund request and platform_admin_audit tables.
CREATE UNIQUE INDEX IF NOT EXISTS coupon_refund_review_one_claim_v1_865
 ON public.platform_admin_audit(target_type,target_id)
 WHERE action='clube_coupon_review_started_v1_865';

CREATE FUNCTION public.admin_clube_coupon_refund_review_start_v1_865(
 p_actor uuid,p_invoice uuid,p_request uuid,p_attempt uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_request public.clube_coupon_refund_requests_v1_814%rowtype;
 v_audit public.platform_admin_audit%rowtype;
 v_started timestamptz;
BEGIN
 IF p_actor IS NULL OR p_invoice IS NULL OR p_request IS NULL OR p_attempt IS NULL
 THEN RAISE EXCEPTION 'COUPON_REVIEW_INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.platform_admins
   WHERE user_id=p_actor AND active IS TRUE
    AND admin_role IN ('superadmin','finance')
 ) THEN RAISE EXCEPTION 'COUPON_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;

 -- Lock order follows provider settlement and buyer-request paths.
 SELECT * INTO v_invoice FROM public.clube_coupon_paid_invoices
 WHERE id=p_invoice FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_REVIEW_INVOICE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_request FROM public.clube_coupon_refund_requests_v1_814
 WHERE invoice_id=p_invoice FOR UPDATE;
 IF NOT FOUND OR v_request.request_id IS DISTINCT FROM p_request
   OR v_request.customer_user_id IS DISTINCT FROM v_invoice.customer_user_id
 THEN RAISE EXCEPTION 'COUPON_REVIEW_REQUEST_MISMATCH' USING ERRCODE='42501'; END IF;

 -- Idempotency UUID cannot be reused for a different case or operator.
 SELECT * INTO v_audit FROM public.platform_admin_audit
 WHERE id=p_attempt;
 IF FOUND THEN
   IF v_audit.actor_user_id IS DISTINCT FROM p_actor
     OR v_audit.action IS DISTINCT FROM 'clube_coupon_review_started_v1_865'
     OR v_audit.target_type IS DISTINCT FROM 'clube_coupon_refund_request'
     OR v_audit.target_id IS DISTINCT FROM p_request::text
     OR v_audit.metadata->>'invoiceId' IS DISTINCT FROM p_invoice::text
     OR v_request.status IS DISTINCT FROM 'in_review'
   THEN RAISE EXCEPTION 'COUPON_REVIEW_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object(
     'ok',true,'source','clube_coupon_review_start_v1_865',
     'replayed',true,'invoiceId',p_invoice,'requestId',p_request,
     'auditId',v_audit.id,'status','in_review',
     'reviewStartedAt',v_audit.created_at,'moneyMoved',false,
     'refundConfirmed',false,'caseClosed',false);
 END IF;
 IF v_request.status IS DISTINCT FROM 'requested' OR
    v_invoice.status NOT IN ('paid','review_required')
 THEN RAISE EXCEPTION 'COUPON_REVIEW_NOT_CLAIMABLE' USING ERRCODE='55000'; END IF;

 INSERT INTO public.platform_admin_audit(
   id,actor_user_id,action,target_type,target_id,metadata
 ) VALUES (
   p_attempt,p_actor,'clube_coupon_review_started_v1_865',
   'clube_coupon_refund_request',p_request::text,
   pg_catalog.jsonb_build_object('invoiceId',p_invoice::text,
    'newStatus','in_review','moneyMoved',false)
 ) RETURNING created_at INTO v_started;
 UPDATE public.clube_coupon_refund_requests_v1_814
 SET status='in_review',updated_at=clock_timestamp()
 WHERE invoice_id=p_invoice AND request_id=p_request AND status='requested';
 IF NOT FOUND THEN
   RAISE EXCEPTION 'COUPON_REVIEW_CONCURRENT_CHANGE' USING ERRCODE='40001';
 END IF;
 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'source','clube_coupon_review_start_v1_865',
   'replayed',false,'invoiceId',p_invoice,'requestId',p_request,
   'auditId',p_attempt,'status','in_review','reviewStartedAt',v_started,
   'moneyMoved',false,'refundConfirmed',false,'caseClosed',false);
END $$;
REVOKE ALL ON FUNCTION public.admin_clube_coupon_refund_review_start_v1_865(uuid,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clube_coupon_refund_review_start_v1_865(uuid,uuid,uuid,uuid)
 TO service_role;
