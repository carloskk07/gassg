-- TAMÃO V1.70.37 — bootstrap final authority requires a confirmed permanent identity.
-- Defense in depth: callers already validate confirmation, but the authority itself must enforce it.

create or replace function public.bootstrap_first_platform_admin(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_user auth.users%rowtype;
  v_active_admins integer:=0;
begin
  if p_user_id is null then
    raise exception 'INVALID_ADMIN_USER' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('platform-admin-bootstrap',0)
  );

  select count(*)
  into v_active_admins
  from public.platform_admins
  where active;

  if v_active_admins>0 then
    raise exception 'ADMIN_BOOTSTRAP_CLOSED' using errcode='42501';
  end if;

  select *
  into v_user
  from auth.users
  where id=p_user_id
  for update;

  if not found then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_user.is_anonymous is true
     or v_user.email is null
     or v_user.email_confirmed_at is null then
    raise exception 'PERMANENT_CONFIRMED_IDENTITY_REQUIRED' using errcode='42501';
  end if;

  insert into public.platform_admins(
    user_id,active,created_by,created_at
  )
  values(
    p_user_id,true,p_user_id,clock_timestamp()
  )
  on conflict(user_id) do update
  set active=true,
      created_by=excluded.created_by;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_user_id,
    'platform_admin_bootstrapped',
    'platform_admin',
    p_user_id::text,
    jsonb_build_object(
      'bootstrap',true,
      'activeAdminsBefore',v_active_admins
    )
  );

  return jsonb_build_object(
    'ok',true,
    'userId',p_user_id,
    'active',true,
    'bootstrap',true
  );
end;
$$;

revoke all on function public.bootstrap_first_platform_admin(uuid)
from public, anon, authenticated;
grant execute on function public.bootstrap_first_platform_admin(uuid)
to postgres, service_role;
