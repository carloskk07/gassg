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

-- The table/RPC ACL posture digests must be explicitly reviewed and updated
-- in a follow-up commit before this branch can pass the fail-closed launch gate.
COMMIT;
