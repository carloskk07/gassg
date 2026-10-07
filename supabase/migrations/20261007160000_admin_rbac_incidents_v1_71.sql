-- TAMÃO — Admin RBAC + Incident Control Plane v1.71
-- Adds explicit admin roles, last-superadmin continuity and a server-only incident register.

alter table public.platform_admins
  add column if not exists admin_role text;

update public.platform_admins
set admin_role='superadmin'
where admin_role is null;

alter table public.platform_admins
  alter column admin_role set default 'superadmin',
  alter column admin_role set not null;

do $$
begin
  if not exists(
    select 1
    from pg_catalog.pg_constraint
    where conname='platform_admins_admin_role_check'
      and conrelid='public.platform_admins'::regclass
  ) then
    alter table public.platform_admins
      add constraint platform_admins_admin_role_check
      check(admin_role in ('superadmin','operations','finance','support','compliance','readonly'));
  end if;
end
$$;

create index if not exists platform_admins_active_role_idx
  on public.platform_admins(active,admin_role)
  where active;

create or replace function public.platform_admin_role(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog
as $$
declare
  v_role text;
begin
  perform public.require_platform_admin(p_user_id);

  select a.admin_role
  into v_role
  from public.platform_admins a
  where a.user_id=p_user_id
    and a.active;

  if v_role is null then
    raise exception 'ADMIN_ACCESS_DENIED' using errcode='42501';
  end if;

  return v_role;
end;
$$;

revoke all on function public.platform_admin_role(uuid)
from public, anon, authenticated;
grant execute on function public.platform_admin_role(uuid)
to service_role;

create or replace function public.enforce_platform_superadmin_continuity()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_other integer;
begin
  if tg_op='DELETE' then
    if old.active and old.admin_role='superadmin' then
      select count(*)::integer
      into v_other
      from public.platform_admins a
      where a.user_id<>old.user_id
        and a.active
        and a.admin_role='superadmin';

      if v_other<1 then
        raise exception 'LAST_SUPERADMIN_CANNOT_BE_REMOVED' using errcode='40001';
      end if;
    end if;
    return old;
  end if;

  if old.active and old.admin_role='superadmin'
     and (new.active is false or new.admin_role<>'superadmin') then
    select count(*)::integer
    into v_other
    from public.platform_admins a
    where a.user_id<>old.user_id
      and a.active
      and a.admin_role='superadmin';

    if v_other<1 then
      raise exception 'LAST_SUPERADMIN_CANNOT_BE_REMOVED' using errcode='40001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_platform_superadmin_continuity()
from public, anon, authenticated;
grant execute on function public.enforce_platform_superadmin_continuity()
to postgres, service_role;

drop trigger if exists enforce_platform_superadmin_continuity_trg
on public.platform_admins;

create trigger enforce_platform_superadmin_continuity_trg
before update of active,admin_role or delete
on public.platform_admins
for each row
execute function public.enforce_platform_superadmin_continuity();

create or replace function public.admin_platform_admin_access_action(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_active boolean,
  p_admin_role text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_result jsonb;
  v_actor_role text;
  v_target auth.users%rowtype;
  v_role text;
  v_active_admins integer;
begin
  v_actor_role:=public.platform_admin_role(p_actor_user_id);
  if v_actor_role<>'superadmin' then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  v_role:=lower(trim(coalesce(p_admin_role,'')));
  if v_role not in ('superadmin','operations','finance','support','compliance','readonly') then
    raise exception 'INVALID_ADMIN_ROLE' using errcode='22023';
  end if;

  select *
  into v_target
  from auth.users
  where id=p_target_user_id;

  if not found
     or v_target.is_anonymous is true
     or v_target.email is null
     or v_target.email_confirmed_at is null then
    raise exception 'PERMANENT_CONFIRMED_IDENTITY_REQUIRED' using errcode='42501';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:set-platform-admin-access',
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:set-platform-admin-access'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  if not p_active then
    select count(*)::integer
    into v_active_admins
    from public.platform_admins a
    where a.active
      and a.user_id<>p_target_user_id;

    if v_active_admins<1 then
      raise exception 'LAST_ADMIN_CANNOT_BE_REMOVED' using errcode='40001';
    end if;
  end if;

  insert into public.platform_admins(
    user_id,active,admin_role,created_by,created_at
  )
  values(
    p_target_user_id,p_active,v_role,p_actor_user_id,clock_timestamp()
  )
  on conflict(user_id) do update
  set active=excluded.active,
      admin_role=excluded.admin_role;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'platform_admin_access_updated',
    'platform_admin',
    p_target_user_id::text,
    jsonb_build_object('active',p_active,'adminRole',v_role)
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'targetUserId',p_target_user_id,
    'active',p_active,
    'adminRole',v_role
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_platform_admin_access_action(
  uuid,uuid,boolean,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_platform_admin_access_action(
  uuid,uuid,boolean,text,text,text
) to service_role;

create table if not exists public.platform_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check(char_length(trim(title)) between 3 and 160),
  description text check(description is null or char_length(description)<=4000),
  severity text not null check(severity in ('critical','high','medium','low')),
  status text not null default 'open'
    check(status in ('open','investigating','monitoring','resolved')),
  source text not null default 'admin'
    check(char_length(source) between 2 and 80),
  entity_type text check(entity_type is null or char_length(entity_type) between 2 and 80),
  entity_id text check(entity_id is null or char_length(entity_id)<=160),
  assigned_admin_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text check(resolution_note is null or char_length(resolution_note)<=4000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.platform_incidents enable row level security;
revoke all on table public.platform_incidents from public, anon, authenticated;
grant all on table public.platform_incidents to service_role;

create index if not exists platform_incidents_open_priority_idx
  on public.platform_incidents(status,severity,updated_at desc);

create index if not exists platform_incidents_entity_idx
  on public.platform_incidents(entity_type,entity_id,created_at desc);

create index if not exists platform_incidents_assignee_idx
  on public.platform_incidents(assigned_admin_id,status,updated_at desc);

create or replace function public.admin_incident_action(
  p_actor_user_id uuid,
  p_action text,
  p_incident_id uuid,
  p_title text,
  p_description text,
  p_severity text,
  p_source text,
  p_entity_type text,
  p_entity_id text,
  p_assigned_admin_id uuid,
  p_status text,
  p_resolution_note text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_actor_role text;
  v_incident public.platform_incidents%rowtype;
  v_result jsonb;
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_severity text:=lower(trim(coalesce(p_severity,'')));
  v_status text:=lower(trim(coalesce(p_status,'')));
begin
  v_actor_role:=public.platform_admin_role(p_actor_user_id);
  if v_actor_role='readonly' then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if v_kind not in ('create','acknowledge','assign','set-status','resolve','reopen') then
    raise exception 'INVALID_INCIDENT_ACTION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  if p_assigned_admin_id is not null
     and not exists(
       select 1 from public.platform_admins a
       where a.user_id=p_assigned_admin_id and a.active
     ) then
    raise exception 'INCIDENT_ASSIGNEE_NOT_ACTIVE_ADMIN' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:incident:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:incident:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  if v_kind='create' then
    if p_title is null or char_length(trim(p_title))<3 or char_length(trim(p_title))>160 then
      raise exception 'INVALID_INCIDENT_TITLE' using errcode='22023';
    end if;
    if v_severity not in ('critical','high','medium','low') then
      raise exception 'INVALID_INCIDENT_SEVERITY' using errcode='22023';
    end if;
    if p_description is not null and char_length(p_description)>4000 then
      raise exception 'INVALID_INCIDENT_DESCRIPTION' using errcode='22023';
    end if;

    insert into public.platform_incidents(
      title,description,severity,status,source,entity_type,entity_id,
      assigned_admin_id,created_by
    )
    values(
      trim(p_title),nullif(trim(p_description),''),
      v_severity,'open',coalesce(nullif(trim(p_source),''),'admin'),
      nullif(trim(p_entity_type),''),nullif(trim(p_entity_id),''),
      p_assigned_admin_id,p_actor_user_id
    )
    returning * into v_incident;
  else
    if p_incident_id is null then
      raise exception 'INCIDENT_ID_REQUIRED' using errcode='22023';
    end if;

    select *
    into v_incident
    from public.platform_incidents
    where id=p_incident_id
    for update;

    if not found then
      raise exception 'INCIDENT_NOT_FOUND' using errcode='P0002';
    end if;

    if v_kind='acknowledge' then
      update public.platform_incidents
      set acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),
          acknowledged_by=coalesce(acknowledged_by,p_actor_user_id),
          updated_at=clock_timestamp()
      where id=v_incident.id
      returning * into v_incident;

    elsif v_kind='assign' then
      update public.platform_incidents
      set assigned_admin_id=p_assigned_admin_id,
          updated_at=clock_timestamp()
      where id=v_incident.id
      returning * into v_incident;

    elsif v_kind='set-status' then
      if v_status not in ('open','investigating','monitoring') then
        raise exception 'INVALID_INCIDENT_STATUS' using errcode='22023';
      end if;
      update public.platform_incidents
      set status=v_status,
          updated_at=clock_timestamp()
      where id=v_incident.id
      returning * into v_incident;

    elsif v_kind='resolve' then
      if p_resolution_note is null
         or char_length(trim(p_resolution_note))<3
         or char_length(trim(p_resolution_note))>4000 then
        raise exception 'INCIDENT_RESOLUTION_REQUIRED' using errcode='22023';
      end if;
      update public.platform_incidents
      set status='resolved',
          resolution_note=trim(p_resolution_note),
          resolved_at=clock_timestamp(),
          resolved_by=p_actor_user_id,
          updated_at=clock_timestamp()
      where id=v_incident.id
      returning * into v_incident;

    elsif v_kind='reopen' then
      update public.platform_incidents
      set status='open',
          resolved_at=null,
          resolved_by=null,
          resolution_note=null,
          updated_at=clock_timestamp()
      where id=v_incident.id
      returning * into v_incident;
    end if;
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'incident_'||replace(v_kind,'-','_'),
    'platform_incident',
    v_incident.id::text,
    jsonb_build_object(
      'severity',v_incident.severity,
      'status',v_incident.status,
      'assignedAdminId',v_incident.assigned_admin_id,
      'entityType',v_incident.entity_type,
      'entityId',v_incident.entity_id
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'incident',to_jsonb(v_incident)
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_incident_action(
  uuid,text,uuid,text,text,text,text,text,text,uuid,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_incident_action(
  uuid,text,uuid,text,text,text,text,text,text,uuid,text,text,text,text
) to service_role;

-- Browser roles remain fail-closed for the new administrative surface.
revoke all on table public.platform_admins from anon, authenticated;
revoke all on table public.platform_incidents from anon, authenticated;
grant all on table public.platform_admins to service_role;
grant all on table public.platform_incidents to service_role;
