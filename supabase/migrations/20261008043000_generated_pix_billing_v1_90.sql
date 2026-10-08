-- TAMÃO — Generated Pix billing v1.90
-- Keeps the TAMÃO request correlation separate from the bank EndToEndId.
-- A generated charge never moves money/credit by itself: it only prepares
-- a provider-correlated payment request that still requires exact event
-- reconciliation and Finance approval.

alter table public.merchant_billing_payment_events
  add column if not exists provider_correlation_id text;

alter table public.merchant_billing_payment_events
  drop constraint if exists merchant_billing_payment_events_provider_correlation_valid;

alter table public.merchant_billing_payment_events
  add constraint merchant_billing_payment_events_provider_correlation_valid
  check (
    provider_correlation_id is null
    or (
      char_length(trim(provider_correlation_id)) between 6 and 160
      and provider_correlation_id !~ '[[:cntrl:]]'
    )
  );

create index if not exists merchant_billing_payment_events_provider_correlation_idx
  on public.merchant_billing_payment_events(
    provider,
    lower(trim(provider_correlation_id)),
    amount_cents
  )
  where provider_correlation_id is not null;

create table if not exists public.merchant_billing_provider_charges (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null
    references public.merchant_billing_payment_requests(id) on delete restrict,
  merchant_id uuid not null
    references public.merchants(id) on delete restrict,
  provider text not null
    check (
      char_length(provider) between 2 and 40
      and provider ~ '^[a-z0-9][a-z0-9._-]*$'
    ),
  correlation_id text not null
    check (
      char_length(trim(correlation_id)) between 6 and 160
      and correlation_id !~ '[[:cntrl:]]'
    ),
  amount_cents bigint not null check (amount_cents>0),
  currency text not null default 'BRL' check (currency='BRL'),
  status text not null default 'preparing'
    check (status in ('preparing','active','completed','expired','cancelled')),
  provider_charge_id text
    check (
      provider_charge_id is null
      or (
        char_length(provider_charge_id) between 3 and 240
        and provider_charge_id !~ '[[:cntrl:]]'
      )
    ),
  provider_transaction_id text
    check (
      provider_transaction_id is null
      or (
        char_length(provider_transaction_id) between 3 and 240
        and provider_transaction_id !~ '[[:cntrl:]]'
      )
    ),
  br_code text
    check (br_code is null or char_length(br_code) between 20 and 8192),
  qr_code_data_uri text
    check (
      qr_code_data_uri is null
      or (
        char_length(qr_code_data_uri) between 32 and 600000
        and qr_code_data_uri like 'data:image/png;base64,%'
      )
    ),
  payment_link_url text
    check (
      payment_link_url is null
      or (
        char_length(payment_link_url) between 12 and 2048
        and payment_link_url ~ '^https://'
      )
    ),
  expires_at timestamptz,
  completed_at timestamptz,
  paid_amount_cents bigint
    check (paid_amount_cents is null or paid_amount_cents>0),
  end_to_end_id text
    check (
      end_to_end_id is null
      or (
        char_length(end_to_end_id) between 6 and 160
        and end_to_end_id !~ '[[:cntrl:]]'
      )
    ),
  last_error_code text
    check (
      last_error_code is null
      or (
        char_length(last_error_code) between 3 and 120
        and last_error_code ~ '^[A-Z0-9_:-]+$'
      )
    ),
  last_error_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_billing_provider_charges_completed_shape check (
    status<>'completed'
    or (
      completed_at is not null
      and paid_amount_cents is not null
      and end_to_end_id is not null
    )
  )
);

alter table public.merchant_billing_provider_charges enable row level security;
revoke all on table public.merchant_billing_provider_charges
from public,anon,authenticated;
grant all on table public.merchant_billing_provider_charges
to service_role,postgres;

create unique index if not exists merchant_billing_provider_charges_provider_correlation_uq
  on public.merchant_billing_provider_charges(
    provider,
    lower(trim(correlation_id))
  );

create unique index if not exists merchant_billing_provider_charges_one_open_per_request_uq
  on public.merchant_billing_provider_charges(payment_request_id,provider)
  where status in ('preparing','active');

create index if not exists merchant_billing_provider_charges_merchant_created_idx
  on public.merchant_billing_provider_charges(merchant_id,created_at desc);

create index if not exists merchant_billing_provider_charges_request_idx
  on public.merchant_billing_provider_charges(payment_request_id,created_at desc);

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

  if not found then
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
        expires_at=coalesce(expires_at,p_expires_at),
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
        expires_at=p_expires_at,
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

