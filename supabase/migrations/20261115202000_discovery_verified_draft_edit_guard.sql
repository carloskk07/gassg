-- RLS review: a role named "authenticated" can contain anonymous sign-ins.
-- Creating a discovery draft already requires a verified permanent identity;
-- editing that draft and changing its details must enforce the SAME condition.
-- No commercial operation or user is created by this migration.
BEGIN;

ALTER POLICY discovery_owner_draft_edit ON public.discovery_listings
  USING (
    owner_id = (SELECT auth.uid())
    AND status IN ('draft','rejected')
    AND (SELECT public.discovery_verified_account())
  )
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND status IN ('draft','rejected')
    AND (SELECT public.discovery_verified_account())
  );

CREATE OR REPLACE FUNCTION public.discovery_owner_can_edit_details(
  p_listing_id uuid, p_vertical text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
  SELECT (SELECT public.discovery_verified_account())
     AND EXISTS (
       SELECT 1 FROM public.discovery_listings l
       WHERE l.id=p_listing_id AND l.owner_id=(SELECT auth.uid())
         AND l.vertical=p_vertical AND l.status IN ('draft','rejected')
     );
$fn$;

-- Re-reviewed exact ACL digests produced by the disposable full migration
-- and independent policy/SECURITY DEFINER inventory of PR #1020. Never
-- replace this with a dynamic value: an unreviewed permission must fail.
DO $recheck$
DECLARE
  v_current jsonb:=public.tamao_launch_acl_posture_v1();
  v_definition text;
  v_previous_table text:='67838fe06fa43d7692e12d8e11a3de91';
  v_reviewed_table text:='b9af268e87e1fd2c40e7b6f18fa3b60f';
  v_previous_rpc text:='fb112503c524fa9e58da1d1b7c035c25';
  v_reviewed_rpc text:='6bd9d484039ed419ec4e0ae8bd14edc0';
BEGIN
  IF v_current->>'tableDigest' IS DISTINCT FROM v_reviewed_table
    OR v_current->>'rpcDigest' IS DISTINCT FROM v_reviewed_rpc
    OR v_current->>'tableCount' <> '7'
    OR v_current->>'rpcCount' <> '36'
  THEN
    RAISE EXCEPTION 'DISCOVERY_VERIFIED_ACL_UNREVIEWED_DRIFT';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.platform_launch_readiness()'::regprocedure)
    INTO v_definition;
  IF v_definition IS NULL
    OR pg_catalog.strpos(v_definition,v_previous_table)=0
    OR pg_catalog.strpos(v_definition,v_previous_rpc)=0
    OR pg_catalog.strpos(v_definition,v_reviewed_table)>0
    OR pg_catalog.strpos(v_definition,v_reviewed_rpc)>0
  THEN
    RAISE EXCEPTION 'LAUNCH_ACL_BASELINE_NOT_REVIEWED';
  END IF;
  v_definition:=pg_catalog.replace(v_definition,v_previous_table,v_reviewed_table);
  v_definition:=pg_catalog.replace(v_definition,v_previous_rpc,v_reviewed_rpc);
  EXECUTE v_definition;

  IF jsonb_array_length(public.platform_launch_readiness()->'securityBlockers')<>0
    AND (public.platform_launch_readiness()->'securityBlockers') ? 'browser_sensitive_table_acl'
  THEN
    RAISE EXCEPTION 'DISCOVERY_ACL_REVIEW_DID_NOT_MATCH';
  END IF;
END
$recheck$;

COMMIT;
