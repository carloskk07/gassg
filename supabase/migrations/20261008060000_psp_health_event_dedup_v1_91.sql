-- TAMÃO — PSP health + sibling provider event dedup v1.91
-- Adds an explicit terminal state for benign sibling notifications emitted
-- by the same PSP for the same bank transaction. Conflicting evidence remains
-- review_required; only same-provider/same-key/same-value siblings are retired.

alter table public.merchant_billing_payment_events
  drop constraint if exists merchant_billing_payment_events_status_check;

alter table public.merchant_billing_payment_events
  add constraint merchant_billing_payment_events_status_check
  check (
    status in (
      'received','matched_exact','review_required','already_applied',
      'ignored','applied','superseded'
    )
  );

alter table public.merchant_billing_payment_events
  drop constraint if exists merchant_billing_payment_events_link_shape;

alter table public.merchant_billing_payment_events
  add constraint merchant_billing_payment_events_link_shape
  check (
    (
      status in ('matched_exact','already_applied','applied')
      and payment_request_id is not null
      and merchant_id is not null
    )
    or (
      status in ('received','review_required','ignored','superseded')
      and payment_request_id is null
      and merchant_id is null
    )
  );

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
  v_other_matched public.merchant_billing_payment_events%rowtype;
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

  if v_event.status in ('applied','already_applied','ignored','superseded') then
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

  select e.*
  into v_other_matched
  from public.merchant_billing_payment_events e
  where e.id<>v_event.id
    and e.status='matched_exact'
    and lower(trim(e.reconciliation_key))=
        lower(trim(v_event.reconciliation_key))
  order by e.received_at asc,e.id
  limit 1;

  if found then
    if v_event.provider_correlation_id is null
       and v_other_matched.provider=v_event.provider
       and v_other_matched.amount_cents=v_event.amount_cents
       and v_other_matched.currency=v_event.currency
       and v_other_matched.payment_method=v_event.payment_method then
      update public.merchant_billing_payment_events
      set status='superseded',
          payment_request_id=null,
          merchant_id=null,
          match_reason='sibling_provider_event_same_transaction',
          updated_at=clock_timestamp()
      where id=v_event.id
      returning * into v_event;
    else
      update public.merchant_billing_payment_events
      set status='review_required',
          payment_request_id=null,
          merchant_id=null,
          match_reason='duplicate_transaction_event',
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
      'canonicalEventId',v_other_matched.id
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

      if not found then
        raise exception 'PIX_CHARGE_REQUEST_NOT_FOUND' using errcode='P0002';
      end if;

      update public.merchant_billing_provider_charges
      set status='completed',
          completed_at=coalesce(completed_at,v_event.occurred_at),
          paid_amount_cents=v_event.amount_cents,
          end_to_end_id=v_event.reconciliation_key,
          updated_at=clock_timestamp()
      where id=v_charge.id
      returning * into v_charge;

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

        -- Woovi can emit TRANSACTION_RECEIVED and CHARGE_COMPLETED for the
        -- same Pix. A generic transaction event may arrive first and have no
        -- request correlation yet. Once the signed charge event proves the
        -- exact TAMÃO request, retire only that harmless unresolved sibling.
        update public.merchant_billing_payment_events e
        set status='superseded',
            payment_request_id=null,
            merchant_id=null,
            match_reason='sibling_provider_event_resolved_by_charge',
            updated_at=clock_timestamp()
        where e.id<>v_event.id
          and e.provider=v_event.provider
          and e.status='review_required'
          and e.provider_correlation_id is null
          and lower(trim(e.reconciliation_key))=
              lower(trim(v_event.reconciliation_key))
          and e.amount_cents=v_event.amount_cents
          and e.currency=v_event.currency
          and e.payment_method=v_event.payment_method
          and e.match_reason='no_exact_pending_request';

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



revoke all on function public.reconcile_merchant_billing_payment_event(uuid)
from public,anon,authenticated;
grant execute on function public.reconcile_merchant_billing_payment_event(uuid)
to service_role,postgres;
