-- TAMÃO — Manual Pix refund anchoring v1.105
-- A trusted PSP refund may arrive even when the original payment webhook was
-- missed and Finance approved the Pix manually. In that case, anchor the
-- refund directly to the approved manual payment request using the exact bank
-- reconciliation key + received amount, without inventing a provider event.
--
-- If the refund arrives before Finance approval and the merchant's pending
-- reference already matches the bank key, cancel/neutralize the request with
-- zero recoverable exposure. Never create debt for a benefit not granted.

alter table public.merchant_billing_payment_refunds
  drop constraint if exists merchant_billing_payment_refunds_resolution_allocation_check;

alter table public.merchant_billing_payment_refunds
  add constraint merchant_billing_payment_refunds_resolution_allocation_check
  check (
    (status<>'resolved_recovered' or recoverable_amount_cents>0)
    and (
      status<>'resolved_excess'
      or (
        recoverable_amount_cents=0
        and excess_amount_cents=amount_cents
      )
    )
    and (
      status<>'resolved_preapproval'
      or (
        match_reason in (
          'refund_before_finance_approval',
          'refund_before_finance_approval_manual_reference'
        )
        and recoverable_amount_cents=0
        and excess_amount_cents=amount_cents
      )
    )
  );

create or replace function public.derive_provider_refund_allocation_split()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_allocated_elsewhere bigint:=0;
  v_remaining bigint:=0;
  v_recoverable bigint:=0;
begin
  if new.payment_request_id is null then
    new.recoverable_amount_cents:=null;
    new.excess_amount_cents:=null;
    return new;
  end if;

  if new.merchant_id is null
     or new.original_payment_amount_cents is null
     or new.original_payment_amount_cents<=0 then
    raise exception 'REFUND_ALLOCATION_ORIGINAL_EXPOSURE_MISSING'
      using errcode='40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-recovery-exposure:'||new.payment_request_id::text,
      0
    )
  );

  if new.match_reason in (
    'refund_before_finance_approval',
    'refund_before_finance_approval_manual_reference'
  ) then
    new.recoverable_amount_cents:=0;
    new.excess_amount_cents:=new.amount_cents;
    return new;
  end if;

  select coalesce(sum(rr.amount_cents),0)
  into v_allocated_elsewhere
  from public.merchant_billing_refund_recoveries rr
  where rr.original_payment_request_id=new.payment_request_id
    and rr.refund_id is distinct from new.id;

  v_remaining:=greatest(
    new.original_payment_amount_cents-v_allocated_elsewhere,
    0
  );
  v_recoverable:=least(new.amount_cents,v_remaining);

  new.recoverable_amount_cents:=v_recoverable;
  new.excess_amount_cents:=new.amount_cents-v_recoverable;

  return new;
end;
$$;

revoke all on function public.derive_provider_refund_allocation_split()
from public,anon,authenticated;
grant execute on function public.derive_provider_refund_allocation_split()
to postgres,service_role;

create or replace function public.resolve_preapproval_provider_refund()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_request public.merchant_billing_payment_requests%rowtype;
  v_event public.merchant_billing_payment_events%rowtype;
  v_event_backed boolean;
