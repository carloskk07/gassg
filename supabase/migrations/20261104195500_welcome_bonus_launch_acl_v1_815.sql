-- #815: update reviewed launch RPC posture to include two explicit welcome functions.
-- The full privilege inventory is asserted separately by the isolated ACL suite.
do $$
declare
 v_before text;
 v_after text;
begin
 if (public.tamao_launch_acl_posture_v1()->>'tableDigest')
   is distinct from '67838fe06fa43d7692e12d8e11a3de91'
   or (public.tamao_launch_acl_posture_v1()->>'tableCount')::integer <> 7
   or (public.tamao_launch_acl_posture_v1()->>'rpcDigest')
   is distinct from 'b55e7fa5756e6e673985163573731ad4'
   or (public.tamao_launch_acl_posture_v1()->>'rpcCount')::integer <> 31 then
  raise exception 'WELCOME_ACL_REVIEW_MISMATCH';
 end if;
 select pg_get_functiondef('public.platform_launch_readiness()'::regprocedure)
 into v_before;
 if position('a02c14df99ce4f9ecfc761a7d92c24b1' in v_before)=0 then
  raise exception 'LAUNCH_READINESS_OLD_DIGEST_MISSING';
 end if;
 v_after:=replace(v_before,'a02c14df99ce4f9ecfc761a7d92c24b1',
                        'b55e7fa5756e6e673985163573731ad4');
 execute v_after;
end;
$$;
