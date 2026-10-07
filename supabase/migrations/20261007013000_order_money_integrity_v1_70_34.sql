-- TAMÃO V1.70.34 — aggregate quote/order money integrity.
-- Prevents a server-side bug or future migration from persisting a total that
-- disagrees with the frozen item lines plus delivery fee.

alter table public.orders
  add column if not exists delivery_fee_cents_snapshot integer not null default 0;

alter table public.orders
  drop constraint if exists orders_delivery_fee_cents_snapshot_check,
  add constraint orders_delivery_fee_cents_snapshot_check
    check (delivery_fee_cents_snapshot between 0 and 100000);

CREATE OR REPLACE FUNCTION public.create_order_from_quote(p_user_id uuid, p_quote_id uuid, p_payment_method text, p_use_cashback boolean, p_idempotency_key text, p_request_hash text, p_referral_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_action public.action_requests%rowtype;
  v_quote public.quotes%rowtype;
  v_merchant public.merchants%rowtype;
  v_order_id uuid;
  v_public_code text;
  v_cashback_balance bigint := 0;
  v_reserved integer := 0;
  v_total integer := 0;
  v_offer_expires_at timestamptz;
  v_result jsonb;
  v_referrer uuid;
  v_prior_order_count integer:=0;
  v_product_codes text[];
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_payment_method not in ('pix','card','cash') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<12 or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or char_length(p_request_hash)<>64 then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_user_id,'create-order',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_user_id or v_action.action_name<>'create-order' or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    if v_action.result_json is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return v_action.result_json;
  end if;

  select * into v_quote
  from public.quotes
  where id=p_quote_id and customer_id=p_user_id
  for update;

  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if v_quote.consumed_at is not null then raise exception 'QUOTE_ALREADY_USED' using errcode='23505'; end if;
  if v_quote.expires_at<=clock_timestamp() then raise exception 'QUOTE_EXPIRED' using errcode='22023'; end if;

  select * into v_merchant
  from public.merchants
  where id=v_quote.merchant_id
  for share;

  if not found
     or v_merchant.status<>'active'
     or not v_merchant.online
     or not v_merchant.accepts_citywide
     or v_merchant.last_seen_at is null
     or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if not public.merchant_operational_compliance_current(v_quote.merchant_id) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  select array_agg(qi.product_code order by qi.product_code)
  into v_product_codes
  from public.quote_items qi
  where qi.quote_id=v_quote.id;

  if coalesce(cardinality(v_product_codes),0)<1
     or not public.merchant_cart_delivery_compatible(
       v_quote.merchant_id,
       v_product_codes
     ) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1
    from public.quote_items qi
    left join public.catalog_items ci
      on ci.merchant_id=v_quote.merchant_id and ci.product_code=qi.product_code
    where qi.quote_id=v_quote.id
      and (ci.merchant_id is null or not ci.active or ci.available_stock<qi.quantity)
  ) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1 from public.orders
    where customer_id=p_user_id and status not in ('SETTLED','CANCELLED')
  ) then
    raise exception 'ACTIVE_ORDER_EXISTS' using errcode='23505';
  end if;

  select count(*)
  into v_prior_order_count
  from public.orders
  where customer_id=p_user_id;

  if p_referral_code is not null
     and char_length(trim(p_referral_code)) between 6 and 20
     and v_prior_order_count=0 then
    select user_id into v_referrer
    from public.profiles
    where referral_code=upper(trim(p_referral_code))
    limit 1;

    if v_referrer is not null and v_referrer<>p_user_id then
      insert into public.referrals(referred_user_id,referrer_user_id,referral_code)
      values(p_user_id,v_referrer,upper(trim(p_referral_code)))
      on conflict(referred_user_id) do nothing;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cashback-user:'||p_user_id::text,0)
  );

  select (public.cashback_position(p_user_id)->>'spendableCents')::bigint
  into v_cashback_balance;

  if p_use_cashback then
    v_reserved:=least(v_quote.gross_total_cents,v_cashback_balance)::integer;
  end if;

  v_total:=v_quote.gross_total_cents-v_reserved;
  v_order_id:=gen_random_uuid();
  v_public_code:='SG-'||upper(substr(replace(v_order_id::text,'-',''),1,12));
  v_offer_expires_at:=clock_timestamp()+interval '3 minutes';

  insert into public.orders(
    id,public_code,customer_id,merchant_id,status,address_text,payment_method,
    gross_total_cents,delivery_fee_cents_snapshot,cashback_reserved_cents,total_cents,pin_hash,
    attempted_merchant_ids,offer_expires_at
  ) values(
    v_order_id,v_public_code,p_user_id,v_quote.merchant_id,'OFFERED_TO_MERCHANT',
    v_quote.address_text,p_payment_method,v_quote.gross_total_cents,v_quote.delivery_fee_cents,v_reserved,v_total,
    null,array[v_quote.merchant_id],v_offer_expires_at
  );

  insert into public.order_items(
    order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  )
  select v_order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  from public.quote_items where quote_id=v_quote.id;

  if v_reserved>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    ) values(
      p_user_id,v_order_id,'cashback','cashback_reserve',-v_reserved,
      p_idempotency_key||':cashback-reserve',
      jsonb_build_object('quoteId',v_quote.id)
    );
  end if;

  insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
  values
    (v_order_id,p_user_id,'customer','CREATED','Pedido recebido','Pedido criado a partir de uma cotação válida.'),
    (v_order_id,p_user_id,'system','QUOTE_LOCKED','Preço protegido','Preço, itens e endereço foram congelados para este pedido.'),
    (v_order_id,p_user_id,'system','OFFERED_TO_MERCHANT','Aguardando confirmação da revenda','A revenda precisa aceitar antes de o pedido ser considerado confirmado.');

  update public.quotes set consumed_at=clock_timestamp() where id=v_quote.id;

  v_result:=jsonb_build_object(
    'orderId',v_order_id,'publicCode',v_public_code,'status','OFFERED_TO_MERCHANT',
    'grossTotalCents',v_quote.gross_total_cents,'cashbackReservedCents',v_reserved,
    'totalCents',v_total,'offerExpiresAt',v_offer_expires_at
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;


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
        delivery_fee_cents_snapshot=v_order.proposed_delivery_fee_cents,
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
$function$;


CREATE OR REPLACE FUNCTION public.system_rescue_order(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_candidate_id uuid;
  v_candidate_merchant public.merchants%rowtype;
  v_candidate_gross integer:=0;
  v_candidate_fee integer:=0;
  v_candidate_valid boolean:=false;
  v_expected_items integer:=0;
  v_locked_items integer:=0;
  v_capacity_used integer:=0;
  v_item record;
  v_ci public.catalog_items%rowtype;
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

  select count(*)
  into v_expected_items
  from public.order_items
  where order_id=v_order.id;

  for v_candidate_id in
    select m.id
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
      and public.merchant_allowed_in_operation_mode(m.id)
      and public.merchant_operational_compliance_current(m.id)
      and m.online
      and m.accepts_citywide
      and public.merchant_accepts_payment_method(m.id,v_order.payment_method)
      and (v_order.delivery_window_start is null or m.accepts_scheduled_orders)
      and m.last_seen_at>=clock_timestamp()-interval '10 minutes'
      and m.delivery_fee_confirmed_at is not null
      and m.delivery_fee_confirmed_at>=clock_timestamp()-interval '24 hours'
      and not (m.id=any(v_order.attempted_merchant_ids))
      and (
        select count(*)
        from public.orders cap
        where (
          cap.merchant_id=m.id
          and cap.status in (
            'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
            'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
          )
        ) or (
          cap.proposed_merchant_id=m.id
          and cap.status='REQUOTE_REQUIRED'
        )
      ) < m.max_active_orders
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
    having count(*)=v_expected_items
    order by
      (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents) asc,
      m.base_eta_minutes asc,
      m.trust_score desc
    limit 20
  loop
    v_candidate_valid:=true;
    v_candidate_gross:=0;
    v_locked_items:=0;

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-capacity:'||v_candidate_id::text,0)
    );

    select *
    into v_candidate_merchant
    from public.merchants
    where id=v_candidate_id
    for update skip locked;

    if not found
       or v_candidate_merchant.status<>'active'
       or not public.merchant_allowed_in_operation_mode(v_candidate_id)
       or not public.merchant_operational_compliance_current(v_candidate_id)
       or not v_candidate_merchant.online
       or not v_candidate_merchant.accepts_citywide
       or not public.merchant_accepts_payment_method(v_candidate_id,v_order.payment_method)
       or (v_order.delivery_window_start is not null and not v_candidate_merchant.accepts_scheduled_orders)
       or v_candidate_merchant.last_seen_at is null
       or v_candidate_merchant.last_seen_at<clock_timestamp()-interval '10 minutes'
       or v_candidate_merchant.delivery_fee_confirmed_at is null
       or v_candidate_merchant.delivery_fee_confirmed_at<clock_timestamp()-interval '24 hours'
       or not public.merchant_cart_delivery_compatible(
         v_candidate_id,
         array(
           select oi2.product_code
           from public.order_items oi2
           where oi2.order_id=v_order.id
           order by oi2.product_code
         )
       ) then
      v_candidate_valid:=false;
    end if;

    if v_candidate_valid then
      select count(*)::integer
      into v_capacity_used
      from public.orders cap
      where (
        cap.merchant_id=v_candidate_id
        and cap.status in (
          'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
          'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
        )
      ) or (
        cap.proposed_merchant_id=v_candidate_id
        and cap.status='REQUOTE_REQUIRED'
      );

      if v_capacity_used>=v_candidate_merchant.max_active_orders then
        v_candidate_valid:=false;
      end if;
    end if;

    if v_candidate_valid then
      v_candidate_fee:=v_candidate_merchant.delivery_fee_cents;
      v_candidate_gross:=v_candidate_fee;

      for v_item in
        select oi.product_code,oi.quantity
        from public.order_items oi
        where oi.order_id=v_order.id
        order by oi.product_code
      loop
        v_ci:=null;

        select ci.*
        into v_ci
        from public.catalog_items ci
        where ci.merchant_id=v_candidate_id
          and ci.product_code=v_item.product_code
        for update skip locked;

        if not found
           or not coalesce(v_ci.active,false)
           or coalesce(v_ci.available_stock,0)<v_item.quantity
           or v_ci.price_confirmed_at is null
           or v_ci.price_confirmed_at<clock_timestamp()-interval '24 hours' then
          v_candidate_valid:=false;
          exit;
        end if;

        v_candidate_gross:=v_candidate_gross+(v_ci.price_cents*v_item.quantity);
        v_locked_items:=v_locked_items+1;
      end loop;

      if v_locked_items<>v_expected_items then
        v_candidate_valid:=false;
      end if;
    end if;

    if v_candidate_valid then
      exit;
    end if;

    v_candidate_id:=null;
  end loop;

  if v_candidate_id is null or not v_candidate_valid then
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
      'Nenhuma outra revenda elegível, estável e logisticamente compatível conseguiu assumir o pedido.',
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
        delivery_fee_cents_snapshot=v_candidate_fee,
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
      'Outra revenda compatível recebeu o pedido sem aumento de preço; preço e estoque foram revalidados atomicamente.',
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
      'A alternativa compatível possui preço diferente; preço e estoque foram revalidados e a condição fica reservada por até 5 minutos.',
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


create or replace function public.assert_quote_money_integrity()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_quote_id uuid;
  v_gross integer;
  v_fee integer;
  v_item_count integer;
  v_line_sum bigint;
begin
  if tg_table_name='quotes' then
    v_quote_id:=coalesce(new.id,old.id);
  else
    v_quote_id:=coalesce(new.quote_id,old.quote_id);
  end if;

  select q.gross_total_cents,q.delivery_fee_cents,
         count(qi.product_code)::integer,
         coalesce(sum(qi.line_total_cents),0)::bigint
  into v_gross,v_fee,v_item_count,v_line_sum
  from public.quotes q
  left join public.quote_items qi on qi.quote_id=q.id
  where q.id=v_quote_id
  group by q.id,q.gross_total_cents,q.delivery_fee_cents;

  if not found then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if v_item_count<1 then
    raise exception 'QUOTE_ITEMS_REQUIRED' using errcode='23514';
  end if;

  if v_gross::bigint<>v_line_sum+v_fee::bigint then
    raise exception 'QUOTE_TOTAL_INTEGRITY_MISMATCH' using errcode='23514';
  end if;

  if tg_op='DELETE' then return old; end if;
    return new;
end;
$$;

revoke all on function public.assert_quote_money_integrity()
from public,anon,authenticated;
grant execute on function public.assert_quote_money_integrity()
to postgres,service_role;

drop trigger if exists quote_money_integrity_header_guard on public.quotes;
create constraint trigger quote_money_integrity_header_guard
after insert or update on public.quotes
deferrable initially deferred
for each row execute function public.assert_quote_money_integrity();

drop trigger if exists quote_money_integrity_item_guard on public.quote_items;
create constraint trigger quote_money_integrity_item_guard
after insert or update or delete on public.quote_items
deferrable initially deferred
for each row execute function public.assert_quote_money_integrity();

create or replace function public.assert_order_money_integrity()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_order_id uuid;
  v_gross integer;
  v_fee integer;
  v_item_count integer;
  v_line_sum bigint;
begin
  if tg_table_name='orders' then
    v_order_id:=coalesce(new.id,old.id);
  else
    v_order_id:=coalesce(new.order_id,old.order_id);
  end if;

  select o.gross_total_cents,o.delivery_fee_cents_snapshot,
         count(oi.product_code)::integer,
         coalesce(sum(oi.line_total_cents),0)::bigint
  into v_gross,v_fee,v_item_count,v_line_sum
  from public.orders o
  left join public.order_items oi on oi.order_id=o.id
  where o.id=v_order_id
  group by o.id,o.gross_total_cents,o.delivery_fee_cents_snapshot;

  if not found then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if v_item_count<1 then
    raise exception 'ORDER_ITEMS_REQUIRED' using errcode='23514';
  end if;

  if v_gross::bigint<>v_line_sum+v_fee::bigint then
    raise exception 'ORDER_TOTAL_INTEGRITY_MISMATCH' using errcode='23514';
  end if;

  if tg_op='DELETE' then return old; end if;
    return new;
end;
$$;

revoke all on function public.assert_order_money_integrity()
from public,anon,authenticated;
grant execute on function public.assert_order_money_integrity()
to postgres,service_role;

drop trigger if exists order_money_integrity_header_guard on public.orders;
create constraint trigger order_money_integrity_header_guard
after insert or update on public.orders
deferrable initially deferred
for each row execute function public.assert_order_money_integrity();

drop trigger if exists order_money_integrity_item_guard on public.order_items;
create constraint trigger order_money_integrity_item_guard
after insert or update or delete on public.order_items
deferrable initially deferred
for each row execute function public.assert_order_money_integrity();

do $$
begin
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders'
      and column_name='delivery_fee_cents_snapshot'
  ) then
    raise exception 'ORDER_DELIVERY_FEE_SNAPSHOT_MISSING';
  end if;
end;
$$;
