\set ON_ERROR_STOP on
-- TAMÃO Rede #493 — disposable integration ONLY. No real PSP, Pix, payouts,
-- live merchant, activity event or cash. All synthetic rows ROLLBACK.
begin;
set local statement_timeout='90s';
do $test$
declare
 v_owner uuid:=gen_random_uuid();v_a uuid:=gen_random_uuid();
 v_b uuid:=gen_random_uuid();v_admin uuid:=gen_random_uuid();
 v_anon uuid:=gen_random_uuid();v_merchant uuid;v_plan public.merchant_billing_plans%rowtype;
 v_charge uuid;v_req uuid;v_payment_event uuid;v_grant uuid;
 v_prepared jsonb;v_result jsonb;v_source public.network_fee_package_sources_v1_1030%rowtype;
 v_chargeref text;v_provider_order text;v_paid_at timestamptz;
 v_close timestamptz;v_pool bigint;v_count bigint;v_before bigint;v_denied boolean;
begin
 -- Actual users, merchant and full provider/credit flow, but ONLY in DB ROLLBACK.
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(v_owner,'authenticated','authenticated',false,'n1030-owner@example.invalid',clock_timestamp()),
 (v_a,'authenticated','authenticated',false,'n1030-membera@example.invalid',clock_timestamp()),
 (v_b,'authenticated','authenticated',false,'n1030-memberb@example.invalid',clock_timestamp()),
 (v_admin,'authenticated','authenticated',false,'n1030-admin@example.invalid',clock_timestamp()),
 (v_anon,'authenticated','authenticated',true,null,null);
 insert into public.platform_admins(user_id,active,admin_role)
 values(v_admin,true,'superadmin');
 insert into public.merchants(name,cnpj,status,online,accepts_citywide,last_seen_at,
  delivery_fee_confirmed_at,delivery_fee_cents)
 values('NETWORK ISOLATED SOURCE','00000000000002','pending',false,true,
  clock_timestamp(),clock_timestamp(),0) returning id into v_merchant;
 insert into public.merchant_members(merchant_id,user_id,member_role,active)
 values(v_merchant,v_owner,'owner',true);

 if has_table_privilege('authenticated','public.network_fee_package_awards_v1_1030','INSERT')
   or has_table_privilege('anon','public.network_fee_package_awards_v1_1030','SELECT')
   or has_function_privilege('authenticated','public.network_fee_package_tick_v1_1030(integer)','EXECUTE')
   or has_function_privilege('authenticated','public.network_fee_package_set_enabled_v1_1030(uuid,boolean,text)','EXECUTE')
 then raise exception 'NETWORK_PUBLIC_FINANCIAL_ACL_LEAK';end if;

 -- A normal profile refresh cannot forge participation; a permanent actor
 -- must explicitly invoke the authenticated visit route (simulated as service).
 v_result:=public.network_record_visit_v1_1030(v_a,'customer');
 if v_result->>'recorded'<>'true' or
   (public.network_record_visit_v1_1030(v_anon,'customer')->>'recorded')<>'false'
   or (public.network_record_visit_v1_1030(v_admin,'customer')->>'recorded')<>'false'
 then raise exception 'NETWORK_VISIT_AUTH_FAIL';end if;
 if (select count(*) from public.network_member_visits_v1_1030 where user_id=v_a)<>1
 then raise exception 'NETWORK_VISIT_NOT_IDEMPOTENT';end if;

 v_result:=public.network_fee_package_tick_v1_1030();
 if v_result->>'accrualEnabled'<>'false' or
   (select count(*) from public.network_fee_package_awards_v1_1030)<>0
 then raise exception 'NETWORK_DEFAULT_POLICY_MUST_BE_OFF';end if;
 v_denied:=false;
 begin
   perform public.network_fee_package_set_enabled_v1_1030(v_a,true,'SYNTHETIC-TERMS');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_OWNER_POLICY_ACCESS_LEAK';end if;
 v_denied:=false;
 begin
   perform public.network_fee_package_set_enabled_v1_1030(v_admin,true,'short');
 exception when sqlstate '22023' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_TERMS_PROOF_SKIPPED';end if;
 v_result:=public.network_fee_package_set_enabled_v1_1030(
   v_admin,true,'CI-ISOLATED-TERMS-REFERENCE-NOT-REAL');
 if v_result->>'accrualEnabled'<>'true' or v_result->>'payoutsEnabled'<>'false'
 then raise exception 'NETWORK_ACTIVATION_STATE_FAIL';end if;

 -- External source: use existing merchant Pix preparation/ingestion/credit.
 select * into v_plan from public.merchant_billing_plans where plan_key='credit_01990' and active;
 if not found then raise exception 'NETWORK_REQUIRED_PLAN_MISSING';end if;
 v_prepared:=public.merchant_billing_pix_charge_prepare_provider(v_owner,v_merchant,
   v_plan.plan_key,null,null,'mercadopago','network-test-pix-1030',repeat('a',64));
 v_charge:=(v_prepared->>'chargeId')::uuid;
 v_req:=(v_prepared->>'paymentRequestId')::uuid;
 if v_charge is null or v_req is null then raise exception 'NETWORK_PROVIDER_PREP_MISSING';end if;
 select correlation_id into v_chargeref from public.merchant_billing_provider_charges where id=v_charge;
 v_provider_order:='ORDN1030'||replace(v_charge::text,'-','');
 update public.merchant_billing_provider_charges
  set provider_charge_id=v_provider_order where id=v_charge;
 v_result:=public.ingest_merchant_billing_payment_event('mercadopago',
  'order:'||v_provider_order||':accredited','mp-order:'||v_provider_order,'pix',
  v_plan.purchase_amount_cents,'BRL',clock_timestamp(),repeat('b',64),null,v_chargeref);
 v_payment_event:=(v_result->>'eventId')::uuid;
 v_result:=public.apply_verified_merchant_billing_payment(v_payment_event,v_charge);
 if v_result->>'applied'<>'true' then raise exception 'NETWORK_PREPAID_ORIGIN_NOT_VERIFIED';end if;
 select id into v_grant from public.merchant_fee_credit_ledger where payment_request_id=v_req
   and entry_type='package_credit' and amount_cents=v_plan.credit_grant_cents;
 if v_grant is null then raise exception 'NETWORK_PREPAID_GRANT_MISSING';end if;

 -- In CI alone, make the legitimately processed fake receipt older so the
 -- deterministic closed daily period has elapsed. NET evidence is also
 -- synthetic, inserted only in this rollback transaction.
 v_paid_at:=clock_timestamp()-interval '1 day';
 update public.merchant_billing_provider_charges
  set completed_at=v_paid_at where id=v_charge;
 v_close:=((v_paid_at at time zone 'America/Sao_Paulo')::date+1)::timestamp
    at time zone 'America/Sao_Paulo';
 insert into public.network_member_visits_v1_1030(user_id,visit_hour,last_visit_at,portal)
 values(v_a,date_trunc('hour',v_close-interval '2 hours'),
   v_close-interval '2 hours','customer'),
 (v_b,date_trunc('hour',v_close-interval '1 hour'),
   v_close-interval '1 hour','customer')
 on conflict(user_id,visit_hour) do nothing;
 insert into public.platform_receipt_net_audit(
   kind,resource_id,gross_cents,net_cents,seller_id,provider_order_id,
   provider_payment_id,external_reference,release_at,report_sha256,evidence_reference)
 values('billing',v_charge,v_plan.purchase_amount_cents,
   v_plan.purchase_amount_cents-20,'222333444',v_provider_order,
   '876543212345',v_chargeref,v_paid_at+interval '12 hours',
   repeat('a',64),'mp-release:CI-SYNTHETIC-ONLY.csv:876543212345');
 insert into public.platform_receipt_net_observations(kind,resource_id,status,reason)
 values('billing',v_charge,'net_verified','CI_SYNTHETIC_NET_EVIDENCE');
 -- The Owner may only enable FUTURE purchases. Backdate inside ROLLBACK
 -- to test a single controlled historical synthetic purchase.
 update public.network_fee_package_policy_v1_1030
   set effective_after=v_paid_at-interval '1 minute' where singleton;
 v_result:=public.network_fee_package_tick_v1_1030();
 if v_result->>'recordedSources'<>'1' or
   v_result->>'recordedAwards'<>'2' or v_result->>'payoutsExecuted'<>'0'
 then raise exception 'NETWORK_VERIFIED_PACKAGE_NOT_ACCRUED:%',v_result;end if;
 select * into v_source from public.network_fee_package_sources_v1_1030
  where source_id=v_charge and kind='merchant_prepaid_fee';
 v_pool:=(v_plan.purchase_amount_cents-20)*100000;
 if v_source.net_cents<>v_plan.purchase_amount_cents-20
   or v_source.pool_microcents<>v_pool or v_source.state<>'pending'
 then raise exception 'NETWORK_GROSS_NET_OR_MATURITY_WRONG';end if;
 select coalesce(sum(equal_microcents+inviter_microcents),0),count(*)
 into v_before,v_count
 from public.network_fee_package_awards_v1_1030 where source_id=v_charge;
 if v_before<>v_pool or v_count<>2 then
   raise exception 'NETWORK_TEN_PERCENT_ALLOCATION_NOT_CONSERVED';end if;
 -- No second credit on repeat, 10% ceiling remains.
 v_result:=public.network_fee_package_tick_v1_1030();
 if v_result->>'recordedSources'<>'0' or
   (select count(*) from public.network_fee_package_awards_v1_1030
    where source_id=v_charge)<>2
 then raise exception 'NETWORK_DUPLICATE_CLOSE';end if;
 v_result:=public.network_user_fee_package_summary_v1_1030(v_a);
 if v_result->>'payoutsEnabled'<>'false' or
   (v_result->>'pendingCents')::bigint<>floor((v_pool/2)::numeric/1000000)
 then raise exception 'NETWORK_CUSTOMER_STATEMENT_WRONG:%',v_result;end if;
 v_result:=public.network_fee_package_conservation_v1_1030(v_admin);
 if v_result->>'balanced'<>'true' or v_result->>'violations'<>'0'
 then raise exception 'NETWORK_FINANCE_CONSERVATION_FAILED:%',v_result;end if;

 -- Fake provider reversal observation invalidates both sides atomically.
 update public.platform_receipt_net_observations
   set status='reversed',reason='CI_SYNTHETIC_REVERSAL' where resource_id=v_charge;
 v_result:=public.network_fee_package_tick_v1_1030();
 if v_result->>'reversed'<>'1' or
   (select state from public.network_fee_package_sources_v1_1030
    where source_id=v_charge)<>'reversed'
 then raise exception 'NETWORK_REVERSAL_NOT_APPLIED';end if;
 v_result:=public.network_user_fee_package_summary_v1_1030(v_a);
 if (v_result->>'pendingCents')::bigint<>0 or
   (v_result->>'validatedCents')::bigint<>0 or
   (v_result->>'reversedCents') is not null
 then raise exception 'NETWORK_REVERSED_STILL_AVAILABLE';end if;

 raise notice 'NETWORK V1.1030 PASS: real disposable PSP package, NET, visits, 10%% cap, role ACL, idempotency, reversal and zero payouts';
end $test$;
rollback;
