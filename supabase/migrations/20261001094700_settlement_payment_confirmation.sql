-- Chama São Gabriel — settlement requires explicit payment confirmation v1.5.4

alter table public.orders
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmation_method text;

alter table public.orders
  drop constraint if exists orders_settlement_requires_payment_confirmation;

alter table public.orders
  add constraint orders_settlement_requires_payment_confirmation
  check (
    status <> 'SETTLED'
    or (
      payment_confirmed_at is not null
      and payment_confirmation_method is not null
    )
  );

alter table public.orders
  drop constraint if exists orders_payment_confirmation_method_check;

alter table public.orders
  add constraint orders_payment_confirmation_method_check
  check (
    payment_confirmation_method is null
    or payment_confirmation_method in ('merchant_attestation','psp_webhook')
  );

create or replace function public.complete_order_delivery(
  p_user_id uuid,
  p_order_id uuid,
  p_pin_code text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_member_role text;
  v_secret public.order_delivery_secrets%rowtype;
  v_submitted_hash text;
  v_result jsonb;
  v_new_failures integer;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_pin_code is null or p_pin_code!~'^[0-9]{4}$' then
    raise exception 'INVALID_PIN_FORMAT' using errcode='22023';
  end if;

  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_VERSION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null or char_length(p_request_hash)<>64 then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_user_id,'complete-delivery',p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_user_id
     or v_action.action_name<>'complete-delivery'
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

  select mm.member_role
  into v_member_role
  from public.merchant_members mm
  where mm.merchant_id=v_order.merchant_id
    and mm.user_id=p_user_id
    and mm.active
  limit 1;

  if not found then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  if v_order.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;

  if v_order.status<>'ARRIVING' then
    raise exception 'INVALID_TRANSITION' using errcode='40001';
  end if;

  if v_order.pin_failures>=5 then
    raise exception 'PIN_LOCKED' using errcode='42501';
  end if;

  select *
  into v_secret
  from public.order_delivery_secrets
  where order_id=v_order.id
  for update;

  if not found
     or v_secret.consumed_at is not null
     or v_order.pin_hash is null then
    raise exception 'PIN_UNAVAILABLE' using errcode='40001';
  end if;

  v_submitted_hash:=encode(extensions.digest(p_pin_code,'sha256'),'hex');

  if v_submitted_hash<>v_order.pin_hash then
    v_new_failures:=v_order.pin_failures+1;

    update public.orders
    set pin_failures=v_new_failures,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,p_user_id,'merchant',
      case when v_new_failures>=5 then 'PIN_LOCKED' else 'PIN_FAILED' end,
      case when v_new_failures>=5 then 'PIN bloqueado' else 'PIN incorreto' end,
      'A entrega não foi concluída.',
      jsonb_build_object('failureCount',v_new_failures)
    );

    v_result:=jsonb_build_object(
      'ok',false,
      'error',case when v_new_failures>=5 then 'PIN_LOCKED' else 'INVALID_PIN' end,
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'pinFailures',v_new_failures
    );

    update public.action_requests
    set result_json=v_result,
        completed_at=clock_timestamp()
    where idempotency_key=p_idempotency_key;

    return v_result;
  end if;

  update public.orders
  set status='SETTLED',
      delivered_at=clock_timestamp(),
      payment_confirmed_at=clock_timestamp(),
      payment_confirmation_method='merchant_attestation',
      settled_at=clock_timestamp(),
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id
  returning * into v_order;

  update public.order_delivery_secrets
  set consumed_at=clock_timestamp()
  where order_id=v_order.id;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail
  )
  values
    (
      v_order.id,p_user_id,'merchant','PAYMENT_CONFIRMED',
      'Pagamento confirmado',
      'A revenda confirmou o recebimento do pagamento no fechamento da entrega.'
    ),
    (
      v_order.id,p_user_id,'merchant','DELIVERED',
      'Entregue',
      'O PIN de recebimento foi validado.'
    ),
    (
      v_order.id,null,'system','SETTLED',
      'Pedido concluído',
      'Entrega e pagamento foram confirmados e o pedido foi encerrado.'
    );

  update public.referrals
  set qualified_order_id=v_order.id
  where referred_user_id=v_order.customer_id
    and qualified_order_id is null;

  v_result:=jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'status',v_order.status,
    'version',v_order.version,
    'deliveredAt',v_order.delivered_at,
    'paymentConfirmedAt',v_order.payment_confirmed_at,
    'settledAt',v_order.settled_at
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.complete_order_delivery(uuid,uuid,text,integer,text,text)
from public, anon, authenticated;
grant execute on function public.complete_order_delivery(uuid,uuid,text,integer,text,text)
to service_role;
