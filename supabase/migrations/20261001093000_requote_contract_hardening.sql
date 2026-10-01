-- Chama São Gabriel — requote contract hardening v1.5.2

alter table public.orders
  add column if not exists proposed_delivery_fee_cents integer
  check (proposed_delivery_fee_cents is null or proposed_delivery_fee_cents >= 0);

alter table public.orders
  drop constraint if exists orders_requote_delivery_fee_required;

alter table public.orders
  add constraint orders_requote_delivery_fee_required
  check (
    status <> 'REQUOTE_REQUIRED'
    or proposed_delivery_fee_cents is not null
  );

create or replace function public.sync_order_item_prices_on_supplier_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_count integer;
  v_expected integer;
  v_actual integer;
  v_fee integer;
begin
  if new.proposed_merchant_id is distinct from old.proposed_merchant_id
     and new.proposed_merchant_id is not null then

    if new.proposed_delivery_fee_cents is null then
      raise exception 'REQUOTE_DELIVERY_FEE_MISSING' using errcode='40001';
    end if;

    delete from public.order_requote_items
    where order_id=new.id;

    insert into public.order_requote_items(
      order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
    )
    select
      oi.order_id,
      oi.product_code,
      ci.product_name,
      oi.quantity,
      ci.price_cents,
      oi.quantity*ci.price_cents
    from public.order_items oi
    join public.catalog_items ci
      on ci.merchant_id=new.proposed_merchant_id
     and ci.product_code=oi.product_code
     and ci.active
    where oi.order_id=new.id;

    select count(*) into v_count
    from public.order_requote_items
    where order_id=new.id;

    select count(*) into v_expected
    from public.order_items
    where order_id=new.id;

    if v_count<>v_expected then
      raise exception 'REQUOTE_ITEM_SNAPSHOT_INCOMPLETE' using errcode='40001';
    end if;

    select coalesce(sum(line_total_cents),0)
    into v_actual
    from public.order_requote_items
    where order_id=new.id;

    v_actual:=v_actual+new.proposed_delivery_fee_cents;

    if v_actual<>new.proposed_gross_total_cents then
      raise exception 'REQUOTE_TOTAL_MISMATCH' using errcode='40001';
    end if;
  end if;

  if new.merchant_id is distinct from old.merchant_id
     and new.merchant_id is not null then

    if exists(
      select 1
      from public.order_requote_items ri
      where ri.order_id=new.id
    ) then
      if old.proposed_delivery_fee_cents is null then
        raise exception 'REQUOTE_DELIVERY_FEE_MISSING' using errcode='40001';
      end if;

      update public.order_items oi
      set product_name=ri.product_name,
          unit_price_cents=ri.unit_price_cents,
          line_total_cents=ri.line_total_cents
      from public.order_requote_items ri
      where oi.order_id=new.id
        and ri.order_id=new.id
        and ri.product_code=oi.product_code;

      v_fee:=old.proposed_delivery_fee_cents;

      delete from public.order_requote_items
      where order_id=new.id;
    else
      update public.order_items oi
      set product_name=ci.product_name,
          unit_price_cents=ci.price_cents,
          line_total_cents=oi.quantity*ci.price_cents
      from public.catalog_items ci
      where oi.order_id=new.id
        and ci.merchant_id=new.merchant_id
        and ci.product_code=oi.product_code
        and ci.active;

      select m.delivery_fee_cents
      into v_fee
      from public.merchants m
      where m.id=new.merchant_id;
    end if;

    select coalesce(sum(line_total_cents),0)+coalesce(v_fee,0)
    into v_actual
    from public.order_items
    where order_id=new.id;

    if v_actual<>new.gross_total_cents then
      raise exception 'ORDER_ITEM_TOTAL_MISMATCH' using errcode='40001';
    end if;
  end if;

  if new.proposed_merchant_id is null
     and old.proposed_merchant_id is not null
     and new.merchant_id is not distinct from old.merchant_id then
    delete from public.order_requote_items
    where order_id=new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_order_item_prices_on_supplier_change()
from public, anon, authenticated;
grant execute on function public.sync_order_item_prices_on_supplier_change()
to postgres, service_role;

