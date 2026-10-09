
create or replace function public.prepare_merchant_sale_payment_attempt(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_order public.orders%rowtype;
  v_action public.action_requests%rowtype;
  v_account public.merchant_payment_provider_accounts%rowtype;
  v_attempt public.merchant_sale_payment_attempts%rowtype;
  v_external_reference text;
  v_result jsonb;
begin
  if p_actor_user_id is null or p_order_id is null then
    raise exception 'SALE_PAYMENT_ACTOR_ORDER_REQUIRED' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'merchant-sale-payment:prepare',
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'merchant-sale-payment:prepare'
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

  if not found or v_order.customer_id<>p_actor_user_id then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.merchant_id is null then
    raise exception 'ORDER_MERCHANT_NOT_BOUND' using errcode='40001';
  end if;

  if v_order.status not in (
    'MERCHANT_ACCEPTED','PREPARING','AT_RISK',
    'OUT_FOR_DELIVERY','ARRIVING'
  ) then
    raise exception 'ORDER_NOT_PAYABLE' using errcode='40001';
  end if;

  if v_order.payment_method not in ('pix','card') then
    raise exception 'ORDER_PAYMENT_METHOD_NOT_ONLINE' using errcode='40001';
  end if;

  if v_order.total_cents<=0 then
    raise exception 'ORDER_PAYMENT_AMOUNT_INVALID' using errcode='40001';
  end if;

  select *
  into v_account
  from public.merchant_payment_provider_accounts
  where merchant_id=v_order.merchant_id
    and provider='mercadopago'
  for share;

  if not found
     or v_account.status<>'active'
     or coalesce((v_account.capabilities->>'directSalePaymentsEnabled')::boolean,false)<>true
     or v_account.access_token_ciphertext is null
     or v_account.access_token_nonce is null then
    raise exception 'MERCHANT_DIRECT_PAYMENT_NOT_ENABLED' using errcode='40001';
  end if;

  select *
  into v_attempt
  from public.merchant_sale_payment_attempts
  where order_id=v_order.id
    and status in ('preparing','checkout_ready','pending','approved')
  order by
    case status when 'approved' then 0 when 'checkout_ready' then 1 else 2 end,
    created_at desc
  limit 1
  for update;

  if not found then
    v_external_reference:=gen_random_uuid()::text;
    insert into public.merchant_sale_payment_attempts(
      order_id,merchant_id,provider,checkout_mode,
      external_reference,amount_cents,currency,status
    )
    values(
      v_order.id,v_order.merchant_id,'mercadopago','hosted',
      v_external_reference,v_order.total_cents,'BRL','preparing'
    )
    returning * into v_attempt;
  end if;

  if v_attempt.merchant_id<>v_order.merchant_id
     or v_attempt.amount_cents<>v_order.total_cents
     or v_attempt.currency<>'BRL' then
    raise exception 'SALE_PAYMENT_ATTEMPT_ORDER_MISMATCH' using errcode='40001';
  end if;

  v_result:=jsonb_build_object(
    'ok',true,
    'attemptId',v_attempt.id,
    'orderId',v_attempt.order_id,
    'merchantId',v_attempt.merchant_id,
    'provider',v_attempt.provider,
    'externalReference',v_attempt.external_reference,
    'amountCents',v_attempt.amount_cents,
    'currency',v_attempt.currency,
    'status',v_attempt.status,
    'providerOrderId',v_attempt.provider_order_id,
    'checkoutUrl',v_attempt.checkout_url,
    'expiresAt',v_attempt.expires_at
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;

revoke all on function public.prepare_merchant_sale_payment_attempt(
  uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.prepare_merchant_sale_payment_attempt(
  uuid,uuid,text,text
) to service_role;

create or replace function public.commit_merchant_sale_payment_checkout(
  p_attempt_id uuid,
  p_provider_order_id text,
  p_checkout_url text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_attempt public.merchant_sale_payment_attempts%rowtype;
  v_order_id text:=trim(coalesce(p_provider_order_id,''));
  v_url text:=trim(coalesce(p_checkout_url,''));
begin
  if p_attempt_id is null
     or char_length(v_order_id)<6
     or char_length(v_order_id)>240
     or v_order_id~'[[:cntrl:]]'
     or char_length(v_url)<12
     or char_length(v_url)>2048
     or v_url!~'^https://'
     or p_expires_at is null
     or p_expires_at<=clock_timestamp() then
    raise exception 'INVALID_SALE_PAYMENT_CHECKOUT' using errcode='22023';
  end if;

  select *
  into v_attempt
  from public.merchant_sale_payment_attempts
  where id=p_attempt_id
  for update;

  if not found then
    raise exception 'SALE_PAYMENT_ATTEMPT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_attempt.status in ('approved','refunded') then
    return jsonb_build_object(
      'ok',true,
      'attemptId',v_attempt.id,
      'status',v_attempt.status,
      'providerOrderId',v_attempt.provider_order_id,
      'checkoutUrl',v_attempt.checkout_url,
      'expiresAt',v_attempt.expires_at
    );
  end if;

  if v_attempt.status not in ('preparing','checkout_ready','pending') then
    raise exception 'SALE_PAYMENT_ATTEMPT_NOT_COMMITTABLE' using errcode='40001';
  end if;

  if v_attempt.provider_order_id is not null
     and v_attempt.provider_order_id<>v_order_id then
    raise exception 'SALE_PAYMENT_PROVIDER_ORDER_CONFLICT' using errcode='23505';
  end if;

  update public.merchant_sale_payment_attempts
  set status='checkout_ready',
      provider_order_id=v_order_id,
      checkout_url=v_url,
      expires_at=p_expires_at,
      last_error_code=null,
      updated_at=clock_timestamp()
  where id=v_attempt.id
  returning * into v_attempt;

  return jsonb_build_object(
    'ok',true,
    'attemptId',v_attempt.id,
    'status',v_attempt.status,
    'providerOrderId',v_attempt.provider_order_id,
    'checkoutUrl',v_attempt.checkout_url,
    'expiresAt',v_attempt.expires_at
  );
end;
$function$;

revoke all on function public.commit_merchant_sale_payment_checkout(
  uuid,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.commit_merchant_sale_payment_checkout(
  uuid,text,text,timestamptz
) to service_role;

create or replace function public.apply_merchant_sale_payment_event(
  p_provider_event_id text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_event_type text,
  p_provider_status text,
  p_amount_cents bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_raw_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_event_id text:=trim(coalesce(p_provider_event_id,''));
  v_order_id text:=trim(coalesce(p_provider_order_id,''));
  v_payment_id text:=nullif(trim(coalesce(p_provider_payment_id,'')),'');
  v_event_type text:=trim(coalesce(p_event_type,''));
  v_status text:=lower(trim(coalesce(p_provider_status,'')));
  v_currency text:=upper(trim(coalesce(p_currency,'')));
  v_hash text:=lower(trim(coalesce(p_raw_payload_sha256,'')));
  v_attempt public.merchant_sale_payment_attempts%rowtype;
  v_existing public.merchant_sale_payment_events%rowtype;
  v_next_status text;
  v_now timestamptz:=clock_timestamp();
begin
  if char_length(v_event_id)<6 or char_length(v_event_id)>200
     or v_event_id~'[[:cntrl:]]'
     or char_length(v_order_id)<6 or char_length(v_order_id)>240
     or v_order_id~'[[:cntrl:]]'
     or char_length(v_event_type)<3 or char_length(v_event_type)>120
     or v_event_type!~'^[A-Za-z0-9._:-]+$'
     or v_hash!~'^[0-9a-f]{64}$'
     or p_amount_cents is null or p_amount_cents<=0
     or v_currency<>'BRL' then
    raise exception 'INVALID_SALE_PAYMENT_EVENT' using errcode='22023';
  end if;

  select *
  into v_attempt
  from public.merchant_sale_payment_attempts
  where provider='mercadopago'
    and provider_order_id=v_order_id
  for update;

  if not found then
    raise exception 'SALE_PAYMENT_PROVIDER_ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_attempt.amount_cents<>p_amount_cents
     or v_attempt.currency<>v_currency then
    update public.merchant_sale_payment_attempts
    set status='review_required',
        last_error_code='PROVIDER_AMOUNT_MISMATCH',
        last_error_at=v_now,
        updated_at=v_now
    where id=v_attempt.id;
    raise exception 'SALE_PAYMENT_AMOUNT_MISMATCH' using errcode='40001';
  end if;

  select *
  into v_existing
  from public.merchant_sale_payment_events
  where provider='mercadopago'
    and provider_event_id=v_event_id
  for update;

  if found then
    if v_existing.raw_payload_sha256<>v_hash
       or v_existing.payment_attempt_id is distinct from v_attempt.id then
      raise exception 'SALE_PAYMENT_EVENT_ID_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object(
      'ok',true,
      'replayed',true,
      'attemptId',v_attempt.id,
      'orderId',v_attempt.order_id,
      'status',v_attempt.status
    );
  end if;

  v_next_status:=case
    when v_status='processed' then 'approved'
    when v_status in ('refunded','partially_refunded') then 'refunded'
    when v_status='expired' then 'expired'
    when v_status='canceled' then 'cancelled'
    when v_status='failed' then 'rejected'
    else 'pending'
  end;

  insert into public.merchant_sale_payment_events(
    provider,provider_event_id,payment_attempt_id,provider_payment_id,
    event_type,event_status,raw_payload_sha256,occurred_at,processed_at
  )
  values(
    'mercadopago',v_event_id,v_attempt.id,v_payment_id,
    v_event_type,'applied',v_hash,coalesce(p_occurred_at,v_now),v_now
  );

  if v_next_status='approved' then
    update public.merchant_sale_payment_attempts
    set status='approved',
        provider_payment_id=coalesce(provider_payment_id,v_payment_id),
        provider_status=v_status,
        approved_at=coalesce(approved_at,coalesce(p_occurred_at,v_now)),
        updated_at=v_now,
        last_error_code=null,
        last_error_at=null
    where id=v_attempt.id
      and status not in ('refunded','review_required');
  elsif v_next_status='refunded' then
    update public.merchant_sale_payment_attempts
    set status='refunded',
        provider_payment_id=coalesce(provider_payment_id,v_payment_id),
        provider_status=v_status,
        refunded_at=coalesce(refunded_at,coalesce(p_occurred_at,v_now)),
        updated_at=v_now
    where id=v_attempt.id
      and status in ('approved','refunded');
  elsif v_next_status in ('expired','cancelled','rejected') then
    update public.merchant_sale_payment_attempts
    set status=v_next_status,
        provider_payment_id=coalesce(provider_payment_id,v_payment_id),
        provider_status=v_status,
        rejected_at=case when v_next_status='rejected' then coalesce(rejected_at,coalesce(p_occurred_at,v_now)) else rejected_at end,
        cancelled_at=case when v_next_status='cancelled' then coalesce(cancelled_at,coalesce(p_occurred_at,v_now)) else cancelled_at end,
        updated_at=v_now
    where id=v_attempt.id
      and status not in ('approved','refunded','review_required');
  else
    update public.merchant_sale_payment_attempts
    set status=case when status='preparing' then 'pending' else status end,
        provider_payment_id=coalesce(provider_payment_id,v_payment_id),
        provider_status=v_status,
        updated_at=v_now
    where id=v_attempt.id
      and status not in ('approved','refunded','review_required');
  end if;

  select *
  into v_attempt
  from public.merchant_sale_payment_attempts
  where id=v_attempt.id;

  return jsonb_build_object(
    'ok',true,
    'replayed',false,
    'attemptId',v_attempt.id,
    'orderId',v_attempt.order_id,
    'merchantId',v_attempt.merchant_id,
    'status',v_attempt.status,
    'providerStatus',v_attempt.provider_status,
    'approvedAt',v_attempt.approved_at,
    'refundedAt',v_attempt.refunded_at
  );
end;
$function$;

revoke all on function public.apply_merchant_sale_payment_event(
  text,text,text,text,text,bigint,text,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.apply_merchant_sale_payment_event(
  text,text,text,text,text,bigint,text,timestamptz,text
) to service_role;
