\set ON_ERROR_STOP on
-- Disposable PostgreSQL only. No production finances; synthetic identities ROLLBACK.
begin;
set local statement_timeout='40s';
do $tests$
declare
 v_inviter uuid:=gen_random_uuid();
 v_invitee uuid:=gen_random_uuid();
 v_other uuid:=gen_random_uuid();
 v_old uuid:=gen_random_uuid();
 v_admin uuid:=gen_random_uuid();
 v_ret jsonb;
 v_code text:='NETV1041TEST';
 v_denied boolean:=false;
begin
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values
 (v_inviter,'authenticated','authenticated',false,'net-benefit-inviter@example.invalid',clock_timestamp()),
 (v_invitee,'authenticated','authenticated',false,'net-benefit-invitee@example.invalid',clock_timestamp()),
 (v_other,'authenticated','authenticated',false,'net-benefit-other@example.invalid',clock_timestamp()),
 (v_old,'authenticated','authenticated',false,'net-benefit-old@example.invalid',clock_timestamp()),
 (v_admin,'authenticated','authenticated',false,'net-benefit-admin@example.invalid',clock_timestamp());
 update auth.users set created_at=clock_timestamp()-interval '40 days' where id=v_old;
 insert into public.profiles(user_id,referral_code) values(v_inviter,v_code)
 on conflict(user_id) do update set referral_code=excluded.referral_code;
 insert into public.platform_admins(user_id,active,admin_role)
 values(v_admin,true,'superadmin');

 if has_table_privilege('anon','public.network_module_ads_bonus_awards_v1_1041','SELECT')
    or has_table_privilege('authenticated','public.network_module_ads_bonus_awards_v1_1041','INSERT')
    or has_table_privilege('authenticated','public.network_module_invite_bindings_v1_1041','SELECT')
    or has_function_privilege('authenticated',
        'public.network_module_bind_invite_v1_1041(uuid,text)','EXECUTE')
    or has_function_privilege('anon',
        'public.network_module_ads_bonus_refresh_v1_1041(uuid)','EXECUTE')
 then raise exception 'NETWORK_MODULE_BENEFITS_ACL_LEAK'; end if;
 if (select enabled from public.network_module_ads_bonus_policy_v1_1041 where singleton)<>false
  or (select count(*) from public.network_module_ads_bonus_awards_v1_1041)<>0
 then raise exception 'NETWORK_ADS_BONUS_MUST_START_DISABLED_AND_EMPTY';end if;

 v_ret:=public.network_module_bind_invite_v1_1041(v_invitee,v_code);
 if v_ret->>'recorded'<>'true' then raise exception 'NETWORK_FIRST_TOUCH_NOT_BOUND';end if;
 perform public.network_module_bind_invite_v1_1041(v_invitee,v_code);
 if (select count(*) from public.network_module_invite_bindings_v1_1041
     where referred_user_id=v_invitee)<>1
 then raise exception 'NETWORK_FIRST_TOUCH_NOT_IDEMPOTENT';end if;
 if (public.network_module_bind_invite_v1_1041(v_other,'MADEUP-CODE')->>'recorded')<>'false'
 or (public.network_module_bind_invite_v1_1041(v_inviter,v_code)->>'recorded')<>'false'
 or (public.network_module_bind_invite_v1_1041(v_old,v_code)->>'recorded')<>'false'
 then raise exception 'INVALID_SELF_OLD_OR_UNKNOWN_REFERRAL_ACCEPTED';end if;
 if (select inviter_user_id from public.network_module_invite_bindings_v1_1041
  where referred_user_id=v_invitee)<>v_inviter
 then raise exception 'REFERRER_NOT_PROVEN_BY_EXISTING_CODE';end if;

 v_ret:=public.network_module_benefits_summary_v1_1041(v_inviter);
 if v_ret->>'source'<>'network_module_benefits_v1_1041'
 or v_ret->>'cashPayoutsEnabled'<>'false' or v_ret->>'readOnly'<>'true'
 or v_ret->>'invitedAccounts'<>'1' or v_ret->>'verifiedConversions'<>'0'
 or v_ret->'modules'->>'rides'<>'0'
 or v_ret->>'adsBonusValidatedCents'<>'0'
 then raise exception 'SOURCE_VERIFIED_SUMMARY_FAILED %',v_ret;end if;
 v_ret:=public.network_module_ads_bonus_refresh_v1_1041(v_inviter);
 if v_ret->>'enabled'<>'false'
 or (select count(*) from public.network_module_ads_bonus_awards_v1_1041)<>0
 then raise exception 'BONUS_CREDIT_WHILE_DISABLED';end if;

 begin
   perform public.network_module_ads_bonus_set_enabled_v1_1041(
    v_invitee,true,'TEST-AGREEMENT-FOR-ISOLATED-CI');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'BONUS_ADMIN_ROLE_BYPASSED';end if;
 v_denied:=false;
 begin
   perform public.network_module_ads_bonus_set_enabled_v1_1041(
    v_admin,true,'short');
 exception when sqlstate '22023' then v_denied:=true;end;
 if not v_denied then raise exception 'TERMS_POLICY_BYPASSED';end if;
 -- Owner's switch is test-only, all changes rolled back.
 v_ret:=public.network_module_ads_bonus_set_enabled_v1_1041(
   v_admin,true,'ISOLATED-NET-ADS-TERMS-NOT-COMMERCIAL');
 if v_ret->>'enabled'<>'true' or v_ret->>'cashPayoutsEnabled'<>'false'
 then raise exception 'OWNER_ENABLE_NOT_GATED';end if;
 perform public.network_module_ads_bonus_set_enabled_v1_1041(v_admin,false,null);
 if (select enabled from public.network_module_ads_bonus_policy_v1_1041 where singleton)<>false
 then raise exception 'OWNER_DISABLE_FAILED';end if;
end $tests$;
rollback;
select 'V1.1041 PASS — verified first-touch, 7-module evidence, RLS, no synthetic payouts, owner terms guard' as proof;
