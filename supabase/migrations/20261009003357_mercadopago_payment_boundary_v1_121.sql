
create table if not exists public.merchant_payment_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  provider text not null,
  provider_account_id text,
  status text not null default 'pending',
  capabilities jsonb not null default '{}'::jsonb,
  access_token_ciphertext text,
  access_token_nonce text,
  refresh_token_ciphertext text,
  refresh_token_nonce text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  refreshed_at timestamptz,
  revoked_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_payment_provider_accounts_provider_check
    check (provider in ('mercadopago','woovi')),
  constraint merchant_payment_provider_accounts_status_check
    check (status in ('pending','active','refresh_required','revoked','error')),
  constraint merchant_payment_provider_accounts_provider_account_id_check
    check (
      provider_account_id is null
      or (
        char_length(trim(provider_account_id)) between 2 and 160
        and provider_account_id !~ '[[:cntrl:]]'
      )
    ),
  constraint merchant_payment_provider_accounts_ciphertext_shape
    check (
      (
        access_token_ciphertext is null
        and access_token_nonce is null
      )
      or (
        access_token_ciphertext is not null
        and access_token_nonce is not null
        and char_length(access_token_ciphertext) between 16 and 8192
        and char_length(access_token_nonce) between 12 and 256
      )
    ),
  constraint merchant_payment_provider_accounts_refresh_shape
    check (
      (
        refresh_token_ciphertext is null
        and refresh_token_nonce is null
      )
      or (
        refresh_token_ciphertext is not null
        and refresh_token_nonce is not null
        and char_length(refresh_token_ciphertext) between 16 and 8192
        and char_length(refresh_token_nonce) between 12 and 256
      )
    ),
  constraint merchant_payment_provider_accounts_active_shape
    check (
      status <> 'active'
      or (
        provider_account_id is not null
        and access_token_ciphertext is not null
        and access_token_nonce is not null
        and connected_at is not null
      )
    ),
  constraint merchant_payment_provider_accounts_revoked_shape
    check (status <> 'revoked' or revoked_at is not null),
  constraint merchant_payment_provider_accounts_last_error_code_check
    check (
      last_error_code is null
      or (
        char_length(last_error_code) between 3 and 120
        and last_error_code ~ '^[A-Z0-9_:-]+$'
      )
    ),
  unique (merchant_id, provider)
);

create index if not exists merchant_payment_provider_accounts_provider_account_idx
  on public.merchant_payment_provider_accounts(provider, provider_account_id)
  where provider_account_id is not null;

create table if not exists public.merchant_payment_oauth_states (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  provider text not null,
  initiated_by uuid not null references auth.users(id) on delete restrict,
  state_hash text not null,
  code_verifier_ciphertext text not null,
  code_verifier_nonce text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint merchant_payment_oauth_states_provider_check
    check (provider='mercadopago'),
  constraint merchant_payment_oauth_states_state_hash_check
    check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint merchant_payment_oauth_states_ciphertext_check
    check (
      char_length(code_verifier_ciphertext) between 16 and 8192
      and char_length(code_verifier_nonce) between 12 and 256
    ),
  constraint merchant_payment_oauth_states_redirect_uri_check
    check (
      char_length(redirect_uri) between 16 and 2048
      and redirect_uri ~ '^https://'
    ),
  constraint merchant_payment_oauth_states_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '20 minutes'),
  unique (state_hash)
);

create index if not exists merchant_payment_oauth_states_expiry_idx
  on public.merchant_payment_oauth_states(expires_at)
  where consumed_at is null;

create table if not exists public.merchant_sale_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  provider text not null,
  checkout_mode text not null default 'hosted',
  external_reference text not null,
  amount_cents bigint not null,
  currency text not null default 'BRL',
  status text not null default 'preparing',
  provider_preference_id text,
  provider_order_id text,
  provider_payment_id text,
  provider_status text,
  provider_status_detail text,
  checkout_url text,
  expires_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_sale_payment_attempts_provider_check
    check (provider='mercadopago'),
  constraint merchant_sale_payment_attempts_checkout_mode_check
    check (checkout_mode in ('hosted','pix')),
  constraint merchant_sale_payment_attempts_external_reference_check
    check (
      char_length(external_reference) between 12 and 160
      and external_reference !~ '[[:cntrl:]]'
    ),
  constraint merchant_sale_payment_attempts_amount_check
    check (amount_cents > 0 and amount_cents <= 1000000000),
  constraint merchant_sale_payment_attempts_currency_check
    check (currency='BRL'),
  constraint merchant_sale_payment_attempts_status_check
    check (
      status in (
        'preparing','checkout_ready','pending','approved',
        'rejected','cancelled','expired','refunded','review_required'
      )
    ),
  constraint merchant_sale_payment_attempts_provider_ids_check
    check (
      (provider_preference_id is null or (
        char_length(provider_preference_id) between 2 and 240
        and provider_preference_id !~ '[[:cntrl:]]'
      ))
      and
      (provider_order_id is null or (
        char_length(provider_order_id) between 2 and 240
        and provider_order_id !~ '[[:cntrl:]]'
      ))
      and
      (provider_payment_id is null or (
        char_length(provider_payment_id) between 1 and 240
        and provider_payment_id !~ '[[:cntrl:]]'
      ))
    ),
  constraint merchant_sale_payment_attempts_checkout_url_check
    check (
      checkout_url is null
      or (
        char_length(checkout_url) between 12 and 2048
        and checkout_url ~ '^https://'
      )
    ),
  constraint merchant_sale_payment_attempts_approved_shape
    check (
      status <> 'approved'
      or (
        approved_at is not null
        and provider_payment_id is not null
      )
    ),
  unique (provider, external_reference)
);

