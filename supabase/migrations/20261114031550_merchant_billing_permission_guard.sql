-- Preserve the current production function, rejecting missing membership
-- before reserving an action, preparing a charge or changing any balance.
create or replace function public.merchant_billing_pix_charge_prepare_provider(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_plan_key text,
  p_statement_id uuid,
  p_refund_recovery_id uuid,
  p_provider text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_role text;
  v_action public.action_requests%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_statement public.merchant_daily_statements%rowtype;
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_charge public.merchant_billing_provider_charges%rowtype;
  v_correlation text;
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_action_name text;
  v_result jsonb;
  v_target_count integer:=
    (case when p_plan_key is not null then 1 else 0 end)
    +(case when p_statement_id is not null then 1 else 0 end)
    +(case when p_refund_recovery_id is not null then 1 else 0 end);
begin
  if v_provider not in ('woovi','mercadopago') then
    raise exception 'UNSUPPORTED_PIX_PROVIDER' using errcode='22023';
  end if;
  v_action_name:='merchant-billing-pix-charge:prepare:'||v_provider;

  select member_role
  into v_role
  from public.merchant_members
  where merchant_id=p_merchant_id
    and user_id=p_actor_user_id
    and active
  for share;

  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'MERCHANT_FINANCE_PERMISSION_DENIED' using errcode='42501';
  end if;

  if v_target_count<>1 then
    raise exception 'PIX_CHARGE_TARGET_REQUIRED' using errcode='22023';
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
    p_idempotency_key,p_actor_user_id,v_action_name,p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>v_action_name
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'merchant-billing-pix:'||p_merchant_id::text,
      0
    )
  );

  if p_plan_key is not null then
    select *
    into v_plan
    from public.merchant_billing_plans
    where plan_key=lower(trim(p_plan_key))
      and active
      and billing_mode='prepaid_credit'
    for share;

    if not found then
      raise exception 'INVALID_PREPAID_PLAN' using errcode='22023';
    end if;

    select *
    into v_request
    from public.merchant_billing_payment_requests
    where merchant_id=p_merchant_id
      and request_kind='package_purchase'
      and status='pending'
    for update;

    if found then
      if v_request.plan_key is distinct from v_plan.plan_key then
        raise exception 'PACKAGE_REQUEST_ALREADY_PENDING' using errcode='40001';
      end if;
    else
      v_correlation:=gen_random_uuid()::text;
      insert into public.merchant_billing_payment_requests(
        merchant_id,request_kind,plan_key,expected_amount_cents,
        platform_fee_bps_snapshot,credit_grant_cents_snapshot,
        merchant_reference,requested_by
      )
      values(
        p_merchant_id,'package_purchase',v_plan.plan_key,
        v_plan.purchase_amount_cents,v_plan.platform_fee_bps,
        v_plan.credit_grant_cents,
        'pix-auto:'||v_correlation,p_actor_user_id
      )
      returning * into v_request;
    end if;

  elsif p_statement_id is not null then
    select *
    into v_statement
    from public.merchant_daily_statements
    where id=p_statement_id
      and merchant_id=p_merchant_id
    for update;

    if not found then
      raise exception 'STATEMENT_NOT_FOUND' using errcode='P0002';
    end if;

    if v_statement.status not in ('open','overdue')
       or v_statement.amount_due_cents<=0 then
      raise exception 'STATEMENT_NOT_PAYABLE' using errcode='40001';
    end if;

    select *
    into v_request
    from public.merchant_billing_payment_requests
    where statement_id=v_statement.id
      and request_kind='statement_payment'
      and status='pending'
    for update;

    if not found then
      v_correlation:=gen_random_uuid()::text;
      insert into public.merchant_billing_payment_requests(
        merchant_id,request_kind,statement_id,expected_amount_cents,
        merchant_reference,requested_by
      )
      values(
        p_merchant_id,'statement_payment',v_statement.id,
        v_statement.amount_due_cents,
        'pix-auto:'||v_correlation,p_actor_user_id
      )
      returning * into v_request;
    end if;

  else
    select rr.*
    into v_recovery
    from public.merchant_billing_refund_recoveries rr
    where rr.id=p_refund_recovery_id
      and rr.merchant_id=p_merchant_id
    for update;

    if not found then
      raise exception 'REFUND_RECOVERY_NOT_FOUND' using errcode='P0002';
    end if;

    select *
    into v_refund
    from public.merchant_billing_payment_refunds
    where id=v_recovery.refund_id
    for share;

    if not found
       or v_refund.status<>'review_required'
       or v_recovery.status='recovered' then
      raise exception 'REFUND_RECOVERY_NOT_PAYABLE' using errcode='40001';
    end if;

    select *
    into v_request
    from public.merchant_billing_payment_requests
    where refund_recovery_id=v_recovery.id
      and request_kind='refund_recovery'
      and status='pending'
    order by requested_at desc,id
    limit 1
    for update;

    if not found then
      v_correlation:=gen_random_uuid()::text;
      insert into public.merchant_billing_payment_requests(
        merchant_id,request_kind,refund_recovery_id,
        expected_amount_cents,merchant_reference,requested_by
      )
      values(
        p_merchant_id,'refund_recovery',v_recovery.id,
        v_recovery.amount_cents,
        'pix-auto:'||v_correlation,p_actor_user_id
      )
      returning * into v_request;
    end if;

    update public.merchant_billing_refund_recoveries
    set status='payment_pending',
        recovery_payment_request_id=v_request.id,
        updated_at=clock_timestamp()
    where id=v_recovery.id
      and status in ('open','payment_pending');
  end if;

  select *
  into v_charge
  from public.merchant_billing_provider_charges
  where payment_request_id=v_request.id
    and status='completed'
  order by completed_at asc nulls last,created_at asc,id
  limit 1
  for update;

  if found then
    v_result:=jsonb_build_object(
      'ok',true,
      'merchantId',v_request.merchant_id,
      'paymentRequestId',v_request.id,
      'requestKind',v_request.request_kind,
      'planKey',v_request.plan_key,
      'statementId',v_request.statement_id,
      'refundRecoveryId',v_request.refund_recovery_id,
      'expectedAmountCents',v_request.expected_amount_cents,
      'chargeId',v_charge.id,
      'provider',v_charge.provider,
      'correlationId',v_charge.correlation_id,
      'chargeStatus',v_charge.status,
      'paymentAlreadyReceived',true
    );

    update public.action_requests
    set result_json=v_result,
        completed_at=clock_timestamp()
    where idempotency_key=p_idempotency_key;

    return v_result;
  end if;

  select *
  into v_charge
  from public.merchant_billing_provider_charges
  where payment_request_id=v_request.id
    and provider=v_provider
    and status in ('preparing','active')
  order by
    case status when 'active' then 0 else 1 end,
    created_at desc
  limit 1
  for update;

  if found
     and v_charge.status='active'
     and v_charge.expires_at is not null
     and v_charge.expires_at<=clock_timestamp() then
    update public.merchant_billing_provider_charges
    set status='expired',
        expired_at=coalesce(expired_at,expires_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where id=v_charge.id;

    v_charge.id:=null;
  end if;

  if v_charge.id is null then
    update public.merchant_billing_provider_charges
    set status='cancelled',
        last_error_code='PROVIDER_CANCEL_REQUIRED',
        last_error_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where payment_request_id=v_request.id
      and provider<>v_provider
      and status in ('preparing','active');

    v_correlation:=coalesce(v_correlation,gen_random_uuid()::text);

    insert into public.merchant_billing_provider_charges(
      payment_request_id,merchant_id,provider,correlation_id,
      amount_cents,currency,status
    )
    values(
      v_request.id,v_request.merchant_id,v_provider,v_correlation,
      v_request.expected_amount_cents,'BRL','preparing'
    )
    returning * into v_charge;
  end if;

  if v_charge.amount_cents is distinct from v_request.expected_amount_cents
     or v_charge.merchant_id is distinct from v_request.merchant_id then
    raise exception 'PIX_CHARGE_REQUEST_MISMATCH' using errcode='40001';
  end if;

  v_result:=jsonb_build_object(
    'ok',true,
    'merchantId',v_request.merchant_id,
    'paymentRequestId',v_request.id,
    'requestKind',v_request.request_kind,
    'planKey',v_request.plan_key,
    'statementId',v_request.statement_id,
    'refundRecoveryId',v_request.refund_recovery_id,
    'expectedAmountCents',v_request.expected_amount_cents,
    'chargeId',v_charge.id,
    'provider',v_charge.provider,
    'correlationId',v_charge.correlation_id,
    'chargeStatus',v_charge.status,
    'paymentAlreadyReceived',false
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;
