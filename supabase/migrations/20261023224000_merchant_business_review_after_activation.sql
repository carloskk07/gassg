-- The owner can self-declare business/legal address while the merchant
-- is pending. Once activated, edits require a separate documented admin
-- review; otherwise a prior compliance/representation approval could be
-- reused against a newly modified identity or operating city.
DO $guard$
DECLARE
 ddl text;
 old_gate text:=$old$
    if v_role<>'owner' then
      raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
    end if;
    if jsonb_typeof(p_payload)<>'object'$old$;
 new_gate text:=$new$
    if v_role<>'owner' then
      raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
    end if;
    if v_merchant.status<>'pending' then
      raise exception 'MERCHANT_BUSINESS_REVIEW_REQUIRED' using errcode='42501';
    end if;
    if jsonb_typeof(p_payload)<>'object'$new$;
BEGIN
 SELECT pg_get_functiondef('public.merchant_config_action(uuid,uuid,text,timestamp with time zone,jsonb,text,text)'::regprocedure)
 INTO ddl;
 IF ddl IS NULL OR strpos(ddl,old_gate)=0
   OR length(ddl)-length(replace(ddl,old_gate,''))<>length(old_gate)
 THEN
   RAISE EXCEPTION 'MERCHANT_BUSINESS_GUARD_BASELINE_DRIFT_BLOCKED' USING ERRCODE='42501';
 END IF;
 EXECUTE replace(ddl,old_gate,new_gate);
END $guard$;
-- No merchant status, commerce flag, compliance review, grant or payment mutated.
