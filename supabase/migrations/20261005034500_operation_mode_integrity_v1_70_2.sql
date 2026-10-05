-- TAMÃO V1.70.2 — production-mode integrity audit hardening

alter table public.platform_launch_control
  drop constraint if exists platform_launch_control_mode_commerce_consistency;

alter table public.platform_launch_control
  add constraint platform_launch_control_mode_commerce_consistency
  check (commerce_enabled = (operation_mode in ('PILOT','LIVE')));

CREATE OR REPLACE FUNCTION public.admin_operation_mode_action(p_actor_user_id uuid, p_mode text, p_reason text, p_source_sha text, p_idempotency_key text, p_request_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_action public.action_requests%rowtype;
  v_readiness jsonb;
  v_result jsonb;
  v_previous_mode text;
  v_enable boolean;
begin
  perform public.require_platform_admin(p_actor_user_id);

  p_mode:=upper(trim(coalesce(p_mode,'')));
  if p_mode not in ('PRELAUNCH','PILOT','LIVE','PAUSED') then
    raise exception 'INVALID_OPERATION_MODE' using errcode='22023';
  end if;
  if p_reason is null or char_length(trim(p_reason))<3 or char_length(p_reason)>1000 then
    raise exception 'OPERATION_MODE_REASON_REQUIRED' using errcode='22023';
  end if;
  if p_source_sha is not null
     and lower(trim(p_source_sha))!~'^[0-9a-f]{40}$' then
    raise exception 'INVALID_OPERATION_SOURCE_SHA' using errcode='22023';
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
    p_idempotency_key,p_actor_user_id,'admin-mode:'||p_mode,p_request_hash
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
     or v_action.action_name<>'admin-mode:'||p_mode
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select operation_mode
  into v_previous_mode
  from public.platform_launch_control
  where singleton=true
  for update;

  if not found then
    raise exception 'LAUNCH_CONTROL_MISSING' using errcode='P0002';
  end if;

  if p_mode<>v_previous_mode and not (
       (v_previous_mode='PRELAUNCH' and p_mode='PILOT')
    or (v_previous_mode='PILOT' and p_mode in ('LIVE','PAUSED'))
    or (v_previous_mode='LIVE' and p_mode='PAUSED')
    or (v_previous_mode='PAUSED' and p_mode='PRELAUNCH')
  ) then
    raise exception 'INVALID_OPERATION_MODE_TRANSITION' using errcode='40001';
  end if;

  v_readiness:=public.platform_launch_readiness();
  if p_mode in ('PILOT','LIVE') then
    if v_readiness->>'readinessState'='BLOCKED_SECURITY' then
      raise exception 'LAUNCH_BLOCKED_SECURITY' using errcode='42501';
    end if;
    if not coalesce((v_readiness->>'allWarningsConfirmed')::boolean,false) then
      raise exception 'LAUNCH_WARNINGS_UNCONFIRMED' using errcode='40001';
    end if;
  end if;

  v_enable:=p_mode in ('PILOT','LIVE');

  update public.platform_launch_control
  set operation_mode=p_mode,
      commerce_enabled=v_enable,
      mode_changed_at=clock_timestamp(),
      mode_changed_by=p_actor_user_id,
      mode_reason=trim(p_reason),
      mode_source_sha=case
        when p_source_sha is null then portals_source_sha
        else lower(trim(p_source_sha))
      end,
      enabled_at=case
        when v_enable and not commerce_enabled then clock_timestamp()
        else enabled_at
      end,
      enabled_by=case
        when v_enable and not commerce_enabled then p_actor_user_id
        else enabled_by
      end,
      disabled_at=case when v_enable then null else clock_timestamp() end,
      disabled_by=case when v_enable then null else p_actor_user_id end,
      updated_at=clock_timestamp()
  where singleton=true;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'set-operation-mode',
    'platform_launch',
    null,
    jsonb_build_object(
      'previousMode',v_previous_mode,
      'newMode',p_mode,
      'reason',trim(p_reason),
      'sourceSha',coalesce(lower(trim(p_source_sha)),v_readiness->>'portalsSourceSha'),
      'readiness',v_readiness
    )
  );

  v_readiness:=public.platform_launch_readiness();
  v_result:=jsonb_build_object(
    'ok',true,
    'previousMode',v_previous_mode,
    'operationMode',p_mode,
    'commerceEnabled',v_enable,
    'readiness',v_readiness
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$

