
create or replace function public.disconnect_merchant_payment_provider_account(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_role text;
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_account public.merchant_payment_provider_accounts%rowtype;
begin
  if v_provider not in ('mercadopago','woovi') then
    raise exception 'PAYMENT_PROVIDER_INVALID' using errcode='22023';
  end if;

  select member_role
  into v_role
  from public.merchant_members
  where merchant_id=p_merchant_id
    and user_id=p_actor_user_id
    and active
  for share;

  if v_role not in ('owner','manager') then
    raise exception 'MERCHANT_PAYMENT_PERMISSION_DENIED' using errcode='42501';
  end if;

  if exists(
    select 1
    from public.merchant_sale_payment_attempts a
    join public.orders o on o.id=a.order_id
    where a.merchant_id=p_merchant_id
      and a.provider=v_provider
      and (
        a.status in (
          'preparing','checkout_ready','pending','review_required'
        )
        or (
          a.status='approved'
          and o.status<>'SETTLED'
        )
      )
  ) then
    raise exception 'PAYMENT_CONNECTION_HAS_LIVE_ATTEMPTS' using errcode='40001';
  end if;

  update public.merchant_payment_provider_accounts
  set status='revoked',
      access_token_ciphertext=null,
      access_token_nonce=null,
      refresh_token_ciphertext=null,
      refresh_token_nonce=null,
      token_expires_at=null,
      revoked_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where merchant_id=p_merchant_id
    and provider=v_provider
  returning * into v_account;

  if not found then
    return jsonb_build_object(
      'ok',true,
      'merchantId',p_merchant_id,
      'provider',v_provider,
      'status','not_connected'
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'merchantId',v_account.merchant_id,
    'provider',v_account.provider,
    'status',v_account.status,
    'revokedAt',v_account.revoked_at
  );
end;
$function$;

revoke all on function public.disconnect_merchant_payment_provider_account(
  uuid,uuid,text
) from public,anon,authenticated;
grant execute on function public.disconnect_merchant_payment_provider_account(
  uuid,uuid,text
) to service_role;

create or replace function public.guard_order_merchant_sale_payment_lifecycle()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not (
    new.status is distinct from old.status
    or new.merchant_id is distinct from old.merchant_id
    or new.proposed_merchant_id is distinct from old.proposed_merchant_id
    or new.payment_method is distinct from old.payment_method
  ) then
    return new;
  end if;

  if exists(
    select 1
    from public.merchant_sale_payment_attempts a
    where a.order_id=old.id
      and a.status in (
        'preparing','checkout_ready','pending','approved','review_required'
      )
  ) and (
    new.merchant_id is distinct from old.merchant_id
    or new.payment_method is distinct from old.payment_method
    or new.status in ('REASSIGNING','REQUOTE_REQUIRED','CANCELLED')
  ) then
    raise exception 'SALE_PAYMENT_CANCEL_OR_REFUND_REQUIRED'
      using errcode='40001';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_order_merchant_sale_payment_lifecycle_trg
  on public.orders;

create trigger guard_order_merchant_sale_payment_lifecycle_trg
before update of status,merchant_id,proposed_merchant_id,payment_method
on public.orders
for each row
execute function public.guard_order_merchant_sale_payment_lifecycle();

revoke all on function public.guard_order_merchant_sale_payment_lifecycle()
  from public,anon,authenticated;
grant execute on function public.guard_order_merchant_sale_payment_lifecycle()
  to service_role;

create or replace function public.complete_order_delivery(
  p_user_id uuid,
  p_order_id uuid,
  p_pin_code text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text,
  p_payment_confirmed_by_merchant boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','extensions'
as $function$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_member_role text;
  v_secret public.order_delivery_secrets%rowtype;
  v_submitted_hash text;
  v_result jsonb;
  v_new_failures integer;
  v_sale_payment public.merchant_sale_payment_attempts%rowtype;
  v_payment_confirmed_at timestamptz;
  v_payment_confirmation_method text;
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

  select *
  into v_sale_payment
  from public.merchant_sale_payment_attempts
  where order_id=v_order.id
    and merchant_id=v_order.merchant_id
    and amount_cents=v_order.total_cents
    and currency='BRL'
    and status='approved'
  order by approved_at asc nulls last,created_at asc,id
  limit 1
  for share;

  if found then
    v_payment_confirmed_at:=coalesce(
      v_sale_payment.approved_at,
      clock_timestamp()
    );
    v_payment_confirmation_method:='psp_webhook';
  else
    if exists(
      select 1
      from public.merchant_sale_payment_attempts a
      where a.order_id=v_order.id
        and a.status in (
          'preparing','checkout_ready','pending','review_required'
        )
    ) then
      raise exception 'SALE_PAYMENT_STILL_PENDING' using errcode='40001';
    end if;

    if coalesce(p_payment_confirmed_by_merchant,false)<>true then
      raise exception 'PAYMENT_CONFIRMATION_REQUIRED' using errcode='40001';
    end if;

    v_payment_confirmed_at:=clock_timestamp();
    v_payment_confirmation_method:='merchant_attestation';
  end if;

  update public.orders
  set status='SETTLED',
      delivered_at=clock_timestamp(),
      payment_confirmed_at=v_payment_confirmed_at,
      payment_confirmation_method=v_payment_confirmation_method,
      settled_at=clock_timestamp(),
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id
  returning * into v_order;

  update public.order_delivery_secrets
  set consumed_at=clock_timestamp()
  where order_id=v_order.id;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values
    (
      v_order.id,
      case when v_payment_confirmation_method='merchant_attestation'
        then p_user_id else null end,
      case when v_payment_confirmation_method='merchant_attestation'
        then 'merchant' else 'system' end,
      'PAYMENT_CONFIRMED',
      'Pagamento confirmado',
      case when v_payment_confirmation_method='psp_webhook'
        then 'O provedor de pagamento confirmou a transação diretamente na conta da revenda.'
        else 'A revenda confirmou o recebimento do pagamento no fechamento da entrega.'
      end,
      jsonb_build_object(
        'confirmationMethod',v_payment_confirmation_method,
        'salePaymentAttemptId',
          case when v_payment_confirmation_method='psp_webhook'
            then v_sale_payment.id else null end
      )
    ),
    (
      v_order.id,p_user_id,'merchant','DELIVERED',
      'Entregue',
      'O PIN de recebimento foi validado.',
      '{}'::jsonb
    ),
    (
      v_order.id,null,'system','SETTLED',
      'Pedido concluído',
      'Entrega e pagamento foram confirmados e o pedido foi encerrado.',
      jsonb_build_object(
        'paymentConfirmationMethod',v_payment_confirmation_method
      )
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
    'paymentConfirmationMethod',v_order.payment_confirmation_method,
    'settledAt',v_order.settled_at
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;

revoke all on function public.complete_order_delivery(
  uuid,uuid,text,integer,text,text,boolean
) from public,anon,authenticated;
grant execute on function public.complete_order_delivery(
  uuid,uuid,text,integer,text,text,boolean
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
language sql
security definer
set search_path to 'pg_catalog','extensions'
as $function$
  select public.complete_order_delivery(
    p_user_id,
    p_order_id,
    p_pin_code,
    p_expected_version,
    p_idempotency_key,
    p_request_hash,
    true
  );
$function$;

revoke all on function public.complete_order_delivery(
  uuid,uuid,text,integer,text,text
) from public,anon,authenticated;
grant execute on function public.complete_order_delivery(
  uuid,uuid,text,integer,text,text
) to service_role;
