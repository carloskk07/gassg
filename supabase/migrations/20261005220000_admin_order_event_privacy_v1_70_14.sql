-- TAMÃO V1.70.14 — Admin order event privacy.
-- Motivos administrativos completos permanecem somente no audit log server-side.
-- Timeline e risk_reason do pedido recebem apenas mensagens/códigos operacionais neutros.

create or replace function public.admin_order_control_action(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_action text,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_expected_items integer:=0;
  v_restored_items integer:=0;
  v_result jsonb;
  v_attempted uuid[];
begin
  perform public.require_platform_admin(p_actor_user_id);

  p_action:=lower(trim(coalesce(p_action,'')));
  p_reason:=trim(regexp_replace(coalesce(p_reason,''),'\s+',' ','g'));

  if p_action not in ('note','rescue','cancel') then
    raise exception 'INVALID_ADMIN_ORDER_ACTION' using errcode='22023';
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
    p_idempotency_key,p_actor_user_id,'admin-order:'||p_action,p_request_hash
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
     or v_action.action_name<>'admin-order:'||p_action
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

  if p_action='note' then
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,p_actor_user_id,'admin','ADMIN_NOTE',
      'Atendimento administrativo registrado',
      'A equipe registrou uma observação interna sobre este pedido.',
      jsonb_build_object('orderVersion',v_order.version)
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,
      'version',v_order.version,'action','note'
    );

  elsif p_action='rescue' then
    if v_order.status='OFFERED_TO_MERCHANT' then
      v_result:=public.rescue_offered_order_now(
        v_order.id,
        'admin_rescue',
        null,
        'ADMIN_RESCUE_REQUESTED',
        'Administrador solicitou nova revenda',
        'A equipe iniciou a busca por outra opção de atendimento.'
      );

    elsif v_order.status in ('PREPARING','AT_RISK') and v_order.dispatched_at is null then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'admin_rescue',
        null,
        'Administrador redirecionou antes da saída',
        'A equipe iniciou a busca por outra opção antes da saída.'
      );

    elsif v_order.status='REASSIGNING' then
      v_result:=public.system_rescue_order(
        v_order.id,
        'admin_rescue'
      );

    elsif v_order.status='REQUOTE_REQUIRED' then
      v_attempted:=coalesce(v_order.attempted_merchant_ids,array[]::uuid[]);
      if v_order.proposed_merchant_id is not null
         and not (v_order.proposed_merchant_id=any(v_attempted)) then
        v_attempted:=array_append(v_attempted,v_order.proposed_merchant_id);
      end if;

      update public.orders
      set status='REASSIGNING',
          attempted_merchant_ids=v_attempted,
          proposed_merchant_id=null,
          proposed_gross_total_cents=null,
          proposed_total_cents=null,
          proposed_delivery_fee_cents=null,
          offer_expires_at=null,
          risk_reason='admin_rescue',
          version=version+1,
          updated_at=clock_timestamp()
      where id=v_order.id;

      delete from public.order_requote_items where order_id=v_order.id;

      insert into public.order_events(
        order_id,actor_user_id,actor_type,event_type,title,detail,metadata
      )
      values(
        v_order.id,p_actor_user_id,'admin','ADMIN_REQUOTE_RESCUE',
        'Administrador descartou a alternativa',
        'A equipe descartou a alternativa anterior e retomou a busca.',
        jsonb_build_object('previousProposedMerchantId',v_order.proposed_merchant_id)
      );

      v_result:=public.system_rescue_order(
        v_order.id,
        'admin_rescue'
      );

    elsif v_order.status in ('OUT_FOR_DELIVERY','ARRIVING') or v_order.dispatched_at is not null then
      raise exception 'ORDER_ALREADY_DISPATCHED' using errcode='40001';
    else
      raise exception 'ORDER_NOT_RESCUABLE' using errcode='40001';
    end if;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,p_actor_user_id,'admin','ADMIN_RESCUE',
      'Intervenção administrativa',
      'A equipe interveio no pedido e atualizou o fluxo operacional.',
      jsonb_build_object('previousStatus',v_order.status,'previousVersion',v_order.version)
    );

    v_result:=coalesce(v_result,'{}'::jsonb)
      ||jsonb_build_object('action','rescue','adminActorUserId',p_actor_user_id);

  elsif p_action='cancel' then
    if v_order.status in ('DELIVERED','SETTLED','CANCELLED') then
      raise exception 'ORDER_TERMINAL' using errcode='40001';
    end if;
    if v_order.status in ('OUT_FOR_DELIVERY','ARRIVING')
       or v_order.dispatched_at is not null then
      raise exception 'ORDER_ALREADY_DISPATCHED' using errcode='40001';
    end if;
    if v_order.status not in (
      'OFFERED_TO_MERCHANT','PREPARING','AT_RISK','REASSIGNING','REQUOTE_REQUIRED'
    ) then
      raise exception 'ORDER_NOT_CANCELLABLE' using errcode='40001';
    end if;

    if v_order.status in ('PREPARING','AT_RISK') then
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
    end if;

    if v_order.cashback_reserved_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_order.customer_id,v_order.id,'cashback','cashback_release',
        v_order.cashback_reserved_cents,
        p_idempotency_key||':cashback-release',
        jsonb_build_object(
          'reason','admin_cancelled',
          'adminActorUserId',p_actor_user_id
        )
      )
      on conflict(idempotency_key) do nothing;
    end if;

    delete from public.order_delivery_secrets where order_id=v_order.id;
    delete from public.order_requote_items where order_id=v_order.id;

    update public.orders
    set status='CANCELLED',
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        offer_expires_at=null,
        dispatch_due_at=null,
        promised_by=null,
        assigned_delivery_user_id=null,
        delivery_assigned_at=null,
        delivery_assigned_by=null,
        pin_hash=null,
        pin_failures=0,
        risk_reason='admin_cancelled',
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,p_actor_user_id,'admin','CANCELLED',
      'Cancelado pela administração',
      'O pedido foi cancelado pela equipe antes da saída.',
      jsonb_build_object('stockRestoredItems',v_restored_items)
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,
      'version',v_order.version,'action','cancel',
      'stockRestoredItems',v_restored_items
    );
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'order-control-'||p_action,
    'order',
    p_order_id::text,
    jsonb_build_object(
      'reason',p_reason,
      'expectedVersion',p_expected_version,
      'result',v_result
    )
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_order_control_action(
  uuid,uuid,text,integer,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_order_control_action(
  uuid,uuid,text,integer,text,text,text
) to service_role;
