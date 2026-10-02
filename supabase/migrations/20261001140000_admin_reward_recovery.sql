-- Chama São Gabriel — admin reward recovery authority v1.9.7
-- Dead-lettered reward debt can be retried explicitly by an authorized admin.
-- Delivery/settlement are never rolled back by reward recovery.

create or replace function public.admin_retry_order_reward(
  p_actor_user_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_failure public.reward_processing_failures%rowtype;
  v_grant jsonb;
  v_recorded jsonb;
  v_error text;
  v_sqlstate text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  perform pg_advisory_xact_lock(
    hashtextextended('reward:'||p_order_id::text,0)
  );

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.financial_reversed_at is not null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_REWARDS' using errcode='40001';
  end if;

  select *
  into v_failure
  from public.reward_processing_failures
  where order_id=p_order_id
  for update;

  if found and v_failure.resolved_at is not null then
    return jsonb_build_object(
      'ok',true,
      'orderId',p_order_id,
      'alreadyResolved',true
    );
  end if;

  begin
    v_grant:=public.grant_order_rewards(p_order_id);

    update public.reward_processing_failures
    set resolved_at=clock_timestamp(),
        next_retry_at=null,
        dead_lettered_at=null,
        updated_at=clock_timestamp()
    where order_id=p_order_id
      and resolved_at is null;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'reward_retry_succeeded',
      'order',
      p_order_id::text,
      jsonb_build_object('grant',v_grant)
    );

    return jsonb_build_object(
      'ok',true,
      'orderId',p_order_id,
      'alreadyResolved',false,
      'grant',v_grant
    );

  exception when others then
    v_error:=left(sqlerrm,2000);
    v_sqlstate:=sqlstate;

    v_recorded:=public.record_reward_processing_failure(
      p_order_id,v_sqlstate,v_error
    );

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'reward_retry_failed',
      'order',
      p_order_id::text,
      jsonb_build_object(
        'sqlstate',v_sqlstate,
        'error',v_error,
        'failure',v_recorded
      )
    );

    return jsonb_build_object(
      'ok',false,
      'orderId',p_order_id,
      'error','REWARD_RETRY_FAILED',
      'detail',v_error,
      'failure',v_recorded
    );
  end;
end;
$$;

revoke all on function public.admin_retry_order_reward(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.admin_retry_order_reward(uuid,uuid)
to service_role;

create or replace function public.admin_reward_retry_action(
  p_actor_user_id uuid,
  p_order_id uuid,
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
    'admin-ops:retry-reward',p_request_hash
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
     or v_action.action_name<>'admin-ops:retry-reward'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  v_result:=public.admin_retry_order_reward(
    p_actor_user_id,p_order_id
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_reward_retry_action(
  uuid,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.admin_reward_retry_action(
  uuid,uuid,text,text
) to service_role;
