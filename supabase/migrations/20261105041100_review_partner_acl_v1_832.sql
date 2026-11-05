-- #832: revisão explícita e fail-closed da superfície RPC autenticada.
-- A alteração é do CORPO das duas funções já autenticadas, nunca da permissão.
DO $$
declare
 v_posture jsonb := public.tamao_launch_acl_posture_v1();
 v_func text;
 v_old text := '9b6df339854577b4fa731549cc46f919';
 v_new text := '1f283b221062cbd3ce667ecac1cb62af';
begin
 if v_posture->>'tableDigest'<>'67838fe06fa43d7692e12d8e11a3de91'
 or (v_posture->>'tableCount')::integer<>7
 or (v_posture->>'rpcCount')::integer<>36
 or v_posture->>'rpcDigest'<>v_new
 then raise exception 'PARTNER_PROGRAM_ACL_FINGERPRINT_NOT_REVIEWED';end if;
 if not has_function_privilege('authenticated','public.mobility_benefits_participate_v1_826(boolean,integer)','EXECUTE')
 or has_function_privilege('anon','public.mobility_benefits_participate_v1_826(boolean,integer)','EXECUTE')
 or not has_function_privilege('authenticated','public.mobility_billing_catalog_v1_826()','EXECUTE')
 or has_function_privilege('anon','public.mobility_billing_catalog_v1_826()','EXECUTE')
 then raise exception 'PARTNER_PROGRAM_RPC_PRIVILEGES_CHANGED';end if;
 v_func:=pg_get_functiondef('public.platform_launch_readiness()'::regprocedure);
 if position(v_old in v_func)=0 or position(v_new in v_func)>0
  or length(v_func)-length(replace(v_func,v_old,''))<>length(v_old)
 then raise exception 'PARTNER_PROGRAM_LAUNCH_BASELINE_CHANGED';end if;
 execute replace(v_func,v_old,v_new);
end $$;
