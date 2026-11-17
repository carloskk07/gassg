-- Explicit reviewed ACL baseline for TAMÃO Agenda. No changes to privileges.
DO $agenda_review$
DECLARE
 v_posture jsonb:=public.tamao_launch_acl_posture_v1();
 v_def text;
 v_old_table text:='b9af268e87e1fd2c40e7b6f18fa3b60f';
 v_old_rpc text:='6bd9d484039ed419ec4e0ae8bd14edc0';
 v_new_table text:='f741c20ee83b8e92f38028f42845d38a';
 v_new_rpc text:='e50b806b328cd292e8a01d6cbb29a061';
BEGIN
 IF v_posture->>'tableDigest' IS DISTINCT FROM v_new_table
    OR v_posture->>'rpcDigest' IS DISTINCT FROM v_new_rpc
    OR (v_posture->>'tableCount')::integer<>11
    OR (v_posture->>'rpcCount')::integer<>42
 THEN RAISE EXCEPTION 'AGENDA_ACL_NOT_EXACTLY_REVIEWED' USING ERRCODE='42501'; END IF;
 IF NOT (
   (SELECT bool_and(c.relrowsecurity) FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY[
      'agenda_pages','agenda_services','agenda_hours','agenda_appointments'])) IS TRUE
 ) THEN RAISE EXCEPTION 'AGENDA_RLS_REQUIRED' USING ERRCODE='42501';END IF;
 IF has_table_privilege('anon','public.agenda_pages','SELECT')
    OR has_table_privilege('anon','public.agenda_appointments','SELECT')
    OR has_table_privilege('authenticated','public.agenda_appointments','INSERT')
    OR has_table_privilege('authenticated','public.agenda_appointments','UPDATE')
    OR has_function_privilege('anon','public.agenda_book_slot(uuid,timestamptz,text,text,uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.agenda_book_slot(uuid,timestamptz,text,text,uuid)','EXECUTE')
    OR NOT has_function_privilege('anon','public.agenda_public_page(text)','EXECUTE')
    OR NOT has_function_privilege('anon','public.agenda_available_slots(uuid,date)','EXECUTE')
    OR NOT has_function_privilege('anon','public.agenda_public_directory()','EXECUTE')
 THEN RAISE EXCEPTION 'AGENDA_PRIVILEGE_BOUNDARY_NOT_REVIEWED' USING ERRCODE='42501';END IF;
 SELECT pg_get_functiondef('public.platform_launch_readiness()'::regprocedure) INTO v_def;
 IF v_def IS NULL
   OR length(v_def)-length(replace(v_def,v_old_table,''))<>length(v_old_table)
   OR length(v_def)-length(replace(v_def,v_old_rpc,''))<>length(v_old_rpc)
   OR position(v_new_table in v_def)>0 OR position(v_new_rpc in v_def)>0
 THEN RAISE EXCEPTION 'AGENDA_OLD_ACL_REFERENCE_DRIFT' USING ERRCODE='42501'; END IF;
 EXECUTE replace(replace(v_def,v_old_table,v_new_table),v_old_rpc,v_new_rpc);
END $agenda_review$;
