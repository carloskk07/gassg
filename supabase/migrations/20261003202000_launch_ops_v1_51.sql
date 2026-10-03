-- TAMÃO — launch operations v1.51
-- Pipeline auditável para leads de pré-lançamento e solicitações públicas.

alter table public.prelaunch_leads
  add column if not exists admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  add column if not exists contacted_at timestamptz,
  add column if not exists qualified_at timestamptz,
  add column if not exists converted_at timestamptz,
  add column if not exists closed_at timestamptz;

create or replace function public.admin_prelaunch_lead_action(
  p_actor_user_id uuid,
  p_lead_id uuid,
  p_status text,
  p_note text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_action public.action_requests%rowtype;
  v_lead public.prelaunch_leads%rowtype;
  v_result jsonb;
  v_current_rank integer;
  v_target_rank integer;
  v_note text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_status not in ('contacted','qualified','converted','closed') then
    raise exception 'INVALID_LEAD_STATUS' using errcode='22023';
  end if;

  v_note:=nullif(trim(coalesce(p_note,'')),'');
  if v_note is not null and char_length(v_note)>1000 then
    raise exception 'INVALID_LEAD_NOTE' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,'admin-ops:lead-status',p_request_hash
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
     or v_action.action_name<>'admin-ops:lead-status'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_lead
  from public.prelaunch_leads
  where id=p_lead_id
  for update;

  if not found then
    raise exception 'PRELAUNCH_LEAD_NOT_FOUND' using errcode='P0002';
  end if;

  if v_lead.status in ('converted','closed') then
    raise exception 'PRELAUNCH_LEAD_FINAL' using errcode='40001';
  end if;

  v_current_rank:=case v_lead.status
    when 'new' then 0
    when 'contacted' then 1
    when 'qualified' then 2
    when 'converted' then 3
    when 'closed' then 4
    else -1
  end;

  v_target_rank:=case p_status
    when 'contacted' then 1
    when 'qualified' then 2
    when 'converted' then 3
    when 'closed' then 4
    else -1
  end;

  if p_status<>'closed' and v_target_rank<=v_current_rank then
    raise exception 'INVALID_LEAD_TRANSITION' using errcode='40001';
  end if;

  update public.prelaunch_leads
  set status=p_status,
      admin_note=coalesce(v_note,admin_note),
      contacted_at=case when p_status in ('contacted','qualified','converted') then coalesce(contacted_at,clock_timestamp()) else contacted_at end,
      qualified_at=case when p_status in ('qualified','converted') then coalesce(qualified_at,clock_timestamp()) else qualified_at end,
      converted_at=case when p_status='converted' then coalesce(converted_at,clock_timestamp()) else converted_at end,
      closed_at=case when p_status='closed' then coalesce(closed_at,clock_timestamp()) else closed_at end,
      updated_at=clock_timestamp()
  where id=v_lead.id
  returning * into v_lead;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'lead-status',
    'prelaunch_lead',
    v_lead.id::text,
    jsonb_build_object(
      'status',v_lead.status,
      'leadType',v_lead.lead_type,
      'note',v_note
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'leadId',v_lead.id,
    'status',v_lead.status,
    'updatedAt',v_lead.updated_at
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_prelaunch_lead_action(uuid,uuid,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.admin_prelaunch_lead_action(uuid,uuid,text,text,text,text)
to service_role;

create or replace function public.admin_public_request_action(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_status text,
  p_resolution_note text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_action public.action_requests%rowtype;
  v_request public.public_requests%rowtype;
  v_result jsonb;
  v_note text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_status not in ('in_review','resolved','closed') then
    raise exception 'INVALID_PUBLIC_REQUEST_STATUS' using errcode='22023';
  end if;

  v_note:=nullif(trim(coalesce(p_resolution_note,'')),'');
  if v_note is not null and char_length(v_note)>2000 then
    raise exception 'INVALID_PUBLIC_REQUEST_NOTE' using errcode='22023';
  end if;

  if p_status in ('resolved','closed') and (v_note is null or char_length(v_note)<3) then
    raise exception 'PUBLIC_REQUEST_RESOLUTION_REQUIRED' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,'admin-ops:public-request-status',p_request_hash
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
     or v_action.action_name<>'admin-ops:public-request-status'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_request
  from public.public_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception 'PUBLIC_REQUEST_NOT_FOUND' using errcode='P0002';
  end if;

  if v_request.status='closed' then
    raise exception 'PUBLIC_REQUEST_ALREADY_CLOSED' using errcode='40001';
  end if;

  if v_request.status='resolved' and p_status<>'closed' then
    raise exception 'INVALID_PUBLIC_REQUEST_TRANSITION' using errcode='40001';
  end if;

  if v_request.status='in_review' and p_status='in_review' then
    raise exception 'INVALID_PUBLIC_REQUEST_TRANSITION' using errcode='40001';
  end if;

  update public.public_requests
  set status=p_status,
      resolution_note=case when v_note is null then resolution_note else v_note end,
      resolved_at=case
        when p_status in ('resolved','closed') then coalesce(resolved_at,clock_timestamp())
        else null
      end,
      updated_at=clock_timestamp()
  where id=v_request.id
  returning * into v_request;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'public-request-status',
    'public_request',
    v_request.id::text,
    jsonb_build_object(
      'status',v_request.status,
      'requestKind',v_request.request_kind,
      'privacyAction',v_request.privacy_action,
      'resolutionNote',v_note
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'requestId',v_request.id,
    'status',v_request.status,
    'resolvedAt',v_request.resolved_at,
    'updatedAt',v_request.updated_at
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_public_request_action(uuid,uuid,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.admin_public_request_action(uuid,uuid,text,text,text,text)
to service_role;
