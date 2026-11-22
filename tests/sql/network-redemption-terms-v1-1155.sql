\set ON_ERROR_STOP on
-- TAMÃO V1.1155 — source-scoped redemption, all synthetic, rolled back.
begin;
set local statement_timeout='60s';
do $proof$
declare
 v_owner uuid:=gen_random_uuid();v_user uuid:=gen_random_uuid();
 v_ad uuid:=gen_random_uuid();v_fee uuid:=gen_random_uuid();
 v_terms jsonb;v_stat jsonb;v_admin jsonb;v_denied boolean;
begin
 if (select accrual_enabled from public.network_fee_package_policy_v1_1030 where singleton)
  or not (select accrual_enabled from public.network_ads_pool_policy_v1_1154 where singleton)
  or (select redemption_terms_approved_at is not null from public.network_ads_pool_policy_v1_1154 where singleton)
 then raise exception 'V1155_DEFAULT_ACTIVATIONS_CHANGED';end if;
 if has_function_privilege('anon','public.network_ads_pool_terms_set_v1_1155(uuid,boolean,text)','execute')
  or has_function_privilege('authenticated','public.network_source_redeemable_v1_1155(text)','execute')
  or has_function_privilege('authenticated','public.network_manual_payout_request_v1_1034(uuid,text)','execute')
 then raise exception 'V1155_RED_REDEMPTION_ACL_LEAK';end if;
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(v_owner,'authenticated','authenticated',false,'v1155-owner@example.invalid',clock_timestamp()),
       (v_user,'authenticated','authenticated',false,'v1155-user@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,admin_role,active) values(v_owner,'superadmin',true);

 -- Identical synthetic amounts from TWO independent sources in disposable DB.
 -- These rows are NOT presented as PSP receipts; ROLLBACK removes all data.
 insert into public.network_fee_package_sources_v1_1030
   (kind,source_id,buyer_user_id,gross_cents,net_cents,fee_credit_cents,
    pool_microcents,attributed_at,closed_at,receipt_reference,state,matured_at)
 values('ads_verified_view',v_ad,v_owner,200,200,200,20000000,
     clock_timestamp()-interval '10 days',clock_timestamp()-interval '8 days',
     'v1155-SYNTHETIC-ONLY-ADS','eligible',clock_timestamp()-interval '2 days'),
       ('mobility_prepaid_fee',v_fee,v_owner,200,200,200,20000000,
     clock_timestamp()-interval '10 days',clock_timestamp()-interval '8 days',
     'v1155-SYNTHETIC-ONLY-FEE','eligible',clock_timestamp()-interval '2 days');
 insert into public.network_fee_package_awards_v1_1030
  (kind,source_id,user_id,equal_microcents,inviter_microcents)
 values('ads_verified_view',v_ad,v_user,20000000,0),
       ('mobility_prepaid_fee',v_fee,v_user,20000000,0);

 if public.network_source_redeemable_v1_1155('ads_verified_view')
    or public.network_source_redeemable_v1_1155('mobility_prepaid_fee')
    or public.network_source_redeemable_v1_1155('unknown_module')
 then raise exception 'V1155_UNAPPROVED_SOURCE_IS_REDEEMABLE';end if;
 v_stat:=public.network_manual_payout_status_v1_1034(v_user);
 if (v_stat->>'availableCents')::bigint<>0 or (v_stat->>'canRequest')::boolean
 then raise exception 'V1155_BLOCKED_SOURCE_APPEARS_AVAILABLE:%',v_stat;end if;
 v_admin:=public.network_fee_payout_status_v1_1031(v_owner,v_user);
 if (v_admin->>'availableCents')::bigint<>0
 then raise exception 'V1155_ADMIN_AVAILABLE_BEFORE_APPROVAL';end if;
 v_denied:=false;
 begin
  perform public.network_ads_pool_terms_set_v1_1155(v_user,true,'V1155-ISOLATED-FAKE-TERMS');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'V1155_NONADMIN_CAN_APPROVE_TERMS';end if;
 v_denied:=false;
 begin
  perform public.network_ads_pool_terms_set_v1_1155(v_owner,true,'short');
 exception when invalid_parameter_value then v_denied:=true;end;
 if not v_denied then raise exception 'V1155_UNPUBLISHED_REFERENCE_ACCEPTED';end if;

 -- Approve Ads ONLY, in rollback, without changing merchant fee policy.
 v_terms:=public.network_ads_pool_terms_set_v1_1155(
   v_owner,true,'CI-ROLLBACK-APPROVED-ONLY-DO-NOT-PUBLISH');
 if v_terms->>'termsApproved'<>'true' or v_terms->>'moneyMoved'<>'false'
  or not public.network_source_redeemable_v1_1155('ads_verified_view')
  or public.network_source_redeemable_v1_1155('mobility_prepaid_fee')
 then raise exception 'V1155_ADS_APPROVAL_UNLOCKED_WRONG_MODULE';end if;
 v_stat:=public.network_manual_payout_status_v1_1034(v_user);
 if (v_stat->>'availableCents')::bigint<>20
  or (v_stat->>'canRequest')::boolean
  or (v_stat->>'adsTermsApproved')::boolean<>true
 then raise exception 'V1155_ADS_ONLY_BALANCE_INCORRECT:%',v_stat;end if;
 v_admin:=public.network_fee_payout_status_v1_1031(v_owner,v_user);
 if (v_admin->>'availableCents')::bigint<>20
 then raise exception 'V1155_ADS_ADMIN_BALANCE_INCORRECT';end if;
 v_terms:=public.network_ads_pool_admin_summary_v1_1154(v_owner);
 if v_terms->>'redemptionTermsApproved'<>'true'
  or v_terms->>'requiresTermsApproval'<>'false'
 then raise exception 'V1155_ADS_ADMIN_TERMS_NOT_REFLECTED';end if;

 -- Revoking Ads shuts its redemption down without undoing its accounting.
 perform public.network_ads_pool_terms_set_v1_1155(v_owner,false,null);
 v_stat:=public.network_manual_payout_status_v1_1034(v_user);
 if (v_stat->>'availableCents')::bigint<>0 or
    (select redemption_terms_reference is not null from public.network_ads_pool_policy_v1_1154 where singleton)
 then raise exception 'V1155_ADS_REVOCATION_FAILED';end if;

 -- Authorizing fee packages ONLY cannot re-enable unapproved Ads.
 perform public.network_fee_package_set_enabled_v1_1030(
   v_owner,true,'CI-ROLLBACK-FAKE-PACKAGE-TERMS-ONLY');
 if not public.network_source_redeemable_v1_1155('mobility_prepaid_fee')
    or public.network_source_redeemable_v1_1155('ads_fixed_campaign')
 then raise exception 'V1155_FEE_POLICY_UNLOCKED_ADS';end if;
 v_stat:=public.network_manual_payout_status_v1_1034(v_user);
 if (v_stat->>'availableCents')::bigint<>20
 then raise exception 'V1155_FEES_ONLY_BALANCE_INCORRECT';end if;
 perform public.network_fee_package_set_enabled_v1_1030(v_owner,false,null);
 v_stat:=public.network_manual_payout_status_v1_1034(v_user);
 if (v_stat->>'availableCents')::bigint<>0
 then raise exception 'V1155_FEES_REVOCATION_LEAK';end if;

 if (select count(*) from public.network_fee_payout_reservations_v1_1031)<>0
  or (select count(*) from public.network_manual_payout_requests_v1_1034)<>0
  or (select count(*) from public.network_payout_jobs_v1_1033)<>0
 then raise exception 'V1155_INVENTED_FINANCIAL_TRANSFER';end if;
 raise notice 'V1.1155 PASS — separate terms per source, Ads accrual preserved, no premature payout';
end $proof$;
rollback;
