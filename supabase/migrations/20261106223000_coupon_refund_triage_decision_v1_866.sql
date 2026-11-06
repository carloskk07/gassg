-- TAMÃO #866: one immutable finance triage decision after #865 assignment.
-- Categorizing a pending refund is NOT PSP proof, settlement or closure.
-- The canonical v814 case remains in_review and original customer vouchers
-- remain protected. No new balance, paid status or external provider action.
CREATE UNIQUE INDEX IF NOT EXISTS clube_coupon_refund_triage_one_case_v1_866
 ON public.platform_admin_audit(target_type,target_id)
 WHERE action='clube_coupon_refund_triage_v1_866';

CREATE FUNCTION public.admin_clube_coupon_refund_triage_v1_866(
 p_actor uuid,p_invoice uuid,p_request uuid,p_attempt uuid,p_decision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_case public.clube_coupon_refund_requests_v1_814%rowtype;
 v_claim public.platform_admin_audit%rowtype;
 v_prior public.platform_admin_audit%rowtype;
 v_replay public.platform_admin_audit%rowtype;
 v_role text;
 v_history bigint;
 v_recorded_at timestamptz;
BEGIN
 IF p_actor IS NULL OR p_invoice IS NULL OR p_request IS NULL OR p_attempt IS NULL
 OR p_decision IS NULL OR p_decision NOT IN
   ('provider_refund_proof_pending','merchant_history_review','financial_anomaly_escalation')
 THEN RAISE EXCEPTION 'COUPON_TRIAGE_INVALID_INPUT' USING ERRCODE='22023'; END IF;

 SELECT admin_role INTO v_role FROM public.platform_admins
 WHERE user_id=p_actor AND active IS TRUE
 AND admin_role IN ('superadmin','finance');
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_TRIAGE_FORBIDDEN'
 USING ERRCODE='42501'; END IF;

 -- Serialize against new buyer requests, voucher reservations and refunds.
 SELECT * INTO v_invoice FROM public.clube_coupon_paid_invoices
 WHERE id=p_invoice FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_TRIAGE_INVOICE_NOT_FOUND'
 USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_case FROM public.clube_coupon_refund_requests_v1_814
 WHERE invoice_id=p_invoice FOR UPDATE;
 IF NOT FOUND OR v_case.request_id IS DISTINCT FROM p_request
 OR v_case.customer_user_id IS DISTINCT FROM v_invoice.customer_user_id
 THEN RAISE EXCEPTION 'COUPON_TRIAGE_CASE_MISMATCH' USING ERRCODE='42501'; END IF;
 IF v_case.status IS DISTINCT FROM 'in_review'
 OR v_invoice.status NOT IN ('paid','review_required')
 THEN RAISE EXCEPTION 'COUPON_TRIAGE_NOT_REVIEWABLE' USING ERRCODE='55000'; END IF;

 SELECT * INTO v_claim FROM public.platform_admin_audit
 WHERE action='clube_coupon_review_started_v1_865'
 AND target_type='clube_coupon_refund_request' AND target_id=p_request::text;
 IF NOT FOUND OR v_claim.metadata->>'invoiceId' IS DISTINCT FROM p_invoice::text
 OR (v_claim.actor_user_id IS DISTINCT FROM p_actor AND v_role<>'superadmin')
 THEN RAISE EXCEPTION 'COUPON_TRIAGE_NOT_ASSIGNED' USING ERRCODE='42501'; END IF;

 -- A reissued coupon is not proof of zero lifetime usage. Classify
 -- historical merchant liabilities before any provider-only explanation.
 SELECT count(*) INTO v_history FROM public.clube_coupon_paid_order_applications
 WHERE invoice_id=p_invoice;
 IF v_history>0 AND p_decision='provider_refund_proof_pending'
 THEN RAISE EXCEPTION 'COUPON_TRIAGE_HISTORY_REQUIRES_MERCHANT_REVIEW'
 USING ERRCODE='55000'; END IF;
 IF v_history=0 AND p_decision='merchant_history_review'
 THEN RAISE EXCEPTION 'COUPON_TRIAGE_NO_HISTORICAL_APPLICATION'
 USING ERRCODE='55000'; END IF;

 SELECT * INTO v_replay FROM public.platform_admin_audit WHERE id=p_attempt;
 IF FOUND THEN
   IF v_replay.actor_user_id IS DISTINCT FROM p_actor
   OR v_replay.action IS DISTINCT FROM 'clube_coupon_refund_triage_v1_866'
   OR v_replay.target_type IS DISTINCT FROM 'clube_coupon_refund_request'
   OR v_replay.target_id IS DISTINCT FROM p_request::text
   OR v_replay.metadata->>'invoiceId' IS DISTINCT FROM p_invoice::text
   OR v_replay.metadata->>'decision' IS DISTINCT FROM p_decision
   THEN RAISE EXCEPTION 'COUPON_TRIAGE_IDEMPOTENCY_CONFLICT'
   USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object(
     'ok',true,'source','clube_coupon_refund_triage_v1_866',
     'replayed',true,'invoiceId',p_invoice,'requestId',p_request,
     'auditId',p_attempt,'decision',p_decision,
     'historicalOrderCount',(v_replay.metadata->>'historicalOrderCount')::bigint,
     'recordedAt',v_replay.created_at,'moneyMoved',false,
     'providerRefundVerified',false,'caseClosed',false);
 END IF;

 SELECT * INTO v_prior FROM public.platform_admin_audit
 WHERE action='clube_coupon_refund_triage_v1_866'
 AND target_type='clube_coupon_refund_request' AND target_id=p_request::text;
 IF FOUND THEN RAISE EXCEPTION 'COUPON_TRIAGE_ALREADY_RECORDED'
 USING ERRCODE='55000'; END IF;

 INSERT INTO public.platform_admin_audit(
   id,actor_user_id,action,target_type,target_id,metadata)
 VALUES(p_attempt,p_actor,'clube_coupon_refund_triage_v1_866',
   'clube_coupon_refund_request',p_request::text,
   pg_catalog.jsonb_build_object(
      'invoiceId',p_invoice::text,'decision',p_decision,
      'historicalOrderCount',v_history,
      'statusAtDecision','in_review',
      'refundVerified',false,'merchantPaid',false,'moneyMoved',false))
 RETURNING created_at INTO v_recorded_at;
 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'source','clube_coupon_refund_triage_v1_866',
   'replayed',false,'invoiceId',p_invoice,'requestId',p_request,
   'auditId',p_attempt,'decision',p_decision,
   'historicalOrderCount',v_history,'recordedAt',v_recorded_at,
   'moneyMoved',false,'providerRefundVerified',false,'caseClosed',false);
END $$;
REVOKE ALL ON FUNCTION public.admin_clube_coupon_refund_triage_v1_866(uuid,uuid,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clube_coupon_refund_triage_v1_866(uuid,uuid,uuid,uuid,text)
 TO service_role;
