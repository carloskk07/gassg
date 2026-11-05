-- #837: explicit security digest review after modifying only the
-- authenticated mobility billing catalogue body and adding PRIVATE functions.
do $$
declare
 v_posture jsonb:=public.tamao_launch_acl_posture_v1();
 v_fn text;
 v_old text:='01c829e82b34ca4ca60d1c6ece7da1ba';
 v_new text:='b33aa22d7054c32af1bc789b2646347a';
begin
 if (v_posture->>'rpcCount')::int<>36
 or v_posture->>'rpcDigest'<>v_new
 or (v_posture->>'tableCount')::int<>7
 or v_posture->>'tableDigest'<>'67838fe06fa43d7692e12d8e11a3de91'
 then raise exception 'MOBILITY_FEE_PIX_ACL_NOT_REVIEWED';end if;
 if has_function_privilege('authenticated','public.mobility_fee_pix_prepare_v1_837(uuid)','EXECUTE')
 or has_function_privilege('anon','public.mobility_fee_pix_apply_proof_v1_837(uuid,text,text,integer,text,text)','EXECUTE')
 or has_function_privilege('authenticated','public.mobility_fee_pix_commit_v1_837(uuid,uuid,text,text,text,text,text,timestamptz)','EXECUTE')
 or has_table_privilege('authenticated','public.mobility_fee_pix_invoices_v1_837','SELECT')
 or has_table_privilege('anon','public.mobility_fee_pix_invoice_lines_v1_837','SELECT')
 or not has_function_privilege('authenticated','public.mobility_billing_catalog_v1_826()','EXECUTE')
 then raise exception 'MOBILITY_FEE_PIX_BROWSER_EXPOSURE';end if;
 v_fn:=pg_get_functiondef('public.mobility_billing_catalog_v1_826()'::regprocedure);
 if position('mobility_fee_pix_invoices_v1_837' in v_fn)=0
 or position('i.driver_id=(select auth.uid())' in v_fn)=0
 then raise exception 'MOBILITY_FEE_PIX_DRIVER_AUTH_SCOPE_MISSING';end if;
 v_fn:=pg_get_functiondef('public.platform_launch_readiness()'::regprocedure);
 if position(v_old in v_fn)=0 or position(v_new in v_fn)>0
 or length(v_fn)-length(replace(v_fn,v_old,''))<>length(v_old)
 then raise exception 'MOBILITY_FEE_PIX_BASELINE_CHANGED';end if;
 execute replace(v_fn,v_old,v_new);
end $$;
