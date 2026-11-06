-- #866 verified financial triage; all synthetic test changes are rolled back.
BEGIN;
DO $case$
DECLARE
 v_invoice uuid;
 v_request uuid;
 v_actor uuid;
 v_claim uuid := pg_catalog.gen_random_uuid();
 v_attempt uuid := pg_catalog.gen_random_uuid();
 v_second uuid := pg_catalog.gen_random_uuid();
 v_history bigint;
 v_decision text;
 v_invalid text;
 v_paid_before text;
 v_paid_after text;
 v_vouchers_before text;
 v_vouchers_after text;
 v_answer jsonb;
 v_replayed jsonb;
 v_audits bigint;
BEGIN
 SELECT r.invoice_id,r.request_id INTO v_invoice,v_request
 FROM public.clube_coupon_refund_requests_v1_814 r
 JOIN public.clube_coupon_paid_invoices i ON i.id=r.invoice_id
 WHERE r.status='requested' AND i.status='paid'
 ORDER BY r.received_at DESC LIMIT 1;
 IF v_invoice IS NULL THEN RAISE EXCEPTION 'CI_866_CASE_FIXTURE_MISSING'; END IF;
 SELECT user_id INTO v_actor FROM public.platform_admins
 WHERE active=true AND admin_role IN ('superadmin','finance') LIMIT 1;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'CI_866_FINANCE_ACTOR_MISSING'; END IF;
 IF pg_catalog.has_function_privilege('anon',
    'public.admin_clube_coupon_refund_triage_v1_866(uuid,uuid,uuid,uuid,text)','EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated',
    'public.admin_clube_coupon_refund_triage_v1_866(uuid,uuid,uuid,uuid,text)','EXECUTE')
 OR NOT pg_catalog.has_function_privilege('service_role',
    'public.admin_clube_coupon_refund_triage_v1_866(uuid,uuid,uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'CI_866_RPC_UNSAFE_ACL'; END IF;
 SELECT count(*) INTO v_history FROM public.clube_coupon_paid_order_applications
 WHERE invoice_id=v_invoice;
 v_decision:=CASE WHEN v_history>0 THEN 'merchant_history_review'
 ELSE 'provider_refund_proof_pending' END;
 v_invalid:=CASE WHEN v_history>0 THEN 'provider_refund_proof_pending'
 ELSE 'merchant_history_review' END;
 SELECT status INTO v_paid_before FROM public.clube_coupon_paid_invoices
 WHERE id=v_invoice;
 SELECT coalesce(pg_catalog.string_agg(ordinal::text||':'||status,',' ORDER BY ordinal),'none')
 INTO v_vouchers_before FROM public.clube_coupon_paid_issuances
 WHERE invoice_id=v_invoice;
 BEGIN
   -- Emulate an old in_review case with no #865 claim inside a savepoint.
   -- The failed function rolls the temporary status change back.
   UPDATE public.clube_coupon_refund_requests_v1_814
   SET status='in_review' WHERE invoice_id=v_invoice;
   PERFORM public.admin_clube_coupon_refund_triage_v1_866(
     v_actor,v_invoice,v_request,pg_catalog.gen_random_uuid(),v_decision);
   RAISE EXCEPTION 'CI_866_UNASSIGNED_TRIAGE_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 PERFORM public.admin_clube_coupon_refund_review_start_v1_865(
   v_actor,v_invoice,v_request,v_claim);
 BEGIN
   PERFORM public.admin_clube_coupon_refund_triage_v1_866(
     pg_catalog.gen_random_uuid(),v_invoice,v_request,pg_catalog.gen_random_uuid(),v_decision);
   RAISE EXCEPTION 'CI_866_WRONG_ACTOR_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
   PERFORM public.admin_clube_coupon_refund_triage_v1_866(
     v_actor,v_invoice,v_request,pg_catalog.gen_random_uuid(),v_invalid);
   RAISE EXCEPTION 'CI_866_HISTORICAL_REASON_MISMATCH_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;

 v_answer:=public.admin_clube_coupon_refund_triage_v1_866(
    v_actor,v_invoice,v_request,v_attempt,v_decision);
 IF v_answer->>'ok'<>'true' OR v_answer->>'replayed'<>'false'
 OR v_answer->>'auditId'<>v_attempt::text
 OR v_answer->>'historicalOrderCount'<>v_history::text
 OR v_answer->>'moneyMoved'<>'false'
 OR v_answer->>'providerRefundVerified'<>'false'
 OR v_answer->>'caseClosed'<>'false'
 THEN RAISE EXCEPTION 'CI_866_TRIAGE_MISSING_ACK'; END IF;
 v_replayed:=public.admin_clube_coupon_refund_triage_v1_866(
    v_actor,v_invoice,v_request,v_attempt,v_decision);
 IF v_replayed->>'replayed'<>'true' OR
    v_replayed->>'auditId'<>v_attempt::text
 THEN RAISE EXCEPTION 'CI_866_IDEMPOTENCE_FAILED'; END IF;
 BEGIN
   PERFORM public.admin_clube_coupon_refund_triage_v1_866(
     v_actor,v_invoice,v_request,v_attempt,'financial_anomaly_escalation');
   RAISE EXCEPTION 'CI_866_ATTEMPT_REPURPOSE_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL; END;
 BEGIN
   PERFORM public.admin_clube_coupon_refund_triage_v1_866(
     v_actor,v_invoice,v_request,v_second,'financial_anomaly_escalation');
   RAISE EXCEPTION 'CI_866_SECOND_TRIAGE_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 SELECT status INTO v_paid_after FROM public.clube_coupon_paid_invoices
 WHERE id=v_invoice;
 SELECT coalesce(pg_catalog.string_agg(ordinal::text||':'||status,',' ORDER BY ordinal),'none')
 INTO v_vouchers_after FROM public.clube_coupon_paid_issuances
 WHERE invoice_id=v_invoice;
 SELECT count(*) INTO v_audits FROM public.platform_admin_audit
 WHERE action='clube_coupon_refund_triage_v1_866'
 AND target_type='clube_coupon_refund_request' AND target_id=v_request::text;
 IF v_paid_before IS DISTINCT FROM v_paid_after
 OR v_vouchers_before IS DISTINCT FROM v_vouchers_after
 OR v_audits<>1
 OR (SELECT status FROM public.clube_coupon_refund_requests_v1_814
     WHERE invoice_id=v_invoice)<>'in_review'
 THEN RAISE EXCEPTION 'CI_866_LEDGER_OR_CASE_CHANGED'; END IF;
 RAISE NOTICE 'CI_866_IMMUTABLE_TRIAGE_PASS';
END $case$;
ROLLBACK;
