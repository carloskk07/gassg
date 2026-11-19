-- V1.1083 — selected hero photo is an approved published key, never an upload.
-- No modifications to RLS, financial roles, or media bucket permissions.
ALTER TABLE public.participant_pages_v1_1072
 ADD COLUMN IF NOT EXISTS hero_photo_key text NOT NULL DEFAULT '';
ALTER TABLE public.participant_pages_v1_1072
 ADD CONSTRAINT participant_pages_v1_1083_hero_photo_key_check
 CHECK (hero_photo_key = '' OR
 hero_photo_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$');
