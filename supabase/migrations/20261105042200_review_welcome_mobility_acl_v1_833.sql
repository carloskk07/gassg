-- #833 — revisão expressa da nova superfície ACL e origem do bônus.
-- O lote do prêmio é consumido pela própria wallet_entries; novas funções
-- auxiliares são PRIVADAS e as RPCs de passageiro mantêm sua assinatura.
DO $$
declare
 v_posture jsonb:=public.tamao_launch_acl_posture_v1();
 v_old text:='1f283b221062cbd3ce667ecac1cb62af';
 v_new text:='3556fbf9d034891941dbc7713892c65d';
 v_func text;
begin
 if v_posture->>'tableDigest'<>'67838fe06fa43d7692e12d8e11a3de91'
  or (v_posture->>'tableCount')::integer<>7
  or (v_posture->>'rpcCount')::integer<>36
  or v_posture->>'rpcDigest'<>v_new
 then raise exception 'MOBILITY_WELCOME_REVIEW_FINGERPRINT_MISMATCH';end if;
 if has_function_privilege('anon','public.mobility_fare_accept_v1_826(uuid,integer)','EXECUTE')
  or not has_function_privilege('authenticated','public.mobility_fare_accept_v1_826(uuid,integer)','EXECUTE')
  or has_function_privilege('anon','public.mobility_snapshot(uuid)','EXECUTE')
  or not has_function_privilege('authenticated','public.mobility_snapshot(uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.mobility_welcome_eligible_v1_833(uuid,uuid,integer)','EXECUTE')
  or has_function_privilege('anon','public.mobility_welcome_eligible_v1_833(uuid,uuid,integer)','EXECUTE')
  or has_table_privilege('authenticated','public.mobility_welcome_uses_v1_833','SELECT')
  or has_table_privilege('anon','public.mobility_welcome_uses_v1_833','SELECT')
 then raise exception 'MOBILITY_WELCOME_REVIEW_GRANTS_CHANGED';end if;
 if position('MOBILITY_WELCOME_RESERVE_UNRECONCILED' in
    pg_get_functiondef('public.mobility_fare_accept_v1_826(uuid,integer)'::regprocedure))=0
 or position('MOBILITY_WELCOME_RELEASE_UNRECONCILED' in
    pg_get_functiondef('public.mobility_welcome_settle_v1_833()'::regprocedure))=0
 then raise exception 'MOBILITY_WELCOME_REVIEW_RECONCILIATION_MISSING';end if;
 v_func:=pg_get_functiondef('public.platform_launch_readiness()'::regprocedure);
 if position(v_old in v_func)=0 or position(v_new in v_func)>0
    or length(v_func)-length(replace(v_func,v_old,''))<>length(v_old)
 then raise exception 'MOBILITY_WELCOME_REVIEW_BASELINE_CHANGED';end if;
 execute replace(v_func,v_old,v_new);
end $$;
