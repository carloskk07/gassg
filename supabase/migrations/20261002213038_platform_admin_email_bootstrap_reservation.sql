-- Chama — secure first-admin bootstrap reservation by hashed email.
-- The repository never stores the administrator email in plaintext.
create table if not exists public.platform_admin_bootstrap_reservations (
  email_sha256 bytea primary key
    check (octet_length(email_sha256)=32),
  created_at timestamptz not null default clock_timestamp(),
  claimed_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  check (
    (claimed_user_id is null and claimed_at is null)
    or (claimed_user_id is not null and claimed_at is not null)
  )
);

alter table public.platform_admin_bootstrap_reservations enable row level security;
revoke all on table public.platform_admin_bootstrap_reservations from public, anon, authenticated;
grant all on table public.platform_admin_bootstrap_reservations to service_role;

create or replace function public.process_platform_admin_bootstrap_reservations()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_active_admins integer:=0;
  v_user_id uuid;
  v_hash bytea;
  v_result jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('platform-admin-email-bootstrap',0)
  );

  select count(*)
  into v_active_admins
  from public.platform_admins
  where active;

  if v_active_admins>0 then
    return jsonb_build_object(
      'ok',true,
      'status','closed',
      'activeAdmins',v_active_admins
    );
  end if;

  select u.id, r.email_sha256
  into v_user_id, v_hash
  from auth.users u
  join public.platform_admin_bootstrap_reservations r
    on r.email_sha256=extensions.digest(lower(btrim(u.email)),'sha256')
  where r.claimed_user_id is null
    and u.email is not null
    and u.is_anonymous is false
    and u.email_confirmed_at is not null
  order by r.created_at asc, u.created_at asc
  limit 1
  for update of u;

  if not found then
    return jsonb_build_object(
      'ok',true,
      'status','waiting_for_confirmed_user'
    );
  end if;

  v_result:=public.bootstrap_first_platform_admin(v_user_id);

  update public.platform_admin_bootstrap_reservations
  set claimed_user_id=v_user_id,
      claimed_at=clock_timestamp()
  where email_sha256=v_hash
    and claimed_user_id is null;

  return v_result || jsonb_build_object(
    'status','claimed'
  );
end;
$$;

revoke all on function public.process_platform_admin_bootstrap_reservations()
from public, anon, authenticated;
grant execute on function public.process_platform_admin_bootstrap_reservations()
to postgres, service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='chama-first-admin-bootstrap';

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'chama-first-admin-bootstrap',
    '*/5 * * * *',
    'select public.process_platform_admin_bootstrap_reservations();'
  );
end;
$$;
