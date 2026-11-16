\set ON_ERROR_STOP on
-- All identities, source ledgers and receipts are synthetic and ROLLBACK.
begin;
set local statement_timeout='90s';
do $t$
declare
 v_admin uuid:=gen_random_uuid();v_user uuid:=gen_random_uuid();
 v_second uuid:=gen_random_uuid();v_rogue uuid:=gen_random_uuid();
 v_source uuid:=gen_random_uuid();v_source2 uuid:=gen_random_uuid();
 v_request jsonb;v_one uuid;v_res uuid;v_two uuid;v_paid jsonb;
 v_status jsonb;v_review jsonb;v_denied boolean;v_orig timestamptz;
begin
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(v_admin,'authenticated','authenticated',false,'v1034-admin@example.invalid',clock_timestamp()),
       (v_user,'authenticated','authenticated',false,'v1034-first@example.invalid',clock_timestamp()),
       (v_second,'authenticated','authenticated',false,'v1034-second@example.invalid',clock_timestamp()),
       (v_rogue,'authenticated','authenticated',false,'v1034-rogue@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,active,admin_role)
 values(v_admin,true,'superadmin');
 if has_function_privilege('authenticated',
  'public.network_manual_payout_request_v1_1034(uuid,text)','EXECUTE')
  or has_function_privilege('anon',
  'public.network_manual_payout_mark_paid_v1_1034(uuid,uuid,bigint,text,text,text,text)','EXECUTE')
  or has_table_privilege('authenticated','public.network_manual_payout_requests_v1_1034','SELECT')
 then raise exception 'MANUAL_PAYOUT_ACL_PUBLIC';end if;
 v_status:=public.network_manual_payout_status_v1_1034(v_user);
 if v_status->>'minimumConfigured'<>'false'
   or v_status->>'canRequest'<>'false'
   or v_status->>'automaticPayouts'<>'false'
 then raise exception 'MANUAL_PAYOUT_POLICY_FAIL_CLOSED';end if;
 v_denied:=false;
 begin perform public.network_manual_payout_policy_set_v1_1034(v_rogue,500,'DEFINIR LIMITE');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_OWNER_ONLY';end if;
 v_review:=public.network_manual_payout_policy_set_v1_1034(v_admin,500,'DEFINIR LIMITE');
 if (v_review->>'minimumCents')::int<>500 or v_review->>'moneyMoved'<>'false'
 then raise exception 'MANUAL_PAYOUT_THRESHOLD_CHANGE_INVALID';end if;
 update public.network_fee_package_policy_v1_1030 set
  accrual_enabled=true,terms_approved_at=clock_timestamp(),
  terms_reference='CI-MANUAL-TERMS-NOT-LIVE-V1034' where singleton;
 insert into public.network_fee_package_sources_v1_1030
  (kind,source_id,gross_cents,net_cents,fee_credit_cents,pool_microcents,
  attributed_at,closed_at,receipt_reference,state,matured_at)
 values
 ('mobility_prepaid_fee',v_source,5000,5000,5000,500000000,
 clock_timestamp()-interval '10 days',clock_timestamp()-interval '9 days',
 'CI-MANUAL-SOURCE-PRIMARY-1034','eligible',clock_timestamp()-interval '1 day'),
 ('mobility_prepaid_fee',v_source2,5000,5000,5000,500000000,
 clock_timestamp()-interval '10 days',clock_timestamp()-interval '9 days',
 'CI-MANUAL-SOURCE-SECONDARY-1034','eligible',clock_timestamp()-interval '1 day');
 insert into public.network_fee_package_awards_v1_1030
  (kind,source_id,user_id,equal_microcents,inviter_microcents)
 values('mobility_prepaid_fee',v_source,v_user,500000000,0),
       ('mobility_prepaid_fee',v_source2,v_second,500000000,0);
 v_status:=public.network_manual_payout_status_v1_1034(v_user);
 if v_status->>'canRequest'<>'true'
    or (v_status->>'availableCents')::bigint<>500
 then raise exception 'MANUAL_PAYOUT_THRESHOLD_NOT_VALIDATED:%',v_status;end if;
 v_request:=public.network_manual_payout_request_v1_1034(v_user,
  'CI-MANUAL-REQUEST-ONE-1034');
 v_one:=(v_request->>'requestId')::uuid;
 select reservation_id into v_res from public.network_manual_payout_requests_v1_1034
 where id=v_one;
 if v_request->>'state'<>'requested' or v_request->>'moneyMoved'<>'false'
   or (v_request->>'amountCents')::bigint<>500
 then raise exception 'MANUAL_PAYOUT_REQUEST_INTEGRITY';end if;
 v_request:=public.network_manual_payout_request_v1_1034(v_user,
  'CI-MANUAL-REQUEST-ONE-1034');
 if v_request->>'alreadyRecorded'<>'true'
  or (v_request->>'requestId')::uuid<>v_one
 then raise exception 'MANUAL_PAYOUT_IDEMPOTENCY';end if;
 v_denied:=false;
 begin perform public.network_manual_payout_request_v1_1034(v_second,
  'CI-MANUAL-REQUEST-ONE-1034');
 exception when unique_violation then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_IDEMPOTENCY_CROSS_USER';end if;
 v_denied:=false;
 begin perform public.network_manual_payout_request_v1_1034(v_user,
  'CI-MANUAL-REQUEST-DUP-1034');
 exception when unique_violation then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_DUPLICATE_RESERVATION';end if;
 v_status:=public.network_manual_payout_status_v1_1034(v_user);
 if v_status->>'canRequest'<>'false' or
  (v_status->>'availableCents')::bigint<>0 or
  v_status->'request'->>'dueAt' is not null
 then raise exception 'MANUAL_PAYOUT_NOT_RESERVED_OR_PREMATURE_DEADLINE';end if;
 v_denied:=false;
 begin perform public.network_manual_payout_approve_v1_1034(
  v_admin,v_one,'IDENTIDADE E SALDO CONFERIDOS');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_APPROVED_WITHOUT_IDENTITY';end if;
 perform public.network_payout_beneficiary_register_v1_1033(
  v_admin,v_user,repeat('A',44),repeat('B',24),repeat('a',64),
  repeat('b',64),'CI-VERIFIED-ID-EXTERNAL-1034-FIRST');
 v_denied:=false;
 begin perform public.network_manual_payout_approve_v1_1034(
  v_rogue,v_one,'IDENTIDADE E SALDO CONFERIDOS');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_UNAUTHORIZED_APPROVAL';end if;
 v_review:=public.network_manual_payout_approve_v1_1034(
  v_admin,v_one,'IDENTIDADE E SALDO CONFERIDOS');
 if v_review->>'state'<>'approved' or v_review->>'moneyMoved'<>'false'
 then raise exception 'MANUAL_PAYOUT_REVIEW_MONEY_FABRICATION';end if;
 select approved_at into v_orig from public.network_manual_payout_requests_v1_1034
 where id=v_one;
 if (select due_at from public.network_manual_payout_requests_v1_1034
     where id=v_one)<>v_orig+interval '3 days'
 then raise exception 'MANUAL_PAYOUT_SLA_NOT_72_HOURS';end if;
 v_denied:=false;
 begin perform public.network_payout_prepare_v1_1033(v_admin,v_res);
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_AUTOMATED_DOUBLE_DISPATCH_ALLOWED';end if;
 v_denied:=false;
 begin perform public.network_manual_payout_cancel_v1_1034(
  v_admin,v_one,'NAO HOUVE PAGAMENTO');
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_APPROVED_RELEASED';end if;
 v_denied:=false;
 begin perform public.network_fee_payout_cancel_v1_1031(v_admin,v_res);
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_LEGACY_CANCEL_BYPASS';end if;
 v_denied:=false;
 begin perform public.network_manual_payout_mark_paid_v1_1034(
  v_admin,v_one,499,repeat('a',64),'CI-MANUAL-BANK-RECEIPT-ID-1034',
  repeat('f',64),'CONFERI PIX EXTERNO E DESTINATARIO');
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_AMOUNT_MISMATCH';end if;
 v_denied:=false;
 begin perform public.network_manual_payout_mark_paid_v1_1034(
  v_admin,v_one,500,repeat('c',64),'CI-MANUAL-BANK-RECEIPT-ID-1034',
  repeat('f',64),'CONFERI PIX EXTERNO E DESTINATARIO');
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_RECIPIENT_MISMATCH';end if;
 v_denied:=false;
 begin perform public.network_manual_payout_mark_paid_v1_1034(
  v_admin,v_one,500,repeat('a',64),'CI-MANUAL-BANK-RECEIPT-ID-1034',
  repeat('f',64),'WRONG');
 exception when invalid_parameter_value then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_UNCONFIRMED_EVIDENCE';end if;
 v_paid:=public.network_manual_payout_mark_paid_v1_1034(
  v_admin,v_one,500,repeat('a',64),'CI-MANUAL-BANK-RECEIPT-ID-1034',
  repeat('f',64),'CONFERI PIX EXTERNO E DESTINATARIO');
 if v_paid->>'state'<>'paid' or v_paid->>'providerApiCalled'<>'false'
 then raise exception 'MANUAL_PAYOUT_MANUAL_EVIDENCE_NOT_SAVED';end if;
 v_denied:=false;
 begin perform public.network_manual_payout_mark_paid_v1_1034(
  v_admin,v_one,500,repeat('a',64),'CI-MANUAL-BANK-RECEIPT-ID-1034',
  repeat('f',64),'CONFERI PIX EXTERNO E DESTINATARIO');
 exception when sqlstate '40001' then v_denied:=true;end;
 if not v_denied then raise exception 'MANUAL_PAYOUT_DOUBLE_PAID';end if;
 v_status:=public.network_manual_payout_status_v1_1034(v_user);
 if v_status->'request'->>'state'<>'paid'
   or (v_status->>'availableCents')::int<>0
 then raise exception 'MANUAL_PAYOUT_HISTORY_DISAPPEARED';end if;
 -- Second request: pending cancellation must safely release exact source.
 v_request:=public.network_manual_payout_request_v1_1034(v_second,
  'CI-MANUAL-REQUEST-TWO-1034');
 v_two:=(v_request->>'requestId')::uuid;
 v_review:=public.network_manual_payout_cancel_v1_1034(
  v_admin,v_two,'NAO HOUVE PAGAMENTO');
 if v_review->>'fundsReleased'<>'true' or
  (public.network_manual_payout_status_v1_1034(v_second)->>'availableCents')::int<>500
 then raise exception 'MANUAL_PAYOUT_CANCEL_DID_NOT_RESTORE';end if;
 update public.network_fee_package_sources_v1_1030
  set state='reversed',reversed_at=clock_timestamp(),matured_at=null
 where kind='mobility_prepaid_fee' and source_id=v_source;
 if (select state from public.network_manual_payout_requests_v1_1034
     where id=v_one)<>'review'
  or (select state from public.network_fee_payout_reservations_v1_1031
     where id=v_res)<>'reversal_review'
 then raise exception 'MANUAL_PAYOUT_REVERSED_NOT_HELD';end if;
 raise notice 'V1.1034 PASS — no default limit, verified user, one reservation, owner review, 72-hour SLA, manual evidence, no double payment, source reversal';
end $t$;
rollback;
