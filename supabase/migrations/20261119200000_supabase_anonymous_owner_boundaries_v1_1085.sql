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
