-- TAMÃO — Pix charge expiration lifecycle v1.94
-- A provider QR is a temporary presentation object. Expiration retires only
-- that charge, never the underlying financial request or any merchant credit.

alter table public.merchant_billing_provider_charges
  add column if not exists expired_at timestamptz;

alter table public.merchant_billing_provider_charges
  drop constraint if exists merchant_billing_provider_charges_expired_shape;

alter table public.merchant_billing_provider_charges
  add constraint merchant_billing_provider_charges_expired_shape
  check (
    status<>'expired'
    or expired_at is not null
  );

create or replace function public.merchant_billing_pix_charge_prepare(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_plan_key text,
  p_statement_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_role text;
  v_action public.action_requests%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_statement public.merchant_daily_statements%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_charge public.merchant_billing_provider_charges%rowtype;
  v_correlation text;
  v_result jsonb;
begin
  select member_role
  into v_role
  from public.merchant_members
  where merchant_id=p_merchant_id
    and user_id=p_actor_user_id
    and active
  for share;

  if v_role not in ('owner','manager') then
    raise exception 'MERCHANT_FINANCE_PERMISSION_DENIED' using errcode='42501';
  end if;

  if (p_plan_key is null)=(p_statement_id is null) then
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
    p_idempotency_key,p_actor_user_id,
    'merchant-billing-pix-charge:prepare',
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'merchant-billing-pix-charge:prepare'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  -- Serialize distinct idempotency keys from multiple tabs/devices for the
  -- same merchant before inspecting/creating the one pending financial request.
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
        'pix-auto:'||v_correlation,
        p_actor_user_id
      )
      returning * into v_request;
    end if;

  else
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
        'pix-auto:'||v_correlation,
        p_actor_user_id
      )
      returning * into v_request;
    end if;
  end if;

  select *
  into v_charge
  from public.merchant_billing_provider_charges
  where payment_request_id=v_request.id
    and provider='woovi'
    and status in ('preparing','active','completed')
  order by
    case status
      when 'completed' then 0
      when 'active' then 1
      else 2
    end,
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

    -- The financial request remains pending. Only the provider presentation
    -- object is retired, allowing a fresh correlation/QR for the same request.
    v_charge.id:=null;
  end if;

  if v_charge.id is null then
    v_correlation:=coalesce(v_correlation,gen_random_uuid()::text);

    insert into public.merchant_billing_provider_charges(
      payment_request_id,merchant_id,provider,correlation_id,
      amount_cents,currency,status
    )
    values(
      v_request.id,v_request.merchant_id,'woovi',v_correlation,
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
    'expectedAmountCents',v_request.expected_amount_cents,
    'chargeId',v_charge.id,
    'provider',v_charge.provider,
    'correlationId',v_charge.correlation_id,
    'chargeStatus',v_charge.status
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;


revoke all on function public.merchant_billing_pix_charge_prepare(
  uuid,uuid,text,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_pix_charge_prepare(
  uuid,uuid,text,uuid,text,text
) to service_role,postgres;

create or replace function public.merchant_billing_provider_charge_commit(
  p_charge_id uuid,
  p_provider_charge_id text,
  p_provider_transaction_id text,
  p_br_code text,
  p_qr_code_data_uri text,
  p_payment_link_url text,
  p_expires_at timestamptz,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_charge public.merchant_billing_provider_charges%rowtype;
  v_status text:=lower(trim(coalesce(p_status,'')));
  v_provider_charge_id text:=nullif(trim(coalesce(p_provider_charge_id,'')),'');
  v_provider_transaction_id text:=nullif(trim(coalesce(p_provider_transaction_id,'')),'');
  v_br_code text:=nullif(trim(coalesce(p_br_code,'')),'');
  v_qr text:=nullif(trim(coalesce(p_qr_code_data_uri,'')),'');
  v_link text:=nullif(trim(coalesce(p_payment_link_url,'')),'');
  v_expires_at timestamptz:=coalesce(
    p_expires_at,
    clock_timestamp()+interval '24 hours'
  );
begin
  if p_charge_id is null then
    raise exception 'PIX_CHARGE_ID_REQUIRED' using errcode='22023';
  end if;

  if v_status not in ('active','completed') then
    raise exception 'INVALID_PROVIDER_CHARGE_STATUS' using errcode='22023';
  end if;

  if v_provider_charge_id is null
     or char_length(v_provider_charge_id)>240
     or v_provider_charge_id~'[[:cntrl:]]' then
    raise exception 'INVALID_PROVIDER_CHARGE_ID' using errcode='22023';
  end if;

  if v_br_code is null
     or char_length(v_br_code)<20
     or char_length(v_br_code)>8192 then
    raise exception 'INVALID_PROVIDER_BR_CODE' using errcode='22023';
  end if;

  if v_qr is not null
     and (
       char_length(v_qr)>600000
       or v_qr not like 'data:image/png;base64,%'
     ) then
    raise exception 'INVALID_PROVIDER_QR_IMAGE' using errcode='22023';
  end if;

  if v_link is not null
     and (
       char_length(v_link)>2048
       or v_link!~'^https://'
     ) then
    raise exception 'INVALID_PROVIDER_PAYMENT_LINK' using errcode='22023';
  end if;

  select *
  into v_charge
  from public.merchant_billing_provider_charges
  where id=p_charge_id
  for update;

  if not found then
    raise exception 'PIX_CHARGE_NOT_FOUND' using errcode='P0002';
  end if;

  if v_charge.provider<>'woovi' then
    raise exception 'PIX_CHARGE_PROVIDER_MISMATCH' using errcode='40001';
  end if;

  if v_charge.status='completed' then
    -- The signed payment webhook can win the race against the create-charge
    -- HTTP response. In that case the financial fact is already completed,
    -- but provider presentation metadata may still be missing. Enrich only
    -- missing fields; conflicting non-null evidence remains fatal.
    if (v_charge.provider_charge_id is not null
        and v_charge.provider_charge_id is distinct from v_provider_charge_id)
       or (v_charge.br_code is not null
        and v_charge.br_code is distinct from v_br_code) then
      raise exception 'PIX_CHARGE_COMMIT_CONFLICT' using errcode='23505';
    end if;

    update public.merchant_billing_provider_charges
    set provider_charge_id=coalesce(provider_charge_id,v_provider_charge_id),
        provider_transaction_id=coalesce(provider_transaction_id,v_provider_transaction_id),
        br_code=coalesce(br_code,v_br_code),
        qr_code_data_uri=coalesce(qr_code_data_uri,v_qr),
        payment_link_url=coalesce(payment_link_url,v_link),
        expires_at=coalesce(expires_at,v_expires_at),
        last_error_code=null,
        last_error_at=null,
        updated_at=clock_timestamp()
    where id=v_charge.id
    returning * into v_charge;
  else
    update public.merchant_billing_provider_charges
    set status=v_status,
        provider_charge_id=v_provider_charge_id,
        provider_transaction_id=v_provider_transaction_id,
        br_code=v_br_code,
        qr_code_data_uri=v_qr,
        payment_link_url=v_link,
        expires_at=v_expires_at,
        last_error_code=null,
        last_error_at=null,
        updated_at=clock_timestamp()
    where id=v_charge.id
    returning * into v_charge;
  end if;

  return jsonb_build_object(
    'ok',true,
    'chargeId',v_charge.id,
    'paymentRequestId',v_charge.payment_request_id,
    'provider',v_charge.provider,
    'correlationId',v_charge.correlation_id,
    'status',v_charge.status,
    'amountCents',v_charge.amount_cents,
    'brCode',v_charge.br_code,
    'qrCodeDataUri',v_charge.qr_code_data_uri,
    'paymentLinkUrl',v_charge.payment_link_url,
    'expiresAt',v_charge.expires_at
  );
end;
$$;


revoke all on function public.merchant_billing_provider_charge_commit(
  uuid,text,text,text,text,text,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_provider_charge_commit(
  uuid,text,text,text,text,text,timestamptz,text
) to service_role,postgres;

create or replace function public.merchant_billing_provider_charge_expire(
  p_provider text,
  p_correlation_id text,
  p_amount_cents bigint,
  p_provider_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_correlation text:=trim(coalesce(p_correlation_id,''));
  v_charge public.merchant_billing_provider_charges%rowtype;
  v_expired_at timestamptz;
begin
  if char_length(v_provider)<2
     or char_length(v_provider)>40
     or v_provider!~'^[a-z0-9][a-z0-9._-]*$' then
    raise exception 'INVALID_PIX_CHARGE_PROVIDER' using errcode='22023';
  end if;

  if char_length(v_correlation)<6
     or char_length(v_correlation)>160
     or v_correlation~'[[:cntrl:]]' then
    raise exception 'INVALID_PIX_CHARGE_CORRELATION' using errcode='22023';
  end if;

  if p_amount_cents is null or p_amount_cents<=0 then
    raise exception 'INVALID_PIX_CHARGE_AMOUNT' using errcode='22023';
  end if;

  if p_provider_expires_at is not null
     and p_provider_expires_at>clock_timestamp()+interval '5 minutes' then
    raise exception 'INVALID_PIX_CHARGE_EXPIRY_TIMESTAMP' using errcode='22023';
  end if;

  select *
  into v_charge
  from public.merchant_billing_provider_charges
  where provider=v_provider
    and lower(trim(correlation_id))=lower(v_correlation)
  order by created_at desc,id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok',true,
      'ignored',true,
      'reason','provider_charge_not_owned'
    );
  end if;

  if v_charge.amount_cents<>p_amount_cents then
    update public.merchant_billing_provider_charges
    set last_error_code='PROVIDER_EXPIRY_AMOUNT_MISMATCH',
        last_error_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=v_charge.id;

    return jsonb_build_object(
      'ok',false,
      'reviewRequired',true,
      'chargeId',v_charge.id,
      'status',v_charge.status,
      'reason','provider_expiry_amount_mismatch'
    );
  end if;

  if v_charge.status='completed' then
    return jsonb_build_object(
      'ok',true,
      'ignored',true,
      'chargeId',v_charge.id,
      'status',v_charge.status,
      'reason','charge_already_completed'
    );
  end if;

  if v_charge.status='cancelled' then
    return jsonb_build_object(
      'ok',true,
      'ignored',true,
      'chargeId',v_charge.id,
      'status',v_charge.status,
      'reason','charge_already_cancelled'
    );
  end if;

  v_expired_at:=coalesce(
    p_provider_expires_at,
    v_charge.expires_at,
    clock_timestamp()
  );

  if v_charge.status='expired' then
    update public.merchant_billing_provider_charges
    set expired_at=coalesce(expired_at,v_expired_at),
        updated_at=clock_timestamp()
    where id=v_charge.id
    returning * into v_charge;

    return jsonb_build_object(
      'ok',true,
      'replayed',true,
      'chargeId',v_charge.id,
      'paymentRequestId',v_charge.payment_request_id,
      'status',v_charge.status,
      'expiredAt',v_charge.expired_at
    );
  end if;

  update public.merchant_billing_provider_charges
  set status='expired',
      expired_at=v_expired_at,
      last_error_code=null,
      last_error_at=null,
      updated_at=clock_timestamp()
  where id=v_charge.id
    and status in ('preparing','active')
  returning * into v_charge;

  if not found then
    raise exception 'PIX_CHARGE_EXPIRY_STATE_CONFLICT' using errcode='40001';
  end if;

  return jsonb_build_object(
    'ok',true,
    'replayed',false,
    'chargeId',v_charge.id,
    'paymentRequestId',v_charge.payment_request_id,
    'status',v_charge.status,
    'expiredAt',v_charge.expired_at
  );
end;
$$;

revoke all on function public.merchant_billing_provider_charge_expire(
  text,text,bigint,timestamptz
) from public,anon,authenticated;
grant execute on function public.merchant_billing_provider_charge_expire(
  text,text,bigint,timestamptz
) to service_role,postgres;
