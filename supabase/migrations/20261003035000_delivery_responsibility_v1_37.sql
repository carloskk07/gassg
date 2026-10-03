-- Chama São Gabriel — delivery responsibility v1.37

alter table public.merchant_members
  add column if not exists display_name text;

alter table public.merchant_members
  drop constraint if exists merchant_members_display_name_check,
  add constraint merchant_members_display_name_check check (
    display_name is null
    or (
      char_length(trim(display_name)) between 2 and 60
      and display_name=trim(display_name)
    )
  );

alter table public.orders
  add column if not exists assigned_delivery_user_id uuid references auth.users(id) on delete set null,
  add column if not exists delivery_assigned_at timestamptz,
  add column if not exists delivery_assigned_by uuid references auth.users(id) on delete set null;

alter table public.orders
  drop constraint if exists orders_delivery_assignment_metadata,
  add constraint orders_delivery_assignment_metadata check (
    assigned_delivery_user_id is null
    or delivery_assigned_at is not null
  ),
  drop constraint if exists orders_delivery_assignment_after_dispatch,
  add constraint orders_delivery_assignment_after_dispatch check (
    status not in ('OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED')
    or delivery_assigned_at is not null
  );

create index if not exists orders_assigned_delivery_user_fk_idx
  on public.orders(assigned_delivery_user_id);

create index if not exists orders_delivery_assigned_by_fk_idx
  on public.orders(delivery_assigned_by);

create index if not exists orders_assigned_delivery_active_idx
  on public.orders(assigned_delivery_user_id,status,updated_at)
  where assigned_delivery_user_id is not null
    and status in ('PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING');

create or replace function public.clear_delivery_assignment_before_rescue()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.dispatched_at is null
     and (
       new.merchant_id is distinct from old.merchant_id
       or new.status in ('REASSIGNING','REQUOTE_REQUIRED','CANCELLED')
     ) then
    new.assigned_delivery_user_id:=null;
    new.delivery_assigned_at:=null;
    new.delivery_assigned_by:=null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_delivery_assignment_before_rescue()
from public, anon, authenticated;
grant execute on function public.clear_delivery_assignment_before_rescue()
to postgres, service_role;

drop trigger if exists clear_delivery_assignment_before_rescue_update
on public.orders;

create trigger clear_delivery_assignment_before_rescue_update
before update of merchant_id,status,dispatched_at
on public.orders
for each row
execute function public.clear_delivery_assignment_before_rescue();

