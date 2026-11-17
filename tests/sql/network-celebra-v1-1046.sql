\set ON_ERROR_STOP on
-- Disposable CI only: no hosted Supabase writes, no Pix, rollback all fixtures.
begin;
set local statement_timeout='70s';
do $test$
declare
 v_owner uuid:=gen_random_uuid();
 v_a uuid:=gen_random_uuid();v_b uuid:=gen_random_uuid();
 v_c uuid:=gen_random_uuid();v_d uuid:=gen_random_uuid();
 v_source uuid:=gen_random_uuid();v_source_c uuid:=gen_random_uuid();
 v_result jsonb;v_bonus bigint;v_refused boolean:=false;
begin
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(v_owner,'authenticated','authenticated',false,'celebra-owner@example.invalid',clock_timestamp()),
       (v_a,'authenticated','authenticated',false,'celebra-inviter@example.invalid',clock_timestamp()),
       (v_b,'authenticated','authenticated',false,'celebra-buyer@example.invalid',clock_timestamp()),
       (v_c,'authenticated','authenticated',false,'celebra-other-inviter@example.invalid',clock_timestamp()),
       (v_d,'authenticated','authenticated',false,'celebra-other-buyer@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,active,admin_role)
 values(v_owner,true,'superadmin');

 if (select count(*) from public.network_celebra_campaigns_v1_1046)<>2
  or exists(select 1 from public.network_celebra_campaigns_v1_1046
            where enabled or authorized_at is not null or budget_limit_cents<>0)
  or exists(select 1 from public.network_celebra_awards_v1_1046)
 then raise exception 'CELEBRA_MUST_START_OFF_AND_UNFUNDED';end if;
 if has_table_privilege('authenticated','public.network_celebra_awards_v1_1046','SELECT')
   or has_table_privilege('anon','public.network_celebra_campaigns_v1_1046','UPDATE')
   or has_function_privilege('authenticated','public.network_celebra_refresh_v1_1046(uuid)','EXECUTE')
   or has_function_privilege('anon',
      'public.network_celebra_set_enabled_v1_1046(uuid,text,boolean,bigint,text)','EXECUTE')
 then raise exception 'CELEBRA_PUBLIC_FINANCIAL_ACL_LEAK';end if;

 v_result:=public.network_celebra_user_summary_v1_1046(v_a);
 if v_result->>'readOnly'<>'true'
   or v_result->>'cashPayoutsEnabled'<>'false'
   or jsonb_array_length(v_result->'items')<>0
 then raise exception 'UNAPPROVED_CELEBRATION_VISIBLE_TO_USER:%',v_result;end if;
 begin
   perform public.network_celebra_set_enabled_v1_1046(
    v_a,'natal_2026',true,100,'CI-ISOLATED-TERMS-CELEBRA');
 exception when insufficient_privilege then v_refused:=true;end;
 if not v_refused then raise exception 'NON_OWNER_CELEBRA_ACTIVATION_ACCEPTED';end if;
 v_refused:=false;
 begin
   perform public.network_celebra_set_enabled_v1_1046(
    v_owner,'natal_2026',true,100,'short');
 exception when sqlstate '22023' then v_refused:=true;end;
 if not v_refused then raise exception 'INVALID_TERMS_CELEBRA_ACCEPTED';end if;
 v_result:=public.network_celebra_set_enabled_v1_1046(
    v_owner,'natal_2026',true,100,'CI-ISOLATED-TERMS-CELEBRA');
 if v_result->>'enabled'<>'true' or v_result->>'moneyMoved'<>'false'
 then raise exception 'OWNER_CELEBRA_ACTIVATION_FAILED';end if;
 -- In local ROLLBACK, emulate the holiday window without waiting for Dec.
 update public.network_celebra_campaigns_v1_1046
 set starts_at=clock_timestamp()-interval '1 minute',
     ends_at=clock_timestamp()+interval '1 day'
 where campaign_key='natal_2026';
 insert into public.network_direct_module_awards_v1_1044
 (module,source_id,referred_user_id,inviter_user_id,net_cents,
  bonus_cents,proof_reference,qualified_at,matured_at)
 values('mobility',v_source,v_b,v_a,9900,495,'CI-NET-DIRECT-CELEBRA-1046',
  clock_timestamp(),clock_timestamp()+interval '1 day');

 v_result:=public.network_celebra_refresh_v1_1046(v_a);
 if v_result->>'created'<>'1' or v_result->>'reversed'<>'0'
     or v_result->>'cashPayoutsEnabled'<>'false' or
        v_result->>'moneyMoved'<>'false'
 then raise exception 'CELEBRA_VERIFIED_FIRST_AWARD_FAILED:%',v_result;end if;
 select bonus_cents into v_bonus from public.network_celebra_awards_v1_1046
 where campaign_key='natal_2026' and inviter_user_id=v_a;
 if v_bonus<>99 or
    (select spent_cents from public.network_celebra_campaigns_v1_1046
       where campaign_key='natal_2026')<>99
 then raise exception 'CELEBRA_NET_1_PERCENT_OR_BUDGET_WRONG:%',v_bonus;end if;
 v_result:=public.network_celebra_refresh_v1_1046(v_a);
 if v_result->>'created'<>'0'
 then raise exception 'CELEBRA_DUPLICATE_AWARD';end if;
 v_result:=public.network_celebra_user_summary_v1_1046(v_a);
 if jsonb_array_length(v_result->'items')<>1 or
     v_result->'items'->0->>'phase'<>'active' or
     (v_result->'items'->0->>'validatedCents')::bigint<>99
 then raise exception 'CELEBRA_USER_SUMMARY_WRONG:%',v_result;end if;

 -- A second independent referrer cannot exceed the single R$1 budget.
 insert into public.network_direct_module_awards_v1_1044
 (module,source_id,referred_user_id,inviter_user_id,net_cents,
  bonus_cents,proof_reference,qualified_at,matured_at)
 values('club',v_source_c,v_d,v_c,9000,450,'CI-NET-OTHER-CELEBRA-1046',
  clock_timestamp(),clock_timestamp()+interval '1 day');
 v_result:=public.network_celebra_refresh_v1_1046(v_c);
 if v_result->>'created'<>'0' or
    (select spent_cents from public.network_celebra_campaigns_v1_1046
       where campaign_key='natal_2026')<>99
 then raise exception 'CELEBRA_HARD_BUDGET_BREACH:%',v_result;end if;
 -- Pause preserves historical records; revocation remains possible after OFF.
 perform public.network_celebra_set_enabled_v1_1046(
   v_owner,'natal_2026',false,null,null);
 update public.network_direct_module_awards_v1_1044
 set status='reversed',reversed_at=clock_timestamp()
 where source_id=v_source and module='mobility';
 v_result:=public.network_celebra_refresh_v1_1046(v_a);
 if v_result->>'reversed'<>'1'
    or (select status from public.network_celebra_awards_v1_1046
        where campaign_key='natal_2026' and inviter_user_id=v_a)<>'reversed'
    or (select spent_cents from public.network_celebra_campaigns_v1_1046
        where campaign_key='natal_2026')<>0
 then raise exception 'CELEBRA_REVERSE_WHEN_OFF_FAILED:%',v_result;end if;
 v_result:=public.network_celebra_refresh_v1_1046(v_a);
 if v_result->>'reversed'<>'0' or v_result->>'created'<>'0'
 then raise exception 'CELEBRA_REPLAY_INCONSISTENT';end if;
 if exists(select 1 from public.wallet_entries
       where user_id in(v_a,v_b,v_c,v_d)) or
    exists(select 1 from public.network_manual_payout_requests_v1_1034
       where user_id in(v_a,v_c))
 then raise exception 'CELEBRA_PAID_OR_CREDITED_REAL_MONEY';end if;
end $test$;
rollback;
select 'V1.1046 PASS — OFF by default, owner-only terms, 1% NET, R$1 cap, no replay, paused reversal and no payout' as proof;
