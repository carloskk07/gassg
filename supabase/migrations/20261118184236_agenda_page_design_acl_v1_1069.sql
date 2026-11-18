-- V1.1069: review ONLY the new Agenda theme grants and RLS.
-- Existing launch protections intentionally remain fail closed on any other ACL drift.
-- Exact hash verified by the isolated canonical full-schema browser ACL test.
do $agenda_theme_review$
declare
 v_old constant text := '45caac3d2036da0b2e6cb1772436fe7d';
 v_new constant text := '7c91aa45f4006001d073aa039e6cd42b';
 v_source text;
 v_found text;
begin
 select public.tamao_launch_acl_posture_v1()->>'tableDigest' into v_found;
 if v_found is distinct from v_new then
  raise exception 'AGENDA_DESIGN_ACL_FINGERPRINT_MISMATCH: %', v_found;
 end if;
 select pg_catalog.pg_get_functiondef('public.platform_launch_readiness()'::regprocedure)
  into v_source;
 if v_source is null
  or pg_catalog.strpos(v_source,v_old)=0
  or pg_catalog.strpos(v_source,v_new)>0 then
  raise exception 'AGENDA_DESIGN_LAUNCH_GUARD_NOT_REVIEWABLE';
 end if;
 -- Rebuild the exact reviewed function; change ONLY one hash literal, never a permission.
 execute pg_catalog.replace(v_source,v_old,v_new);
 if (public.platform_launch_readiness()->'securityBlockers') ? 'browser_sensitive_table_acl' then
  raise exception 'AGENDA_DESIGN_LAUNCH_GUARD_STILL_BLOCKED';
 end if;
end
$agenda_theme_review$;
