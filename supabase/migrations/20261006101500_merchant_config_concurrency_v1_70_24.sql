-- TAMÃO V1.70.24 — merchant configuration concurrency authority
-- Serializes merchant operational configuration writes and makes retries
-- idempotent so a lost ACK cannot silently overwrite a newer tab.

create or replace function public.merchant_config_action(
  p_user_id uuid,
  p_merchant_id uuid,
  p_action text,
  p_expected_updated_at timestamptz,
  p_payload jsonb,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_merchant public.merchants%rowtype;
  v_role text;
  v_now timestamptz:=clock_timestamp();
  v_result jsonb;
  v_delivery_fee integer;
  v_eta integer;
  v_citywide boolean;
  v_capacity integer;
  v_scheduling boolean;
  v_pix boolean;
  v_card boolean;
  v_cash boolean;
begin
  if p_user_id is null or p_merchant_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  p_action:=trim(coalesce(p_action,''));
  if p_action not in ('update-logistics','update-capacity','update-scheduling','update-payment-methods') then
    raise exception 'INVALID_ACTION' using errcode='22023';
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
    p_idempotency_key,p_user_id,'merchant-config:'||p_action,p_request_hash
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

  if v_action.user_id<>p_user_id
     or v_action.action_name<>'merchant-config:'||p_action
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select mm.member_role
  into v_role
  from public.merchant_members mm
  where mm.merchant_id=p_merchant_id
    and mm.user_id=p_user_id
    and mm.active
  limit 1;

  if not found or v_role not in ('owner','manager') then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for update;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if p_expected_updated_at is null then
    raise exception 'CONFIG_VERSION_REQUIRED' using errcode='40001';
  end if;
  if v_merchant.updated_at is distinct from p_expected_updated_at then
    raise exception 'CONFIG_VERSION_CONFLICT' using errcode='40001';
  end if;

  p_payload:=coalesce(p_payload,'{}'::jsonb);

  if p_action='update-logistics' then
    v_delivery_fee:=(p_payload->>'deliveryFeeCents')::integer;
    v_eta:=(p_payload->>'baseEtaMinutes')::integer;
    v_citywide:=coalesce((p_payload->>'acceptsCitywide')::boolean,false);

    if v_delivery_fee<0 or v_delivery_fee>100000 then
      raise exception 'INVALID_DELIVERY_FEE' using errcode='22023';
    end if;
    if v_eta<5 or v_eta>180 then
      raise exception 'INVALID_BASE_ETA' using errcode='22023';
    end if;

    update public.merchants
    set delivery_fee_cents=v_delivery_fee,
        delivery_fee_confirmed_at=v_now,
        base_eta_minutes=v_eta,
        accepts_citywide=v_citywide,
        online=case when v_citywide then online else false end,
        last_seen_at=v_now,
        updated_at=v_now
    where id=p_merchant_id
    returning * into v_merchant;

    v_result:=jsonb_build_object(
      'ok',true,
      'action',p_action,
      'deliveryFeeCents',v_merchant.delivery_fee_cents,
      'deliveryFeeConfirmedAt',v_merchant.delivery_fee_confirmed_at,
      'baseEtaMinutes',v_merchant.base_eta_minutes,
      'acceptsCitywide',v_merchant.accepts_citywide,
      'online',v_merchant.online,
      'lastSeenAt',v_merchant.last_seen_at,
      'configUpdatedAt',v_merchant.updated_at
    );

  elsif p_action='update-capacity' then
    v_capacity:=(p_payload->>'maxActiveOrders')::integer;
    if v_capacity<1 or v_capacity>100 then
      raise exception 'INVALID_MAX_ACTIVE_ORDERS' using errcode='22023';
    end if;

    update public.merchants
    set max_active_orders=v_capacity,
        last_seen_at=v_now,
        updated_at=v_now
    where id=p_merchant_id
    returning * into v_merchant;

    v_result:=jsonb_build_object(
      'ok',true,
      'action',p_action,
      'maxActiveOrders',v_merchant.max_active_orders,
      'lastSeenAt',v_merchant.last_seen_at,
      'configUpdatedAt',v_merchant.updated_at
    );

  elsif p_action='update-scheduling' then
    v_scheduling:=coalesce((p_payload->>'acceptsScheduledOrders')::boolean,false);

    update public.merchants
    set accepts_scheduled_orders=v_scheduling,
        last_seen_at=v_now,
        updated_at=v_now
    where id=p_merchant_id
    returning * into v_merchant;

    v_result:=jsonb_build_object(
      'ok',true,
      'action',p_action,
      'acceptsScheduledOrders',v_merchant.accepts_scheduled_orders,
      'lastSeenAt',v_merchant.last_seen_at,
      'configUpdatedAt',v_merchant.updated_at
    );

  elsif p_action='update-payment-methods' then
    v_pix:=coalesce((p_payload->>'pix')::boolean,false);
    v_card:=coalesce((p_payload->>'card')::boolean,false);
    v_cash:=coalesce((p_payload->>'cash')::boolean,false);

    if not (v_pix or v_card or v_cash) then
      raise exception 'PAYMENT_METHOD_REQUIRED' using errcode='22023';
    end if;

    insert into public.merchant_payment_methods(
      merchant_id,payment_method,active,confirmed_at,updated_at
    )
    values
      (p_merchant_id,'pix',v_pix,v_now,v_now),
      (p_merchant_id,'card',v_card,v_now,v_now),
      (p_merchant_id,'cash',v_cash,v_now,v_now)
    on conflict(merchant_id,payment_method) do update
      set active=excluded.active,
          confirmed_at=excluded.confirmed_at,
          updated_at=excluded.updated_at;

    update public.merchants
    set last_seen_at=v_now,
        updated_at=v_now
    where id=p_merchant_id
    returning * into v_merchant;

    v_result:=jsonb_build_object(
      'ok',true,
      'action',p_action,
      'paymentMethods',jsonb_build_object(
        'pix',v_pix,
        'card',v_card,
        'cash',v_cash
      ),
      'lastSeenAt',v_merchant.last_seen_at,
      'configUpdatedAt',v_merchant.updated_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.merchant_config_action(
  uuid,uuid,text,timestamptz,jsonb,text,text
) from public, anon, authenticated;

grant execute on function public.merchant_config_action(
  uuid,uuid,text,timestamptz,jsonb,text,text
) to service_role;

comment on function public.merchant_config_action(
  uuid,uuid,text,timestamptz,jsonb,text,text
) is 'Server-only idempotent optimistic-concurrency authority for merchant operational configuration.';
