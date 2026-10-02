-- Chama São Gabriel — enforce delivery compatibility v1.8.1

create or replace function public.assert_quote_delivery_compatible()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant_id uuid;
  v_codes text[];
begin
  select q.merchant_id
  into v_merchant_id
  from public.quotes q
  where q.id=new.quote_id;

  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;

  select array_agg(qi.product_code order by qi.product_code)
  into v_codes
  from public.quote_items qi
  where qi.quote_id=new.quote_id;

  if coalesce(cardinality(v_codes),0)>0
     and not public.merchant_cart_delivery_compatible(v_merchant_id,v_codes) then
    raise exception 'DELIVERY_INCOMPATIBLE' using errcode='40001';
  end if;

  return new;
end;
$$;

revoke all on function public.assert_quote_delivery_compatible()
from public, anon, authenticated;
grant execute on function public.assert_quote_delivery_compatible()
to postgres, service_role;

drop trigger if exists quote_delivery_compatibility_guard
on public.quote_items;

create constraint trigger quote_delivery_compatibility_guard
after insert or update on public.quote_items
deferrable initially deferred
for each row
execute function public.assert_quote_delivery_compatible();

create or replace function public.assert_order_item_delivery_compatible()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order_id uuid;
  v_merchant_id uuid;
  v_codes text[];
begin
  v_order_id:=coalesce(new.order_id,old.order_id);

  select o.merchant_id
  into v_merchant_id
  from public.orders o
  where o.id=v_order_id;

  if not found or v_merchant_id is null then
    return coalesce(new,old);
  end if;

  select array_agg(oi.product_code order by oi.product_code)
  into v_codes
  from public.order_items oi
  where oi.order_id=v_order_id;

  if coalesce(cardinality(v_codes),0)>0
     and not public.merchant_cart_delivery_compatible(v_merchant_id,v_codes) then
    raise exception 'DELIVERY_INCOMPATIBLE' using errcode='40001';
  end if;

  return coalesce(new,old);
end;
$$;

revoke all on function public.assert_order_item_delivery_compatible()
from public, anon, authenticated;
grant execute on function public.assert_order_item_delivery_compatible()
to postgres, service_role;

drop trigger if exists order_item_delivery_compatibility_guard
on public.order_items;

create constraint trigger order_item_delivery_compatibility_guard
after insert or update on public.order_items
deferrable initially deferred
for each row
execute function public.assert_order_item_delivery_compatible();

create or replace function public.assert_order_delivery_transition_compatible()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_codes text[];
  v_target_merchant uuid;
begin
  select array_agg(oi.product_code order by oi.product_code)
  into v_codes
  from public.order_items oi
  where oi.order_id=new.id;

  if coalesce(cardinality(v_codes),0)=0 then
    return new;
  end if;

  if new.proposed_merchant_id is not null
     and new.proposed_merchant_id is distinct from old.proposed_merchant_id then
    if not public.merchant_cart_delivery_compatible(new.proposed_merchant_id,v_codes) then
      raise exception 'DELIVERY_INCOMPATIBLE' using errcode='40001';
    end if;
  end if;

  if new.merchant_id is distinct from old.merchant_id
     or (
       new.status in ('PREPARING','OUT_FOR_DELIVERY')
       and new.status is distinct from old.status
     ) then
    v_target_merchant:=new.merchant_id;
    if v_target_merchant is not null
       and not public.merchant_cart_delivery_compatible(v_target_merchant,v_codes) then
      raise exception 'DELIVERY_INCOMPATIBLE' using errcode='40001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.assert_order_delivery_transition_compatible()
from public, anon, authenticated;
grant execute on function public.assert_order_delivery_transition_compatible()
to postgres, service_role;

drop trigger if exists order_delivery_transition_compatibility_guard
on public.orders;

create trigger order_delivery_transition_compatibility_guard
before update of merchant_id,proposed_merchant_id,status on public.orders
for each row
execute function public.assert_order_delivery_transition_compatible();

CREATE OR REPLACE FUNCTION public.merchant_order_action(
  p_user_id uuid,
  p_order_id uuid,
  p_action text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_merchant public.merchants%rowtype;
  v_member_role text;
  v_item record;
  v_product_codes text[];
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

  if p_request_hash is null or char_length(p_request_hash)<>64 then
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
      raise exception 'OFFER_EXPIRED' using errcode='40001';
    end if;

    if v_merchant.status<>'active'
       or not v_merchant.online
       or v_merchant.last_seen_at is null
       or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
      raise exception 'MERCHANT_UNAVAILABLE' using errcode='40001';
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

    for v_item in
      select product_code,quantity
      from public.order_items
      where order_id=v_order.id
      order by product_code
    loop
      update public.catalog_items
      set available_stock=available_stock-v_item.quantity,
          updated_at=clock_timestamp()
      where merchant_id=v_order.merchant_id
        and product_code=v_item.product_code
        and active
        and available_stock>=v_item.quantity;

      if not found then
        raise exception 'INSUFFICIENT_STOCK' using errcode='40001';
      end if;
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
      'promisedBy',v_order.promised_by
    );

  elsif p_action='reject' then
    if v_order.status<>'OFFERED_TO_MERCHANT' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    update public.orders
    set status='REASSIGNING',
        supplier_name_snapshot=null,
        offer_expires_at=null,
        accepted_at=null,
        dispatch_due_at=null,
        promised_by=null,
        risk_reason='merchant_rejected',
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_order.id,p_user_id,'merchant','MERCHANT_REJECTED',
      'Revenda não consegue atender',
      'A revenda recusou antes do aceite e o sistema iniciou resgate automático.'
    );

    v_result:=public.system_rescue_order(v_order.id,'merchant_rejected');

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
$function$;

