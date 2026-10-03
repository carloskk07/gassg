-- Chama São Gabriel — cron PUBLIC ACL lockdown v1.34.3
-- pg_cron grants SELECT (and run-history DELETE) to the pseudo-role PUBLIC.
-- Browser roles inherit PUBLIC, so close that inherited ACL explicitly.

revoke all privileges on table cron.job, cron.job_run_details
from public, anon, authenticated;
