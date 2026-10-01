-- Chama São Gabriel — admin delivery capability control v1.8.2

create or replace function public.admin_set_delivery_capability(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_active boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant public.merchants%rowtype;
  v_compliance public.merchant_compliance%rowtype;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_merchant_id is null then
    raise exception 'INVALID_MERCHANT' using errcode='22023';
  end if;

  if p_notes is not null and char_length(trim(p_notes))>1000 then
    raise exception 'NOTES_TOO_LONG' using errcode='22023';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for update;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  select *
  into v_compliance
  from public.merchant_compliance
  where merchant_id=p_merchant_id
  for share;

  if p_active then
    if not found
       or v_compliance.cnpj_status<>'verified' then
      raise exception 'CNPJ_VERIFICATION_REQUIRED' using errcode='40001';
    end if;

    if v_compliance.anp_status<>'verified' then
      raise exception 'ANP_VERIFICATION_REQUIRED' using errcode='40001';
    end if;
  end if;

  insert into public.merchant_delivery_capabilities(
    merchant_id,capability_code,active,verified_at,verified_by,notes,updated_at
  )
  values(
    p_merchant_id,
    'regulated_glp_mixed_load_verified',
    p_active,
    clock_timestamp(),
    p_actor_user_id,
    nullif(trim(p_notes),''),
    clock_timestamp()
  )
  on conflict(merchant_id,capability_code) do update
  set active=excluded.active,
      verified_at=excluded.verified_at,
      verified_by=excluded.verified_by,
      notes=excluded.notes,
      updated_at=clock_timestamp();

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_active
      then 'delivery_capability_verified'
      else 'delivery_capability_revoked'
    end,
    'merchant',
    p_merchant_id::text,
    jsonb_build_object(
      'capabilityCode','regulated_glp_mixed_load_verified',
      'active',p_active,
      'notes',p_notes
    )
  );

  return jsonb_build_object(
    'ok',true,
    'merchantId',p_merchant_id,
    'capabilityCode','regulated_glp_mixed_load_verified',
    'active',p_active,
    'verifiedAt',clock_timestamp()
  );
end;
$$;

revoke all on function public.admin_set_delivery_capability(uuid,uuid,boolean,text)
from public, anon, authenticated;
grant execute on function public.admin_set_delivery_capability(uuid,uuid,boolean,text)
to service_role;

create or replace function public.admin_delivery_capability_action(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_active boolean,
  p_notes text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

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
    'admin-ops:set-delivery-capability',p_request_hash
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
     or v_action.action_name<>'admin-ops:set-delivery-capability'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  v_result:=public.admin_set_delivery_capability(
    p_actor_user_id,p_merchant_id,p_active,p_notes
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_delivery_capability_action(
  uuid,uuid,boolean,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_delivery_capability_action(
  uuid,uuid,boolean,text,text,text
) to service_role;
