-- V1.921: restore Admin financial evidence WITHOUT granting raw payout-table SELECT.
-- The two V1.263/V1.265 tables intentionally revoke service_role reads.
-- An owner-scoped aggregate is the sole new financial-read capability.
BEGIN;
CREATE OR REPLACE FUNCTION platform_referral_payout_private_v1_263.finance_counts_v1_921(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $fn$
DECLARE
 v_claims bigint;
 v_observations bigint;
 v_bank_evidence bigint;
BEGIN
 PERFORM platform_referral_payout_private_v1_263.assert_owner(p_actor);
 SELECT count(*) INTO v_claims
   FROM public.platform_referral_payout_claims_v1_263;
 SELECT count(*),count(*) FILTER(
   WHERE bank_settlement_verified=true AND recipient_verified=true
    AND provider_transaction_success=true)
 INTO v_observations,v_bank_evidence
   FROM public.platform_referral_provider_observations_v1_265;
 RETURN jsonb_build_object('source','admin_finance_referral_counts_v1_921',
   'readOnly',true,'claims',v_claims,'observations',v_observations,
   'bankEvidence',v_bank_evidence);
END;$fn$;
REVOKE ALL ON FUNCTION
 platform_referral_payout_private_v1_263.finance_counts_v1_921(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 platform_referral_payout_private_v1_263.finance_counts_v1_921(uuid)
 TO service_role;

-- Exposed-schema wrapper is SECURITY INVOKER, not SECURITY DEFINER.
-- PostgREST sees only this restricted scalar-count function.
CREATE OR REPLACE FUNCTION public.admin_finance_referral_counts_v1_921(p_actor uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog AS $wrapper$
 SELECT platform_referral_payout_private_v1_263.finance_counts_v1_921($1)
$wrapper$;
REVOKE ALL ON FUNCTION public.admin_finance_referral_counts_v1_921(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_finance_referral_counts_v1_921(uuid)
 TO service_role;

-- Fail the migration on unexpected permission drift.
DO $acl$BEGIN
 IF has_table_privilege('service_role',
   'public.platform_referral_payout_claims_v1_263','SELECT')
 OR has_table_privilege('service_role',
   'public.platform_referral_provider_observations_v1_265','SELECT')
 OR has_function_privilege('anon',
   'public.admin_finance_referral_counts_v1_921(uuid)','EXECUTE')
 OR has_function_privilege('authenticated',
   'public.admin_finance_referral_counts_v1_921(uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role',
   'public.admin_finance_referral_counts_v1_921(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'FINANCE_REFERRAL_AGGREGATE_ACL_DRIFT'
   USING errcode='42501';END IF;
END$acl$;
COMMIT;
