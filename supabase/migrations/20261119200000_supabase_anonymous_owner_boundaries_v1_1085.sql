-- TAMÃO V1.1085: anonymous Auth users use PostgreSQL 'authenticated' role.
-- Preserve anonymous discovery, checkout, public Agenda reads, and all current
-- service_role/SECURITY DEFINER paths; do not disable anonymous sign-in.
-- Verified owners must be the only users with direct owner-scoped Data API
-- access to protected Agenda, listing, document and mobility records.
-- Also compare JWT is_anonymous, but use an authoritative auth.users lookup
-- via the EXISTING discovery_verified_account() function, since some local
-- RLS contract tests set request.jwt.claim.sub without a full JWT.
-- These policies restrict; they never grant privileges or bypass old ownership.
-- No financial tables, PSPs, migrations of existing records or auth settings.

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.agenda_appointments AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.agenda_closed_days AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.agenda_hours AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.agenda_pages AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.agenda_service_deposit_settings AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.agenda_services AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.agenda_staff AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.agenda_staff_blocks AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.agenda_waitlist AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.discovery_documents AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.mobility_requests AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

CREATE POLICY tamao_verified_owner_v1_1085
 ON public.participant_pages_v1_1072 AS RESTRICTIVE FOR ALL TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_insert_v1_1085
 ON public.agenda_page_design AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_update_v1_1085
 ON public.agenda_page_design AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_delete_v1_1085
 ON public.agenda_page_design AS RESTRICTIVE FOR DELETE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_insert_v1_1085
 ON public.discovery_listings AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_update_v1_1085
 ON public.discovery_listings AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_delete_v1_1085
 ON public.discovery_listings AS RESTRICTIVE FOR DELETE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_insert_v1_1085
 ON public.discovery_professional_details AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_update_v1_1085
 ON public.discovery_professional_details AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_delete_v1_1085
 ON public.discovery_professional_details AS RESTRICTIVE FOR DELETE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_insert_v1_1085
 ON public.discovery_ride_details AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_update_v1_1085
 ON public.discovery_ride_details AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_delete_v1_1085
 ON public.discovery_ride_details AS RESTRICTIVE FOR DELETE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_insert_v1_1085
 ON public.discovery_stay_details AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_update_v1_1085
 ON public.discovery_stay_details AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))) WITH CHECK (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Keep public SELECT policies unchanged. Only owner WRITE is restricted.
CREATE POLICY tamao_verified_delete_v1_1085
 ON public.discovery_stay_details AS RESTRICTIVE FOR DELETE TO authenticated
 USING (((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)));

-- Never deny unrelated Storage buckets or intentionally public image URLs.
-- Only signed-in anonymous users trying owner-only Discovery bucket operations
-- are denied; public storage serving uses its independent public bucket path.
CREATE POLICY tamao_discovery_bucket_verified_v1_1085
 ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING ((bucket_id NOT IN ('tamao-discovery-documents','tamao-discovery-photos')
 OR ((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE)))) WITH CHECK ((bucket_id NOT IN ('tamao-discovery-documents','tamao-discovery-photos')
 OR ((SELECT public.discovery_verified_account()) AND
 ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS DISTINCT FROM TRUE))));

-- TAMÃO commerce readiness maintains an exact browser-ACL fingerprint.
-- A stricter RLS policy legitimately changes tableDigest. Update ONLY the
-- pinned table digest in the reviewed, service-only readiness function. Its
-- behavior, grants, privileges, security definer and RPC digest stay intact.
-- Source MD5 is checked to prevent patching unknown production function code.
DO $tamao$
DECLARE
 v_ddl text;
 v_original_md5 text;
 v_posture text;
 v_readiness jsonb;
BEGIN
 SELECT md5(prosrc),pg_get_functiondef(oid)
 INTO v_original_md5,v_ddl FROM pg_proc
 WHERE oid='public.platform_launch_readiness()'::regprocedure
   AND prosecdef=true;
 IF v_original_md5 IS DISTINCT FROM 'bd2526b912aeb1c4d829550ea3b3a999'
 THEN RAISE EXCEPTION 'TAMAO_LAUNCH_READINESS_UNREVIEWED_SOURCE';END IF;
 IF (length(v_ddl)-length(replace(v_ddl,'bcaea107616e3c2713787a71efd4c7ff','')))<>32
 THEN RAISE EXCEPTION 'TAMAO_ACL_FINGERPRINT_ANCHOR_CHANGED';END IF;
 v_posture:=public.tamao_launch_acl_posture_v1()->>'tableDigest';
 IF v_posture IS DISTINCT FROM 'da666df0fb875fc8066c156483b5e9d8'
 THEN RAISE EXCEPTION 'TAMAO_NEW_POLICY_ACL_DIGEST_UNEXPECTED: %',v_posture;END IF;
 EXECUTE replace(v_ddl,'bcaea107616e3c2713787a71efd4c7ff','da666df0fb875fc8066c156483b5e9d8');
 v_readiness:=public.platform_launch_readiness();
 IF (v_readiness->'securityBlockers') ? 'browser_sensitive_table_acl'
 THEN RAISE EXCEPTION 'TAMAO_ACL_BLOCKER_NOT_CLEARED';END IF;
 IF (v_readiness->>'commerceEnabled')::boolean IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'TAMAO_COMMERCIAL_SWITCH_CHANGED';END IF;
END $tamao$;
