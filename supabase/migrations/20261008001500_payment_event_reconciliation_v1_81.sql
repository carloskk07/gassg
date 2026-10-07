-- TAMÃO — Provider payment event inbox and deterministic reconciliation v1.81
-- Receives already-authenticated provider events through a server-only RPC.
-- Matching is fail-closed: only exact amount + normalized transaction identifier
-- can link an event to a pending merchant billing request.

create table if not exists public.merchant_billing_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (
      char_length(provider) between 2 and 40
      and provider ~ '^[a-z0-9][a-z0-9._-]*$'
    ),
  provider_event_id text not null
    check (
      char_length(trim(provider_event_id)) between 6 and 160
      and provider_event_id !~ '[[:cntrl:]]'
    ),
  reconciliation_key text not null
    check (
      char_length(trim(reconciliation_key)) between 6 and 160
      and reconciliation_key !~ '[[:cntrl:]]'
    ),
  payment_method text not null
    check (payment_method in ('pix','bank_transfer','cash','card','other')),
  amount_cents bigint not null check (amount_cents>0),
  currency text not null default 'BRL' check (currency='BRL'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  payer_reference text
    check (
      payer_reference is null
      or (
        char_length(trim(payer_reference)) between 1 and 240
        and payer_reference !~ '[[:cntrl:]]'
      )
    ),
  raw_payload_sha256 text not null
    check (raw_payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'received'
    check (status in ('received','matched_exact','review_required','already_applied','ignored','applied')),
  payment_request_id uuid
    references public.merchant_billing_payment_requests(id) on delete restrict,
  merchant_id uuid
    references public.merchants(id) on delete restrict,
  match_reason text
    check (
      match_reason is null
      or char_length(match_reason) between 3 and 120
    ),
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_billing_payment_events_link_shape check (
    (status in ('matched_exact','already_applied','applied')
      and payment_request_id is not null and merchant_id is not null)
    or
    (status in ('received','review_required','ignored'))
  ),
  constraint merchant_billing_payment_events_applied_shape check (
    status<>'applied'
    or (applied_at is not null and applied_by is not null)
  )
);

alter table public.merchant_billing_payment_events enable row level security;
revoke all on table public.merchant_billing_payment_events from public, anon, authenticated;
grant all on table public.merchant_billing_payment_events to service_role;

create unique index if not exists merchant_billing_payment_events_provider_event_uq
  on public.merchant_billing_payment_events(provider,provider_event_id);

create index if not exists merchant_billing_payment_events_status_received_idx
  on public.merchant_billing_payment_events(status,received_at desc);

create index if not exists merchant_billing_payment_events_reconciliation_idx
  on public.merchant_billing_payment_events(lower(trim(reconciliation_key)),amount_cents);

create index if not exists merchant_billing_pending_reference_amount_idx
  on public.merchant_billing_payment_requests(
    lower(trim(merchant_reference)),
    expected_amount_cents
  )
  where status='pending';

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
  v_event public.merchant_billing_payment_events%rowtype;
  v_existing public.merchant_billing_payment_events%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_candidate_count integer:=0;
  v_reference_candidate_count integer:=0;
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
    provider,provider_event_id,reconciliation_key,payment_method,
    amount_cents,currency,occurred_at,payer_reference,raw_payload_sha256
  )
  values(
    v_provider,v_event_id,v_key,v_method,
    p_amount_cents,v_currency,p_occurred_at,v_payer,v_hash
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
       or v_existing.payment_method<>v_method
       or v_existing.amount_cents<>p_amount_cents
       or v_existing.currency<>v_currency
       or v_existing.raw_payload_sha256<>v_hash then
      raise exception 'PAYMENT_EVENT_IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;

    v_event:=v_existing;

    if v_event.status<>'received' then
      return jsonb_build_object(
        'eventId',v_event.id,
        'status',v_event.status,
        'paymentRequestId',v_event.payment_request_id,
        'merchantId',v_event.merchant_id,
        'matchReason',v_event.match_reason,
        'replayed',true
      );
    end if;
  end if;

  select *
  into v_request
  from public.merchant_billing_payment_requests r
  where r.status='approved'
    and lower(trim(r.reconciliation_key))=lower(v_key)
  limit 1;

  if found then
    if v_request.received_amount_cents=p_amount_cents then
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
      'matchReason',v_event.match_reason,
      'replayed',false
    );
  end if;

  select count(*)
  into v_candidate_count
  from public.merchant_billing_payment_requests r
  where r.status='pending'
    and r.expected_amount_cents=p_amount_cents
    and lower(trim(r.merchant_reference))=lower(v_key);

  if v_candidate_count=1 then
    select *
    into v_request
    from public.merchant_billing_payment_requests r
    where r.status='pending'
      and r.expected_amount_cents=p_amount_cents
      and lower(trim(r.merchant_reference))=lower(v_key)
    order by r.requested_at asc
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
        match_reason='multiple_exact_candidates',
        updated_at=clock_timestamp()
    where id=v_event.id
    returning * into v_event;

  else
    select count(*)
    into v_reference_candidate_count
    from public.merchant_billing_payment_requests r
    where r.status='pending'
      and lower(trim(r.merchant_reference))=lower(v_key);

    update public.merchant_billing_payment_events
    set status='review_required',
        match_reason=case
          when v_reference_candidate_count>0 then 'reference_found_but_amount_differs'
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
    'matchReason',v_event.match_reason,
    'replayed',false
  );
end;
$$;

revoke all on function public.ingest_merchant_billing_payment_event(
  text,text,text,text,bigint,text,timestamptz,text,text
) from public, anon, authenticated;
grant execute on function public.ingest_merchant_billing_payment_event(
  text,text,text,text,bigint,text,timestamptz,text,text
) to service_role, postgres;
