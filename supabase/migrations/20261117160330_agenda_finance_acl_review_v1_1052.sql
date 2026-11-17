-- TAMÃO V1.1052: revisão explícita de ACL financeira sem liberar cobranças.
DO $agenda_review$
DECLARE
 v_acl jsonb:=public.tamao_launch_acl_posture_v1();
 v_def text;
 v_old_table text:='782bb91974d26ebd956e1325eeeeea10';
 v_old_rpc text:='71d223779f5322bd962efe9a13541a5d';
 v_new_table text:='45caac3d2036da0b2e6cb1772436fe7d';
 v_new_rpc text:='7a1342b570ed46b605d2f7284d2e62ca';
 v_rls boolean;
 v_tables integer;
BEGIN
 IF v_acl->>'tableDigest' IS DISTINCT FROM v_new_table
    OR v_acl->>'rpcDigest' IS DISTINCT FROM v_new_rpc
    OR (v_acl->>'tableCount')::integer<>16
    OR (v_acl->>'rpcCount')::integer<>55
 THEN RAISE EXCEPTION 'AGENDA_V1052_UNREVIEWED_FINANCE_ACL' USING ERRCODE='42501';END IF;
 SELECT count(*),bool_and(c.relrowsecurity) INTO v_tables,v_rls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=ANY(ARRAY[
  'agenda_service_deposit_settings','agenda_payment_control','agenda_payment_holds',
  'agenda_payment_attempts','agenda_payment_refunds']);
 IF v_tables<>5 OR v_rls IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'AGENDA_V1052_FINANCE_RLS_MISSING' USING ERRCODE='42501';END IF;
 IF has_table_privilege('anon','public.agenda_service_deposit_settings','SELECT')
    OR has_table_privilege('authenticated','public.agenda_service_deposit_settings','INSERT')
    OR has_table_privilege('authenticated','public.agenda_service_deposit_settings','UPDATE')
    OR NOT has_table_privilege('authenticated','public.agenda_service_deposit_settings','SELECT')
    OR has_table_privilege('anon','public.agenda_payment_control','SELECT')
    OR has_table_privilege('authenticated','public.agenda_payment_control','UPDATE')
    OR has_table_privilege('authenticated','public.agenda_payment_holds','SELECT')
    OR has_table_privilege('authenticated','public.agenda_payment_holds','INSERT')
    OR has_table_privilege('authenticated','public.agenda_payment_attempts','SELECT')
    OR has_table_privilege('authenticated','public.agenda_payment_refunds','SELECT')
    OR has_function_privilege('anon','public.agenda_set_deposit_policy(uuid,smallint,text)','EXECUTE')
    OR NOT has_function_privilege('anon','public.agenda_deposit_quote(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.agenda_set_deposit_policy(uuid,smallint,text)','EXECUTE')
    OR NOT EXISTS(select 1 from pg_trigger
        where tgrelid='public.agenda_payment_holds'::regclass
        and tgname='agenda_hold_disabled_guard_trigger' and not tgisinternal)
    OR NOT EXISTS(select 1 from public.agenda_payment_control c where c.singleton
        and not c.charges_enabled and not c.oauth_recipient_homologated
        and not c.provider_webhook_homologated and not c.refunds_homologated
        and not c.reconciler_homologated and not c.live_finance_approved)
 THEN RAISE EXCEPTION 'AGENDA_V1052_FINANCE_BOUNDARY_UNREVIEWED' USING ERRCODE='42501';END IF;
 SELECT pg_get_functiondef('public.platform_launch_readiness()'::regprocedure) INTO v_def;
 IF v_def IS NULL
   OR length(v_def)-length(replace(v_def,v_old_table,''))<>length(v_old_table)
   OR length(v_def)-length(replace(v_def,v_old_rpc,''))<>length(v_old_rpc)
   OR position(v_new_table in v_def)>0 OR position(v_new_rpc in v_def)>0
 THEN RAISE EXCEPTION 'AGENDA_V1052_OLD_ACL_REFERENCE_DRIFT' USING ERRCODE='42501';END IF;
 EXECUTE replace(replace(v_def,v_old_table,v_new_table),v_old_rpc,v_new_rpc);
END $agenda_review$;
