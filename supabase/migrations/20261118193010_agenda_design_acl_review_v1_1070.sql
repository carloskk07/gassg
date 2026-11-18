-- V1.1070 reviewed ACL delta: split read grants into anon public + authenticated owner.
-- Keep all prior launch/security blocks active for any deviation.
do $agenda_acl_1070$
declare
 v_old constant text := '7c91aa45f4006001d073aa039e6cd42b';
 v_new constant text := '9de269f4a04d1b2dd312eedd3318419e';
 v_source text;
 v_found text;
begin
 select public.tamao_launch_acl_posture_v1()->>'tableDigest' into v_found;
 if v_found is distinct from v_new then
  raise exception 'AGENDA_V1070_ACL_FINGERPRINT_MISMATCH: %',v_found;
 end if;
 select pg_catalog.pg_get_functiondef('public.platform_launch_readiness()'::regprocedure)
 into v_source;
 if v_source is null or pg_catalog.strpos(v_source,v_old)=0 or pg_catalog.strpos(v_source,v_new)>0 then
  raise exception 'AGENDA_V1070_ACL_NOT_REVIEWABLE';
 end if;
 execute pg_catalog.replace(v_source,v_old,v_new);
 if (public.platform_launch_readiness()->'securityBlockers') ? 'browser_sensitive_table_acl' then
  raise exception 'AGENDA_V1070_ACL_STILL_BLOCKED';
 end if;
end
$agenda_acl_1070$;
