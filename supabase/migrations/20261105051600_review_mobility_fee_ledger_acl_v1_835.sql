-- #835 — approve only the reviewed catalogue RPC body for driver fee history.
-- Digest derived read-only from the live pg_proc inventory with replacement
-- of exactly mobility_billing_catalog_v1_826.prosrc, without DB mutation.
do $$
declare
 v_posture jsonb:=public.tamao_launch_acl_posture_v1();
 v_old text:='3556fbf9d034891941dbc7713892c65d';
 v_new text:='01c829e82b34ca4ca60d1c6ece7da1ba';
 v_fn text;
begin
 if v_posture->>'tableDigest'<>'67838fe06fa43d7692e12d8e11a3de91'
  or (v_posture->>'tableCount')::integer<>7
  or (v_posture->>'rpcCount')::integer<>36
  or v_posture->>'rpcDigest'<>v_new
 then raise exception 'MOBILITY_FEE_LEDGER_ACL_NOT_REVIEWED';end if;
 if not has_function_privilege('authenticated','public.mobility_billing_catalog_v1_826()','EXECUTE')
  or has_function_privilege('anon','public.mobility_billing_catalog_v1_826()','EXECUTE')
  or has_table_privilege('authenticated','public.mobility_platform_fee_accruals_v1_835','SELECT')
  or has_table_privilege('anon','public.mobility_platform_fee_accruals_v1_835','SELECT')
 then raise exception 'MOBILITY_FEE_LEDGER_BROWSER_EXPOSURE';end if;
 v_fn:=pg_get_functiondef('public.mobility_billing_catalog_v1_826()'::regprocedure);
 if position('mobility_platform_fee_accruals_v1_835' in v_fn)=0
    or position('a.driver_id=(select auth.uid())' in v_fn)=0
 then raise exception 'MOBILITY_FEE_DRIVER_SCOPE_MISSING';end if;
 v_fn:=pg_get_functiondef('public.platform_launch_readiness()'::regprocedure);
 if position(v_old in v_fn)=0 or position(v_new in v_fn)>0
 or length(v_fn)-length(replace(v_fn,v_old,''))<>length(v_old)
 then raise exception 'MOBILITY_FEE_LEDGER_BASELINE_CHANGED';end if;
 execute replace(v_fn,v_old,v_new);
end $$;
