-- #865 transactional rollback-only test: all data are CI synthetic.
BEGIN;
DO $case$
DECLARE
 v_invoice uuid;
 v_request uuid;
 v_actor uuid;
 v_attempt uuid := pg_catalog.gen_random_uuid();
 v_bad_attempt uuid := pg_catalog.gen_random_uuid();
 v_response jsonb;
 v_replay jsonb;
 v_invoice_status text;
 v_refund_status text;
 v_audits bigint;
BEGIN
 SELECT r.invoice_id,r.request_id INTO v_invoice,v_request
 FROM public.clube_coupon_refund_requests_v1_814 r
 JOIN public.clube_coupon_paid_invoices i ON i.id=r.invoice_id
 WHERE r.status='requested' AND i.status='paid'
 ORDER BY r.received_at DESC LIMIT 1;
 IF v_invoice IS NULL OR v_request IS NULL THEN
   RAISE EXCEPTION 'CI_865_REFUND_FIXTURE_MISSING';
 END IF;
 SELECT user_id INTO v_actor FROM public.platform_admins
 WHERE active=true AND admin_role IN ('superadmin','finance') LIMIT 1;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'CI_865_FINANCE_ADMIN_MISSING'; END IF;
 IF pg_catalog.has_function_privilege('anon',
  'public.admin_clube_coupon_refund_review_start_v1_865(uuid,uuid,uuid,uuid)','EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated',
  'public.admin_clube_coupon_refund_review_start_v1_865(uuid,uuid,uuid,uuid)','EXECUTE')
 OR NOT pg_catalog.has_function_privilege('service_role',
  'public.admin_clube_coupon_refund_review_start_v1_865(uuid,uuid,uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'CI_865_RPC_ACL_UNSAFE'; END IF;

 BEGIN
   PERFORM public.admin_clube_coupon_refund_review_start_v1_865(
     pg_catalog.gen_random_uuid(),v_invoice,v_request,pg_catalog.gen_random_uuid());
   RAISE EXCEPTION 'CI_865_UNAUTHORIZED_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 BEGIN
   PERFORM public.admin_clube_coupon_refund_review_start_v1_865(
     v_actor,v_invoice,pg_catalog.gen_random_uuid(),pg_catalog.gen_random_uuid());
   RAISE EXCEPTION 'CI_865_WRONG_REQUEST_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 v_response:=public.admin_clube_coupon_refund_review_start_v1_865(
   v_actor,v_invoice,v_request,v_attempt);
 IF v_response->>'status' <> 'in_review' OR
    v_response->>'auditId' <> v_attempt::text OR
    v_response->>'replayed' <> 'false' OR
    v_response->>'moneyMoved' <> 'false' OR
    v_response->>'refundConfirmed' <> 'false' OR
    v_response->>'caseClosed' <> 'false'
 THEN RAISE EXCEPTION 'CI_865_CLAIM_FAILED'; END IF;
 v_replay:=public.admin_clube_coupon_refund_review_start_v1_865(
   v_actor,v_invoice,v_request,v_attempt);
 IF v_replay->>'replayed' <> 'true' OR
    v_replay->>'auditId' <> v_attempt::text
 THEN RAISE EXCEPTION 'CI_865_REPLAY_FAILED'; END IF;
 BEGIN
   PERFORM public.admin_clube_coupon_refund_review_start_v1_865(
     v_actor,v_invoice,v_request,v_bad_attempt);
   RAISE EXCEPTION 'CI_865_DOUBLE_CLAIM_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
 END;
 SELECT status INTO v_refund_status
 FROM public.clube_coupon_refund_requests_v1_814 WHERE invoice_id=v_invoice;
 SELECT status INTO v_invoice_status
 FROM public.clube_coupon_paid_invoices WHERE id=v_invoice;
 SELECT count(*) INTO v_audits FROM public.platform_admin_audit
 WHERE action='clube_coupon_review_started_v1_865'
   AND target_type='clube_coupon_refund_request'
   AND target_id=v_request::text;
 IF v_refund_status<>'in_review' OR v_invoice_status<>'paid' OR v_audits<>1
 THEN RAISE EXCEPTION 'CI_865_ACCOUNTING_MUTATION_OR_AUDIT_FAILURE'; END IF;
 RAISE NOTICE 'CI_865_REVIEW_ATOMIC_AUDIT_PASS';
END $case$;
ROLLBACK;
