-- Restrict the welcome award to accounts created after the campaign began.
-- Keep the exact reviewed RPC inventory synchronized with the launch safety gate.
do $$
declare v_def text; v_launch text; v_before jsonb; v_after jsonb;
begin
 v_before:=public.tamao_launch_acl_posture_v1();
 if v_before->>'rpcDigest'<>'b55e7fa5756e6e673985163573731ad4'
    or (v_before->>'rpcCount')::integer<>31 then
   raise exception 'WELCOME_BONUS_PREVIOUS_ACL_MISMATCH';
 end if;
 select pg_get_functiondef('public.claim_welcome_bonus_v1_815()'::regprocedure)
 into v_def;
 if position('select email, email_confirmed_at, is_anonymous into v_auth' in v_def)=0
    or position('v_auth.email_confirmed_at<v_campaign.starts_at' in v_def)=0 then
   raise exception 'WELCOME_BONUS_CONTRACT_DRIFT';
 end if;
 v_def:=replace(v_def,
   'select email, email_confirmed_at, is_anonymous into v_auth',
   'select email, email_confirmed_at, is_anonymous, created_at into v_auth');
 v_def:=replace(v_def,
   'v_auth.email_confirmed_at<v_campaign.starts_at then',
   'v_auth.email_confirmed_at<v_campaign.starts_at or
    v_auth.created_at<v_campaign.starts_at then');
 execute v_def;
 v_after:=public.tamao_launch_acl_posture_v1();
 if (v_after->>'rpcCount')::integer<>31 or
   (v_after->>'tableDigest') is distinct from v_before->>'tableDigest' then
   raise exception 'WELCOME_BONUS_UNEXPECTED_ACL_DRIFT';
 end if;
 select pg_get_functiondef('public.platform_launch_readiness()'::regprocedure)
 into v_launch;
 if position('b55e7fa5756e6e673985163573731ad4' in v_launch)=0 then
   raise exception 'WELCOME_BONUS_LAUNCH_BASELINE_DRIFT';
 end if;
 execute replace(v_launch,'b55e7fa5756e6e673985163573731ad4',
                          v_after->>'rpcDigest');
end;
$$;
