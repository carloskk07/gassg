-- TAMÃO #826: explicit review of four new participant RPCs.
-- Keep launch security deny-by-default: change ONLY the exact reviewed RPC digest,
-- after prior known baseline has been matched and the 4 new functions are audited.
DO $$
DECLARE
  v_posture jsonb := public.tamao_launch_acl_posture_v1();
  v_function text;
  v_before text := 'dec4ee10f396b0b5174d8821eb0aa181';
  v_after text := '9b6df339854577b4fa731549cc46f919';
BEGIN
  IF v_posture->>'tableDigest' <> '67838fe06fa43d7692e12d8e11a3de91'
    OR v_posture->>'rpcDigest' <> v_after
    OR (v_posture->>'rpcCount')::integer <> 36
    OR (v_posture->>'tableCount')::integer <> 7
  THEN
    RAISE EXCEPTION 'MOBILITY_ACL_REVIEW_FINGERPRINT_MISMATCH';
  END IF;

  IF NOT (
    SELECT count(*)=4 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.proname IN ('mobility_benefits_participate_v1_826',
                       'mobility_billing_catalog_v1_826',
                       'mobility_fare_accept_v1_826',
                       'mobility_fare_propose_v1_826')
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND 'search_path=pg_catalog'=ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'MOBILITY_ACL_REVIEW_PRIVILEGE_MISMATCH';
  END IF;

  v_function:=pg_get_functiondef('public.platform_launch_readiness()'::regprocedure);
  IF position(v_before IN v_function)=0 OR position(v_after IN v_function)>0
     OR length(v_function)-length(replace(v_function,v_before,''))<>length(v_before)
  THEN
    RAISE EXCEPTION 'MOBILITY_ACL_REVIEW_BASELINE_CHANGED';
  END IF;
  EXECUTE replace(v_function,v_before,v_after);
END $$;

-- The new caller signatures are reviewed; unsafe grants or changed function bodies
-- will still change the digest and block a commercial launch.
