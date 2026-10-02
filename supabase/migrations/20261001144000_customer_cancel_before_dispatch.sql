-- Chama São Gabriel — customer cancellation before dispatch v1.14.2
-- A customer may cancel after merchant acceptance only while the order is still
-- PREPARING/AT_RISK. Order row locking serializes this against merchant dispatch.

create or replace function public.customer_order_action(
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
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_merchant public.merchants%rowtype;
  v_item record;
  v_expected_items integer:=0;
  v_restored_items integer:=0;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_action not in (
    'cancel-before-accept',
    'cancel-before-dispatch',
    'accept-requote'
  ) then
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
    p_idempotency_key,p_user_id,'customer-action:'||p_action,p_request_hash
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
     or v_action.action_name<>'customer-action:'||p_action
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
    and customer_id=p_user_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;

  if p_action='cancel-before-accept' then
    if v_order.status not in ('OFFERED_TO_MERCHANT','REQUOTE_REQUIRED') then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    if v_order.cashback_reserved_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_order.customer_id,v_order.id,'cashback','cashback_release',
        v_order.cashback_reserved_cents,
        p_idempotency_key||':cashback-release',
        jsonb_build_object('reason','customer_cancelled_before_accept')
      )
      on conflict(idempotency_key) do nothing;
    end if;

    update public.orders
    set status='CANCELLED',
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        offer_expires_at=null,
        risk_reason='customer_cancelled_before_accept',
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    delete from public.order_requote_items
    where order_id=v_order.id;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_order.id,p_user_id,'customer','CANCELLED',
      'Cancelado pelo cliente',
      'O pedido foi cancelado antes do compromisso de entrega.'
    );

    v_result:=jsonb_build_object(
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version
    );

  elsif p_action='cancel-before-dispatch' then
    if v_order.status not in ('PREPARING','AT_RISK')
       or v_order.dispatched_at is not null then
      raise exception 'TOO_LATE_TO_CANCEL' using errcode='40001';
    end if;

    select count(*)
    into v_expected_items
    from public.order_items
    where order_id=v_order.id;

    if v_expected_items<1 then
      raise exception 'STOCK_RESTORE_FAILED' using errcode='40001';
    end if;

    for v_item in
      select product_code,quantity
      from public.order_items
      where order_id=v_order.id
      order by product_code
    loop
      update public.catalog_items
      set available_stock=available_stock+v_item.quantity,
          updated_at=clock_timestamp()
      where merchant_id=v_order.merchant_id
        and product_code=v_item.product_code;

      if found then
        v_restored_items:=v_restored_items+1;
      end if;
    end loop;

    if v_restored_items<>v_expected_items then
      raise exception 'STOCK_RESTORE_FAILED' using errcode='40001';
    end if;

    if v_order.cashback_reserved_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_order.customer_id,v_order.id,'cashback','cashback_release',
        v_order.cashback_reserved_cents,
        p_idempotency_key||':cashback-release',
        jsonb_build_object('reason','customer_cancelled_before_dispatch')
      )
      on conflict(idempotency_key) do nothing;
    end if;

    update public.orders
    set status='CANCELLED',
        offer_expires_at=null,
        dispatch_due_at=null,
        promised_by=null,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        risk_reason='customer_cancelled_before_dispatch',
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,p_user_id,'customer','CANCELLED',
      'Cancelado antes da saída',
      'O cliente cancelou após o aceite, mas antes da saída. O estoque reservado foi devolvido.',
      jsonb_build_object('stockRestoredItems',v_restored_items)
    );

    v_result:=jsonb_build_object(
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'stockRestoredItems',v_restored_items
    );

  elsif p_action='accept-requote' then
    if v_order.status<>'REQUOTE_REQUIRED'
       or v_order.proposed_merchant_id is null
       or v_order.proposed_gross_total_cents is null
       or v_order.proposed_total_cents is null
       or v_order.proposed_delivery_fee_cents is null then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    if v_order.offer_expires_at is null
       or v_order.offer_expires_at<=clock_timestamp() then
      raise exception 'REQUOTE_EXPIRED' using errcode='40001';
    end if;

    select *
    into v_merchant
    from public.merchants
    where id=v_order.proposed_merchant_id
    for share;

    if not found
       or v_merchant.status<>'active'
       or not v_merchant.online
       or not v_merchant.accepts_citywide
       or v_merchant.last_seen_at is null
       or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes'
       or v_merchant.delivery_fee_confirmed_at is null
       or v_merchant.delivery_fee_confirmed_at<clock_timestamp()-interval '24 hours'
       or not public.merchant_cart_delivery_compatible(
         v_order.proposed_merchant_id,
         array(
           select oi.product_code
           from public.order_items oi
           where oi.order_id=v_order.id
           order by oi.product_code
         )
       ) then
      raise exception 'PROPOSED_OFFER_STALE' using errcode='40001';
    end if;

    if exists(
      select 1
      from public.order_items oi
      left join public.catalog_items ci
        on ci.merchant_id=v_order.proposed_merchant_id
       and ci.product_code=oi.product_code
      where oi.order_id=v_order.id
        and (
          ci.merchant_id is null
          or not ci.active
          or ci.available_stock<oi.quantity
          or ci.price_confirmed_at is null
          or ci.price_confirmed_at<clock_timestamp()-interval '24 hours'
        )
    ) then
      raise exception 'PROPOSED_OFFER_STALE' using errcode='40001';
    end if;

    update public.orders
    set merchant_id=v_order.proposed_merchant_id,
        supplier_name_snapshot=null,
        gross_total_cents=v_order.proposed_gross_total_cents,
        total_cents=v_order.proposed_total_cents,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        status='OFFERED_TO_MERCHANT',
        attempted_merchant_ids=array_append(
          attempted_merchant_ids,v_order.proposed_merchant_id
        ),
        offer_expires_at=clock_timestamp()+interval '3 minutes',
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
        v_order.id,p_user_id,'customer','REQUOTE_ACCEPTED',
        'Nova cotação aceita',
        'O cliente aceitou explicitamente a nova condição.'
      ),
      (
        v_order.id,null,'system','OFFERED_TO_MERCHANT',
        'Nova revenda acionada',
        'A nova revenda recebeu o pedido para confirmação.'
      );

    v_result:=jsonb_build_object(
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'totalCents',v_order.total_cents,
      'offerExpiresAt',v_order.offer_expires_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.customer_order_action(uuid,uuid,text,integer,text,text)
from public, anon, authenticated;
grant execute on function public.customer_order_action(uuid,uuid,text,integer,text,text)
to service_role;
