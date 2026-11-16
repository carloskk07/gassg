\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 integration. Every fixture synthetic, ROLLBACK.
begin;
set local statement_timeout='90s';
do $test$
declare
 v_owner uuid:=gen_random_uuid();v_admin uuid:=gen_random_uuid();
 v_other uuid:=gen_random_uuid();v_merchant uuid;v_source uuid:=gen_random_uuid();
 v_plan public.merchant_billing_plans%rowtype;v_first jsonb;v_again jsonb;
 v_status jsonb;v_req uuid;v_charge uuid;v_order text;v_corr text;v_event uuid;
 v_denied boolean;v_tmp jsonb;
begin
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(v_owner,'authenticated','authenticated',false,'offset-owner-1032@example.invalid',clock_timestamp()),
 (v_admin,'authenticated','authenticated',false,'offset-admin-1032@example.invalid',clock_timestamp()),
 (v_other,'authenticated','authenticated',false,'offset-other-1032@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,active,admin_role) values(v_admin,true,'superadmin');
 insert into public.merchants(name,cnpj,status)
 values('OFFSET SYNTHETIC MERCHANT','00000000001032','pending') returning id into v_merchant;
 insert into public.merchant_members(merchant_id,user_id,member_role,active)
 values(v_merchant,v_owner,'owner',true);
 select * into v_plan from public.merchant_billing_plans
 where plan_key='credit_01990' and active and billing_mode='prepaid_credit';
 if not found then raise exception 'OFFSET_PLAN_SEED_MISSING';end if;
 if has_table_privilege('authenticated','public.network_fee_package_offsets_v1_1032','SELECT')
   or has_table_privilege('anon','public.network_fee_package_offset_allocations_v1_1032','INSERT')
   or has_function_privilege('authenticated','public.network_fee_offset_prepare_v1_1032(uuid,uuid,text,bigint,text)','EXECUTE')
 then raise exception 'OFFSET_PUBLIC_ACL_LEAK';end if;
 v_denied:=false;
 begin
   perform public.network_fee_offset_prepare_v1_1032(v_owner,v_merchant,v_plan.plan_key,120,'CI-OFFSET-PREPARE-ONE-1032');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'OFFSET_TERMS_BYPASS';end if;
 update public.network_fee_package_policy_v1_1030
  set accrual_enabled=true,terms_approved_at=clock_timestamp(),
   terms_reference='CI-SYNTHETIC-TERMS-NOT-REAL'
  where singleton;
 insert into public.network_fee_package_sources_v1_1030(
  kind,source_id,gross_cents,net_cents,fee_credit_cents,pool_microcents,
  attributed_at,closed_at,receipt_reference,state,matured_at)
 values('mobility_prepaid_fee',v_source,3000,3000,3000,300000000,
  clock_timestamp()-interval '9 days',clock_timestamp()-interval '8 days',
  'CI-ISOLATED-AWARD-ONLY','eligible',clock_timestamp()-interval '1 day');
 insert into public.network_fee_package_awards_v1_1030(
  kind,source_id,user_id,equal_microcents,inviter_microcents)
 values('mobility_prepaid_fee',v_source,v_owner,300000000,0);
 v_denied:=false;
 begin
   perform public.network_fee_offset_prepare_v1_1032(v_other,v_merchant,v_plan.plan_key,100,'CI-OFFSET-STRANGER-1032');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'OFFSET_OTHER_MEMBER_ALLOWED';end if;
 v_status:=public.network_fee_offset_status_v1_1032(v_owner,v_merchant);
 if (v_status->>'availableCents')::bigint<>300 or v_status->>'enabled'<>'true'
 then raise exception 'OFFSET_AVAILABLE_BALANCE_BAD:%',v_status;end if;
 v_first:=public.network_fee_offset_prepare_v1_1032(v_owner,v_merchant,
   v_plan.plan_key,120,'CI-OFFSET-PREPARE-ONE-1032');
 v_req:=(v_first->>'paymentRequestId')::uuid;
 if v_first->>'remainingPixCents'<>(v_plan.purchase_amount_cents-120)::text
   or v_first->>'moneyMoved'<>'false' then
   raise exception 'OFFSET_PREPARE_INCORRECT:%',v_first;end if;
 v_again:=public.network_fee_offset_prepare_v1_1032(v_owner,v_merchant,
   v_plan.plan_key,120,'CI-OFFSET-PREPARE-ONE-1032');
 if v_again->>'alreadyRecorded'<>'true' or
   (v_again->>'paymentRequestId')::uuid<>v_req
 then raise exception 'OFFSET_REPLAY_NOT_IDEMPOTENT';end if;
 v_denied:=false;
 begin
   perform public.network_fee_offset_prepare_v1_1032(v_owner,v_merchant,
     v_plan.plan_key,121,'CI-OFFSET-PREPARE-ONE-1032');
 exception when unique_violation then v_denied:=true;end;
 if not v_denied then raise exception 'OFFSET_REPLAY_MUTATION';end if;
 v_status:=public.network_fee_offset_status_v1_1032(v_owner,v_merchant);
 if (v_status->>'availableCents')::bigint<>180 then
   raise exception 'OFFSET_DOUBLE_SPEND_AFTER_PREPARE:%',v_status;end if;
 -- Cancellation BEFORE provider payment releases only the reserved offset.
 v_tmp:=public.merchant_billing_request_action(v_owner,v_merchant,'cancel-request',
   null,null,null,v_req,null,'CI-OFFSET-CANCEL-ONE-1032',repeat('a',64));
 if v_tmp->>'status'<>'cancelled'
 or (select state from public.network_fee_package_offsets_v1_1032
     where payment_request_id=v_req)<>'cancelled' then
   raise exception 'OFFSET_CANCEL_FAILED';end if;
 v_status:=public.network_fee_offset_status_v1_1032(v_owner,v_merchant);
 if (v_status->>'availableCents')::bigint<>300 then
   raise exception 'OFFSET_CANCEL_NOT_RELEASED';end if;

 -- Renew with 150 cents. The PSP must collect exactly plan price minus offset.
 v_first:=public.network_fee_offset_prepare_v1_1032(v_owner,v_merchant,
   v_plan.plan_key,150,'CI-OFFSET-PREPARE-TWO-1032');
 v_req:=(v_first->>'paymentRequestId')::uuid;
 v_status:=public.network_fee_payout_status_v1_1031(v_admin,v_owner);
 if (v_status->>'availableCents')::bigint<>150 then
   raise exception 'OFFSET_PAYOUT_DOUBLE_SPEND_ALLOWED:%',v_status;end if;
 v_denied:=false;
 begin
   perform public.network_fee_payout_reserve_v1_1031(
     v_admin,v_owner,200,'CI-OFFSET-PAYOUT-BLOCK-1032');
 exception when sqlstate '22023' then v_denied:=true;end;
 if not v_denied then raise exception 'OFFSET_PAYOUT_DOUBLE_SPEND';end if;
 v_first:=public.merchant_billing_pix_charge_prepare_provider(
   v_owner,v_merchant,v_plan.plan_key,null,null,'mercadopago',
   'CI-OFFSET-PIX-PREP-1032',repeat('c',64));
 v_charge:=(v_first->>'chargeId')::uuid;
 if (v_first->>'paymentRequestId')::uuid<>v_req
   or (v_first->>'expectedAmountCents')::bigint<>v_plan.purchase_amount_cents-150
 then raise exception 'OFFSET_PIX_AMOUNT_MISMATCH:%',v_first;end if;
 select correlation_id into v_corr from public.merchant_billing_provider_charges
 where id=v_charge;
 v_order:='ORDOFFSET1032'||replace(v_charge::text,'-','');
 update public.merchant_billing_provider_charges set provider_charge_id=v_order where id=v_charge;
 v_tmp:=public.ingest_merchant_billing_payment_event('mercadopago',
   'order:'||v_order||':accredited','mp-order:'||v_order,'pix',
   v_plan.purchase_amount_cents-150,'BRL',clock_timestamp(),
   repeat('b',64),null,v_corr);
 v_event:=(v_tmp->>'eventId')::uuid;
 v_tmp:=public.apply_verified_merchant_billing_payment(v_event,v_charge);
 if v_tmp->>'applied'<>'true' or
   (select state from public.network_fee_package_offsets_v1_1032
    where payment_request_id=v_req)<>'applied' or
   (select expected_amount_cents from public.merchant_billing_payment_requests
    where id=v_req)<>v_plan.purchase_amount_cents-150 or
   (select sum(amount_cents) from public.merchant_fee_credit_ledger
    where payment_request_id=v_req and entry_type='package_credit')<>v_plan.credit_grant_cents
 then raise exception 'OFFSET_PIX_SETTLEMENT_NOT_ATOMIC:%',v_tmp;end if;
 -- Any later source reversal produces a review hold, not counterfeit bank refunds.
 update public.network_fee_package_sources_v1_1030
   set state='reversed',reversed_at=clock_timestamp(),matured_at=null
 where kind='mobility_prepaid_fee' and source_id=v_source;
 if (select state from public.network_fee_package_offsets_v1_1032
     where payment_request_id=v_req)<>'reversal_review'
    or (select sales_hold from public.merchant_billing_accounts
     where merchant_id=v_merchant) is not true
 then raise exception 'OFFSET_SOURCE_REVERSAL_NOT_HELD';end if;
 raise notice 'V1.1032 PASS: terms/auth/RLS, microcent conservation, idempotency, cancellation, payout lock, real Pix remainder settlement and reversal hold';
end $test$;
rollback;
