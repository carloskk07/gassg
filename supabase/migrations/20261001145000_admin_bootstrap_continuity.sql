-- Chama São Gabriel — protected admin bootstrap and continuity v1.14.3
-- First admin is bootstrapped only through service_role and only while there are
-- zero active platform admins. Afterwards, active admins may manage additional
-- permanent admins, but the last active admin can never be removed.

create or replace function public.bootstrap_first_platform_admin(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
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

  if v_user.is_anonymous is true then
    raise exception 'PERMANENT_IDENTITY_REQUIRED' using errcode='42501';
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
to service_role;

create or replace function public.admin_set_platform_admin(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_target auth.users%rowtype;
  v_active_admins integer:=0;
  v_target_was_active boolean:=false;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_target_user_id is null or p_active is null then
    raise exception 'INVALID_ADMIN_CHANGE' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('platform-admin-management',0)
  );

  select *
  into v_target
  from auth.users
  where id=p_target_user_id
  for update;

  if not found then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_target.is_anonymous is true then
    raise exception 'PERMANENT_IDENTITY_REQUIRED' using errcode='42501';
  end if;

  select coalesce(a.active,false)
  into v_target_was_active
  from public.platform_admins a
  where a.user_id=p_target_user_id;

  if not found then
    v_target_was_active:=false;
  end if;

  if not p_active and v_target_was_active then
    select count(*)
    into v_active_admins
    from public.platform_admins
    where active;

    if v_active_admins<=1 then
      raise exception 'LAST_ADMIN_CANNOT_BE_REMOVED' using errcode='23514';
    end if;
  end if;

  insert into public.platform_admins(
    user_id,active,created_by,created_at
  )
  values(
    p_target_user_id,p_active,p_actor_user_id,clock_timestamp()
  )
  on conflict(user_id) do update
  set active=excluded.active,
      created_by=case
        when excluded.active then p_actor_user_id
        else public.platform_admins.created_by
      end;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_active then 'platform_admin_activated' else 'platform_admin_deactivated' end,
    'platform_admin',
    p_target_user_id::text,
    jsonb_build_object(
      'active',p_active,
      'previouslyActive',v_target_was_active
    )
  );

  return jsonb_build_object(
    'ok',true,
    'userId',p_target_user_id,
    'active',p_active
  );
end;
$$;

revoke all on function public.admin_set_platform_admin(uuid,uuid,boolean)
from public, anon, authenticated;
grant execute on function public.admin_set_platform_admin(uuid,uuid,boolean)
to service_role;
