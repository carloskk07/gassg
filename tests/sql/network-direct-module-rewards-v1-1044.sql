\set ON_ERROR_STOP on
-- V1.1044: SYNTHETIC, disposable PostgreSQL only. No production account,
-- Pix, wallet, coupon subsidy, automatic payout or terms approval. ROLLBACK.
begin;
set local statement_timeout='70s';
do $test$
declare
 v_admin uuid:=gen_random_uuid();
 v_inviter uuid:=gen_random_uuid();
 v_referred uuid:=gen_random_uuid();
 v_motor uuid:=gen_random_uuid();
 v_invoice uuid:=gen_random_uuid();
 v_club_invoice uuid:=gen_random_uuid();
 v_paid_at timestamptz:=clock_timestamp()-interval '10 days';
 v_result jsonb;v_bonus bigint;v_denied boolean:=false;
begin
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values (v_admin,'authenticated','authenticated',false,'direct-admin@example.invalid',clock_timestamp()),
        (v_inviter,'authenticated','authenticated',false,'direct-inviter@example.invalid',clock_timestamp()),
        (v_referred,'authenticated','authenticated',false,'direct-customer@example.invalid',clock_timestamp()),
        (v_motor,'authenticated','authenticated',false,'direct-motor@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,active,admin_role)
 values(v_admin,true,'superadmin');
 insert into public.profiles(user_id,referral_code)
 values(v_inviter,'NTWDIRECT1044')
 on conflict(user_id) do update set referral_code=excluded.referral_code;

 if exists(select 1 from public.network_direct_module_policy_v1_1044 where enabled)
    or exists(select 1 from public.network_direct_module_awards_v1_1044)
 then raise exception 'DIRECT_BONUS_DEFAULT_MUST_BE_DISABLED';end if;
 if has_table_privilege('anon','public.network_direct_module_awards_v1_1044','SELECT')
    or has_table_privilege('authenticated','public.network_direct_module_awards_v1_1044','INSERT')
    or has_table_privilege('authenticated','public.network_direct_module_policy_v1_1044','UPDATE')
    or has_function_privilege('authenticated',
      'public.network_direct_module_refresh_v1_1044(uuid)','EXECUTE')
    or has_function_privilege('anon',
      'public.network_direct_module_set_enabled_v1_1044(uuid,text,boolean,text)','EXECUTE')
 then raise exception 'DIRECT_BONUS_PUBLIC_FINANCE_ACL_LEAK';end if;

 if (public.network_module_bind_invite_v1_1041(v_motor,'NTWDIRECT1044')->>'recorded')<>'true'
    or (public.network_module_bind_invite_v1_1041(v_referred,'NTWDIRECT1044')->>'recorded')<>'true'
 then raise exception 'DIRECT_BONUS_INVITE_BIND_FAILED';end if;
 -- Backdating is only allowed in a disposable fixture. Production never
 -- receives retroactive bonus for historic buyers.
 update public.network_module_invite_bindings_v1_1041
 set bound_at=v_paid_at-interval '1 day'
 where referred_user_id in (v_motor,v_referred);

 v_result:=public.network_direct_module_refresh_v1_1044(v_inviter);
 if v_result->>'createdMobility'<>'0' or v_result->>'createdClub'<>'0'
 then raise exception 'DISABLED_DIRECT_AWARD_CREATED:%',v_result;end if;
 begin
  perform public.network_direct_module_set_enabled_v1_1044(v_inviter,'mobility',true,'SYNTHETIC-CI-TERMS');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'UNAUTHORIZED_DIRECT_MODULE_ENABLE';end if;
 v_denied:=false;
 begin
  perform public.network_direct_module_set_enabled_v1_1044(v_admin,'mobility',true,'short');
 exception when sqlstate '22023' then v_denied:=true;end;
 if not v_denied then raise exception 'UNAPPROVED_TERMS_ACCEPTED';end if;
 v_result:=public.network_direct_module_set_enabled_v1_1044(
   v_admin,'mobility',true,'CI-TERMS-NOT-PUBLISHED-1044');
 if v_result->>'enabled'<>'true' or v_result->>'moneyMoved'<>'false'
 then raise exception 'DIRECT_MOBILITY_OWNER_POLICY_FAILED';end if;
 perform public.network_direct_module_set_enabled_v1_1044(
   v_admin,'club',true,'CI-TERMS-NOT-PUBLISHED-CLUB');
 update public.network_direct_module_policy_v1_1044
 set effective_after=v_paid_at-interval '1 day'
 where module in ('mobility','club');

 -- Paid and fully used mobility package with independent NET evidence.
 insert into public.mobility_fee_pix_invoices_v1_837(
  id,driver_id,external_reference,amount_cents,status,provider,
  provider_order_id,provider_payment_id,paid_at,provider_evidence_hash,
  invoice_kind,plan_key,plan_fee_bps,grant_cents)
 values(v_invoice,v_motor,'mobility-fee:'||v_invoice::text,990,
  'paid','mercadopago','CI-ORDER-DIRECT-1044','876543218888',
  v_paid_at,repeat('a',64),'prepaid_credit','essential',600,990);
 insert into public.mobility_fee_prepaid_lots_v1_838(
  invoice_id,driver_id,plan_key,fee_bps,funded_cents,reserved_cents,spent_cents,status)
 values(v_invoice,v_motor,'essential',600,990,0,990,'active');
 insert into public.platform_receipt_net_audit(
  kind,resource_id,gross_cents,net_cents,seller_id,provider_order_id,
  provider_payment_id,external_reference,release_at,report_sha256,evidence_reference)
 values('mobility',v_invoice,990,950,'222333445','CI-ORDER-DIRECT-1044',
  '876543218888','mobility-fee:'||v_invoice::text,v_paid_at+interval '8 hours',
  repeat('b',64),'mp-release:CI-ONLY-DIRECT.csv:876543218888');
 insert into public.platform_receipt_net_observations(kind,resource_id,status,reason)
 values('mobility',v_invoice,'net_verified','CI_SYNTHETIC_DIRECT');

 v_result:=public.network_direct_module_refresh_v1_1044(v_inviter);
 if v_result->>'createdMobility'<>'1' or v_result->>'createdClub'<>'0'
    or v_result->>'moneyMoved'<>'false' or v_result->>'cashPayoutsEnabled'<>'false'
 then raise exception 'DIRECT_VERIFIED_MOBILITY_NOT_AWARDED:%',v_result;end if;
 select bonus_cents into v_bonus from public.network_direct_module_awards_v1_1044
 where module='mobility' and source_id=v_invoice;
 if v_bonus<>47 then raise exception 'DIRECT_BONUS_NOT_5_PERCENT_OF_NET:%',v_bonus;end if;
 v_result:=public.network_direct_module_refresh_v1_1044(v_inviter);
 if v_result->>'createdMobility'<>'0' then raise exception 'DIRECT_DUPLICATE_AWARD';end if;

 -- Owner-subsidized Club coupon may show a paid/net-verified source, but is
 -- NOT funded by a merchant and must NEVER generate a direct cash bonus.
 insert into public.clube_coupon_paid_invoices(
  id,customer_user_id,package_key,request_id,sale_price_cents,
  coupon_face_cents,coupons_per_pack,valid_days,status,paid_at,
  net_proceeds_cents,net_proceeds_reference,net_proceeds_verified_at,
  sponsor_covered_cents,funding_mode_v1_846)
 values(v_club_invoice,v_referred,'all_products_3x5_sponsor',gen_random_uuid(),
  890,500,3,90,'paid',v_paid_at,
  820,'CI-ONLY-OWNER-SPONSORED',v_paid_at+interval '1 hour',680,'platform_reimbursed');
 v_result:=public.network_direct_module_refresh_v1_1044(v_inviter);
 if v_result->>'createdClub'<>'0' or
  exists(select 1 from public.network_direct_module_awards_v1_1044
    where module='club') then raise exception 'SUBSIDIZED_COUPON_PAID_REFERRAL';end if;
 v_result:=public.network_direct_module_summary_v1_1044(v_inviter);
 if v_result->>'cashPayoutsEnabled'<>'false'
    or v_result->'modules'->'mobility'->>'validatedAwards'<>'1'
    or v_result->'modules'->'mobility'->>'validatedCents'<>'47'
    or v_result->'modules'->'club'->>'validatedAwards'<>'0'
 then raise exception 'DIRECT_USER_READBACK_MISMATCH:%',v_result;end if;
 v_result:=public.network_direct_module_admin_v1_1044(v_admin);
 if v_result->>'readOnly'<>'true' or
    v_result->'modules'->'mobility'->>'validatedAwards'<>'1'
 then raise exception 'DIRECT_ADMIN_READBACK_MISMATCH:%',v_result;end if;

 -- Even when disabled, reconcile and REVERSE the prior bonus after PSP dispute.
 perform public.network_direct_module_set_enabled_v1_1044(v_admin,'mobility',false,null);
 update public.platform_receipt_net_observations
 set status='reversed',reason='CI_SYNTHETIC_REVERSAL' where kind='mobility' and resource_id=v_invoice;
 v_result:=public.network_direct_module_refresh_v1_1044(v_inviter);
 if v_result->>'reversed'<>'1' or v_result->>'createdMobility'<>'0' or
    (select status from public.network_direct_module_awards_v1_1044
      where module='mobility' and source_id=v_invoice)<>'reversed'
 then raise exception 'PAUSED_DIRECT_REVERSAL_FAILED:%',v_result;end if;
 v_result:=public.network_direct_module_refresh_v1_1044(v_inviter);
 if v_result->>'reversed'<>'0' then raise exception 'REVERSAL_REPLAY_NOT_IDEMPOTENT';end if;
end $test$;
rollback;
select 'V1.1044 PASS — paid mobility NET 5%, owner-subsidized Club blocked, role ACL, replay, paused reversal, no cash' as proof;
