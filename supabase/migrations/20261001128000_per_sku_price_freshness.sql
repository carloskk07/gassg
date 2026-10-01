-- Chama São Gabriel — per-SKU price freshness v1.8
-- A confirmation of one product must never refresh unrelated catalog prices.

alter table public.catalog_items
  add column if not exists price_confirmed_at timestamptz;

alter table public.merchants
  add column if not exists delivery_fee_confirmed_at timestamptz;

-- Compatibility backfill for pre-v1.8 rows. New updates use independent clocks.
update public.catalog_items ci
set price_confirmed_at=coalesce(
  ci.price_confirmed_at,
  m.price_confirmed_at,
  ci.updated_at
)
from public.merchants m
where m.id=ci.merchant_id
  and ci.price_confirmed_at is null;

update public.merchants
set delivery_fee_confirmed_at=coalesce(
  delivery_fee_confirmed_at,
  price_confirmed_at,
  updated_at
)
where delivery_fee_confirmed_at is null;

create index if not exists catalog_items_offer_fresh_idx
  on public.catalog_items(
    merchant_id,product_code,active,price_confirmed_at
  );

create index if not exists merchants_delivery_fee_fresh_idx
  on public.merchants(
    status,online,accepts_citywide,delivery_fee_confirmed_at,last_seen_at
  );