create index if not exists merchant_sale_payment_attempts_order_idx
  on public.merchant_sale_payment_attempts(order_id, created_at desc);

create index if not exists merchant_sale_payment_attempts_provider_payment_idx
  on public.merchant_sale_payment_attempts(provider, provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists merchant_sale_payment_attempts_one_live_per_order
  on public.merchant_sale_payment_attempts(order_id)
  where status in ('preparing','checkout_ready','pending','approved');

create table if not exists public.merchant_sale_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  payment_attempt_id uuid references public.merchant_sale_payment_attempts(id) on delete restrict,
  provider_payment_id text,
  event_type text not null,
  event_status text not null default 'received',
  raw_payload_sha256 text not null,
  occurred_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_sale_payment_events_provider_check
    check (provider='mercadopago'),
  constraint merchant_sale_payment_events_provider_event_id_check
    check (
      char_length(provider_event_id) between 6 and 200
      and provider_event_id !~ '[[:cntrl:]]'
    ),
  constraint merchant_sale_payment_events_provider_payment_id_check
    check (
      provider_payment_id is null
      or (
        char_length(provider_payment_id) between 1 and 240
        and provider_payment_id !~ '[[:cntrl:]]'
      )
    ),
  constraint merchant_sale_payment_events_type_check
    check (
      char_length(event_type) between 3 and 120
      and event_type ~ '^[A-Za-z0-9._:-]+$'
    ),
  constraint merchant_sale_payment_events_status_check
    check (event_status in ('received','applied','ignored','review_required','failed')),
  constraint merchant_sale_payment_events_hash_check
    check (raw_payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint merchant_sale_payment_events_error_code_check
    check (
      error_code is null
      or (
        char_length(error_code) between 3 and 120
        and error_code ~ '^[A-Z0-9_:-]+$'
      )
    ),
  unique (provider, provider_event_id)
);

create index if not exists merchant_sale_payment_events_attempt_idx
  on public.merchant_sale_payment_events(payment_attempt_id, received_at desc)
  where payment_attempt_id is not null;

alter table public.merchant_payment_provider_accounts enable row level security;
alter table public.merchant_payment_oauth_states enable row level security;
alter table public.merchant_sale_payment_attempts enable row level security;
alter table public.merchant_sale_payment_events enable row level security;

revoke all on table public.merchant_payment_provider_accounts from public, anon, authenticated;
revoke all on table public.merchant_payment_oauth_states from public, anon, authenticated;
revoke all on table public.merchant_sale_payment_attempts from public, anon, authenticated;
revoke all on table public.merchant_sale_payment_events from public, anon, authenticated;

grant select,insert,update,delete on table public.merchant_payment_provider_accounts to service_role;
grant select,insert,update,delete on table public.merchant_payment_oauth_states to service_role;
grant select,insert,update,delete on table public.merchant_sale_payment_attempts to service_role;
grant select,insert,update,delete on table public.merchant_sale_payment_events to service_role;

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

  if v_role not in ('owner','manager') then
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

revoke all on function public.merchant_billing_pix_charge_prepare_provider(
  uuid,uuid,text,uuid,uuid,text,text,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_pix_charge_prepare_provider(
  uuid,uuid,text,uuid,uuid,text,text,text
) to service_role;

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
set search_path to 'pg_catalog'
as $function$
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

  if v_charge.provider not in ('woovi','mercadopago') then
    raise exception 'PIX_CHARGE_PROVIDER_MISMATCH' using errcode='40001';
  end if;

  if v_charge.status in ('completed','expired','cancelled') then
    if v_charge.status='completed' then
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
    end if;
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
$function$;

revoke all on function public.merchant_billing_provider_charge_commit(
  uuid,text,text,text,text,text,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_provider_charge_commit(
  uuid,text,text,text,text,text,timestamptz,text
) to service_role;
