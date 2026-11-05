-- #842: apenas PostgreSQL descartável; tudo ROLLBACK e nenhum Pix gerado.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,is_sso_user,is_anonymous,email,email_confirmed_at)
VALUES
('a8420000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'benefits-owner@example.invalid',clock_timestamp()),
('a8420000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'benefits-manager@example.invalid',clock_timestamp()),
('a8420000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'benefits-operator@example.invalid',clock_timestamp());
INSERT INTO public.merchants(id,name,cnpj,status,online)
VALUES ('b8420000-0000-4000-8000-000000000001','Revenda benefícios isolada CI','84200000000001','pending',false);
INSERT INTO public.merchant_members(merchant_id,user_id,member_role,active)
VALUES
('b8420000-0000-4000-8000-000000000001','a8420000-0000-4000-8000-000000000001','owner',true),
('b8420000-0000-4000-8000-000000000001','a8420000-0000-4000-8000-000000000002','manager',true),
('b8420000-0000-4000-8000-000000000001','a8420000-0000-4000-8000-000000000003','operator',true);
SET LOCAL ROLE service_role;
DO $t$
declare
 m uuid:='b8420000-0000-4000-8000-000000000001';
 o uuid:='a8420000-0000-4000-8000-000000000001';
 mgr uuid:='a8420000-0000-4000-8000-000000000002';
 operator_id uuid:='a8420000-0000-4000-8000-000000000003';
 r jsonb;
 denied boolean;
 before_snapshot text;
begin
 before_snapshot:=md5(pg_get_functiondef('public.snapshot_order_economics()'::regprocedure));
 r:=public.merchant_benefits_contract_v1_842(o,m,'view');
 if r->>'source'<>'merchant_benefits_contract_v1_842'
 or (r->>'optedIn')::boolean is distinct from false
 or (r->>'version')::integer<>0
 or (r->>'checkoutBenefitsEnabled')::boolean is distinct from false
 or (r->>'feeReductionEnabled')::boolean is distinct from false
 or (r->>'legacyCouponRightsPreserved')::boolean is distinct from true
 or (r->>'normalFlexFeeBps')::integer<>900
 or (r->>'memberFlexFeeBps')::integer<>800
 then raise exception 'MERCHANT_BENEFITS_INITIAL_VIEW_INVALID';end if;
 r:=public.merchant_benefits_contract_v1_842(mgr,m,'view');
 if (r->>'version')::integer<>0
 then raise exception 'MANAGER_VIEW_MISSING';end if;
 denied:=false;
 begin
  perform public.merchant_benefits_contract_v1_842(mgr,m,'accept',1,0,'c8420000-0000-4000-8000-000000000001',true);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'MANAGER_COULD_ACCEPT';end if;
 denied:=false;
 begin
  perform public.merchant_benefits_contract_v1_842(operator_id,m,'view');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'OPERATOR_COULD_READ';end if;
 denied:=false;
 begin
  perform public.merchant_benefits_contract_v1_842(o,m,'accept',1,0,'c8420000-0000-4000-8000-000000000002',false);
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'ACCEPTANCE_WITHOUT_CONSENT';end if;

 r:=public.merchant_benefits_contract_v1_842(o,m,'accept',1,0,'c8420000-0000-4000-8000-000000000003',true);
 if (r->>'optedIn')::boolean is distinct from true or (r->>'version')::integer<>1
    or (r->>'noCurrentFinancialMutation')::boolean is distinct from true
 then raise exception 'MERCHANT_BENEFIT_ACCEPT_FAILED';end if;
 r:=public.merchant_benefits_contract_v1_842(o,m,'accept',1,0,'c8420000-0000-4000-8000-000000000003',true);
 if (r->>'replayed')::boolean is distinct from true
 then raise exception 'IDEMPOTENT_ACCEPT_FAILED';end if;

 denied:=false;
 begin
  perform public.merchant_benefits_contract_v1_842(o,m,'revoke',1,1,'c8420000-0000-4000-8000-000000000003',false);
 exception when unique_violation then denied:=true;end;
 if not denied then raise exception 'REQUEST_ID_REUSED_FOR_DIFFERENT_ACTION';end if;
 denied:=false;
 begin
  perform public.merchant_benefits_contract_v1_842(o,m,'revoke',1,0,'c8420000-0000-4000-8000-000000000004',false);
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'STALE_VERSION_CHANGED_STATE';end if;
 r:=public.merchant_benefits_contract_v1_842(o,m,'revoke',1,1,'c8420000-0000-4000-8000-000000000005',false);
 if (r->>'optedIn')::boolean is distinct from false
 or (r->>'version')::integer<>2 then raise exception 'REVOCATION_FAILED';end if;
 r:=public.merchant_benefits_contract_v1_842(o,m,'revoke',1,1,'c8420000-0000-4000-8000-000000000005',false);
 if (r->>'replayed')::boolean is distinct from true then raise exception 'REVOKE_REPLAY_FAILED';end if;
 r:=public.merchant_benefits_contract_v1_842(o,m,'accept',1,2,'c8420000-0000-4000-8000-000000000006',true);
 if (r->>'optedIn')::boolean is distinct from true
 or (r->>'version')::integer<>3 then raise exception 'REACCEPT_FAILED';end if;

 if (select count(*) from public.merchant_benefit_events_v1_842
     where merchant_id=m)<>3
 or (select count(*) from public.merchant_benefit_participations_v1_842
     where merchant_id=m and opted_in=true and version=3)<>1
 or exists(select 1 from public.merchant_benefit_events_v1_842
     where merchant_id=m and (flex_standard_fee_bps<>900
       or flex_benefit_fee_bps<>800 or max_welcome_discount_cents<>100
       or length(terms_text_snapshot)<250))
 then raise exception 'BENEFIT_HISTORY_NOT_IMMUTABLE';end if;
 denied:=false;
 begin
  update public.merchant_benefit_events_v1_842 set operation='revoke'
  where request_id='c8420000-0000-4000-8000-000000000003';
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'BENEFIT_EVENT_MODIFIED';end if;
 if md5(pg_get_functiondef('public.snapshot_order_economics()'::regprocedure))<>before_snapshot
 or (select platform_fee_bps from public.merchant_billing_plans
    where plan_key='flex_daily')<>900
 or exists(select 1 from public.platform_receivables
   where merchant_id=m)
 or exists(select 1 from public.merchant_cashback_reimbursements
   where merchant_id=m)
 then raise exception 'CONTRACT_CHANGED_ACTIVE_FINANCE';end if;
end $t$;
DO $t$ BEGIN
 if has_table_privilege('authenticated','public.merchant_benefit_events_v1_842','SELECT')
 or has_table_privilege('authenticated','public.merchant_benefit_participations_v1_842','SELECT')
 or has_function_privilege('authenticated',
  'public.merchant_benefits_contract_v1_842(uuid,uuid,text,integer,integer,uuid,boolean)','EXECUTE')
 then raise exception 'BROWSER_BENEFITS_PERMISSION_LEAK';end if;
END $t$;
ROLLBACK;