begin
  if new.status<>'review_required'
     or new.match_reason not in (
       'refund_before_finance_approval',
       'refund_before_finance_approval_manual_reference'
     )
     or new.payment_request_id is null
     or new.merchant_id is null then
    return new;
  end if;

  v_event_backed:=new.match_reason='refund_before_finance_approval';

  select *
  into v_request
  from public.merchant_billing_payment_requests
  where id=new.payment_request_id
    and merchant_id=new.merchant_id
  for update;

  if not found or v_request.status<>'pending' then
    raise exception 'PREAPPROVAL_REFUND_REQUEST_NOT_PENDING'
      using errcode='40001';
  end if;

  if v_event_backed then
    if new.payment_event_id is null then
      raise exception 'PREAPPROVAL_REFUND_PAYMENT_EVENT_MISSING'
        using errcode='40001';
    end if;

    select *
    into v_event
    from public.merchant_billing_payment_events
    where id=new.payment_event_id
    for update;

    if not found
       or v_event.provider is distinct from new.provider
       or v_event.payment_request_id is distinct from new.payment_request_id
       or v_event.merchant_id is distinct from new.merchant_id
       or v_event.amount_cents is distinct from new.original_payment_amount_cents
       or lower(trim(v_event.reconciliation_key))
          is distinct from lower(trim(new.original_reconciliation_key))
       or v_event.status<>'matched_exact' then
      raise exception 'PREAPPROVAL_REFUND_PAYMENT_EVENT_MISMATCH'
        using errcode='40001';
    end if;
  else
    if new.payment_event_id is not null
       or lower(trim(v_request.merchant_reference))
          is distinct from lower(trim(new.original_reconciliation_key))
       or v_request.expected_amount_cents
          is distinct from new.original_payment_amount_cents then
      raise exception 'PREAPPROVAL_REFUND_MANUAL_REFERENCE_MISMATCH'
        using errcode='40001';
    end if;
  end if;

  if exists(
    select 1
    from public.merchant_billing_refund_recoveries rr
    where rr.refund_id=new.id
  ) then
    raise exception 'PREAPPROVAL_REFUND_MUST_NOT_HAVE_RECOVERY'
      using errcode='23514';
  end if;

  update public.merchant_billing_payment_requests
  set status='cancelled',
      resolved_by=null,
      resolved_at=clock_timestamp(),
      admin_reference='provider-refund-before-approval',
      updated_at=clock_timestamp()
  where id=v_request.id
    and status='pending';

  if v_event_backed then
    update public.merchant_billing_payment_events
    set status='refunded',
        payment_request_id=new.payment_request_id,
        merchant_id=new.merchant_id,
        match_reason='provider_refund_before_approval',
        updated_at=clock_timestamp()
    where id=v_event.id
      and provider=new.provider
      and amount_cents=new.original_payment_amount_cents
      and lower(trim(reconciliation_key))=
          lower(trim(new.original_reconciliation_key));

    if not found then
      raise exception 'PREAPPROVAL_REFUND_EVENT_TERMINALIZATION_FAILED'
        using errcode='40001';
    end if;
  end if;

  new.status:='resolved_preapproval';
  new.resolved_by:=null;
  new.resolved_at:=clock_timestamp();
  new.resolution_reference:=
    'provider-refund-before-approval:'||new.provider_event_id;

  return new;
end;
$$;

revoke all on function public.resolve_preapproval_provider_refund()
from public,anon,authenticated;
grant execute on function public.resolve_preapproval_provider_refund()
to postgres,service_role;

create or replace function public.require_preapproval_refund_neutrality()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_request public.merchant_billing_payment_requests%rowtype;
  v_event public.merchant_billing_payment_events%rowtype;
