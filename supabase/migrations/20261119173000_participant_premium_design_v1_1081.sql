-- TAMÃO V1.1081: optional native participant design preferences.
-- Existing slugs, owner RLS, referral rules and every payment gate remain unchanged.
ALTER TABLE public.participant_pages_v1_1072
 ADD COLUMN IF NOT EXISTS layout text NOT NULL DEFAULT 'split',
 ADD COLUMN IF NOT EXISTS show_about boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS show_gallery boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS show_catalog boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS show_discover boolean NOT NULL DEFAULT true;

ALTER TABLE public.participant_pages_v1_1072
 DROP CONSTRAINT IF EXISTS participant_pages_v1_1072_template_check;
ALTER TABLE public.participant_pages_v1_1072
 ADD CONSTRAINT participant_pages_v1_1072_template_check
 CHECK (template IN ('clean','gold','rose','ocean','sunset','midnight'));
ALTER TABLE public.participant_pages_v1_1072
 ADD CONSTRAINT participant_pages_v1_1081_layout_check
 CHECK (layout IN ('split','centered','editorial'));
