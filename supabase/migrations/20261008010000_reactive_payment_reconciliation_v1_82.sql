-- TAMÃO — Reactive provider payment reconciliation v1.82
-- One matcher authority is reused by webhook ingestion and payment-request lifecycle.
-- This closes ordering races: provider event may arrive before the merchant request,
-- and cancelled/rejected requests release their matched event for deterministic rematch.

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

  select *
  into v_request
  from public.merchant_billing_payment_requests r
  where r.status='approved'
    and lower(trim(r.reconciliation_key))=lower(trim(v_event.reconciliation_key))
  order by r.resolved_at asc nulls last, r.id
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

  select count(*)
  into v_candidate_count
  from public.merchant_billing_payment_requests r
  where r.status='pending'
    and r.expected_amount_cents=v_event.amount_cents
    and lower(trim(r.merchant_reference))=lower(trim(v_event.reconciliation_key));

  if v_candidate_count=1 then
    select *
    into v_request
    from public.merchant_billing_payment_requests r
    where r.status='pending'
      and r.expected_amount_cents=v_event.amount_cents
      and lower(trim(r.merchant_reference))=lower(trim(v_event.reconciliation_key))
    order by r.requested_at asc, r.id
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
      and lower(trim(r.merchant_reference))=lower(trim(v_event.reconciliation_key));

    update public.merchant_billing_payment_events
    set status='review_required',
        payment_request_id=null,
        merchant_id=null,
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
    'matchReason',v_event.match_reason
  );
end;
$$;

revoke all on function public.reconcile_merchant_billing_payment_event(uuid)
from public, anon, authenticated;
grant execute on function public.reconcile_merchant_billing_payment_event(uuid)
to service_role, postgres;

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
    v_replayed:=true;
  end if;

  v_result:=public.reconcile_merchant_billing_payment_event(v_event.id);

  return v_result||jsonb_build_object('replayed',v_replayed);
end;
$$;

revoke all on function public.ingest_merchant_billing_payment_event(
  text,text,text,text,bigint,text,timestamptz,text,text
) from public, anon, authenticated;
grant execute on function public.ingest_merchant_billing_payment_event(
  text,text,text,text,bigint,text,timestamptz,text,text
) to service_role, postgres;

create or replace function public.refresh_payment_event_matches_for_request()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_event_id uuid;
begin
  if tg_op='INSERT' then
    if new.status='pending' then
      for v_event_id in
        select e.id
        from public.merchant_billing_payment_events e
        where e.status in ('received','review_required','matched_exact')
          and lower(trim(e.reconciliation_key))=lower(trim(new.merchant_reference))
        order by e.received_at asc,e.id
      loop
        perform public.reconcile_merchant_billing_payment_event(v_event_id);
      end loop;
    end if;
    return new;
  end if;

  -- Approval is finalized by mark_reconciled_payment_event_applied_trg.
  -- Do not rematch an event while the approved request is being committed.
  if new.status='approved' and old.status is distinct from new.status then
    return new;
  end if;

  -- If a previously matched request leaves pending state, release/rematch
  -- its event against any other still-valid pending candidate.
  if old.status='pending' and new.status is distinct from 'pending' then
    for v_event_id in
      select e.id
      from public.merchant_billing_payment_events e
      where e.status in ('received','review_required','matched_exact')
        and (
          e.payment_request_id=old.id
          or lower(trim(e.reconciliation_key))=lower(trim(old.merchant_reference))
        )
      order by e.received_at asc,e.id
    loop
      perform public.reconcile_merchant_billing_payment_event(v_event_id);
    end loop;
  end if;

  -- Pending reference/amount changes can create or invalidate exact matches.
  if new.status='pending'
     and (
       old.status is distinct from new.status
       or old.merchant_reference is distinct from new.merchant_reference
       or old.expected_amount_cents is distinct from new.expected_amount_cents
     ) then
    for v_event_id in
      select distinct e.id
      from public.merchant_billing_payment_events e
      where e.status in ('received','review_required','matched_exact')
        and (
          e.payment_request_id=new.id
          or lower(trim(e.reconciliation_key))=lower(trim(new.merchant_reference))
          or lower(trim(e.reconciliation_key))=lower(trim(old.merchant_reference))
        )
      order by e.id
    loop
      perform public.reconcile_merchant_billing_payment_event(v_event_id);
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.refresh_payment_event_matches_for_request()
from public, anon, authenticated;
grant execute on function public.refresh_payment_event_matches_for_request()
to postgres, service_role;

drop trigger if exists refresh_payment_event_matches_for_request_trg
on public.merchant_billing_payment_requests;
create trigger refresh_payment_event_matches_for_request_trg
after insert or update of status,merchant_reference,expected_amount_cents
on public.merchant_billing_payment_requests
for each row execute function public.refresh_payment_event_matches_for_request();