begin
  if new.status<>'resolved_preapproval' then
    return new;
  end if;

  if new.match_reason not in (
       'refund_before_finance_approval',
       'refund_before_finance_approval_manual_reference'
     )
     or new.payment_request_id is null
     or new.merchant_id is null
     or new.recoverable_amount_cents is distinct from 0::bigint
     or new.excess_amount_cents is distinct from new.amount_cents
     or new.resolved_at is null
     or new.resolved_by is not null
     or new.resolution_reference is null then
    raise exception 'PREAPPROVAL_REFUND_NEUTRALITY_SHAPE_INVALID'
      using errcode='23514';
  end if;

  if exists(
    select 1
    from public.merchant_billing_refund_recoveries rr
    where rr.refund_id=new.id
  ) then
    raise exception 'PREAPPROVAL_REFUND_CREATED_RECOVERY'
      using errcode='23514';
  end if;

  select *
  into v_request
  from public.merchant_billing_payment_requests
  where id=new.payment_request_id;

  if not found
     or v_request.merchant_id is distinct from new.merchant_id
     or v_request.status<>'cancelled'
     or v_request.admin_reference is distinct from 'provider-refund-before-approval'
     or v_request.resolved_at is null
     or v_request.resolved_by is not null
     or v_request.approval_source is not null
     or v_request.provider_payment_event_id is not null
     or v_request.received_amount_cents is not null
     or v_request.payment_method is not null
     or v_request.reconciliation_key is not null then
    raise exception 'PREAPPROVAL_REFUND_REQUEST_NOT_NEUTRAL'
      using errcode='23514';
  end if;

  if new.match_reason='refund_before_finance_approval' then
    if new.payment_event_id is null then
      raise exception 'PREAPPROVAL_REFUND_EVENT_NOT_NEUTRAL'
        using errcode='23514';
    end if;

    select *
    into v_event
    from public.merchant_billing_payment_events
    where id=new.payment_event_id;

    if not found
       or v_event.status<>'refunded'
       or v_event.payment_request_id is distinct from new.payment_request_id
       or v_event.merchant_id is distinct from new.merchant_id
       or v_event.amount_cents is distinct from new.original_payment_amount_cents
       or lower(trim(v_event.reconciliation_key))
          is distinct from lower(trim(new.original_reconciliation_key))
       or v_event.match_reason<>'provider_refund_before_approval' then
      raise exception 'PREAPPROVAL_REFUND_EVENT_NOT_NEUTRAL'
        using errcode='23514';
    end if;
  else
    if new.payment_event_id is not null
       or lower(trim(v_request.merchant_reference))
          is distinct from lower(trim(new.original_reconciliation_key))
       or v_request.expected_amount_cents
          is distinct from new.original_payment_amount_cents then
      raise exception 'PREAPPROVAL_REFUND_MANUAL_REFERENCE_NOT_NEUTRAL'
        using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.require_preapproval_refund_neutrality()
from public,anon,authenticated;
grant execute on function public.require_preapproval_refund_neutrality()
to postgres,service_role;

create or replace function public.require_manual_payment_refund_anchor()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_request public.merchant_billing_payment_requests%rowtype;
begin
  if new.payment_request_id is null
     or new.payment_event_id is not null
     or (
       new.status='resolved_preapproval'
       and new.match_reason='refund_before_finance_approval_manual_reference'
     ) then
    return new;
  end if;

  select *
  into v_request
  from public.merchant_billing_payment_requests
  where id=new.payment_request_id;

  if not found
     or v_request.merchant_id is distinct from new.merchant_id
     or v_request.status<>'approved'
     or v_request.approval_source<>'manual'
     or v_request.provider_payment_event_id is not null
     or v_request.payment_method<>'pix'
     or v_request.received_amount_cents is null
     or v_request.received_amount_cents
        is distinct from new.original_payment_amount_cents
     or lower(trim(v_request.reconciliation_key))
        is distinct from lower(trim(new.original_reconciliation_key))
     or new.match_reason not in (
       'partial_refund_confirmed',
       'full_refund_confirmed',
       'refund_total_exceeds_original'
     ) then
    raise exception 'MANUAL_PAYMENT_REFUND_ANCHOR_INVALID'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.require_manual_payment_refund_anchor()
from public,anon,authenticated;
grant execute on function public.require_manual_payment_refund_anchor()
to postgres,service_role;

drop trigger if exists require_manual_payment_refund_anchor_trg
on public.merchant_billing_payment_refunds;
create constraint trigger require_manual_payment_refund_anchor_trg
after insert or update
on public.merchant_billing_payment_refunds
deferrable initially deferred
for each row execute function public.require_manual_payment_refund_anchor();

