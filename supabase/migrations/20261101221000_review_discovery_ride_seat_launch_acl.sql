-- Review the exact new privileged-function inventory, without disabling
-- launch fingerprint enforcement or changing any other readiness condition.
-- This is the canonical disposable full-schema result with one added
-- owner-scoped authenticated RPC and unchanged table ACL.
do $ride_launch_acl$
declare
 v_current jsonb:=public.tamao_launch_acl_posture_v1();
 v_old text:='''d795df150e91d9d758b6ccb4fd0386cd''';
 v_new text:='''820687783f9ba7ff7891facb891067f6''';
 v_def text;
begin
 if v_current->>'tableDigest'<>'67838fe06fa43d7692e12d8e11a3de91'
  or (v_current->>'tableCount')::integer<>7
  or v_current->>'rpcDigest'<>'820687783f9ba7ff7891facb891067f6'
  or (v_current->>'rpcCount')::integer<>29
 then raise exception 'RIDE_LAUNCH_FINGERPRINT_DRIFT' using errcode='42501';end if;
 select pg_catalog.pg_get_functiondef('public.platform_launch_readiness()'::pg_catalog.regprocedure)
 into v_def;
 if v_def is null or pg_catalog.strpos(v_def,v_old)=0
  or pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,''))
   <>pg_catalog.length(v_old)
 then raise exception 'RIDE_LAUNCH_EXPECTED_BASELINE_MISSING' using errcode='42501';end if;
 execute pg_catalog.replace(v_def,v_old,v_new);
 -- Unknown subsequent SECURITY DEFINER additions still change the digest
 -- and block commercial readiness; no toggle or allow-all path is introduced.
end $ride_launch_acl$;
