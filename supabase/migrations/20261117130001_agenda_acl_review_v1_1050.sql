-- TAMÃO Agenda V1.1050: review new team/RPC grants, never turn off global guard.
DO $agenda_review$
DECLARE
 v_posture jsonb:=public.tamao_launch_acl_posture_v1();
 v_def text;
 v_old_table text:='815c77e75c1364560fc7743107528498';
 v_old_rpc text:='d63130f5ea783ab9360ce4ff956ff904';
 v_new_table text:='6d46dfe77e1245243500d8c41df885e4';
 v_new_rpc text:='b61f2207052ae8c1f47738f763c747c3';
BEGIN
 IF v_posture->>'tableDigest' IS DISTINCT FROM v_new_table
    OR v_posture->>'rpcDigest' IS DISTINCT FROM v_new_rpc
    OR (v_posture->>'tableCount')::integer<>13
    OR (v_posture->>'rpcCount')::integer<>48
 THEN RAISE EXCEPTION 'AGENDA_V1050_ACL_FINGERPRINT_UNREVIEWED' USING ERRCODE='42501';END IF;
 IF NOT (
  SELECT bool_and(c.relrowsecurity) FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=ANY(ARRAY[
    'agenda_pages','agenda_services','agenda_hours','agenda_staff',
    'agenda_appointments','agenda_closed_days'])
 ) THEN RAISE EXCEPTION 'AGENDA_V1050_RLS_REQUIRED' USING ERRCODE='42501';END IF;
 IF has_table_privilege('anon','public.agenda_staff','SELECT')
  OR has_table_privilege('authenticated','public.agenda_staff','DELETE')
  OR NOT has_table_privilege('authenticated','public.agenda_staff','SELECT')
  OR has_function_privilege('anon','public.agenda_reschedule_booking(uuid,timestamptz,timestamptz)','EXECUTE')
  OR has_function_privilege('anon','public.agenda_book_staff_slot(uuid,timestamptz,text,text,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.agenda_reschedule_booking(uuid,timestamptz,timestamptz)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.agenda_book_staff_slot(uuid,timestamptz,text,text,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('anon','public.agenda_available_staff_slots(uuid,date,uuid)','EXECUTE')
  OR NOT EXISTS(select 1 from pg_trigger where tgrelid='public.agenda_staff'::regclass
   and tgname='agenda_staff_write_guard_trg' and not tgisinternal)
  OR NOT EXISTS(select 1 from pg_trigger where tgrelid='public.agenda_appointments'::regclass
   and tgname='agenda_booking_staff_guard_trg' and not tgisinternal)
 THEN RAISE EXCEPTION 'AGENDA_V1050_BOUNDARY_UNREVIEWED' USING ERRCODE='42501';END IF;
 SELECT pg_get_functiondef('public.platform_launch_readiness()'::regprocedure) INTO v_def;
 IF v_def IS NULL OR length(v_def)-length(replace(v_def,v_old_table,''))<>length(v_old_table)
   OR length(v_def)-length(replace(v_def,v_old_rpc,''))<>length(v_old_rpc)
   OR position(v_new_table in v_def)>0 OR position(v_new_rpc in v_def)>0
 THEN RAISE EXCEPTION 'AGENDA_V1050_OLD_ACL_REFERENCE_DRIFT' USING ERRCODE='42501';END IF;
 EXECUTE replace(replace(v_def,v_old_table,v_new_table),v_old_rpc,v_new_rpc);
END $agenda_review$;