create or replace function public.reconcile_merchant_billing_payment_refund(
  p_refund_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $refund_reconcile$
declare
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_event public.merchant_billing_payment_events%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_cumulative bigint:=0;
  v_reason text;
  v_pending_count integer:=0;
begin
  select *
  into v_refund
  from public.merchant_billing_payment_refunds
  where id=p_refund_id
  for update;

  if not found then
    raise exception 'PAYMENT_REFUND_NOT_FOUND' using errcode='P0002';
  end if;

  if v_refund.status<>'review_required'
     or v_refund.payment_request_id is not null then
    return jsonb_build_object(
      'ok',true,
      'refundId',v_refund.id,
      'status',v_refund.status,
      'paymentRequestId',v_refund.payment_request_id,
      'merchantId',v_refund.merchant_id,
      'matchReason',v_refund.match_reason,
      'cumulativeRefundedCents',v_refund.cumulative_refunded_cents
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'merchant-billing-refund:'||v_refund.provider||':'||
      lower(trim(v_refund.original_reconciliation_key)),
      0
    )
  );

  -- Strongest anchor: authenticated provider payment event.
  select e.*
  into v_event
  from public.merchant_billing_payment_events e
  where e.provider=v_refund.provider
    and lower(trim(e.reconciliation_key))=
        lower(trim(v_refund.original_reconciliation_key))
    and e.payment_request_id is not null
    and e.merchant_id is not null
    and e.status in ('matched_exact','applied','already_applied')
  order by
    case e.status
      when 'applied' then 0
      when 'already_applied' then 1
      else 2
    end,
    e.received_at asc,e.id
  limit 1
  for update;

  if found then
    select *
    into v_request
    from public.merchant_billing_payment_requests
    where id=v_event.payment_request_id
    for update;

    if not found then
      raise exception 'PAYMENT_REFUND_REQUEST_NOT_FOUND' using errcode='P0002';
    end if;

    select coalesce(sum(r.amount_cents),0)
    into v_cumulative
    from public.merchant_billing_payment_refunds r
    where r.provider=v_refund.provider
      and lower(trim(r.original_reconciliation_key))=
          lower(trim(v_refund.original_reconciliation_key));

    v_reason:=case
      when v_cumulative>v_event.amount_cents
        then 'refund_total_exceeds_original'
      when v_request.status<>'approved'
        then 'refund_before_finance_approval'
      when v_cumulative=v_event.amount_cents
        then 'full_refund_confirmed'
      else 'partial_refund_confirmed'
    end;

    update public.merchant_billing_payment_refunds
    set payment_event_id=v_event.id,
        payment_request_id=v_request.id,
        merchant_id=v_request.merchant_id,
        original_payment_amount_cents=v_event.amount_cents,
        cumulative_refunded_cents=v_cumulative,
        match_reason=v_reason,
        updated_at=clock_timestamp()
    where id=v_refund.id
    returning * into v_refund;

  else
    -- Second anchor: an already-approved manual Pix confirmation.
    select *
    into v_request
    from public.merchant_billing_payment_requests r
    where r.status='approved'
      and r.approval_source='manual'
      and r.provider_payment_event_id is null
      and r.payment_method='pix'
      and r.received_amount_cents is not null
      and r.received_amount_cents>0
      and lower(trim(r.reconciliation_key))=
          lower(trim(v_refund.original_reconciliation_key))
    order by r.resolved_at asc nulls last,r.id
    limit 1
    for update;

    if found then
      select coalesce(sum(r.amount_cents),0)
      into v_cumulative
      from public.merchant_billing_payment_refunds r
      where r.provider=v_refund.provider
        and lower(trim(r.original_reconciliation_key))=
            lower(trim(v_refund.original_reconciliation_key));

      v_reason:=case
        when v_cumulative>v_request.received_amount_cents
          then 'refund_total_exceeds_original'
        when v_cumulative=v_request.received_amount_cents
          then 'full_refund_confirmed'
        else 'partial_refund_confirmed'
      end;

      update public.merchant_billing_payment_refunds
      set payment_event_id=null,
          payment_request_id=v_request.id,
          merchant_id=v_request.merchant_id,
          original_payment_amount_cents=v_request.received_amount_cents,
          cumulative_refunded_cents=v_cumulative,
          match_reason=v_reason,
          updated_at=clock_timestamp()
      where id=v_refund.id
      returning * into v_refund;

    else
      -- Conservative pre-approval fallback: an exact merchant-provided bank
      -- reference can only neutralize the pending request; it never creates
      -- recoverable exposure.
      select count(*)
      into v_pending_count
      from public.merchant_billing_payment_requests r
      where r.status='pending'
        and lower(trim(r.merchant_reference))=
            lower(trim(v_refund.original_reconciliation_key));

      if v_pending_count=1 then
        select *
        into v_request
        from public.merchant_billing_payment_requests r
        where r.status='pending'
          and lower(trim(r.merchant_reference))=
              lower(trim(v_refund.original_reconciliation_key))
        order by r.requested_at asc,r.id
        limit 1
        for update;

        select coalesce(sum(r.amount_cents),0)
        into v_cumulative
        from public.merchant_billing_payment_refunds r
        where r.provider=v_refund.provider
          and lower(trim(r.original_reconciliation_key))=
              lower(trim(v_refund.original_reconciliation_key));

        update public.merchant_billing_payment_refunds
        set payment_event_id=null,
            payment_request_id=v_request.id,
            merchant_id=v_request.merchant_id,
            original_payment_amount_cents=v_request.expected_amount_cents,
            cumulative_refunded_cents=v_cumulative,
            match_reason='refund_before_finance_approval_manual_reference',
            updated_at=clock_timestamp()
        where id=v_refund.id
        returning * into v_refund;

      elsif v_pending_count>1 then
        update public.merchant_billing_payment_refunds
        set match_reason='multiple_manual_payment_candidates',
            updated_at=clock_timestamp()
        where id=v_refund.id
        returning * into v_refund;
      else
        update public.merchant_billing_payment_refunds
        set match_reason='original_payment_not_found',
            updated_at=clock_timestamp()
        where id=v_refund.id
        returning * into v_refund;
      end if;
    end if;
  end if;

  if v_refund.status='review_required'
     and v_refund.payment_request_id is not null
     and v_refund.merchant_id is not null then
    insert into public.merchant_billing_accounts(merchant_id,plan_key)
    values(v_refund.merchant_id,'flex_daily')
    on conflict(merchant_id) do nothing;

    perform public.process_merchant_billing_enforcement();
  end if;

  return jsonb_build_object(
    'ok',true,
    'refundId',v_refund.id,
    'status',v_refund.status,
    'paymentRequestId',v_refund.payment_request_id,
    'merchantId',v_refund.merchant_id,
    'matchReason',v_refund.match_reason,
    'originalPaymentAmountCents',v_refund.original_payment_amount_cents,
    'cumulativeRefundedCents',v_refund.cumulative_refunded_cents
  );
