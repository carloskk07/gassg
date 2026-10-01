-- Chama São Gabriel — idempotent admin mutations v1.7.3
-- Reuses action_requests so every privileged mutation can be retried safely.

create or replace function public.admin_execute_action(
  p_actor_user_id uuid,
  p_action_name text,
  p_payload jsonb,
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
  v_application_id uuid;
  v_merchant_id uuid;
  v_order_id uuid;
  v_target_id uuid;
  v_reason text;
  v_reference text;
  v_kind text;
  v_financial_action text;
  v_cnpj_status text;
  v_anp_status text;
  v_anp_reference text;
  v_notes text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_action_name is null
     or p_action_name not in (
       'approve-application',
       'reject-application',
       'verify-merchant',
       'activate-merchant',
       'suspend-merchant',
       'reverse-order',
       'financial-action'
     ) then
    raise exception 'INVALID_ADMIN_ACTION' using errcode='22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'INVALID_ADMIN_PAYLOAD' using errcode='22023';
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
    p_idempotency_key,
    p_actor_user_id,
    'admin-ops:'||p_action_name,
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
     or v_action.action_name<>('admin-ops:'||p_action_name)
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  case p_action_name
    when 'approve-application' then
      begin
        v_application_id:=(p_payload->>'applicationId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_APPLICATION' using errcode='22023';
      end;
      v_result:=public.admin_approve_merchant_application(
        p_actor_user_id,
        v_application_id
      );

    when 'reject-application' then
      begin
        v_application_id:=(p_payload->>'applicationId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_APPLICATION' using errcode='22023';
      end;
      v_reason:=nullif(trim(p_payload->>'reason'),'');
      v_result:=public.admin_reject_merchant_application(
        p_actor_user_id,
        v_application_id,
        v_reason
      );

    when 'verify-merchant' then
      begin
        v_merchant_id:=(p_payload->>'merchantId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_MERCHANT' using errcode='22023';
      end;
      v_cnpj_status:=p_payload->>'cnpjStatus';
      v_anp_status:=p_payload->>'anpStatus';
      v_anp_reference:=nullif(trim(p_payload->>'anpReference'),'');
      v_notes:=nullif(trim(p_payload->>'notes'),'');
      v_result:=public.admin_verify_merchant(
        p_actor_user_id,
        v_merchant_id,
        v_cnpj_status,
        v_anp_status,
        v_anp_reference,
        v_notes
      );

    when 'activate-merchant' then
      begin
        v_merchant_id:=(p_payload->>'merchantId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_MERCHANT' using errcode='22023';
      end;
      v_result:=public.admin_set_merchant_status(
        p_actor_user_id,
        v_merchant_id,
        'active'
      );

    when 'suspend-merchant' then
      begin
        v_merchant_id:=(p_payload->>'merchantId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_MERCHANT' using errcode='22023';
      end;
      v_result:=public.admin_set_merchant_status(
        p_actor_user_id,
        v_merchant_id,
        'suspended'
      );

    when 'reverse-order' then
      begin
        v_order_id:=(p_payload->>'orderId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_ORDER' using errcode='22023';
      end;
      v_reason:=nullif(trim(p_payload->>'reason'),'');
      v_reference:=nullif(trim(p_payload->>'reference'),'');
      v_result:=public.admin_reverse_settled_order(
        p_actor_user_id,
        v_order_id,
        v_reason,
        v_reference
      );

    when 'financial-action' then
      begin
        v_target_id:=(p_payload->>'targetId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_TARGET' using errcode='22023';
      end;
      v_kind:=p_payload->>'kind';
      v_financial_action:=p_payload->>'financialAction';
      v_reference:=nullif(trim(p_payload->>'reference'),'');
      v_result:=public.admin_financial_action(
        p_actor_user_id,
        v_kind,
        v_target_id,
        v_financial_action,
        v_reference
      );
  end case;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_execute_action(uuid,text,jsonb,text,text)
from public, anon, authenticated;
grant execute on function public.admin_execute_action(uuid,text,jsonb,text,text)
to service_role;
