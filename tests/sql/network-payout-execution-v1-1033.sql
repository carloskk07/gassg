\set ON_ERROR_STOP on
-- V1.1033: disposable PostgreSQL 17, synthetic users/rewards, ROLLBACK.
-- This script NEVER calls Mercado Pago, creates real Pix or stores real CPF.
begin;
set local statement_timeout='90s';
do $run$
declare
 v_owner uuid:=gen_random_uuid();v_member uuid:=gen_random_uuid();
 v_stranger uuid:=gen_random_uuid();v_source uuid:=gen_random_uuid();
 v_r jsonb;v_j jsonb;v_x jsonb;v_id uuid;v_res uuid;v_other uuid;
 v_denied boolean;v_before jsonb;
begin
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(v_owner,'authenticated','authenticated',false,'p1033-admin@example.invalid',clock_timestamp()),
 (v_member,'authenticated','authenticated',false,'p1033-member@example.invalid',clock_timestamp()),
 (v_stranger,'authenticated','authenticated',false,'p1033-stranger@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,active,admin_role) values(v_owner,true,'superadmin');
 if has_table_privilege('authenticated','public.network_payout_beneficiaries_v1_1033','SELECT')
  or has_table_privilege('anon','public.network_payout_jobs_v1_1033','INSERT')
  or has_function_privilege('authenticated','public.network_payout_dispatch_begin_v1_1033(uuid,uuid)','EXECUTE')
 then raise exception 'NETWORK_PAYOUT_PRIVATE_ACL_LEAK';end if;
 v_denied:=false;
 begin perform public.network_payout_beneficiary_register_v1_1033(
   v_stranger,v_member,repeat('a',44),repeat('b',24),repeat('a',64),
   repeat('b',64),'CI-EXTERNAL-IDENTITY-ONLY-1033');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_ROLE_BYPASS';end if;
 v_x:=public.network_payout_beneficiary_register_v1_1033(
   v_owner,v_member,repeat('a',44),repeat('b',24),repeat('a',64),
   repeat('b',64),'CI-EXTERNAL-IDENTITY-ONLY-1033');
 if v_x->>'verified'<>'true' or v_x->>'rawPixReturned'<>'false'
 then raise exception 'NETWORK_PAYOUT_RECIPIENT_LEAK';end if;
 -- A single verified Pix CPF cannot belong to another beneficiary.
 v_denied:=false;
 begin perform public.network_payout_beneficiary_register_v1_1033(
   v_owner,v_stranger,repeat('c',44),repeat('d',24),repeat('a',64),
   repeat('c',64),'CI-OTHER-IDENTITY-1033-SYNTHETIC');
 exception when unique_violation then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_DUPLICATE_CPF_BENEFICIARY';end if;
 -- A synthetic only source, matured and fully traceable in rollback database.
 update public.network_fee_package_policy_v1_1030 set
  accrual_enabled=true,terms_approved_at=clock_timestamp(),
  terms_reference='CI-TERMS-NOT-REAL-1033' where singleton;
 insert into public.network_fee_package_sources_v1_1030
  (kind,source_id,gross_cents,net_cents,fee_credit_cents,pool_microcents,
  attributed_at,closed_at,receipt_reference,state,matured_at)
 values('mobility_prepaid_fee',v_source,5000,5000,5000,500000000,
  clock_timestamp()-interval '10 days',clock_timestamp()-interval '9 days',
  'CI-SYNTHETIC-SOURCE-1033','eligible',clock_timestamp()-interval '1 day');
 insert into public.network_fee_package_awards_v1_1030
  (kind,source_id,user_id,equal_microcents,inviter_microcents)
 values('mobility_prepaid_fee',v_source,v_member,500000000,0);
 v_r:=public.network_fee_payout_reserve_v1_1031(v_owner,v_member,300,
  'CI-RESERVATION-1033-ONE');
 v_res:=(v_r->>'reservationId')::uuid;
 v_j:=public.network_payout_prepare_v1_1033(v_owner,v_res);
 v_id:=(v_j->>'jobId')::uuid;
 if v_j->>'state'<>'prepared' or
  (public.network_payout_prepare_v1_1033(v_owner,v_res)->>'alreadyRecorded')<>'true'
 then raise exception 'NETWORK_PAYOUT_PREPARE_IDEMPOTENCY';end if;
 v_denied:=false;
 begin perform public.network_payout_authorize_v1_1033(
  v_owner,v_id,300,repeat('a',64),'AUTORIZO PIX');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_POLICY_BYPASS';end if;
 v_denied:=false;
 begin perform public.network_payout_dispatch_begin_v1_1033(v_owner,v_id);
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_NO_AUTH_BYPASS';end if;
 v_denied:=false;
 begin perform public.network_payout_set_execution_v1_1033(v_stranger,true,
  'CI-EXTERNAL-SAFETY-PROOF-1033');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_POLICY_ROLE_BYPASS';end if;
 v_x:=public.network_payout_set_execution_v1_1033(v_owner,true,
  'CI-EXTERNAL-SAFETY-PROOF-1033');
 if v_x->>'executionEnabled'<>'true' or v_x->>'moneyMoved'<>'false'
 then raise exception 'NETWORK_PAYOUT_POLICY_INVALID';end if;
 v_denied:=false;
 begin perform public.network_payout_authorize_v1_1033(
  v_owner,v_id,301,repeat('a',64),'AUTORIZO PIX');
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_AMOUNT_TAMPER';end if;
 v_denied:=false;
 begin perform public.network_payout_authorize_v1_1033(
  v_owner,v_id,300,repeat('a',64),'WRONG');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_CONFIRMATION_BYPASS';end if;
 v_x:=public.network_payout_authorize_v1_1033(
  v_owner,v_id,300,repeat('a',64),'AUTORIZO PIX');
 if v_x->>'authorized'<>'true' or v_x->>'moneyMoved'<>'false'
 then raise exception 'NETWORK_PAYOUT_AUTHORIZATION_WRONG';end if;
 -- No outgoing provider request in this test: only the *persisted* dispatch lock.
 v_x:=public.network_payout_dispatch_begin_v1_1033(v_owner,v_id);
 if v_x->>'alreadyDispatched'<>'false' or
  v_x->>'encryptedPixKey'<>repeat('a',44) or
  v_x->>'pixKeyHash'<>repeat('a',64)
 then raise exception 'NETWORK_PAYOUT_DISPATCH_PAYLOAD_WRONG';end if;
 v_denied:=false;
 begin perform public.network_payout_dispatch_begin_v1_1033(v_owner,v_id);
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_DUPLICATE_DISPATCH';end if;
 v_denied:=false;
 begin perform public.network_fee_payout_cancel_v1_1031(v_owner,v_res);
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_FUNDS_RELEASED_AFTER_DISPATCH';end if;
 v_denied:=false;
 begin perform public.network_payout_beneficiary_register_v1_1033(
   v_owner,v_member,repeat('c',44),repeat('d',24),repeat('c',64),
   repeat('b',64),'CI-SECOND-IDENTITY-1033-ONLY');
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_RECIPIENT_SWAP';end if;
 -- Provider accepted: 202 ACK alone is NOT a bank credit.
 v_x:=public.network_payout_dispatch_result_v1_1033(v_owner,v_id,
  'POPTEST000000001033','TOPTEST000000001033',false);
 if v_x->>'moneyConfirmed'<>'false' or v_x->>'state'<>'submitted'
 then raise exception 'NETWORK_PAYOUT_ACK_IS_NOT_SETTLEMENT';end if;
 v_denied:=false;
 begin perform public.network_payout_bank_confirm_v1_1033(v_owner,v_id,
  'CI-INDEPENDENT-RECEIPT-1033',repeat('f',64));
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_SETTLED_WITHOUT_GET';end if;
 v_x:=public.network_payout_observe_v1_1033(v_owner,v_id,
  'POPTEST000000001033','TOPTEST000000001033','processed','approved');
 if v_x->>'state'<>'submitted' then raise exception 'NETWORK_PAYOUT_EARLY_CREDIT';end if;
 v_x:=public.network_payout_observe_v1_1033(v_owner,v_id,
  'POPTEST000000001033','TOPTEST000000001033','success','accredited');
 if v_x->>'state'<>'credited_unverified' or v_x->>'bankReceiptVerified'<>'false'
 then raise exception 'NETWORK_PAYOUT_PROVIDER_SUCCESS_NOT_PROVEN';end if;
 v_denied:=false;
 begin perform public.network_payout_bank_confirm_v1_1033(v_owner,v_id,
  'CI-INDEPENDENT-RECEIPT-1033','invalid');
 exception when sqlstate '22023' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_FAKE_PROOF';end if;
 v_x:=public.network_payout_bank_confirm_v1_1033(v_owner,v_id,
  'CI-INDEPENDENT-RECEIPT-1033',repeat('f',64));
 if v_x->>'state'<>'paid' or
  (select state from public.network_payout_jobs_v1_1033 where id=v_id)<>'paid'
 then raise exception 'NETWORK_PAYOUT_BANK_SETTLEMENT_NOT_RECORDED';end if;
 -- Another 200-cent reward stays available until reserved, never double count.
 v_before:=public.network_fee_payout_status_v1_1031(v_owner,v_member);
 if (v_before->>'availableCents')::bigint<>200 then
  raise exception 'NETWORK_PAYOUT_BALANCE_CONSERVATION:%',v_before;end if;
 v_r:=public.network_fee_payout_reserve_v1_1031(v_owner,v_member,200,
  'CI-RESERVATION-1033-TWO');
 v_other:=(v_r->>'reservationId')::uuid;
 v_j:=public.network_payout_prepare_v1_1033(v_owner,v_other);
 v_x:=public.network_payout_cancel_prepared_v1_1033(v_owner,(v_j->>'jobId')::uuid);
 if v_x->>'fundsReleased'<>'true'
  or (select state from public.network_fee_payout_reservations_v1_1031
   where id=v_other)<>'cancelled'
 then raise exception 'NETWORK_PAYOUT_CANCEL_PRE_DISPATCH';end if;
 -- In an ambiguous POST, operator may only bind ids after official GET.
 v_r:=public.network_fee_payout_reserve_v1_1031(v_owner,v_member,200,
  'CI-RESERVATION-1033-THREE');
 v_other:=(v_r->>'reservationId')::uuid;
 v_j:=public.network_payout_prepare_v1_1033(v_owner,v_other);
 v_x:=public.network_payout_authorize_v1_1033(
  v_owner,(v_j->>'jobId')::uuid,200,repeat('a',64),'AUTORIZO PIX');
 v_x:=public.network_payout_dispatch_begin_v1_1033(v_owner,(v_j->>'jobId')::uuid);
 v_x:=public.network_payout_dispatch_result_v1_1033(
  v_owner,(v_j->>'jobId')::uuid,null,null,true);
 if v_x->>'state'<>'uncertain' then raise exception 'NETWORK_PAYOUT_UNCERTAIN_LOST';end if;
 v_denied:=false;
 begin perform public.network_payout_dispatch_begin_v1_1033(v_owner,(v_j->>'jobId')::uuid);
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_UNCERTAIN_DUPLICATE_POST';end if;
 v_denied:=false;
 begin perform public.network_payout_bind_ambiguous_v1_1033(
  v_stranger,(v_j->>'jobId')::uuid,'POPTEST000000002033','TOPTEST000000002033');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_RECOVERY_ROLE_BYPASS';end if;
 v_x:=public.network_payout_bind_ambiguous_v1_1033(
  v_owner,(v_j->>'jobId')::uuid,'POPTEST000000002033','TOPTEST000000002033');
 if v_x->>'providerBound'<>'true' or v_x->>'moneyConfirmed'<>'false'
 then raise exception 'NETWORK_PAYOUT_RECOVERY_ASSERTS_CREDIT';end if;
 v_denied:=false;
 begin perform public.network_payout_bind_ambiguous_v1_1033(
  v_owner,(v_j->>'jobId')::uuid,'POPTEST000000002034','TOPTEST000000002034');
 exception when unique_violation then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_PROVIDER_REBIND_ALLOWED';end if;

 -- Refund after proven Pix never releases previously paid award.
 v_x:=public.network_payout_observe_v1_1033(v_owner,v_id,
  'POPTEST000000001033','TOPTEST000000001033','refunded','refunded');
 if v_x->>'state'<>'review' then raise exception 'NETWORK_PAYOUT_REFUND_REVIEW_REQUIRED';end if;
 update public.network_fee_package_sources_v1_1030 set
  state='reversed',reversed_at=clock_timestamp(),matured_at=null
 where kind='mobility_prepaid_fee' and source_id=v_source;
 if (select state from public.network_fee_payout_reservations_v1_1031
  where id=v_res)<>'reversal_review'
  or (select state from public.network_payout_jobs_v1_1033 where id=v_id)<>'review'
 then raise exception 'NETWORK_PAYOUT_SOURCE_REVERSAL_HELD';end if;
 if (public.network_fee_payout_status_v1_1031(v_owner,v_member)->>'availableCents')::bigint<>0
 then raise exception 'NETWORK_PAYOUT_REVERSED_AWARD_SPENDABLE';end if;
 raise notice 'V1.1033 PASS: superadmin ACL, identity evidence, policy gates, 1x dispatch, no early credits, independent proof, refund and source reversal';
end $run$;
rollback;