end;
$refund_reconcile$;

revoke all on function public.reconcile_merchant_billing_payment_refund(uuid)
from public,anon,authenticated;
grant execute on function public.reconcile_merchant_billing_payment_refund(uuid)
to service_role,postgres;

create or replace function public.ingest_merchant_billing_payment_refund(
  p_provider text,
  p_provider_event_id text,
  p_original_reconciliation_key text,
  p_refund_reconciliation_key text,
  p_amount_cents bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_raw_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_event_id text:=trim(coalesce(p_provider_event_id,''));
  v_original_key text:=trim(coalesce(p_original_reconciliation_key,''));
  v_refund_key text:=trim(coalesce(p_refund_reconciliation_key,''));
  v_currency text:=upper(trim(coalesce(p_currency,'')));
  v_hash text:=lower(trim(coalesce(p_raw_payload_sha256,'')));
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_existing public.merchant_billing_payment_refunds%rowtype;
  v_result jsonb;
  v_replayed boolean:=false;
begin
  if char_length(v_provider)<2
     or char_length(v_provider)>40
     or v_provider!~'^[a-z0-9][a-z0-9._-]*$' then
    raise exception 'INVALID_PAYMENT_REFUND_PROVIDER' using errcode='22023';
  end if;

  if char_length(v_event_id)<6
     or char_length(v_event_id)>180
     or v_event_id~'[[:cntrl:]]' then
    raise exception 'INVALID_PAYMENT_REFUND_EVENT_ID' using errcode='22023';
  end if;

  if char_length(v_original_key)<6
     or char_length(v_original_key)>160
     or v_original_key~'[[:cntrl:]]'
     or char_length(v_refund_key)<6
     or char_length(v_refund_key)>160
     or v_refund_key~'[[:cntrl:]]' then
    raise exception 'INVALID_PAYMENT_REFUND_RECONCILIATION_KEY'
      using errcode='22023';
  end if;

  if lower(v_original_key)=lower(v_refund_key) then
    raise exception 'PAYMENT_REFUND_KEYS_MUST_DIFFER' using errcode='22023';
  end if;

  if p_amount_cents is null or p_amount_cents<=0 then
    raise exception 'INVALID_PAYMENT_REFUND_AMOUNT' using errcode='22023';
  end if;

  if v_currency<>'BRL' then
    raise exception 'UNSUPPORTED_PAYMENT_REFUND_CURRENCY' using errcode='22023';
  end if;

  if p_occurred_at is null
     or p_occurred_at>clock_timestamp()+interval '5 minutes'
     or p_occurred_at<clock_timestamp()-interval '180 days' then
    raise exception 'INVALID_PAYMENT_REFUND_TIMESTAMP' using errcode='22023';
  end if;

  if v_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_PAYMENT_REFUND_PAYLOAD_HASH' using errcode='22023';
  end if;

  insert into public.merchant_billing_payment_refunds(
    provider,provider_event_id,
    original_reconciliation_key,refund_reconciliation_key,
    amount_cents,currency,occurred_at,raw_payload_sha256,
    match_reason
  )
  values(
    v_provider,v_event_id,
    v_original_key,v_refund_key,
    p_amount_cents,v_currency,p_occurred_at,v_hash,
    'original_payment_not_found'
  )
  on conflict do nothing
  returning * into v_refund;

  if v_refund.id is null then
    select *
    into v_existing
    from public.merchant_billing_payment_refunds
    where provider=v_provider
      and (
        provider_event_id=v_event_id
        or lower(trim(refund_reconciliation_key))=lower(v_refund_key)
      )
    order by case when provider_event_id=v_event_id then 0 else 1 end,id
    limit 1
    for update;

    if not found then
      raise exception 'PAYMENT_REFUND_IDEMPOTENCY_LOOKUP_FAILED'
        using errcode='40001';
    end if;

    if lower(trim(v_existing.original_reconciliation_key))
          <>lower(v_original_key)
       or lower(trim(v_existing.refund_reconciliation_key))
          <>lower(v_refund_key)
       or v_existing.amount_cents<>p_amount_cents
       or v_existing.currency<>v_currency
       or v_existing.raw_payload_sha256<>v_hash then
      raise exception 'PAYMENT_REFUND_IDEMPOTENCY_CONFLICT'
        using errcode='23505';
    end if;

    v_refund:=v_existing;
    v_replayed:=true;
  end if;

  v_result:=public.reconcile_merchant_billing_payment_refund(v_refund.id);

  return v_result||jsonb_build_object('replayed',v_replayed);
end;
$$;

revoke all on function public.ingest_merchant_billing_payment_refund(
  text,text,text,text,bigint,text,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.ingest_merchant_billing_payment_refund(
  text,text,text,text,bigint,text,timestamptz,text
) to service_role,postgres;

create or replace function public.block_manual_approval_with_unlinked_provider_refund()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if old.status='pending'
     and new.status='approved'
     and new.approval_source='manual'
     and new.reconciliation_key is not null
     and exists(
       select 1
       from public.merchant_billing_payment_refunds r
       where r.status='review_required'
         and r.payment_request_id is null
         and lower(trim(r.original_reconciliation_key))=
             lower(trim(new.reconciliation_key))
     ) then
    raise exception 'PAYMENT_REFUND_REVIEW_REQUIRED' using errcode='40001';
  end if;

  return new;
end;
$$;

revoke all on function public.block_manual_approval_with_unlinked_provider_refund()
from public,anon,authenticated;
grant execute on function public.block_manual_approval_with_unlinked_provider_refund()
to postgres,service_role;

drop trigger if exists block_manual_approval_with_unlinked_provider_refund_trg
on public.merchant_billing_payment_requests;
create trigger block_manual_approval_with_unlinked_provider_refund_trg
before update of status,approval_source,reconciliation_key
on public.merchant_billing_payment_requests
for each row execute function public.block_manual_approval_with_unlinked_provider_refund();
