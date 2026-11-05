-- TAMÃO #845: isolated PostgreSQL fixture. No PSP, credit or production users.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,is_sso_user,is_anonymous,email,email_confirmed_at)
VALUES
('a8450000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'coupon-owner@example.invalid',clock_timestamp()),
('a8450000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'coupon-manager@example.invalid',clock_timestamp()),
('a8450000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'coupon-operator@example.invalid',clock_timestamp());
INSERT INTO public.merchants(id,name,cnpj,status,online)
VALUES ('b8450000-0000-4000-8000-000000000001','Revenda de cupons isolada','84500000000001','pending',false);
INSERT INTO public.merchant_members(merchant_id,user_id,member_role,active)
VALUES
('b8450000-0000-4000-8000-000000000001','a8450000-0000-4000-8000-000000000001','owner',true),
('b8450000-0000-4000-8000-000000000001','a8450000-0000-4000-8000-000000000002','manager',true),
('b8450000-0000-4000-8000-000000000001','a8450000-0000-4000-8000-000000000003','operator',true);
SET LOCAL ROLE service_role;
DO $test$
DECLARE
 m uuid:='b8450000-0000-4000-8000-000000000001';
 o uuid:='a8450000-0000-4000-8000-000000000001';
 mgr uuid:='a8450000-0000-4000-8000-000000000002';
 op uuid:='a8450000-0000-4000-8000-000000000003';
 r jsonb;
 denied boolean;
 prior_hash text;
BEGIN
 prior_hash:=md5(pg_get_functiondef(
   'public.clube_coupon_paid_create_order(uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text)'::regprocedure));
 r:=public.merchant_coupon_contract_v1_845(o,m,'view');
 IF r->>'source'<>'merchant_coupon_contract_v1_845'
    OR (r->>'version')::integer<>0
    OR (r->>'optedIn')::boolean IS DISTINCT FROM false
    OR (r->>'checkoutEnabled')::boolean IS DISTINCT FROM false
    OR (r->>'feeReductionEnabled')::boolean IS DISTINCT FROM false
    OR (r->>'futureCouponsOnly')::boolean IS DISTINCT FROM true
    OR (r->>'existingPaidCouponsUntouched')::boolean IS DISTINCT FROM true
    OR (r->>'maxCouponFaceCents')::integer<>500
    OR (r->>'minOrderCents')::integer<>1000
    OR (r->>'normalFlexFeeBps')::integer<>900
    OR (r->>'fundedFlexFeeBps')::integer<>800
 THEN RAISE EXCEPTION 'COUPON_CONTRACT_INVALID_INITIAL_READ'; END IF;
 r:=public.merchant_coupon_contract_v1_845(mgr,m,'view');
 IF (r->>'version')::integer<>0
 THEN RAISE EXCEPTION 'COUPON_MANAGER_READ_DENIED'; END IF;
 denied:=false;
 BEGIN
   PERFORM public.merchant_coupon_contract_v1_845(mgr,m,'accept',1,0,
      'c8450000-0000-4000-8000-000000000001',true);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'MANAGER_SIGNED_NEW_COUPONS'; END IF;
 denied:=false;
 BEGIN
   PERFORM public.merchant_coupon_contract_v1_845(op,m,'view');
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'OPERATOR_SAW_COUPON_TERMS'; END IF;
 denied:=false;
 BEGIN
   PERFORM public.merchant_coupon_contract_v1_845(o,m,'accept',1,0,
      'c8450000-0000-4000-8000-000000000002',false);
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'COUPON_ACCEPTED_WITHOUT_CONSENT'; END IF;

 r:=public.merchant_coupon_contract_v1_845(o,m,'accept',1,0,
      'c8450000-0000-4000-8000-000000000003',true);
 IF (r->>'optedIn')::boolean IS DISTINCT FROM true OR (r->>'version')::integer<>1
    OR (r->>'moneyMoved')::boolean IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'COUPON_CONSENT_ACCEPT_FAILED'; END IF;
 r:=public.merchant_coupon_contract_v1_845(o,m,'accept',1,0,
      'c8450000-0000-4000-8000-000000000003',true);
 IF (r->>'replayed')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'COUPON_ACCEPT_REPLAY_FAILED'; END IF;
 denied:=false;
 BEGIN
   PERFORM public.merchant_coupon_contract_v1_845(o,m,'revoke',1,1,
      'c8450000-0000-4000-8000-000000000003',false);
 EXCEPTION WHEN SQLSTATE '23505' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'COUPON_REUSED_REQUEST_DIFFERENT_ACTION'; END IF;
 denied:=false;
 BEGIN
   PERFORM public.merchant_coupon_contract_v1_845(o,m,'revoke',1,0,
      'c8450000-0000-4000-8000-000000000004',false);
 EXCEPTION WHEN SQLSTATE '40001' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'STALE_COUPON_CONTRACT_CHANGED_STATE'; END IF;
 r:=public.merchant_coupon_contract_v1_845(o,m,'revoke',1,1,
      'c8450000-0000-4000-8000-000000000005',false);
 IF (r->>'optedIn')::boolean IS DISTINCT FROM false OR (r->>'version')::integer<>2
 THEN RAISE EXCEPTION 'COUPON_REVOCATION_FAILED'; END IF;
 r:=public.merchant_coupon_contract_v1_845(o,m,'revoke',1,1,
      'c8450000-0000-4000-8000-000000000005',false);
 IF (r->>'replayed')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'COUPON_REVOKE_REPLAY_FAILED'; END IF;
 r:=public.merchant_coupon_contract_v1_845(o,m,'accept',1,2,
      'c8450000-0000-4000-8000-000000000006',true);
 IF (r->>'optedIn')::boolean IS DISTINCT FROM true OR (r->>'version')::integer<>3
 THEN RAISE EXCEPTION 'COUPON_REACCEPT_FAILED'; END IF;
 IF (SELECT count(*) FROM public.merchant_coupon_consent_events_v1_845 WHERE merchant_id=m)<>3
    OR (SELECT count(*) FROM public.merchant_coupon_consents_v1_845 WHERE merchant_id=m AND opted_in AND version=3)<>1
    OR EXISTS(SELECT 1 FROM public.merchant_coupon_consent_events_v1_845
      WHERE merchant_id=m AND (max_coupon_face_cents<>500 OR
        min_order_cents<>1000 OR funded_flex_fee_bps<>800 OR
        length(terms_text_snapshot)<500))
 THEN RAISE EXCEPTION 'COUPON_EVENT_HISTORY_DRIFT'; END IF;
 denied:=false;
 BEGIN
   UPDATE public.merchant_coupon_consent_events_v1_845
      SET operation='revoke'
    WHERE request_id='c8450000-0000-4000-8000-000000000003';
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'COUPON_EVENT_HISTORY_EDITABLE'; END IF;
 IF prior_hash<>md5(pg_get_functiondef(
   'public.clube_coupon_paid_create_order(uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text)'::regprocedure))
    OR EXISTS(SELECT 1 FROM public.platform_receivables WHERE merchant_id=m)
    OR EXISTS(SELECT 1 FROM public.merchant_cashback_reimbursements WHERE merchant_id=m)
    OR EXISTS(SELECT 1 FROM public.merchant_benefit_participations_v1_842 WHERE merchant_id=m)
    OR EXISTS(SELECT 1 FROM public.clube_coupon_paid_invoices WHERE customer_user_id=o)
 THEN RAISE EXCEPTION 'COUPON_CONSENT_FINANCIAL_SIDE_EFFECT'; END IF;
END $test$;
DO $acl$ BEGIN
 IF has_table_privilege('authenticated','public.merchant_coupon_consents_v1_845','SELECT')
    OR has_table_privilege('authenticated','public.merchant_coupon_consent_events_v1_845','SELECT')
    OR has_table_privilege('authenticated','public.merchant_coupon_terms_v1_845','SELECT')
    OR has_function_privilege('authenticated',
      'public.merchant_coupon_contract_v1_845(uuid,uuid,text,integer,integer,uuid,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'BROWSER_COUPON_CONTRACT_PERMISSION_LEAK'; END IF;
END $acl$;
ROLLBACK;
