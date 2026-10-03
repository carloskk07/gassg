-- Chama São Gabriel — cron browser lockdown v1.34.2
-- pg_cron is an internal scheduling authority. Browser roles must not be able
-- to address its schema/tables. The policies themselves are owned by
-- supabase_admin and are intentionally left untouched.

revoke select on table cron.job, cron.job_run_details
from anon, authenticated;

revoke usage on schema cron
from anon, authenticated;
