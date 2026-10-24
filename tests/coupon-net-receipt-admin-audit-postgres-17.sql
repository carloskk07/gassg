-- Disposable PostgreSQL 17 only. Runs after the real coupon migrations
-- and prior atomic checkout fixture. All identifiers and money are fictional.
create table public.platform_admin_audit(
 id uuid primary key default gen_random_uuid(),
 actor_user_id uuid not null references auth.users(id),
 action text not null check(length(action) between 3 and 80),
 target_type text not null check(length(target_type) between 3 and 80),
 target_id text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.platform_admin_audit enable row level security;

DO $coupon_actor_fixture$
DECLARE
 v_admin uuid;
 v_finance uuid;
 v_invoice uuid;
 v_invoice_rollback uuid;
 v_count integer;
 v_result jsonb;
 v_audit_id uuid;
 v_net integer;
BEGIN
 select id into v_admin from auth.users order by id limit 1;
 select id into v_finance from auth.users where id<>v_admin order by id limit 1;
 if v_admin is null or v_finance is null then
   raise exception 'COUPON_AUDIT_FIXTURE_USERS_MISSING'; end if;
 insert into public.platform_admins(user_id,active,admin_role)
 values(v_admin,true,'superadmin'),(v_finance,true,'finance')
 on conflict(user_id) do update set active=excluded.active,admin_role=excluded.admin_role;

 insert into public.clube_coupon_paid_invoices(
   customer_user_id,package_key,request_id,sale_price_cents,
   coupon_face_cents,coupons_per_pack,valid_days,provider_order_id,status
 ) values(v_admin,'checkout_funded',gen_random_uuid(),1200,
    500,2,60,'audit-test-order-01','awaiting_payment')
 returning id into v_invoice;
 perform public.clube_coupon_paid_payment_verify(
   v_invoice,'audit-test-order-01','audit-test-payment-01',1200);

 begin
   perform public.clube_coupon_paid_net_proceeds_verify_audited(
     v_invoice,'audit-test-order-01',1100,'mp-release:audit-test-01',v_finance);
   raise exception 'COUPON_FINANCE_ROLE_UNEXPECTEDLY_AUTHORIZED';
 exception when insufficient_privilege then null;
 end;
 select net_proceeds_cents into v_net from public.clube_coupon_paid_invoices
 where id=v_invoice;
 if v_net is not null then raise exception 'FINANCE_ACTOR_REGISTERED_MONEY';end if;

 v_result:=public.clube_coupon_paid_net_proceeds_verify_audited(
   v_invoice,'audit-test-order-01',1100,'mp-release:audit-test-01',v_admin);
 if v_result->>'ok'<>'true'
   or v_result->>'auditRecorded'<>'true'
   or v_result->>'replayed'<>'false'
 then raise exception 'COUPON_AUDIT_FIRST_REGISTRATION_MISSING';end if;
 v_audit_id:=(v_result->>'auditId')::uuid;
 select count(*) into v_count from public.platform_admin_audit
 where id=v_audit_id and actor_user_id=v_admin
   and action='coupon_net_receipt_registered'
   and target_type='clube_coupon_paid_invoice'
   and target_id=v_invoice::text
   and metadata->>'providerOrderId'='audit-test-order-01'
   and (metadata->>'netCents')::integer=1100
   and metadata->>'evidenceReference'='mp-release:audit-test-01'
   and metadata->>'replayed'='false';
 if v_count<>1 then raise exception 'COUPON_AUDIT_ACTOR_PROVENANCE_WRONG';end if;

 v_result:=public.clube_coupon_paid_net_proceeds_verify_audited(
   v_invoice,'audit-test-order-01',1100,'mp-release:audit-test-01',v_admin);
 if v_result->>'replayed'<>'true' then
   raise exception 'COUPON_AUDIT_REPLAY_UNDETECTED';end if;
 select count(*) into v_count from public.platform_admin_audit
 where target_id=v_invoice::text and action='coupon_net_receipt_registered';
 if v_count<>2 then raise exception 'COUPON_AUDIT_RETRY_NOT_RECORDED';end if;

 begin
   perform public.clube_coupon_paid_net_proceeds_verify_audited(
     v_invoice,'audit-test-order-01',1100,'mp-release:changed-proof',v_admin);
   raise exception 'COUPON_AUDIT_CONFLICT_WAS_ACCEPTED';
 exception when unique_violation then null;
 end;
 select count(*) into v_count from public.platform_admin_audit
 where target_id=v_invoice::text and action='coupon_net_receipt_registered';
 if v_count<>2 then raise exception 'COUPON_AUDIT_CONFLICT_LEFT_SPURIOUS_EVENT';end if;

 insert into public.clube_coupon_paid_invoices(
   customer_user_id,package_key,request_id,sale_price_cents,
   coupon_face_cents,coupons_per_pack,valid_days,provider_order_id,status
 ) values(v_admin,'checkout_funded',gen_random_uuid(),1200,
    500,2,60,'audit-test-order-rollback','awaiting_payment')
 returning id into v_invoice_rollback;
 perform public.clube_coupon_paid_payment_verify(
   v_invoice_rollback,'audit-test-order-rollback','audit-test-payment-rollback',1200);
END $coupon_actor_fixture$;

-- Force a reject at the audit insert, and verify that the existing finance
-- RPC did NOT leave the new invoice half-registered.
alter table public.platform_admin_audit add constraint
 coupon_audit_reject_test_action check(action<>'coupon_net_receipt_registered') not valid;

DO $coupon_atomic_audit_reject$
DECLARE
 v_id uuid;
 v_admin uuid;
 v_result jsonb;
 v_net integer;
BEGIN
 select user_id into v_admin from public.platform_admins
 where active=true and admin_role='superadmin' limit 1;
 select id into v_id from public.clube_coupon_paid_invoices
 where provider_order_id='audit-test-order-rollback' limit 1;
 begin
   v_result:=public.clube_coupon_paid_net_proceeds_verify_audited(
     v_id,'audit-test-order-rollback',1100,'mp-release:rollback-test',v_admin);
   raise exception 'AUDIT_FAILURE_COMMITTED_FINANCIAL_SETTLEMENT';
 exception when check_violation then null;
 end;
 select net_proceeds_cents into v_net from public.clube_coupon_paid_invoices
 where id=v_id;
 if v_net is not null then
   raise exception 'AUDIT_INSERT_FAILURE_DID_NOT_ROLL_BACK_NET';
 end if;
END $coupon_atomic_audit_reject$;
alter table public.platform_admin_audit drop constraint coupon_audit_reject_test_action;

DO $coupon_audit_acl$
BEGIN
 IF has_function_privilege('anon',
   'public.clube_coupon_paid_net_proceeds_verify_audited(uuid,text,integer,text,uuid)',
   'EXECUTE')
   or has_function_privilege('authenticated',
   'public.clube_coupon_paid_net_proceeds_verify_audited(uuid,text,integer,text,uuid)',
   'EXECUTE')
   or not has_function_privilege('service_role',
   'public.clube_coupon_paid_net_proceeds_verify_audited(uuid,text,integer,text,uuid)',
   'EXECUTE')
   or has_function_privilege('service_role',
   'public.clube_coupon_paid_net_proceeds_verify(uuid,text,integer,text)',
   'EXECUTE')
 THEN RAISE EXCEPTION 'COUPON_AUDITED_RPC_ACL_FAILURE';END IF;
END $coupon_audit_acl$;
