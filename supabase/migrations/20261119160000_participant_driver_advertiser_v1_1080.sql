-- TAMÃO V1.1080 — new native pages for existing mobility providers and Ads.
-- No new registration tables, RLS policies, financial permissions or payouts.
BEGIN;
ALTER TABLE public.participant_pages_v1_1072
 DROP CONSTRAINT participant_pages_v1_1072_kind_check;
ALTER TABLE public.participant_pages_v1_1072
 ADD CONSTRAINT participant_pages_v1_1072_kind_check
 CHECK (kind IN ('merchant','customer','listing','agenda','driver','advertiser'));
COMMENT ON TABLE public.participant_pages_v1_1072 IS
 'Private owner configuration; public driver/Ads pages inherit existing approved listing/campaign status and are served only by Edge.';
COMMIT;