CREATE OR REPLACE FUNCTION public.create_quote_snapshot(p_user_id uuid, p_merchant_id uuid, p_address text, p_delivery_fee_cents integer, p_eta_min_minutes integer, p_eta_max_minutes integer, p_expires_at timestamp with time zone, p_items jsonb, p_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_quote public.quotes%rowtype;
  v_merchant public.merchants%rowtype;
  v_expected_count integer;
  v_catalog_count integer;
  v_subtotal bigint;
  v_gross integer;
begin
  if p_user_id is null or p_merchant_id is null then
    raise exception 'INVALID_QUOTE_OWNER' using errcode='22023';
  end if;

  if p_address is null
     or char_length(trim(p_address))<5
     or char_length(trim(p_address))>240 then
    raise exception 'INVALID_ADDRESS' using errcode='22023';
  end if;

  if p_delivery_fee_cents is null or p_delivery_fee_cents<0 then
    raise exception 'INVALID_DELIVERY_FEE' using errcode='22023';
  end if;

  if p_eta_min_minutes is null
     or p_eta_min_minutes<1
     or p_eta_max_minutes is null
     or p_eta_max_minutes<p_eta_min_minutes
     or p_eta_max_minutes>240 then
    raise exception 'INVALID_ETA' using errcode='22023';
  end if;

  if p_expires_at is null
     or p_expires_at<=clock_timestamp()+interval '30 seconds'
     or p_expires_at>clock_timestamp()+interval '10 minutes' then
    raise exception 'INVALID_QUOTE_EXPIRY' using errcode='22023';
  end if;

  if p_fingerprint is null or p_fingerprint!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_QUOTE_FINGERPRINT' using errcode='22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items)<1
     or jsonb_array_length(p_items)>10 then
    raise exception 'INVALID_QUOTE_ITEMS' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_user_id::text||':'||p_merchant_id::text||':'||p_fingerprint,
      0
    )
  );

  select *
  into v_quote
  from public.quotes
  where customer_id=p_user_id
    and merchant_id=p_merchant_id
    and snapshot_fingerprint=p_fingerprint
    and consumed_at is null
    and expires_at>clock_timestamp()+interval '60 seconds'
  order by expires_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'quoteId',v_quote.id,
      'grossTotalCents',v_quote.gross_total_cents,
      'etaMinMinutes',v_quote.eta_min_minutes,
      'etaMaxMinutes',v_quote.eta_max_minutes,
      'expiresAt',v_quote.expires_at,
      'reused',true
    );
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for share;

  if not found
     or v_merchant.status<>'active'
     or not v_merchant.online
     or not v_merchant.accepts_citywide
     or v_merchant.last_seen_at is null
     or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes'
     or v_merchant.delivery_fee_confirmed_at is null
     or v_merchant.delivery_fee_confirmed_at<clock_timestamp()-interval '24 hours'
     or v_merchant.delivery_fee_cents<>p_delivery_fee_cents then
    raise exception 'QUOTE_SOURCE_STALE' using errcode='40001';
  end if;

  with requested as (
    select
      upper(trim(x.product_code)) product_code,
      x.quantity,
      x.unit_price_cents
    from jsonb_to_recordset(p_items) as x(
      product_code text,
      quantity integer,
      unit_price_cents integer
    )
  )
  select
    count(*),
    count(distinct product_code)
  into
    v_expected_count,
    v_catalog_count
  from requested
  where product_code is not null
    and quantity between 1 and 99
    and unit_price_cents>0;

  if v_expected_count<>jsonb_array_length(p_items)
     or v_catalog_count<>v_expected_count then
    raise exception 'INVALID_QUOTE_ITEMS' using errcode='22023';
  end if;

  -- Lock the exact catalog rows while the quote snapshot is built. This keeps
  -- price/stock confirmation stable until quote + quote_items are committed.
  perform ci.product_code
  from jsonb_to_recordset(p_items) as x(
    product_code text,
    quantity integer,
    unit_price_cents integer
  )
  join public.catalog_items ci
    on ci.merchant_id=p_merchant_id
   and ci.product_code=upper(trim(x.product_code))
  order by ci.product_code
  for share of ci;

  with requested as (
    select
      upper(trim(x.product_code)) product_code,
      x.quantity,
      x.unit_price_cents
    from jsonb_to_recordset(p_items) as x(
      product_code text,
      quantity integer,
      unit_price_cents integer
    )
  )
  select
    count(*),
    coalesce(sum(ci.price_cents*r.quantity),0)
  into
    v_catalog_count,
    v_subtotal
  from requested r
  join public.catalog_items ci
    on ci.merchant_id=p_merchant_id
   and ci.product_code=r.product_code
   and ci.active
   and ci.available_stock>=r.quantity
   and ci.price_cents=r.unit_price_cents
   and ci.price_confirmed_at is not null
   and ci.price_confirmed_at>=clock_timestamp()-interval '24 hours';

  if v_catalog_count<>v_expected_count then
    raise exception 'QUOTE_SOURCE_STALE' using errcode='40001';
  end if;

  v_gross:=(v_subtotal+p_delivery_fee_cents)::integer;

  insert into public.quotes(
    customer_id,merchant_id,address_text,gross_total_cents,delivery_fee_cents,
    eta_min_minutes,eta_max_minutes,expires_at,snapshot_fingerprint
  )
  values(
    p_user_id,p_merchant_id,trim(p_address),v_gross,p_delivery_fee_cents,
    p_eta_min_minutes,p_eta_max_minutes,p_expires_at,p_fingerprint
  )
  returning * into v_quote;

  insert into public.quote_items(
    quote_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  )
  select
    v_quote.id,
    ci.product_code,
    ci.product_name,
    r.quantity,
    ci.price_cents,
    ci.price_cents*r.quantity
  from (
    select
      upper(trim(x.product_code)) product_code,
      x.quantity,
      x.unit_price_cents
    from jsonb_to_recordset(p_items) as x(
      product_code text,
      quantity integer,
      unit_price_cents integer
    )
  ) r
  join public.catalog_items ci
    on ci.merchant_id=p_merchant_id
   and ci.product_code=r.product_code
   and ci.active
   and ci.available_stock>=r.quantity
   and ci.price_cents=r.unit_price_cents
   and ci.price_confirmed_at is not null
   and ci.price_confirmed_at>=clock_timestamp()-interval '24 hours'
  order by ci.product_code;

  return jsonb_build_object(
    'quoteId',v_quote.id,
    'grossTotalCents',v_quote.gross_total_cents,
    'etaMinMinutes',v_quote.eta_min_minutes,
    'etaMaxMinutes',v_quote.eta_max_minutes,
    'expiresAt',v_quote.expires_at,
    'reused',false
  );
end;
$function$;

revoke all on function public.create_quote_snapshot(
  uuid,uuid,text,integer,integer,integer,timestamptz,jsonb,text
) from public, anon, authenticated;
grant execute on function public.create_quote_snapshot(
  uuid,uuid,text,integer,integer,integer,timestamptz,jsonb,text
) to service_role;

CREATE OR REPLACE FUNCTION public.customer_order_action(p_user_id uuid, p_order_id uuid, p_action text, p_expected_version integer, p_idempotency_key text, p_request_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
       or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
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
$function$;

revoke all on function public.customer_order_action(uuid,uuid,text,integer,text,text)
from public, anon, authenticated;
grant execute on function public.customer_order_action(uuid,uuid,text,integer,text,text)
to service_role;

CREATE OR REPLACE FUNCTION public.system_rescue_order(p_order_id uuid, p_reason text)
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
$function$;

revoke all on function public.system_rescue_order(uuid,text)
from public, anon, authenticated;
grant execute on function public.system_rescue_order(uuid,text)
to postgres, service_role;
