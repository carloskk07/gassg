\set ON_ERROR_STOP on
-- Isolated PostgreSQL 17 only. Every identity and award here is synthetic,
-- no external provider call or production money movement.
begin;
set local statement_timeout='60s';
do $test$
declare
 v_owner uuid:=gen_random_uuid();v_user uuid:=gen_random_uuid();
 v_stranger uuid:=gen_random_uuid();v_source uuid:=gen_random_uuid();
 v_first jsonb;v_second jsonb;v_status jsonb;v_id uuid;v_denied boolean;
begin
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(v_owner,'authenticated','authenticated',false,'p1031-owner@example.invalid',clock_timestamp()),
 (v_user,'authenticated','authenticated',false,'p1031-member@example.invalid',clock_timestamp()),
 (v_stranger,'authenticated','authenticated',false,'p1031-stranger@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,active,admin_role)
 values(v_owner,true,'superadmin');
 if has_table_privilege('authenticated','public.network_fee_payout_reservations_v1_1031','SELECT')
  or has_table_privilege('authenticated','public.network_fee_payout_allocations_v1_1031','INSERT')
  or has_function_privilege('anon','public.network_fee_payout_reserve_v1_1031(uuid,uuid,bigint,text)','EXECUTE')
  or has_function_privilege('authenticated','public.network_fee_payout_cancel_v1_1031(uuid,uuid)','EXECUTE')
 then raise exception 'NETWORK_PAYOUT_PUBLIC_ACL_DRIFT';end if;

 -- Even a superadmin cannot reserve unapproved rewards.
 v_denied:=false;
 begin
  perform public.network_fee_payout_reserve_v1_1031(v_owner,v_user,100,'CI-RESERVE-ONE-1031');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_TERMS_BYPASS';end if;

 -- Full synthetic entitlement: 10%% of 3000 cents in microcents, with
 -- a source in eligible state. Only possible within ROLLBACK test fixtures.
 update public.network_fee_package_policy_v1_1030
   set accrual_enabled=true,terms_approved_at=clock_timestamp(),
   terms_reference='CI-TEST-TERMS-NOT-REAL' where singleton;
 insert into public.network_fee_package_sources_v1_1030
   (kind,source_id,gross_cents,net_cents,fee_credit_cents,pool_microcents,
    attributed_at,closed_at,receipt_reference,state,matured_at)
 values('mobility_prepaid_fee',v_source,3000,3000,3000,300000000,
   clock_timestamp()-interval '9 days',clock_timestamp()-interval '8 days',
   'CI-ISOLATED-NET-SOURCE-ONLY','eligible',clock_timestamp()-interval '1 day');
 insert into public.network_fee_package_awards_v1_1030
   (kind,source_id,user_id,equal_microcents,inviter_microcents)
 values('mobility_prepaid_fee',v_source,v_user,300000000,0);

 v_denied:=false;
 begin
  perform public.network_fee_payout_reserve_v1_1031(v_stranger,v_user,100,'CI-RESERVE-ONE-1031');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_ROLE_BYPASS';end if;
 v_first:=public.network_fee_payout_reserve_v1_1031(
   v_owner,v_user,100,'CI-RESERVE-ONE-1031');
 v_id:=(v_first->>'reservationId')::uuid;
 if v_first->>'state'<>'reserved' or v_first->>'moneyMoved'<>'false' or
   v_first->>'payoutProviderCalled'<>'false' or v_first->>'alreadyRecorded'<>'false'
 then raise exception 'NETWORK_PAYOUT_PREPARE_WRONG:%',v_first;end if;
 v_second:=public.network_fee_payout_reserve_v1_1031(
   v_owner,v_user,100,'CI-RESERVE-ONE-1031');
 if v_second->>'alreadyRecorded'<>'true' or
   (v_second->>'reservationId')::uuid<>v_id then
  raise exception 'NETWORK_PAYOUT_REPLAY_NOT_IDEMPOTENT';end if;
 v_denied:=false;
 begin
  perform public.network_fee_payout_reserve_v1_1031(v_owner,v_user,101,'CI-RESERVE-ONE-1031');
 exception when unique_violation then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_IDEMPOTENCY_KEY_REUSED';end if;
 v_denied:=false;
 begin
  perform public.network_fee_payout_reserve_v1_1031(v_owner,v_user,201,'CI-RESERVE-TWO-1031');
 exception when sqlstate '22023' then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_DUPLICATE_ALLOCATION';end if;
 v_status:=public.network_fee_payout_status_v1_1031(v_owner,v_user);
 if (v_status->>'availableCents')::bigint<>200
  or (v_status->>'reservedMicrocents')::bigint<>100000000
  or v_status->>'bankSettlementVerified'<>'false'
 then raise exception 'NETWORK_PAYOUT_BALANCE_NOT_CONSERVED:%',v_status;end if;
 v_denied:=false;
 begin
  perform public.network_fee_payout_cancel_v1_1031(v_stranger,v_id);
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'NETWORK_PAYOUT_CANCEL_ROLE_BYPASS';end if;
 v_second:=public.network_fee_payout_cancel_v1_1031(v_owner,v_id);
 if v_second->>'fundsReleased'<>'true' then
  raise exception 'NETWORK_PAYOUT_CANCEL_FAILED';end if;
 v_status:=public.network_fee_payout_status_v1_1031(v_owner,v_user);
 if (v_status->>'availableCents')::bigint<>300 then
  raise exception 'NETWORK_PAYOUT_CANCEL_BALANCE_MISMATCH';end if;

 v_first:=public.network_fee_payout_reserve_v1_1031(
   v_owner,v_user,300,'CI-RESERVE-THREE-1031');
 v_id:=(v_first->>'reservationId')::uuid;
 update public.network_fee_package_sources_v1_1030
   set state='reversed',reversed_at=clock_timestamp(),matured_at=null
 where kind='mobility_prepaid_fee' and source_id=v_source;
 if (select state from public.network_fee_payout_reservations_v1_1031
   where id=v_id)<>'reversal_review'
 then raise exception 'NETWORK_PAYOUT_REVERSAL_NOT_ESCALATED';end if;
 v_status:=public.network_fee_payout_status_v1_1031(v_owner,v_user);
 if (v_status->>'availableCents')::bigint<>0
   or (v_status->>'reversalReviews')::bigint<>1
   or v_status->>'payoutsEnabled'<>'false'
 then raise exception 'NETWORK_PAYOUT_REVERSAL_STILL_AVAILABLE';end if;
 if (select count(*) from public.network_fee_payout_allocations_v1_1031
   where reservation_id=v_id)<>1
 then raise exception 'NETWORK_PAYOUT_ALLOCATION_HISTORY_DELETED';end if;

 raise notice 'V1.1031 PASS: financial reservation conservation, idempotency, owner ACL, cancellation, source reversal and no bank payout';
end $test$;
rollback;
