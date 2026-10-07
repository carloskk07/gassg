-- TAMÃO — Canonical provider payment event v1.86
-- Guarantees one active matched_exact event per real-world transaction key.
-- Serializes matching by reconciliation key and keeps manual/provider approval
-- provenance semantically distinct.

-- Normalize any pre-existing duplicate exact matches before adding the guard.
with ranked as (
  select
    id,
    row_number() over(
      partition by lower(trim(reconciliation_key))
      order by received_at asc,id
    ) as rn
  from public.merchant_billing_payment_events
  where status='matched_exact'
)
update public.merchant_billing_payment_events e
set status='review_required',
    payment_request_id=null,
    merchant_id=null,
    match_reason='duplicate_transaction_event',
    updated_at=clock_timestamp()
from ranked r
where r.id=e.id
  and r.rn>1;

create unique index if not exists merchant_billing_payment_events_one_matched_transaction_uq
  on public.merchant_billing_payment_events(lower(trim(reconciliation_key)))
  where status='matched_exact';

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

  -- Serialize all matching work for the same real-world transaction key.
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
    and lower(trim(r.reconciliation_key))=lower(trim(v_event.reconciliation_key))
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
from public, anon, authenticated;
grant execute on function public.reconcile_merchant_billing_payment_event(uuid)
to service_role,postgres;

create or replace function public.mark_reconciled_payment_event_applied()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.status='approved'
     and old.status is distinct from new.status
     and new.reconciliation_key is not null then

    if new.approval_source='provider_event'
       and new.provider_payment_event_id is not null then
      update public.merchant_billing_payment_events e
      set status='applied',
          payment_request_id=new.id,
          merchant_id=new.merchant_id,
          match_reason='approved_payment_request_applied',
          applied_at=clock_timestamp(),
          applied_by=new.resolved_by,
          updated_at=clock_timestamp()
      where e.id=new.provider_payment_event_id
        and e.status='matched_exact'
        and e.payment_request_id=new.id
        and e.amount_cents=new.received_amount_cents
        and lower(trim(e.reconciliation_key))=
            lower(trim(new.reconciliation_key));

    elsif new.approval_source='manual' then
      update public.merchant_billing_payment_events e
      set status='already_applied',
          payment_request_id=new.id,
          merchant_id=new.merchant_id,
          match_reason='manual_approval_payment_already_confirmed',
          applied_at=null,
          applied_by=null,
          updated_at=clock_timestamp()
      where e.status='matched_exact'
        and e.payment_request_id=new.id
        and e.amount_cents=new.received_amount_cents
        and lower(trim(e.reconciliation_key))=
            lower(trim(new.reconciliation_key));
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.mark_reconciled_payment_event_applied()
from public, anon, authenticated;
grant execute on function public.mark_reconciled_payment_event_applied()
to postgres,service_role;