create or replace function public.merchant_assign_delivery(
  p_user_id uuid,
  p_order_id uuid,
  p_delivery_user_id uuid,
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
  v_actor_role text;
  v_target_role text;
  v_result jsonb;
begin
  if p_user_id is null or p_delivery_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
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
    p_idempotency_key,p_user_id,'merchant-action:assign-delivery',p_request_hash
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
     or v_action.action_name<>'merchant-action:assign-delivery'
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
  into v_actor_role
  from public.merchant_members mm
  where mm.merchant_id=v_order.merchant_id
    and mm.user_id=p_user_id
    and mm.active
  limit 1;

  if not found or v_actor_role not in ('owner','manager') then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  select mm.member_role
  into v_target_role
  from public.merchant_members mm
  where mm.merchant_id=v_order.merchant_id
    and mm.user_id=p_delivery_user_id
    and mm.active
    and mm.member_role in ('owner','manager','operator','driver')
  limit 1;

  if not found then
    raise exception 'DELIVERY_MEMBER_INVALID' using errcode='42501';
  end if;

  if v_order.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;

  if v_order.status not in ('PREPARING','AT_RISK')
     or v_order.dispatched_at is not null then
    raise exception 'INVALID_TRANSITION' using errcode='40001';
  end if;

  update public.orders
  set assigned_delivery_user_id=p_delivery_user_id,
      delivery_assigned_at=clock_timestamp(),
      delivery_assigned_by=p_user_id,
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id
  returning * into v_order;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,p_user_id,'merchant','DELIVERY_ASSIGNED',
    'Responsável pela entrega definido',
    'A operação definiu um membro responsável pela etapa de entrega.',
    jsonb_build_object(
      'deliveryUserId',p_delivery_user_id,
      'deliveryMemberRole',v_target_role
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'status',v_order.status,
    'version',v_order.version,
    'assignedDeliveryUserId',v_order.assigned_delivery_user_id,
    'deliveryAssignedAt',v_order.delivery_assigned_at
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.merchant_assign_delivery(
  uuid,uuid,uuid,integer,text,text
) from public, anon, authenticated;
grant execute on function public.merchant_assign_delivery(
  uuid,uuid,uuid,integer,text,text
) to service_role;

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
     or (
       v_member_role not in ('owner','manager','operator')
       and not (
         v_member_role='driver'
         and p_action in ('dispatch','arriving')
         and v_order.assigned_delivery_user_id=p_user_id
       )
     ) then
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
      if not public.merchant_operational_compliance_current(v_order.merchant_id) then
        v_accept_issue:='merchant_compliance_expired_before_accept';
      elsif v_merchant.status<>'active'
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

    if not public.merchant_operational_compliance_current(v_order.merchant_id) then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'merchant_compliance_expired_before_dispatch',
        p_user_id,
        'Compliance venceu antes da saída',
        'A evidência regulatória deixou de estar vigente antes da saída; o estoque foi devolvido e o pedido entrou em rescue.'
      ) || jsonb_build_object(
        'dispatched',false,
        'autoRescued',true,
        'rescueReason','merchant_compliance_expired_before_dispatch'
      );

      update public.action_requests
      set result_json=v_result,completed_at=clock_timestamp()
      where idempotency_key=p_idempotency_key;
      return v_result;
    end if;

    if v_merchant.status<>'active'
       or v_merchant.last_seen_at is null
       or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'merchant_unavailable_before_dispatch',
        p_user_id,
        'Revenda indisponível antes da saída',
        'A revenda deixou de estar elegível ou perdeu conexão antes da saída; o estoque foi devolvido e o pedido entrou em rescue.'
      ) || jsonb_build_object(
        'dispatched',false,
        'autoRescued',true,
        'rescueReason','merchant_unavailable_before_dispatch'
      );

      update public.action_requests
      set result_json=v_result,completed_at=clock_timestamp()
      where idempotency_key=p_idempotency_key;
      return v_result;
    end if;

    select array_agg(oi.product_code order by oi.product_code)
    into v_product_codes
    from public.order_items oi
    where oi.order_id=v_order.id;

    if not public.merchant_cart_delivery_compatible(
      v_order.merchant_id,
      coalesce(v_product_codes,array[]::text[])
    ) then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'delivery_capability_changed_before_dispatch',
        p_user_id,
        'Capacidade logística mudou antes da saída',
        'A capacidade necessária deixou de ser válida antes da saída; o estoque foi devolvido e o pedido entrou em rescue.'
      ) || jsonb_build_object(
        'dispatched',false,
        'autoRescued',true,
        'rescueReason','delivery_capability_changed_before_dispatch'
      );

      update public.action_requests
      set result_json=v_result,completed_at=clock_timestamp()
      where idempotency_key=p_idempotency_key;
      return v_result;
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
        assigned_delivery_user_id=coalesce(assigned_delivery_user_id,p_user_id),
        delivery_assigned_at=coalesce(delivery_assigned_at,clock_timestamp()),
        delivery_assigned_by=coalesce(delivery_assigned_by,p_user_id),
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

create or replace function public.merchant_fail_before_dispatch(
  p_user_id uuid,
  p_order_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text,
  p_reason text default 'merchant_cannot_fulfill'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_member_role text;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
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
  if p_reason is null or char_length(p_reason)<2 or char_length(p_reason)>120 then
    raise exception 'INVALID_FAILURE_REASON' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_user_id,'merchant-action:cannot-fulfill',p_request_hash
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
     or v_action.action_name<>'merchant-action:cannot-fulfill'
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
     or (
       v_member_role not in ('owner','manager','operator')
       and not (
         v_member_role='driver'
         and v_order.assigned_delivery_user_id=p_user_id
       )
     ) then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  if v_order.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;

  if v_order.status not in ('PREPARING','AT_RISK')
     or v_order.dispatched_at is not null then
    raise exception 'INVALID_TRANSITION' using errcode='40001';
  end if;

  v_result:=public.system_release_and_rescue_accepted_order(
    v_order.id,
    p_reason,
    p_user_id,
    'Revenda não consegue concluir',
    'A revenda informou uma falha antes da saída; o estoque reservado foi devolvido e o sistema iniciou rescue automático.'
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.merchant_fail_before_dispatch(
  uuid,uuid,integer,text,text,text
) from public, anon, authenticated;
grant execute on function public.merchant_fail_before_dispatch(
  uuid,uuid,integer,text,text,text
) to service_role;

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

  if not found
     or (
       v_member_role not in ('owner','manager','operator')
       and not (
         v_member_role='driver'
         and v_order.assigned_delivery_user_id=p_user_id
       )
     ) then
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
