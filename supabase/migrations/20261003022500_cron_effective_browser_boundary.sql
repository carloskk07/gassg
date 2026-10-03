-- Chama São Gabriel — effective cron browser boundary v1.34.4
-- Supabase owns pg_cron table grants/policies through supabase_admin. The
-- application-controlled boundary is schema USAGE: without it browser roles
-- cannot resolve cron.job or cron.job_run_details even if a table ACL remains.

revoke usage on schema cron
from anon, authenticated;

do $$
begin
  if has_schema_privilege('anon','cron','usage')
     or has_schema_privilege('authenticated','cron','usage') then
    raise exception 'CRON_SCHEMA_EXPOSED_TO_BROWSER';
  end if;
end;
$$;
