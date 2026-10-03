-- Chama São Gabriel — cron browser lockdown v1.34.2
-- pg_cron is an internal scheduling authority. Browser roles must not be able
-- to address its schema/tables, even when row policies would return no rows.

revoke all privileges on table cron.job, cron.job_run_details
from anon, authenticated;

revoke usage on schema cron
from anon, authenticated;

drop policy if exists cron_job_policy on cron.job;
create policy cron_job_policy
on cron.job
for all
to postgres
using (username=current_user)
with check (username=current_user);

drop policy if exists cron_job_run_details_policy on cron.job_run_details;
create policy cron_job_run_details_policy
on cron.job_run_details
for all
to postgres
using (username=current_user)
with check (username=current_user);
