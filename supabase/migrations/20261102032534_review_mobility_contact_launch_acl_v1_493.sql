-- #493: A security-reviewed change to one existing authenticated
-- SECURITY DEFINER RPC: participant-scoped mobility_snapshot(uuid).
-- No new table grants, no new SECURITY DEFINER functions, no new role
-- privileges, and no weakening of any unrelated launch readiness gate.
-- A local full-schema CI run proved this exact digest after the contact
-- field was added; only this reviewed delta may update the launch baseline.
do $mobility_contact_review$
declare
 v_current jsonb:=public.tamao_launch_acl_posture_v1();
 v_old text:='''820687783f9ba7ff7891facb891067f6''';
 v_new text:='''a02c14df99ce4f9ecfc761a7d92c24b1''';
 v_def text;
 v_rpc text;
begin
 if v_current->>'tableDigest'<>'67838fe06fa43d7692e12d8e11a3de91'
  or (v_current->>'tableCount')::integer<>7
  or v_current->>'rpcDigest'<>'a02c14df99ce4f9ecfc761a7d92c24b1'
  or (v_current->>'rpcCount')::integer<>29
 then raise exception 'MOBILITY_CONTACT_UNREVIEWED_SCHEMA_DRIFT'
   using errcode='42501';end if;
 -- Check the exact review subject, not just a global hash.
 if has_function_privilege('anon','public.mobility_snapshot(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.mobility_snapshot(uuid)','EXECUTE')
 then raise exception 'MOBILITY_CONTACT_RPC_ROLE_DRIFT' using errcode='42501';end if;
 select pg_catalog.pg_get_functiondef('public.mobility_snapshot(uuid)'::pg_catalog.regprocedure)
 into v_rpc;
 if v_rpc is null or
  pg_catalog.strpos(v_rpc,'''driver_whatsapp''')=0 or
  pg_catalog.strpos(v_rpc,'accepted')=0 or
  pg_catalog.strpos(v_rpc,'auth.uid()')=0 or
  pg_catalog.strpos(v_rpc,'whatsapp_e164')=0 or
  pg_catalog.strpos(v_rpc,'public.mobility_driver_category_current')=0
 then raise exception 'MOBILITY_CONTACT_SNAPSHOT_NOT_REVIEWED'
  using errcode='42501';end if;
 select pg_catalog.pg_get_functiondef('public.platform_launch_readiness()'::pg_catalog.regprocedure)
 into v_def;
 if v_def is null or pg_catalog.strpos(v_def,v_old)=0
   or pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,''))
      <>pg_catalog.length(v_old)
 then raise exception 'MOBILITY_CONTACT_OLD_BASELINE_NOT_UNIQUE'
  using errcode='42501';end if;
 execute pg_catalog.replace(v_def,v_old,v_new);
end $mobility_contact_review$;
