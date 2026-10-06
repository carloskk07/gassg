-- TAMÃO V1.70.23 — resolução administrativa de incidente após despacho
-- Corrige pedido que poderia permanecer ativo indefinidamente após falha real de entrega.
-- Conservador por desenho: encerra o pedido, libera cashback reservado, invalida PIN,
-- preserva timestamps/atribuição de saída e NÃO devolve estoque automaticamente.

alter table public.orders
  drop constraint if exists orders_dispatch_timestamp_state;

alter table public.orders
  add constraint orders_dispatch_timestamp_state
  check (
    dispatched_at is null
    or status in ('OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED','CANCELLED')
  );

alter table public.orders
  drop constraint if exists orders_arriving_timestamp_state;

alter table public.orders
  add constraint orders_arriving_timestamp_state
  check (
    arriving_at is null
    or status in ('ARRIVING','DELIVERED','SETTLED','CANCELLED')
  );

create or replace function public.admin_cancel_dispatched_order(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_expected_version integer,
  p_reason text,
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
  v_order public.orders%rowtype;
  v_previous_status text;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  p_reason:=trim(regexp_replace(coalesce(p_reason,''),'\s+',' ','g'));
  if p_order_id is null then
    raise exception 'INVALID_ORDER' using errcode='22023';
  end if;
  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_VERSION' using errcode='22023';
  end if;
  if char_length(p_reason)<3 or char_length(p_reason)>1000 then
    raise exception 'ADMIN_ORDER_REASON_REQUIRED' using errcode='22023';
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
    'admin-order:cancel-after-dispatch',p_request_hash
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
     or v_action.action_name<>'admin-order:cancel-after-dispatch'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;
  if v_order.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;
  if v_order.status not in ('OUT_FOR_DELIVERY','ARRIVING')
     or v_order.dispatched_at is null then
    raise exception 'ORDER_NOT_DISPATCHED_INCIDENT' using errcode='40001';
  end if;
  if v_order.delivered_at is not null
     or v_order.settled_at is not null
     or v_order.payment_confirmed_at is not null
     or v_order.payment_confirmation_method is not null
     or v_order.financial_state<>'pending' then
    raise exception 'ORDER_FINANCIAL_STATE_NOT_CANCELLABLE' using errcode='40001';
  end if;

  v_previous_status:=v_order.status;

  if v_order.cashback_reserved_cents>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,v_order.id,'cashback','cashback_release',
      v_order.cashback_reserved_cents,
      p_idempotency_key||':cashback-release',
      jsonb_build_object(
        'reason','admin_cancelled_after_dispatch',
        'adminActorUserId',p_actor_user_id
      )
    )
    on conflict(idempotency_key) do nothing;
  end if;

  delete from public.order_delivery_secrets
  where order_id=v_order.id;

  delete from public.order_requote_items
  where order_id=v_order.id;

  update public.orders
  set status='CANCELLED',
      proposed_merchant_id=null,
      proposed_gross_total_cents=null,
      proposed_total_cents=null,
      proposed_delivery_fee_cents=null,
      offer_expires_at=null,
      pin_hash=null,
      pin_failures=0,
      risk_reason='admin_cancelled_after_dispatch',
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id
  returning * into v_order;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,p_actor_user_id,'admin','CANCELLED_AFTER_DISPATCH',
    'Entrega encerrada pela administração',
    'Uma falha operacional após a saída encerrou o pedido. O estoque não foi devolvido automaticamente.',
    jsonb_build_object(
      'previousStatus',v_previous_status,
      'previousVersion',p_expected_version,
      'stockRestored',false
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'status',v_order.status,
    'version',v_order.version,
    'action','cancel-after-dispatch',
    'stockRestored',false,
    'manualStockReviewRequired',true
  );

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'order-control-cancel-after-dispatch',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'reason',p_reason,
      'expectedVersion',p_expected_version,
      'previousStatus',v_previous_status,
      'stockRestored',false,
      'result',v_result
    )
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_cancel_dispatched_order(uuid,uuid,integer,text,text,text)
from public,anon,authenticated;
grant execute on function public.admin_cancel_dispatched_order(uuid,uuid,integer,text,text,text)
to service_role;