revoke all on function public.merchant_order_action(
  uuid,uuid,text,integer,text,text
) from public, anon, authenticated;
grant execute on function public.merchant_order_action(
  uuid,uuid,text,integer,text,text
) to service_role;

CREATE OR REPLACE FUNCTION public.system_rescue_order(
  p_order_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_candidate_id uuid;
  v_candidate_gross integer;
  v_candidate_fee integer;
  v_new_reserved integer;
  v_release_diff integer;
  v_key text;
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

  if v_order.status<>'REASSIGNING' then
    raise exception 'INVALID_RESCUE_STATE' using errcode='40001';
  end if;

  v_key:='system-rescue:'||replace(v_order.id::text,'-','')||':'||v_order.version::text;

  select
    m.id,
    (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents)::integer,
    m.delivery_fee_cents
  into
    v_candidate_id,
    v_candidate_gross,
    v_candidate_fee
  from public.merchants m
  join public.order_items oi
    on oi.order_id=v_order.id
  join public.catalog_items ci
    on ci.merchant_id=m.id
   and ci.product_code=oi.product_code
   and ci.active
   and ci.available_stock>=oi.quantity
   and ci.price_confirmed_at is not null
   and ci.price_confirmed_at>=clock_timestamp()-interval '24 hours'
  where m.status='active'
    and m.online
    and m.accepts_citywide
    and m.last_seen_at>=clock_timestamp()-interval '10 minutes'
    and m.delivery_fee_confirmed_at is not null
    and m.delivery_fee_confirmed_at>=clock_timestamp()-interval '24 hours'
    and not (m.id=any(v_order.attempted_merchant_ids))
    and public.merchant_cart_delivery_compatible(
      m.id,
      array(
        select oi2.product_code
        from public.order_items oi2
        where oi2.order_id=v_order.id
        order by oi2.product_code
      )
    )
  group by m.id,m.delivery_fee_cents,m.base_eta_minutes,m.trust_score
  having count(*)=(select count(*) from public.order_items where order_id=v_order.id)
  order by
    (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents) asc,
    m.base_eta_minutes asc,
    m.trust_score desc
  limit 1;

  if v_candidate_id is null then
    update public.orders
    set status='CANCELLED',
        supplier_name_snapshot=null,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        risk_reason=p_reason,
        offer_expires_at=null,
        dispatch_due_at=null,
        promised_by=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    if v_order.cashback_reserved_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_order.customer_id,v_order.id,'cashback','cashback_release',
        v_order.cashback_reserved_cents,
        v_key||':cashback-release',
        jsonb_build_object('reason',p_reason)
      )
      on conflict(idempotency_key) do nothing;
    end if;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','CANCELLED',
      'Pedido cancelado',
      'Nenhuma outra revenda elegível e logisticamente compatível conseguiu assumir o pedido.',
      jsonb_build_object('reason',p_reason)
    );

    return jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status','CANCELLED','version',v_order.version
    );
  end if;

  v_new_reserved:=least(v_order.cashback_reserved_cents,v_candidate_gross);
  v_release_diff:=v_order.cashback_reserved_cents-v_new_reserved;

  if v_release_diff>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,v_order.id,'cashback','cashback_release',
      v_release_diff,
      v_key||':cashback-rebalance',
      jsonb_build_object('reason',p_reason)
    )
    on conflict(idempotency_key) do nothing;
  end if;

  if v_candidate_gross<=v_order.gross_total_cents then
    update public.orders
    set merchant_id=v_candidate_id,
        supplier_name_snapshot=null,
        gross_total_cents=v_candidate_gross,
        cashback_reserved_cents=v_new_reserved,
        total_cents=v_candidate_gross-v_new_reserved,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        status='OFFERED_TO_MERCHANT',
        attempted_merchant_ids=array_append(attempted_merchant_ids,v_candidate_id),
        offer_expires_at=clock_timestamp()+interval '3 minutes',
        accepted_at=null,
        dispatch_due_at=null,
        promised_by=null,
        risk_reason=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','OFFERED_TO_MERCHANT',
      'Nova revenda acionada',
      'Outra revenda compatível recebeu o pedido sem aumento de preço.',
      jsonb_build_object('reason',p_reason)
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'totalCents',v_order.total_cents,'offerExpiresAt',v_order.offer_expires_at
    );
  else
    update public.orders
    set status='REQUOTE_REQUIRED',
        supplier_name_snapshot=null,
        proposed_merchant_id=v_candidate_id,
        proposed_gross_total_cents=v_candidate_gross,
        proposed_total_cents=v_candidate_gross-v_new_reserved,
        proposed_delivery_fee_cents=v_candidate_fee,
        offer_expires_at=clock_timestamp()+interval '5 minutes',
        accepted_at=null,
        dispatch_due_at=null,
        promised_by=null,
        risk_reason=p_reason,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','REQUOTE_REQUIRED',
      'Nova confirmação necessária',
      'A alternativa logisticamente compatível possui preço diferente e fica reservada por até 5 minutos.',
      jsonb_build_object('reason',p_reason,'expiresAt',v_order.offer_expires_at)
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'proposedTotalCents',v_order.proposed_total_cents,
      'offerExpiresAt',v_order.offer_expires_at
    );
  end if;

  return v_result;
end;
$function$;

revoke all on function public.system_rescue_order(uuid,text)
from public, anon, authenticated;
grant execute on function public.system_rescue_order(uuid,text)
to postgres, service_role;
