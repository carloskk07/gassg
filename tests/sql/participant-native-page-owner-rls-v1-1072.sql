-- V1.1072: verify native participant page RLS and non-public API.
BEGIN;
DO $$
DECLARE
  p record;
  policies integer;
BEGIN
 IF to_regclass('public.participant_pages_v1_1072') IS NULL THEN
  RAISE EXCEPTION 'Native participant pages missing';
 END IF;
 SELECT relrowsecurity,relforcerowsecurity INTO p
 FROM pg_class WHERE oid='public.participant_pages_v1_1072'::regclass;
 IF p.relrowsecurity IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Native pages RLS must be enabled';
 END IF;
 IF has_table_privilege('anon','public.participant_pages_v1_1072','SELECT')
    OR has_table_privilege('anon','public.participant_pages_v1_1072','INSERT')
    OR has_table_privilege('anon','public.participant_pages_v1_1072','UPDATE')
    OR has_table_privilege('authenticated','public.participant_pages_v1_1072','INSERT')
    OR has_table_privilege('authenticated','public.participant_pages_v1_1072','UPDATE')
    OR has_table_privilege('authenticated','public.participant_pages_v1_1072','DELETE') THEN
  RAISE EXCEPTION 'Native pages public API permissions too broad';
 END IF;
 IF NOT has_table_privilege('authenticated','public.participant_pages_v1_1072','SELECT') THEN
  RAISE EXCEPTION 'Authenticated owner needs RLS-scoped SELECT';
 END IF;
 SELECT count(*) INTO policies FROM pg_policies
 WHERE schemaname='public' AND tablename='participant_pages_v1_1072'
 AND cmd='SELECT' AND 'authenticated'=ANY(roles)
 AND qual LIKE '%auth.uid()%';
 IF policies<>1 THEN RAISE EXCEPTION 'Expected exactly one owner SELECT policy, got %',policies;END IF;
 RAISE NOTICE 'V1.1072 native participant ACL PASS';
END $$;
ROLLBACK;
