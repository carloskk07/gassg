-- TAMÃO V1.144 — Single unproven PSP pilot containment
-- Before evidence-backed homologation, a merchant/provider may have at most
-- one live automated payment pilot. Terminal pre-checkout failure releases
-- the slot; ambiguous provider outcomes remain in review and keep it blocked.

alter table public.merchant_sale_payment_attempts
  add column if not exists pilot_guard boolean not null default false;

alter table public.merchant_sale_payment_attempts
  drop constraint if exists merchant_sale_payment_attempts_pilot_guard_shape;

alter table public.merchant_sale_payment_attempts
  add constraint merchant_sale_payment_attempts_pilot_guard_shape
  check (
    pilot_guard is false
    or (
      provider<>'manual'
      and verification_level in ('provider','device')
      and funds_owner='merchant'
      and payment_route_id is not null
    )
  );

update public.merchant_sale_payment_attempts a
set pilot_guard=true
from public.merchant_payment_provider_accounts account
where a.merchant_id=account.merchant_id
  and a.provider=account.provider
  and account.status='active'
  and coalesce((account.capabilities->>'e2eValidated')::boolean,false)<>true
  and a.provider<>'manual'
  and a.verification_level in ('provider','device')
  and a.payment_route_id is not null
  and a.status in (
    'preparing','checkout_ready','pending','approved','review_required'
  );

do $$
begin
  if exists(
    select 1
    from public.merchant_sale_payment_attempts
    where pilot_guard
      and status in (
        'preparing','checkout_ready','pending','approved','review_required'
      )
    group by merchant_id,provider
    having count(*)>1
  ) then
    raise exception 'MERCHANT_PAYMENT_PILOT_DUPLICATE_ACTIVE'
      using errcode='23505';
  end if;
end;
$$;

create unique index if not exists merchant_sale_payment_attempts_one_unproven_pilot
  on public.merchant_sale_payment_attempts(merchant_id,provider)
  where pilot_guard
    and status in (
      'preparing','checkout_ready','pending','approved','review_required'
    );

comment on column public.merchant_sale_payment_attempts.pilot_guard
  is 'V1.144 true only for automated attempts created before evidence-backed PSP homologation; live guarded attempts are unique per merchant/provider.';