create or replace function public.merchant_billing_provider_charge_record_error(
  p_charge_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_error text:=upper(trim(coalesce(p_error_code,'')));
begin
  if p_charge_id is null then
    raise exception 'PIX_CHARGE_ID_REQUIRED' using errcode='22023';
  end if;

  if char_length(v_error)<3
     or char_length(v_error)>120
     or v_error!~'^[A-Z0-9_:-]+$' then
    raise exception 'INVALID_PIX_CHARGE_ERROR' using errcode='22023';
  end if;

  update public.merchant_billing_provider_charges
  set last_error_code=v_error,
      last_error_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where id=p_charge_id
    and status in ('preparing','active');
end;
$$;

revoke all on function public.merchant_billing_provider_charge_record_error(
  uuid,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_provider_charge_record_error(
  uuid,text
) to service_role,postgres;

create or replace function public.reconcile_merchant_billing_payment_event(
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_event public.merchant_billing_payment_events%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_charge public.merchant_billing_provider_charges%rowtype;
  v_other_matched_id uuid;
  v_candidate_count integer:=0;
  v_reference_candidate_count integer:=0;
begin
  select *
  into v_event
  from public.merchant_billing_payment_events
  where id=p_event_id
  for update;

  if not found then
    raise exception 'PAYMENT_EVENT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_event.status in ('applied','already_applied','ignored') then
    return jsonb_build_object(
      'eventId',v_event.id,
      'status',v_event.status,
      'paymentRequestId',v_event.payment_request_id,
      'merchantId',v_event.merchant_id,
      'matchReason',v_event.match_reason
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'merchant-billing-payment:'||lower(trim(v_event.reconciliation_key)),
      0
    )
  );

  select *
  into v_request
  from public.merchant_billing_payment_requests r
  where r.status='approved'
    and lower(trim(r.reconciliation_key))=
        lower(trim(v_event.reconciliation_key))
  order by r.resolved_at asc nulls last,r.id
  limit 1;

  if found then
    if v_request.received_amount_cents=v_event.amount_cents then
      update public.merchant_billing_payment_events
      set status='already_applied',
          payment_request_id=v_request.id,
          merchant_id=v_request.merchant_id,
          match_reason='approved_payment_already_uses_transaction',
          updated_at=clock_timestamp()
      where id=v_event.id
      returning * into v_event;
    else
      update public.merchant_billing_payment_events
      set status='review_required',
          payment_request_id=null,
          merchant_id=null,
          match_reason='transaction_key_already_used_with_other_amount',
          updated_at=clock_timestamp()
      where id=v_event.id
      returning * into v_event;
    end if;

    return jsonb_build_object(
      'eventId',v_event.id,
      'status',v_event.status,
      'paymentRequestId',v_event.payment_request_id,
      'merchantId',v_event.merchant_id,
      'matchReason',v_event.match_reason
    );
  end if;

  select e.id
  into v_other_matched_id
  from public.merchant_billing_payment_events e
  where e.id<>v_event.id
    and e.status='matched_exact'
    and lower(trim(e.reconciliation_key))=
        lower(trim(v_event.reconciliation_key))
  order by e.received_at asc,e.id
  limit 1;

  if found then
    update public.merchant_billing_payment_events
    set status='review_required',
        payment_request_id=null,
        merchant_id=null,
        match_reason='duplicate_transaction_event',
        updated_at=clock_timestamp()
    where id=v_event.id
    returning * into v_event;

    return jsonb_build_object(
      'eventId',v_event.id,
      'status',v_event.status,
      'paymentRequestId',v_event.payment_request_id,
      'merchantId',v_event.merchant_id,
      'matchReason',v_event.match_reason,
      'canonicalEventId',v_other_matched_id
    );
  end if;

  if v_event.provider_correlation_id is not null then
    select *
    into v_charge
    from public.merchant_billing_provider_charges c
    where c.provider=v_event.provider
      and lower(trim(c.correlation_id))=
          lower(trim(v_event.provider_correlation_id))
    order by c.created_at desc,c.id
    limit 1
    for update;

    if found then
      select *
      into v_request
      from public.merchant_billing_payment_requests r
      where r.id=v_charge.payment_request_id
      for update;

      update public.merchant_billing_provider_charges
      set status='completed',
          completed_at=coalesce(completed_at,v_event.occurred_at),
          paid_amount_cents=v_event.amount_cents,
          end_to_end_id=v_event.reconciliation_key,
          updated_at=clock_timestamp()
      where id=v_charge.id
      returning * into v_charge;

      if not found then
        raise exception 'PIX_CHARGE_REQUEST_NOT_FOUND' using errcode='P0002';
      end if;

      if v_request.status='pending'
         and v_request.merchant_id=v_charge.merchant_id
         and v_request.expected_amount_cents=v_event.amount_cents
         and v_charge.amount_cents=v_event.amount_cents then
        update public.merchant_billing_payment_events
        set status='matched_exact',
            payment_request_id=v_request.id,
            merchant_id=v_request.merchant_id,
            match_reason='provider_charge_correlation_and_amount',
            updated_at=clock_timestamp()
        where id=v_event.id
        returning * into v_event;

      else
        update public.merchant_billing_payment_events
        set status='review_required',
            payment_request_id=null,
            merchant_id=null,
            match_reason=case
              when v_request.status<>'pending'
                then 'provider_charge_request_not_pending'
              when v_request.merchant_id is distinct from v_charge.merchant_id
                then 'provider_charge_merchant_mismatch'
              else 'provider_charge_amount_mismatch'
            end,
            updated_at=clock_timestamp()
        where id=v_event.id
        returning * into v_event;
      end if;

      return jsonb_build_object(
        'eventId',v_event.id,
        'status',v_event.status,
        'paymentRequestId',v_event.payment_request_id,
        'merchantId',v_event.merchant_id,
        'matchReason',v_event.match_reason,
        'providerCorrelationId',v_event.provider_correlation_id
      );
    end if;
  end if;

  select count(*)
  into v_candidate_count
  from public.merchant_billing_payment_requests r
  where r.status='pending'
    and r.expected_amount_cents=v_event.amount_cents
    and lower(trim(r.merchant_reference))=
        lower(trim(v_event.reconciliation_key));

  if v_candidate_count=1 then
    select *
    into v_request
    from public.merchant_billing_payment_requests r
    where r.status='pending'
      and r.expected_amount_cents=v_event.amount_cents
      and lower(trim(r.merchant_reference))=
          lower(trim(v_event.reconciliation_key))
    order by r.requested_at asc,r.id
    limit 1
    for update;

    update public.merchant_billing_payment_events
    set status='matched_exact',
        payment_request_id=v_request.id,
        merchant_id=v_request.merchant_id,
        match_reason='exact_reference_and_amount',
        updated_at=clock_timestamp()
    where id=v_event.id
    returning * into v_event;

  elsif v_candidate_count>1 then
    update public.merchant_billing_payment_events
    set status='review_required',
        payment_request_id=null,
        merchant_id=null,
        match_reason='multiple_exact_candidates',
        updated_at=clock_timestamp()
    where id=v_event.id
    returning * into v_event;

  else
    select count(*)
    into v_reference_candidate_count
    from public.merchant_billing_payment_requests r
    where r.status='pending'
      and lower(trim(r.merchant_reference))=
          lower(trim(v_event.reconciliation_key));

    update public.merchant_billing_payment_events
    set status='review_required',
        payment_request_id=null,
        merchant_id=null,
        match_reason=case
          when v_reference_candidate_count>0
            then 'reference_found_but_amount_differs'
          else 'no_exact_pending_request'
        end,
        updated_at=clock_timestamp()
    where id=v_event.id
    returning * into v_event;
  end if;

  return jsonb_build_object(
    'eventId',v_event.id,
    'status',v_event.status,
    'paymentRequestId',v_event.payment_request_id,
    'merchantId',v_event.merchant_id,
    'matchReason',v_event.match_reason
  );
end;
$$;

revoke all on function public.reconcile_merchant_billing_payment_event(uuid)
from public,anon,authenticated;
grant execute on function public.reconcile_merchant_billing_payment_event(uuid)
to service_role,postgres;

create or replace function public.ingest_merchant_billing_payment_event(
  p_provider text,
  p_provider_event_id text,
  p_reconciliation_key text,
  p_payment_method text,
  p_amount_cents bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_raw_payload_sha256 text,
  p_payer_reference text,
  p_provider_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_event_id text:=trim(coalesce(p_provider_event_id,''));
  v_key text:=trim(coalesce(p_reconciliation_key,''));
  v_method text:=lower(trim(coalesce(p_payment_method,'')));
  v_currency text:=upper(trim(coalesce(p_currency,'')));
  v_hash text:=lower(trim(coalesce(p_raw_payload_sha256,'')));
  v_payer text:=nullif(trim(coalesce(p_payer_reference,'')),'');
  v_provider_correlation text:=
    nullif(trim(coalesce(p_provider_correlation_id,'')),'');
  v_event public.merchant_billing_payment_events%rowtype;
  v_existing public.merchant_billing_payment_events%rowtype;
  v_result jsonb;
  v_replayed boolean:=false;
begin
  if char_length(v_provider)<2
     or char_length(v_provider)>40
     or v_provider!~'^[a-z0-9][a-z0-9._-]*$' then
    raise exception 'INVALID_PAYMENT_EVENT_PROVIDER' using errcode='22023';
  end if;

  if char_length(v_event_id)<6
     or char_length(v_event_id)>160
     or v_event_id~'[[:cntrl:]]' then
    raise exception 'INVALID_PAYMENT_EVENT_ID' using errcode='22023';
  end if;

  if char_length(v_key)<6
     or char_length(v_key)>160
     or v_key~'[[:cntrl:]]' then
    raise exception 'INVALID_PAYMENT_RECONCILIATION_KEY' using errcode='22023';
  end if;

  if v_provider_correlation is not null
     and (
       char_length(v_provider_correlation)<6
       or char_length(v_provider_correlation)>160
       or v_provider_correlation~'[[:cntrl:]]'
     ) then
    raise exception 'INVALID_PROVIDER_CORRELATION_ID' using errcode='22023';
  end if;

  if v_method not in ('pix','bank_transfer','cash','card','other') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
  end if;

  if p_amount_cents is null or p_amount_cents<=0 then
    raise exception 'INVALID_PAYMENT_EVENT_AMOUNT' using errcode='22023';
  end if;

  if v_currency<>'BRL' then
    raise exception 'UNSUPPORTED_PAYMENT_EVENT_CURRENCY' using errcode='22023';
  end if;

  if p_occurred_at is null
     or p_occurred_at>clock_timestamp()+interval '5 minutes'
     or p_occurred_at<clock_timestamp()-interval '90 days' then
    raise exception 'INVALID_PAYMENT_EVENT_TIMESTAMP' using errcode='22023';
  end if;

  if v_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_PAYMENT_EVENT_PAYLOAD_HASH' using errcode='22023';
  end if;

  if v_payer is not null
     and (
       char_length(v_payer)>240
       or v_payer~'[[:cntrl:]]'
     ) then
    raise exception 'INVALID_PAYMENT_EVENT_PAYER_REFERENCE' using errcode='22023';
  end if;

  insert into public.merchant_billing_payment_events(
    provider,provider_event_id,reconciliation_key,provider_correlation_id,
    payment_method,amount_cents,currency,occurred_at,
    payer_reference,raw_payload_sha256
  )
  values(
    v_provider,v_event_id,v_key,v_provider_correlation,
    v_method,p_amount_cents,v_currency,p_occurred_at,
    v_payer,v_hash
  )
  on conflict(provider,provider_event_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    select *
    into v_existing
    from public.merchant_billing_payment_events
    where provider=v_provider and provider_event_id=v_event_id
    for update;

    if not found then
      raise exception 'PAYMENT_EVENT_IDEMPOTENCY_LOOKUP_FAILED' using errcode='40001';
    end if;

    if lower(trim(v_existing.reconciliation_key))<>lower(v_key)
       or lower(trim(coalesce(v_existing.provider_correlation_id,'')))
          <>lower(trim(coalesce(v_provider_correlation,'')))
       or v_existing.payment_method<>v_method
       or v_existing.amount_cents<>p_amount_cents
       or v_existing.currency<>v_currency
       or v_existing.raw_payload_sha256<>v_hash then
      raise exception 'PAYMENT_EVENT_IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;

    v_event:=v_existing;
    v_replayed:=true;
  end if;

  v_result:=public.reconcile_merchant_billing_payment_event(v_event.id);

  return v_result||jsonb_build_object('replayed',v_replayed);
end;
$$;

revoke all on function public.ingest_merchant_billing_payment_event(
  text,text,text,text,bigint,text,timestamptz,text,text,text
) from public,anon,authenticated;
grant execute on function public.ingest_merchant_billing_payment_event(
  text,text,text,text,bigint,text,timestamptz,text,text,text
) to service_role,postgres;

create or replace function public.ingest_merchant_billing_payment_event(
  p_provider text,
  p_provider_event_id text,
  p_reconciliation_key text,
  p_payment_method text,
  p_amount_cents bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_raw_payload_sha256 text,
  p_payer_reference text default null
)
returns jsonb
language sql
security definer
set search_path=pg_catalog
as $$
  select public.ingest_merchant_billing_payment_event(
    p_provider,
    p_provider_event_id,
    p_reconciliation_key,
    p_payment_method,
    p_amount_cents,
    p_currency,
    p_occurred_at,
    p_raw_payload_sha256,
    p_payer_reference,
    null
  );
$$;

revoke all on function public.ingest_merchant_billing_payment_event(
  text,text,text,text,bigint,text,timestamptz,text,text
) from public,anon,authenticated;
grant execute on function public.ingest_merchant_billing_payment_event(
  text,text,text,text,bigint,text,timestamptz,text,text
) to service_role,postgres;
