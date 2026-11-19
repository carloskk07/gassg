\set ON_ERROR_STOP on
-- This verification ONLY runs against isolated local PostgreSQL. All seed
-- records and RLS role changes are rolled back. Never use in production.
BEGIN;
SELECT gen_random_uuid() AS p_id, gen_random_uuid() AS a_id \gset
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
VALUES
 (:'p_id'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','verified-ci-1085@example.org',now(),false,now(),now()),
 (:'a_id'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,null,true,now(),now());
INSERT INTO public.agenda_pages(owner_id,slug,title,city,published)
VALUES
 (:'p_id'::uuid,'seguro-profissional-ci-1085','Barbearia CI verificada','São Gabriel',true),
 (:'a_id'::uuid,'seguro-anonimo-ci-1085','Ficticio anonimo CI','São Gabriel',true);

-- Real permanent user, actual owner — must still access their configuration.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'p_id',true);
SELECT set_config('request.jwt.claims',
 jsonb_build_object('sub',:'p_id','role','authenticated','is_anonymous',false)::text,true);
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.agenda_pages WHERE slug='seguro-profissional-ci-1085')<>1
 THEN RAISE EXCEPTION 'PERMANENT_OWNER_RLS_REGRESSION';END IF;
 IF (SELECT count(*) FROM public.agenda_pages WHERE slug='seguro-anonimo-ci-1085')<>0
 THEN RAISE EXCEPTION 'FOREIGN_OWNER_RLS_BROKEN';END IF;
END $test$;

-- A signed-in anonymous user has the SAME role, but an is_anonymous=true JWT.
SELECT set_config('request.jwt.claim.sub',:'a_id',true);
SELECT set_config('request.jwt.claims',
 jsonb_build_object('sub',:'a_id','role','authenticated','is_anonymous',true)::text,true);
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.agenda_pages WHERE slug='seguro-anonimo-ci-1085')<>0
 THEN RAISE EXCEPTION 'ANONYMOUS_JWT_READS_PRIVATE_AGENDA';END IF;
 IF (SELECT count(*) FROM public.agenda_pages WHERE slug='seguro-profissional-ci-1085')<>0
 THEN RAISE EXCEPTION 'ANONYMOUS_JWT_READS_FOREIGN_AGENDA';END IF;
END $test$;

-- Even a malformed (false) claim cannot override authoritative anonymous
-- membership in auth.users: discovery_verified_account() checks the user.
SELECT set_config('request.jwt.claims',
 jsonb_build_object('sub',:'a_id','role','authenticated','is_anonymous',false)::text,true);
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.agenda_pages WHERE slug='seguro-anonimo-ci-1085')<>0
 THEN RAISE EXCEPTION 'ANONYMOUS_DB_USER_SPOOFED_JWT_CLAIM';END IF;
END $test$;

-- SQL regression tests that supply only sub (without an is_anonymous claim)
-- continue to prove verified owner access on the disposable baseline.
SELECT set_config('request.jwt.claim.sub',:'p_id',true);
SELECT set_config('request.jwt.claims','{}',true);
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.agenda_pages WHERE slug='seguro-profissional-ci-1085')<>1
 THEN RAISE EXCEPTION 'VERIFIED_OWNER_NO_JWT_CLAIM_REGRESSION';END IF;
END $test$;

-- A public Agenda must remain readable using the genuinely anonymous 'anon'
-- PostgreSQL role (different from authenticated anonymous Auth accounts).
SET LOCAL ROLE anon;
DO $test$
BEGIN
 IF (SELECT public.agenda_public_page('seguro-profissional-ci-1085'))->>'slug'
     IS DISTINCT FROM 'seguro-profissional-ci-1085'
 THEN RAISE EXCEPTION 'PUBLIC_AGENDA_BROKEN';END IF;
END $test$;
RESET ROLE;

-- Count every expected restrictive guard; a missing policy must fail CI.
DO $test$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_policies
 WHERE schemaname='public' AND policyname='tamao_verified_owner_v1_1085'
   AND permissive='RESTRICTIVE';
 IF n<>12 THEN RAISE EXCEPTION 'PRIVATE_OWNER_GUARD_COUNT: %',n;END IF;
 SELECT count(*) INTO n FROM pg_policies
 WHERE schemaname='public' AND policyname LIKE 'tamao_verified_%_v1_1085'
   AND policyname<>'tamao_verified_owner_v1_1085' AND permissive='RESTRICTIVE';
 IF n<>15 THEN RAISE EXCEPTION 'MIXED_OWNER_WRITE_GUARD_COUNT: %',n;END IF;
 SELECT count(*) INTO n FROM pg_policies
 WHERE schemaname='storage' AND tablename='objects'
 AND policyname='tamao_discovery_bucket_verified_v1_1085'
 AND permissive='RESTRICTIVE';
 IF n<>1 THEN RAISE EXCEPTION 'STORAGE_BUCKET_GUARD_MISSING';END IF;
 IF NOT has_function_privilege('anon','public.agenda_public_page(text)','EXECUTE')
 THEN RAISE EXCEPTION 'PUBLIC_AGENDA_EXECUTE_REVOKED';END IF;
END $test$;
ROLLBACK;
\echo 'PASS V1.1085: verified owners retain RLS, two forms of anonymous JWT cannot access owner data, public Agenda untouched, 28 restrictive guards installed, all rolled back.'
