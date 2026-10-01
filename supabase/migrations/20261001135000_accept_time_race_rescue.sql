-- Chama São Gabriel — accept-time race rescue v1.9.2
-- Convert stock/capability/unavailability races at merchant acceptance into an
-- immediate, atomic rescue instead of leaving the customer waiting for timeout.

create or replace function public.rescue_offered_order_now(
  p_order_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_event_type text,
  p_title text,
  p_detail text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_result jsonb;
begin
  if p_reason is null or char_length(p_reason)<2 or char_length(p_reason)>120 then
    raise exception 'INVALID_RESCUE_REASON' using errcode='22023';
  end if;

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'OFFERED_TO_MERCHANT' then
    raise exception 'INVALID_RESCUE_STATE' using errcode='40001';
  end if;

  update public.orders
  set status='REASSIGNING',
      supplier_name_snapshot=null,
      offer_expires_at=null,
      accepted_at=null,
      dispatch_due_at=null,
      promised_by=null,
      risk_reason=p_reason,
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,
    p_actor_user_id,
    case when p_actor_user_id is null then 'system' else 'merchant' end,
    coalesce(nullif(trim(p_event_type),''),'REASSIGNING'),
    coalesce(nullif(trim(p_title),''),'Buscando outra revenda'),
    coalesce(nullif(trim(p_detail),''),'O sistema iniciou resgate automático.'),
    jsonb_build_object('reason',p_reason)
  );

  v_result:=public.system_rescue_order(v_order.id,p_reason);

  return v_result||jsonb_build_object(
    'accepted',false,
    'autoRescued',true,
    'rescueReason',p_reason
  );
end;
$$;

revoke all on function public.rescue_offered_order_now(
  uuid,text,uuid,text,text,text
) from public, anon, authenticated;
grant execute on function public.rescue_offered_order_now(
  uuid,text,uuid,text,text,text
) to postgres, service_role;

