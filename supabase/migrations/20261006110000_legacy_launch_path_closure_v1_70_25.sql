-- TAMÃO V1.70.25 — Legacy launch path closure
-- Production activation must always pass through the Edge portal re-probe and
-- the modern operation-mode authority. The old direct enable action is retired.

create or replace function public.admin_launch_control_action(
  p_actor_user_id uuid,
  p_action text,
  p_source_sha text,
  p_customer_ok boolean,
  p_merchant_ok boolean,
  p_admin_ok boolean,
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
  v_readiness jsonb;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_action='enable-commerce' then
    raise exception 'LEGACY_ENABLE_COMMERCE_DISABLED' using errcode='42501';
  elsif p_action='disable-commerce' then
    return public.admin_operation_mode_action(
      p_actor_user_id,'PAUSED',
      'Pausa imediata de novos pedidos pelo kill switch.',
      p_source_sha,p_idempotency_key,p_request_hash
    );
  elsif p_action<>'record-portals' then
    raise exception 'INVALID_LAUNCH_ACTION' using errcode='22023';
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
  if p_source_sha is null
     or lower(trim(p_source_sha))!~'^[0-9a-f]{40}$'
     or not coalesce(p_customer_ok,false)
     or not coalesce(p_merchant_ok,false)
     or not coalesce(p_admin_ok,false) then
    raise exception 'PORTAL_ATTESTATION_INVALID' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,'admin-launch:record-portals',p_request_hash
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
     or v_action.action_name<>'admin-launch:record-portals'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  update public.platform_launch_control
  set portals_verified_at=clock_timestamp(),
      portals_source_sha=lower(trim(p_source_sha)),
      customer_portal_ok=true,
      merchant_portal_ok=true,
      admin_portal_ok=true,
      updated_at=clock_timestamp()
  where singleton=true;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,'record-launch-portals','platform_launch',null,
    jsonb_build_object('sourceSha',lower(trim(p_source_sha)))
  );

  v_readiness:=public.platform_launch_readiness();
  v_result:=jsonb_build_object(
    'ok',true,
    'action','record-portals',
    'commerceEnabled',coalesce((v_readiness->>'commerceEnabled')::boolean,false),
    'readiness',v_readiness
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_launch_control_action(
  uuid,text,text,boolean,boolean,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.admin_launch_control_action(
  uuid,text,text,boolean,boolean,boolean,text,text
) to service_role;