create or replace function public.record_merchant_sale_payment_attempt_issue(
  p_attempt_id uuid,
  p_error_code text,
  p_disposition text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_attempt public.merchant_sale_payment_attempts%rowtype;
  v_error_code text:=upper(trim(coalesce(p_error_code,'')));
  v_disposition text:=lower(trim(coalesce(p_disposition,'')));
  v_now timestamptz:=clock_timestamp();
begin
  if p_attempt_id is null
     or char_length(v_error_code)<3
     or char_length(v_error_code)>120
     or v_error_code!~'^[A-Z0-9_:-]+$'
     or v_disposition not in ('terminal_rejected','review_required') then
    raise exception 'INVALID_SALE_PAYMENT_ATTEMPT_ISSUE'
      using errcode='22023';
  end if;

  select *
  into v_attempt
  from public.merchant_sale_payment_attempts
  where id=p_attempt_id
  for update;

  if not found then
    raise exception 'SALE_PAYMENT_ATTEMPT_NOT_FOUND'
      using errcode='P0002';
  end if;

  if v_attempt.status in ('approved','refunded','cancelled','expired','rejected') then
    return jsonb_build_object(
      'ok',true,
      'attemptId',v_attempt.id,
      'status',v_attempt.status,
      'unchanged',true
    );
  end if;

  if v_disposition='terminal_rejected'
     and v_attempt.provider_order_id is null
     and v_attempt.status='preparing' then
    update public.merchant_sale_payment_attempts
    set status='rejected',
        rejected_at=coalesce(rejected_at,v_now),
        last_error_code=v_error_code,
        last_error_at=v_now,
        updated_at=v_now
    where id=v_attempt.id
    returning * into v_attempt;
  else
    update public.merchant_sale_payment_attempts
    set status='review_required',
        last_error_code=v_error_code,
        last_error_at=v_now,
        updated_at=v_now
    where id=v_attempt.id
      and status in ('preparing','checkout_ready','pending','review_required')
    returning * into v_attempt;
  end if;

  return jsonb_build_object(
    'ok',true,
    'attemptId',v_attempt.id,
    'status',v_attempt.status,
    'pilotGuard',v_attempt.pilot_guard,
    'errorCode',v_attempt.last_error_code
  );
end;
$function$;

revoke all on function public.record_merchant_sale_payment_attempt_issue(
  uuid,text,text
) from public,anon,authenticated;
grant execute on function public.record_merchant_sale_payment_attempt_issue(
  uuid,text,text
) to service_role;

create or replace function public.prepare_merchant_sale_payment_attempt_v2(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_payment_route_id uuid,
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
  v_route public.merchant_payment_routes%rowtype;
  v_account public.merchant_payment_provider_accounts%rowtype;
  v_action public.action_requests%rowtype;
  v_attempt public.merchant_sale_payment_attempts%rowtype;
  v_external_reference text;
  v_checkout_mode text;
  v_verification_level text;
  v_pilot_guard boolean:=false;
  v_result jsonb;
begin
  if p_actor_user_id is null or p_order_id is null or p_payment_route_id is null then
    raise exception 'SALE_PAYMENT_ROUTE_REQUIRED' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_actor_user_id,'merchant-sale-payment:prepare:v2',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found
     or v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'merchant-sale-payment:prepare:v2'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select * into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found or v_order.customer_id<>p_actor_user_id then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;
  if v_order.merchant_id is null then
    raise exception 'ORDER_MERCHANT_NOT_BOUND' using errcode='40001';
  end if;
  if v_order.status not in ('MERCHANT_ACCEPTED','PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING') then
    raise exception 'ORDER_NOT_PAYABLE' using errcode='40001';
  end if;
  if v_order.total_cents<=0 then
    raise exception 'ORDER_PAYMENT_AMOUNT_INVALID' using errcode='40001';
  end if;

  select * into v_route
  from public.merchant_payment_routes
  where id=p_payment_route_id
    and merchant_id=v_order.merchant_id
    and active
  for share;

  if not found then
    raise exception 'PAYMENT_ROUTE_NOT_AVAILABLE' using errcode='40001';
  end if;
  if v_route.verification_mode not in ('provider_api','device') then
    raise exception 'PAYMENT_ROUTE_NOT_AUTOMATED' using errcode='40001';
  end if;
  if v_route.connection_id is null then
    raise exception 'PAYMENT_ROUTE_CONNECTION_REQUIRED' using errcode='40001';
  end if;

  -- Serialize all pilot decisions for this exact merchant/provider account.
  select * into v_account
  from public.merchant_payment_provider_accounts
  where id=v_route.connection_id
    and merchant_id=v_order.merchant_id
    and provider=v_route.provider
  for update;

  if not found
     or v_account.status<>'active'
     or coalesce((v_account.capabilities->>'directSalePaymentsEnabled')::boolean,false)<>true
     or coalesce((v_account.capabilities->>'canValidateProviderTransactions')::boolean,false)<>true then
    raise exception 'MERCHANT_DIRECT_PAYMENT_NOT_ENABLED' using errcode='40001';
  end if;

  v_pilot_guard:=
    coalesce((v_account.capabilities->>'e2eValidated')::boolean,false)<>true;

  if v_pilot_guard and exists(
    select 1
    from public.merchant_sale_payment_attempts a
    where a.merchant_id=v_order.merchant_id
      and a.provider=v_route.provider
      and a.order_id<>v_order.id
      and a.pilot_guard
      and a.status in (
        'preparing','checkout_ready','pending','approved','review_required'
      )
  ) then
    raise exception 'MERCHANT_PAYMENT_PILOT_IN_FLIGHT'
      using errcode='40001';
  end if;

  if not (
    v_order.payment_method=v_route.payment_method
    or (v_order.payment_method='card' and v_route.payment_method in ('card','card_credit','card_debit'))
  ) then
    raise exception 'ORDER_PAYMENT_ROUTE_MISMATCH' using errcode='40001';
  end if;

  select * into v_attempt
  from public.merchant_sale_payment_attempts
  where order_id=v_order.id
    and status in ('preparing','checkout_ready','pending','approved','review_required')
  order by
    case status when 'approved' then 0 when 'review_required' then 1 when 'checkout_ready' then 2 else 3 end,
    created_at desc
  limit 1
  for update;

  if not found then
    v_external_reference:=gen_random_uuid()::text;
    v_checkout_mode:=case
      when v_route.verification_mode='device' then 'terminal'
      when v_route.payment_method='pix' then 'pix'
      when v_route.payment_method='payment_link' then 'external_link'
      else 'hosted'
    end;
    v_verification_level:=case
      when v_route.verification_mode='device' then 'device'
      else 'provider'
    end;

    insert into public.merchant_sale_payment_attempts(
      order_id,merchant_id,provider,checkout_mode,external_reference,
      amount_cents,currency,status,payment_route_id,payment_method_snapshot,
      verification_level,funds_owner,pilot_guard
    )
    values(
      v_order.id,v_order.merchant_id,v_route.provider,v_checkout_mode,
      v_external_reference,v_order.total_cents,'BRL','preparing',
      v_route.id,v_route.payment_method,v_verification_level,'merchant',
      v_pilot_guard
    )
    returning * into v_attempt;
  end if;

  v_result:=jsonb_build_object(
    'ok',true,'attemptId',v_attempt.id,'orderId',v_attempt.order_id,
    'merchantId',v_attempt.merchant_id,'provider',v_attempt.provider,
    'paymentRouteId',v_attempt.payment_route_id,
    'paymentMethod',v_attempt.payment_method_snapshot,
    'verificationLevel',v_attempt.verification_level,
    'externalReference',v_attempt.external_reference,
    'amountCents',v_attempt.amount_cents,'currency',v_attempt.currency,
    'status',v_attempt.status,'providerOrderId',v_attempt.provider_order_id,
    'checkoutUrl',v_attempt.checkout_url,'expiresAt',v_attempt.expires_at,
    'pilotGuard',v_attempt.pilot_guard,
    'e2eValidated',not v_attempt.pilot_guard,
    'fundsOwner','merchant','tamaoReceivesSaleProceeds',false
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;

revoke all on function public.prepare_merchant_sale_payment_attempt_v2(
  uuid,uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.prepare_merchant_sale_payment_attempt_v2(
  uuid,uuid,uuid,text,text
) to service_role;

comment on function public.prepare_merchant_sale_payment_attempt_v2(
  uuid,uuid,uuid,text,text
) is 'V1.144 serializes merchant/provider pilot creation and allows only one live guarded attempt until evidence-backed E2E validation.';