create or replace function public.merchant_order_action(
  p_user_id uuid,
  p_order_id uuid,
  p_action text,
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
  v_merchant public.merchants%rowtype;
  v_member_role text;
  v_item record;
  v_locked_stock integer;
  v_locked_active boolean;
  v_product_codes text[];
  v_accept_issue text:=null;
  v_dispatch_minutes integer;
  v_pin_bytes bytea;
  v_pin_seed integer;
  v_pin_code text;
  v_pin_hash text;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_action not in ('accept','reject','dispatch','arriving') then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;

  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_VERSION' using errcode='22023';
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
    p_idempotency_key,p_user_id,'merchant-action:'||p_action,p_request_hash
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
     or v_action.action_name<>'merchant-action:'||p_action
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

  if not found
     or v_member_role not in ('owner','manager','operator') then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  if v_order.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=v_order.merchant_id
  for share;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if p_action='accept' then
    if v_order.status<>'OFFERED_TO_MERCHANT' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    if v_order.offer_expires_at is null
       or v_order.offer_expires_at<=clock_timestamp() then
      v_result:=public.system_reassign_expired_order(v_order.id)
        ||jsonb_build_object(
          'accepted',false,
          'autoRescued',true,
          'rescueReason','offer_expired'
        );

    else
      if v_merchant.status<>'active'
         or not v_merchant.online
         or v_merchant.last_seen_at is null
         or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
        v_accept_issue:='merchant_unavailable_before_accept';
      end if;

      select array_agg(oi.product_code order by oi.product_code)
      into v_product_codes
      from public.order_items oi
      where oi.order_id=v_order.id;

      if v_accept_issue is null
         and not public.merchant_cart_delivery_compatible(
           v_order.merchant_id,
           coalesce(v_product_codes,array[]::text[])
         ) then
        v_accept_issue:='delivery_capability_changed_before_accept';
      end if;

      if v_accept_issue is null then
        for v_item in
          select oi.product_code,oi.quantity
          from public.order_items oi
          where oi.order_id=v_order.id
          order by oi.product_code
        loop
          v_locked_stock:=null;
          v_locked_active:=null;

          select ci.available_stock,ci.active
          into v_locked_stock,v_locked_active
          from public.catalog_items ci
          where ci.merchant_id=v_order.merchant_id
            and ci.product_code=v_item.product_code
          for update;

          if not found
             or not coalesce(v_locked_active,false)
             or coalesce(v_locked_stock,0)<v_item.quantity then
            v_accept_issue:='stock_changed_before_accept';
            exit;
          end if;
        end loop;
      end if;

      if v_accept_issue is not null then
        v_result:=public.rescue_offered_order_now(
          v_order.id,
          v_accept_issue,
          p_user_id,
          'ACCEPT_PRECONDITION_CHANGED',
          'Pedido redirecionado',
          'Uma condição necessária mudou antes do aceite; o sistema iniciou resgate automático.'
        );

      else
        for v_item in
          select oi.product_code,oi.quantity
          from public.order_items oi
          where oi.order_id=v_order.id
          order by oi.product_code
        loop
          update public.catalog_items
          set available_stock=available_stock-v_item.quantity,
              updated_at=clock_timestamp()
          where merchant_id=v_order.merchant_id
            and product_code=v_item.product_code;
        end loop;

        v_dispatch_minutes:=greatest(
          3,
          least(10,ceil(v_merchant.base_eta_minutes*0.35)::integer)
        );

        update public.orders
        set status='PREPARING',
            supplier_name_snapshot=v_merchant.name,
            accepted_at=clock_timestamp(),
            dispatch_due_at=clock_timestamp()+make_interval(mins=>v_dispatch_minutes),
            promised_by=clock_timestamp()+make_interval(mins=>v_merchant.base_eta_minutes+7),
            offer_expires_at=null,
            risk_reason=null,
            version=version+1,
            updated_at=clock_timestamp()
        where id=v_order.id
        returning * into v_order;

        insert into public.order_events(
          order_id,actor_user_id,actor_type,event_type,title,detail
        )
        values
          (
            v_order.id,p_user_id,'merchant','MERCHANT_ACCEPTED',
            'Revenda confirmou',
            'A revenda confirmou itens, preço, capacidade e compatibilidade de entrega.'
          ),
          (
            v_order.id,p_user_id,'merchant','PREPARING',
            'Em preparação',
            'Estoque reservado e entrega sendo preparada.'
          );

        v_result:=jsonb_build_object(
          'orderId',v_order.id,
          'status',v_order.status,
          'version',v_order.version,
          'supplierName',v_order.supplier_name_snapshot,
          'dispatchDueAt',v_order.dispatch_due_at,
          'promisedBy',v_order.promised_by,
          'accepted',true,
          'autoRescued',false
        );
      end if;
    end if;

  elsif p_action='reject' then
    if v_order.status<>'OFFERED_TO_MERCHANT' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    v_result:=public.rescue_offered_order_now(
      v_order.id,
      'merchant_rejected',
      p_user_id,
      'MERCHANT_REJECTED',
      'Revenda não consegue atender',
      'A revenda recusou antes do aceite e o sistema iniciou resgate automático.'
    );

  elsif p_action='dispatch' then
    if v_order.status not in ('PREPARING','AT_RISK') then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    select array_agg(oi.product_code order by oi.product_code)
    into v_product_codes
    from public.order_items oi
    where oi.order_id=v_order.id;

    if not public.merchant_cart_delivery_compatible(
      v_order.merchant_id,
      coalesce(v_product_codes,array[]::text[])
    ) then
      raise exception 'DELIVERY_INCOMPATIBLE' using errcode='40001';
    end if;

    v_pin_bytes:=extensions.gen_random_bytes(2);
    v_pin_seed:=get_byte(v_pin_bytes,0)*256+get_byte(v_pin_bytes,1);
    v_pin_code:=lpad((1000+(v_pin_seed%9000))::text,4,'0');
    v_pin_hash:=encode(extensions.digest(v_pin_code,'sha256'),'hex');

    insert into public.order_delivery_secrets(order_id,pin_code)
    values(v_order.id,v_pin_code)
    on conflict(order_id) do update
      set pin_code=excluded.pin_code,
          created_at=clock_timestamp(),
          revealed_at=null,
          consumed_at=null;

    update public.orders
    set status='OUT_FOR_DELIVERY',
        pin_hash=v_pin_hash,
        dispatched_at=clock_timestamp(),
        risk_reason=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_order.id,p_user_id,'merchant','OUT_FOR_DELIVERY',
      'Saiu para entrega',
      'A revenda confirmou explicitamente a saída.'
    );

    v_result:=jsonb_build_object(
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'dispatchedAt',v_order.dispatched_at
    );

  elsif p_action='arriving' then
    if v_order.status<>'OUT_FOR_DELIVERY' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    update public.orders
    set status='ARRIVING',
        arriving_at=clock_timestamp(),
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_order.id,p_user_id,'merchant','ARRIVING',
      'Entregador chegando',
      'A chegada próxima foi confirmada.'
    );

    v_result:=jsonb_build_object(
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'arrivingAt',v_order.arriving_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.merchant_order_action(
  uuid,uuid,text,integer,text,text
) from public, anon, authenticated;
grant execute on function public.merchant_order_action(
  uuid,uuid,text,integer,text,text
) to service_role;
