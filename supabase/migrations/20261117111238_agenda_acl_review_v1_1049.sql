-- TAMÃO V1.1049: explicitly reviewed ACL fingerprints on disposable full schema.
-- Only approve exact inspected table policies, RPCs, immutable SQL bodies, and grants.
DO $agenda_review$
DECLARE
 v_posture jsonb:=public.tamao_launch_acl_posture_v1();
 v_def text;
 v_old_table text:='f741c20ee83b8e92f38028f42845d38a';
 v_old_rpc text:='e50b806b328cd292e8a01d6cbb29a061';
 v_new_table text:='815c77e75c1364560fc7743107528498';
 v_new_rpc text:='d63130f5ea783ab9360ce4ff956ff904';
BEGIN
 IF v_posture->>'tableDigest' IS DISTINCT FROM v_new_table
   OR v_posture->>'rpcDigest' IS DISTINCT FROM v_new_rpc
   OR (v_posture->>'tableCount')::integer<>12
   OR (v_posture->>'rpcCount')::integer<>45
 THEN RAISE EXCEPTION 'AGENDA_V1049_ACL_FINGERPRINT_UNREVIEWED' USING ERRCODE='42501';END IF;
 IF NOT (
   SELECT bool_and(c.relrowsecurity) FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname=ANY(ARRAY[
    'agenda_pages','agenda_services','agenda_hours',
    'agenda_appointments','agenda_closed_days'])
 ) THEN RAISE EXCEPTION 'AGENDA_V1049_RLS_REQUIRED' USING ERRCODE='42501';END IF;
 IF has_table_privilege('anon','public.agenda_closed_days','SELECT')
  OR has_table_privilege('authenticated','public.agenda_closed_days','INSERT')
  OR has_table_privilege('authenticated','public.agenda_closed_days','UPDATE')
  OR has_table_privilege('authenticated','public.agenda_closed_days','DELETE')
  OR NOT has_table_privilege('authenticated','public.agenda_closed_days','SELECT')
  OR has_function_privilege('anon','public.agenda_set_closed_day(date,boolean)','EXECUTE')
  OR has_function_privilege('anon','public.agenda_my_bookings()','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.agenda_set_closed_day(date,boolean)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.agenda_my_bookings()','EXECUTE')
  OR NOT has_function_privilege('anon','public.agenda_day_is_closed(uuid,date)','EXECUTE')
  OR NOT EXISTS(
   SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.agenda_appointments'::regclass
    AND tgname='agenda_bookings_closed_day_guard' AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'AGENDA_V1049_BOUNDARY_UNREVIEWED' USING ERRCODE='42501';END IF;
 SELECT pg_get_functiondef('public.platform_launch_readiness()'::regprocedure) INTO v_def;
 IF v_def IS NULL
   OR length(v_def)-length(replace(v_def,v_old_table,''))<>length(v_old_table)
   OR length(v_def)-length(replace(v_def,v_old_rpc,''))<>length(v_old_rpc)
   OR position(v_new_table in v_def)>0
   OR position(v_new_rpc in v_def)>0
 THEN RAISE EXCEPTION 'AGENDA_V1049_OLD_ACL_REFERENCE_DRIFT' USING ERRCODE='42501';END IF;
 EXECUTE replace(replace(v_def,v_old_table,v_new_table),v_old_rpc,v_new_rpc);
END $agenda_review$;
