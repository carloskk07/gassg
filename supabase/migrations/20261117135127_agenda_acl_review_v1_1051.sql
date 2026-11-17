-- TAMÃO Agenda V1.1051: revisao explícita de ACL sem flexibilizar readiness.
DO $agenda_review$
DECLARE
 v_posture jsonb:=public.tamao_launch_acl_posture_v1();
 v_def text;
 v_old_table text:='6d46dfe77e1245243500d8c41df885e4';
 v_old_rpc text:='b61f2207052ae8c1f47738f763c747c3';
 v_new_table text:='782bb91974d26ebd956e1325eeeeea10';
 v_new_rpc text:='71d223779f5322bd962efe9a13541a5d';
 v_count integer;
 v_rls boolean;
BEGIN
 IF v_posture->>'tableDigest' IS DISTINCT FROM v_new_table
    OR v_posture->>'rpcDigest' IS DISTINCT FROM v_new_rpc
    OR (v_posture->>'tableCount')::integer<>15
    OR (v_posture->>'rpcCount')::integer<>53
 THEN RAISE EXCEPTION 'AGENDA_V1051_ACL_FINGERPRINT_UNREVIEWED' USING ERRCODE='42501';END IF;
 SELECT count(*),bool_and(c.relrowsecurity) INTO v_count,v_rls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=ANY(ARRAY[
  'agenda_pages','agenda_services','agenda_hours','agenda_staff','agenda_appointments',
  'agenda_closed_days','agenda_staff_blocks','agenda_waitlist','agenda_booking_events'
 ]);
 IF v_count<>9 OR v_rls IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'AGENDA_V1051_RLS_REQUIRED' USING ERRCODE='42501';END IF;
 IF has_table_privilege('anon','public.agenda_waitlist','SELECT')
  OR has_table_privilege('anon','public.agenda_staff_blocks','SELECT')
  OR has_table_privilege('authenticated','public.agenda_booking_events','SELECT')
  OR has_table_privilege('authenticated','public.agenda_waitlist','INSERT')
  OR has_table_privilege('authenticated','public.agenda_waitlist','UPDATE')
  OR has_table_privilege('authenticated','public.agenda_staff_blocks','INSERT')
  OR has_table_privilege('authenticated','public.agenda_staff_blocks','DELETE')
  OR NOT has_table_privilege('authenticated','public.agenda_waitlist','SELECT')
  OR NOT has_table_privilege('authenticated','public.agenda_staff_blocks','SELECT')
  OR has_function_privilege('anon','public.agenda_join_waitlist(uuid,uuid,date,text,text,boolean)','EXECUTE')
  OR has_function_privilege('anon','public.agenda_close_waitlist(uuid,boolean)','EXECUTE')
  OR has_function_privilege('anon','public.agenda_add_staff_block(uuid,timestamptz,timestamptz)','EXECUTE')
  OR has_function_privilege('anon','public.agenda_remove_staff_block(uuid)','EXECUTE')
  OR has_function_privilege('anon','public.agenda_mark_attendance(uuid,text)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.agenda_join_waitlist(uuid,uuid,date,text,text,boolean)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.agenda_close_waitlist(uuid,boolean)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.agenda_add_staff_block(uuid,timestamptz,timestamptz)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.agenda_remove_staff_block(uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.agenda_mark_attendance(uuid,text)','EXECUTE')
  OR NOT EXISTS(select 1 from pg_trigger where tgrelid='public.agenda_appointments'::regclass
    and tgname='agenda_staff_block_booking_guard_trg' and not tgisinternal)
  OR NOT EXISTS(select 1 from pg_trigger where tgrelid='public.agenda_appointments'::regclass
    and tgname='agenda_booking_audit_trg' and not tgisinternal)
 THEN RAISE EXCEPTION 'AGENDA_V1051_SECURITY_BOUNDARY_UNREVIEWED' USING ERRCODE='42501';END IF;
 SELECT pg_get_functiondef('public.platform_launch_readiness()'::regprocedure) INTO v_def;
 IF v_def IS NULL
  OR length(v_def)-length(replace(v_def,v_old_table,''))<>length(v_old_table)
  OR length(v_def)-length(replace(v_def,v_old_rpc,''))<>length(v_old_rpc)
  OR position(v_new_table in v_def)>0 OR position(v_new_rpc in v_def)>0
 THEN RAISE EXCEPTION 'AGENDA_V1051_OLD_ACL_REFERENCE_DRIFT' USING ERRCODE='42501';END IF;
 EXECUTE replace(replace(v_def,v_old_table,v_new_table),v_old_rpc,v_new_rpc);
END $agenda_review$;