create or replace function public.system_rescue_order(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
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
  where m.status='active'
    and m.online
    and m.accepts_citywide
    and m.last_seen_at>=clock_timestamp()-interval '10 minutes'
    and m.price_confirmed_at>=clock_timestamp()-interval '24 hours'
    and not (m.id=any(v_order.attempted_merchant_ids))
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
      'Nenhuma outra revenda elegível conseguiu assumir o pedido.',
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
      'Outra revenda recebeu o pedido sem aumento de preço.',
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
      'A alternativa encontrada possui preço diferente e fica reservada por até 5 minutos.',
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
$$;

revoke all on function public.system_rescue_order(uuid,text)
from public, anon, authenticated;
grant execute on function public.system_rescue_order(uuid,text)
to postgres, service_role;

create or replace function public.system_expire_requote(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_key text;
begin
  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','ORDER_NOT_FOUND');
  end if;

  if v_order.status<>'REQUOTE_REQUIRED'
     or v_order.offer_expires_at is null
     or v_order.offer_expires_at>clock_timestamp() then
    return jsonb_build_object('ok',false,'reason','NOT_EXPIRED');
  end if;

  v_key:='system-requote-timeout:'||replace(v_order.id::text,'-','')||':'||v_order.version::text;

  if v_order.cashback_reserved_cents>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,v_order.id,'cashback','cashback_release',
      v_order.cashback_reserved_cents,
      v_key||':cashback-release',
      jsonb_build_object('reason','requote_timeout')
    )
    on conflict(idempotency_key) do nothing;
  end if;

  update public.orders
  set status='CANCELLED',
      supplier_name_snapshot=null,
      proposed_merchant_id=null,
      proposed_gross_total_cents=null,
      proposed_total_cents=null,
      proposed_delivery_fee_cents=null,
      offer_expires_at=null,
      risk_reason='requote_timeout',
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
    v_order.id,null,'system','REQUOTE_TIMEOUT',
    'Nova cotação expirou',
    'O cliente não confirmou a nova condição dentro da janela e o pedido foi cancelado.'
  );

  return jsonb_build_object(
    'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version
  );
end;
$$;

revoke all on function public.system_expire_requote(uuid)
from public, anon, authenticated;
grant execute on function public.system_expire_requote(uuid)
to postgres, service_role;

create or replace function public.process_order_timeouts()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row record;
  v_offer_count integer:=0;
  v_requote_count integer:=0;
  v_risk_count integer:=0;
  v_eta_count integer:=0;
begin
  for v_row in
    select id
    from public.orders
    where status='OFFERED_TO_MERCHANT'
      and offer_expires_at is not null
      and offer_expires_at<=clock_timestamp()
    order by offer_expires_at
    limit 100
  loop
    perform public.system_reassign_expired_order(v_row.id);
    v_offer_count:=v_offer_count+1;
  end loop;

  for v_row in
    select id
    from public.orders
    where status='REQUOTE_REQUIRED'
      and offer_expires_at is not null
      and offer_expires_at<=clock_timestamp()
    order by offer_expires_at
    limit 100
  loop
    perform public.system_expire_requote(v_row.id);
    v_requote_count:=v_requote_count+1;
  end loop;

  for v_row in
    update public.orders
    set status='AT_RISK',
        risk_reason='Saída ainda não confirmada',
        version=version+1,
        updated_at=clock_timestamp()
    where status='PREPARING'
      and dispatch_due_at is not null
      and dispatch_due_at<=clock_timestamp()
    returning id
  loop
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_row.id,null,'system','AT_RISK',
      'Saída ainda não confirmada',
      'A janela de preparação terminou sem confirmação real de saída.'
    );
    v_risk_count:=v_risk_count+1;
  end loop;

  for v_row in
    update public.orders
    set risk_reason='Entrega fora da janela prevista',
        version=version+1,
        updated_at=clock_timestamp()
    where status in ('OUT_FOR_DELIVERY','ARRIVING')
      and promised_by is not null
      and promised_by<=clock_timestamp()
      and risk_reason is distinct from 'Entrega fora da janela prevista'
    returning id
  loop
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_row.id,null,'system','ETA_RISK',
      'Entrega fora da janela prevista',
      'O prazo máximo estimado foi ultrapassado; o pedido continua ativo e monitorado.'
    );
    v_eta_count:=v_eta_count+1;
  end loop;

  return jsonb_build_object(
    'expiredOffersProcessed',v_offer_count,
    'expiredRequotesProcessed',v_requote_count,
    'preparingRisked',v_risk_count,
    'etaRisked',v_eta_count
  );
end;
$$;

revoke all on function public.process_order_timeouts()
from public, anon, authenticated;
grant execute on function public.process_order_timeouts()
to postgres, service_role;

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
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_action not in ('cancel-before-accept','accept-requote') then
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
    p_idempotency_key,p_user_id,'customer-action:'||p_action,p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

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
      );
    end if;

    update public.orders
    set status='CANCELLED',
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        offer_expires_at=null,
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
      'orderId',v_order.id,'status',v_order.status,'version',v_order.version
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
       or v_merchant.price_confirmed_at is null
       or v_merchant.price_confirmed_at<clock_timestamp()-interval '24 hours' then
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
        attempted_merchant_ids=array_append(attempted_merchant_ids,v_order.proposed_merchant_id),
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
      'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'totalCents',v_order.total_cents,'offerExpiresAt',v_order.offer_expires_at
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
