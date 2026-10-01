-- Chama São Gabriel — safe anonymous-user cleanup v1.6.3
-- Supabase does not automatically purge anonymous Auth users.
-- Only disposable identities with no business history are eligible.

create or replace function public.process_anonymous_user_cleanup(
  p_older_than_days integer default 45,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_deleted integer:=0;
begin
  if p_older_than_days<30 or p_older_than_days>365 then
    raise exception 'INVALID_RETENTION_DAYS' using errcode='22023';
  end if;

  if p_limit<1 or p_limit>2000 then
    raise exception 'INVALID_CLEANUP_LIMIT' using errcode='22023';
  end if;

  with candidates as (
    select u.id
    from auth.users u
    where u.is_anonymous is true
      and u.created_at<clock_timestamp()-make_interval(days=>p_older_than_days)
      and coalesce(u.updated_at,u.created_at)<clock_timestamp()-make_interval(days=>p_older_than_days)
      and u.email is null
      and u.phone is null
      and not exists(
        select 1 from auth.identities i where i.user_id=u.id
      )
      and not exists(
        select 1 from public.orders o where o.customer_id=u.id
      )
      and not exists(
        select 1 from public.wallet_entries w where w.user_id=u.id
      )
      and not exists(
        select 1
        from public.referrals r
        where r.referred_user_id=u.id or r.referrer_user_id=u.id
      )
      and not exists(
        select 1
        from public.merchant_applications a
        where a.applicant_user_id=u.id
      )
      and not exists(
        select 1
        from public.merchant_members mm
        where mm.user_id=u.id
      )
    order by u.created_at
    limit p_limit
    for update skip locked
  ),
  deleted as (
    delete from auth.users u
    using candidates c
    where u.id=c.id
    returning u.id
  )
  select count(*) into v_deleted from deleted;

  return jsonb_build_object(
    'deletedAnonymousUsers',v_deleted,
    'olderThanDays',p_older_than_days,
    'limit',p_limit
  );
end;
$$;

revoke all on function public.process_anonymous_user_cleanup(integer,integer)
from public, anon, authenticated;
grant execute on function public.process_anonymous_user_cleanup(integer,integer)
to postgres, service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='chama-anonymous-cleanup';

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'chama-anonymous-cleanup',
    '7 4 * * *',
    'select public.process_anonymous_user_cleanup(45,500);'
  );
end;
$$;
