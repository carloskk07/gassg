-- Restore fail-closed launch posture after approved universal-only RPC body change.
do $$
declare v_before jsonb; v_launch text;
begin
 v_before:=public.tamao_launch_acl_posture_v1();
 if v_before->>'rpcDigest' is distinct from 'dec4ee10f396b0b5174d8821eb0aa181'
    or (v_before->>'rpcCount')::integer<>32
    or v_before->>'tableDigest' is distinct from '67838fe06fa43d7692e12d8e11a3de91'
 then raise exception 'UNIVERSAL_COUPON_ACL_DRIFT'; end if;
 select pg_get_functiondef('public.platform_launch_readiness()'::regprocedure)
 into v_launch;
 if position('4934a801613454115dcf015e85548c53' in v_launch)=0
 then raise exception 'UNIVERSAL_COUPON_PREVIOUS_LAUNCH_DIGEST_MISSING'; end if;
 execute replace(v_launch,'4934a801613454115dcf015e85548c53',
                          'dec4ee10f396b0b5174d8821eb0aa181');
end;
$$;
