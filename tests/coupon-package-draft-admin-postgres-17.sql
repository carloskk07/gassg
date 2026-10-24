-- Disposable PostgreSQL 17 only, after the earlier coupon audit fixture.
-- Never run these synthetic actors or scenario drafts against production.
create table if not exists public.platform_launch_control(
 singleton boolean primary key,
 commerce_enabled boolean not null,
 operation_mode text not null
);
insert into public.platform_launch_control(singleton,commerce_enabled,operation_mode)
values(true,false,'PRELAUNCH') on conflict(singleton)
do update set commerce_enabled=false,operation_mode='PRELAUNCH';

DO $draft_spec$
DECLARE v_admin uuid; v_finance uuid; v_result jsonb; v_count integer;
BEGIN
 select user_id into v_admin from public.platform_admins
 where active=true and admin_role='superadmin' limit 1;
 select user_id into v_finance from public.platform_admins
 where active=true and admin_role='finance' limit 1;
 if v_admin is null or v_finance is null then
  raise exception 'COUPON_DRAFT_FIXTURE_ADMIN_MISSING'; end if;
 begin
  perform public.clube_coupon_paid_package_draft_create(
   v_finance,'pilot_fail_finance','Pacote piloto',1200,500,2,60);
  raise exception 'COUPON_DRAFT_FINANCE_ROLE_WAS_ALLOWED';
 exception when insufficient_privilege then null; end;
 begin
  perform public.clube_coupon_paid_package_draft_create(
   v_admin,'pilot_unsupported','Pacote subfinanciado',900,500,2,60);
  raise exception 'COUPON_DRAFT_FACE_EXCEEDS_GROSS_ALLOWED';
 exception when invalid_parameter_value then null; end;
 v_result:=public.clube_coupon_paid_package_draft_create(
   v_admin,'pilot_draft_only','Pacote piloto interno',1200,500,2,60);
 if v_result->>'ok' is distinct from 'true'
   or v_result->>'saleEnabled' is distinct from 'false'
   or v_result->>'fundingVerified' is distinct from 'false'
   or v_result->>'grossBufferCents'<>'200'
   or v_result->>'costCoverageVerified' is distinct from 'false'
   or v_result->>'moneyMoved' is distinct from 'false'
 then raise exception 'COUPON_DRAFT_NOT_FAIL_CLOSED'; end if;
 select count(*) into v_count from public.clube_coupon_paid_packages
 where package_key='pilot_draft_only' and sale_enabled=false
 and funding_verified=false and legal_terms_verified=false
 and redeem_settlement_verified=false;
 if v_count<>1 then raise exception 'COUPON_DRAFT_UNVERIFIED_FLAGS'; end if;
 select count(*) into v_count from public.platform_admin_audit
 where id=(v_result->>'auditId')::uuid
 and actor_user_id=v_admin and action='coupon_paid_package_draft_created'
 and target_id='pilot_draft_only'
 and (metadata->>'saleEnabled')::boolean=false;
 if v_count<>1 then raise exception 'COUPON_DRAFT_AUDIT_MISSING'; end if;
 begin
  perform public.clube_coupon_paid_package_draft_create(
   v_admin,'pilot_draft_only','Duplicate prevented',1200,500,2,60);
  raise exception 'COUPON_DRAFT_DUPLICATE_ALLOWED';
 exception when unique_violation then null; end;
 select count(*) into v_count from public.platform_admin_audit
 where action='coupon_paid_package_draft_created' and target_id='pilot_draft_only';
 if v_count<>1 then raise exception 'COUPON_DRAFT_DUPLICATE_CREATED_AUDIT'; end if;
 update public.platform_launch_control set commerce_enabled=true
 where singleton=true;
 begin
  perform public.clube_coupon_paid_package_draft_create(
   v_admin,'pilot_live_reject','Should never sell',1200,500,2,60);
  raise exception 'COUPON_DRAFT_COMMERCE_ALLOWED';
 exception when insufficient_privilege then null; end;
 update public.platform_launch_control set commerce_enabled=false
 where singleton=true;
END $draft_spec$;

-- Audit must be transactionally atomic with the package row.
alter table public.platform_admin_audit add constraint
 coupon_draft_audit_reject_spec check(action<>'coupon_paid_package_draft_created') not valid;
DO $draft_rollback$
DECLARE v_admin uuid; v_count integer;
BEGIN
 select user_id into v_admin from public.platform_admins
 where active=true and admin_role='superadmin' limit 1;
 begin
  perform public.clube_coupon_paid_package_draft_create(
   v_admin,'pilot_audit_reject','Audit fails and rolls back',1200,500,2,60);
  raise exception 'COUPON_DRAFT_AUDIT_FAILURE_NOT_CAUGHT';
 exception when check_violation then null; end;
 select count(*) into v_count from public.clube_coupon_paid_packages
 where package_key='pilot_audit_reject';
 if v_count<>0 then raise exception 'COUPON_DRAFT_AUDIT_FAILURE_LEFT_ROW'; end if;
END $draft_rollback$;
alter table public.platform_admin_audit drop constraint coupon_draft_audit_reject_spec;

DO $draft_acl$
BEGIN
 if has_table_privilege('service_role','public.clube_coupon_paid_packages','INSERT')
 or has_table_privilege('service_role','public.clube_coupon_paid_packages','UPDATE')
 or not has_table_privilege('service_role','public.clube_coupon_paid_packages','SELECT')
 then raise exception 'COUPON_DRAFT_DIRECT_PACKAGE_WRITE_BYPASS';end if;
 if has_function_privilege('anon',
   'public.clube_coupon_paid_package_draft_create(uuid,text,text,integer,integer,integer,integer)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.clube_coupon_paid_package_draft_create(uuid,text,text,integer,integer,integer,integer)','EXECUTE')
 or not has_function_privilege('service_role',
   'public.clube_coupon_paid_package_draft_create(uuid,text,text,integer,integer,integer,integer)','EXECUTE')
 then raise exception 'COUPON_DRAFT_ACL_EXPOSED'; end if;
END $draft_acl$;
