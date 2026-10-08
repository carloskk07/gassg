-- TAMÃO — Pre-approval refund neutrality v1.102
-- A provider refund that arrives before Finance approval cannot create merchant
-- debt because TAMÃO never granted the package credit / statement settlement /
-- refund-recovery benefit. The pending request is invalidated, the payment
-- event becomes terminal REFUNDED, and the refund is resolved with zero
-- recoverable exposure. Conflicting evidence still fails closed.

do $$
begin
  if exists(
    select 1
    from public.merchant_billing_payment_refunds
    where status='review_required'
      and match_reason='refund_before_finance_approval'
  ) then
    raise exception 'V1102_EXISTING_PREAPPROVAL_REFUND_REVIEW_REQUIRED'
      using errcode='40001';
  end if;
end $$;

alter table public.merchant_billing_payment_events
  drop constraint if exists merchant_billing_payment_events_status_check,
  drop constraint if exists merchant_billing_payment_events_link_shape;

alter table public.merchant_billing_payment_events
  add constraint merchant_billing_payment_events_status_check
  check (
    status in (
      'received','matched_exact','review_required','already_applied',
      'ignored','applied','superseded','refunded'
    )
  ),
  add constraint merchant_billing_payment_events_link_shape
  check (
    (
      status in ('matched_exact','already_applied','applied','refunded')
      and payment_request_id is not null
      and merchant_id is not null
    )
    or
    (
      status in ('received','review_required','ignored','superseded')
      and payment_request_id is null
      and merchant_id is null
    )
  );

alter table public.merchant_billing_payment_refunds
  drop constraint if exists merchant_billing_payment_refunds_status_check,
  drop constraint if exists merchant_billing_payment_refunds_resolution_shape,
  drop constraint if exists merchant_billing_payment_refunds_resolution_allocation_check;

alter table public.merchant_billing_payment_refunds
  add constraint merchant_billing_payment_refunds_status_check
  check (
    status in (
      'review_required','resolved_recovered','ignored_unrelated',
      'resolved_excess','resolved_preapproval'
    )
  ),
  add constraint merchant_billing_payment_refunds_resolution_shape
  check (
    (
      status='review_required'
      and resolved_at is null
      and resolved_by is null
      and resolution_reference is null
    )
    or
    (
      status='resolved_preapproval'
      and resolved_at is not null
      and resolved_by is null
      and resolution_reference is not null
    )
    or
    (
      status in ('resolved_recovered','ignored_unrelated','resolved_excess')
      and resolved_at is not null
      and resolved_by is not null
      and resolution_reference is not null
    )
  ),
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
        match_reason='refund_before_finance_approval'
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

  if new.match_reason='refund_before_finance_approval' then
    -- The PSP returned the money before TAMÃO granted any economic benefit.
    -- This is a zero-liability provider fact, not merchant debt.
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
begin
  if new.status<>'review_required'
     or new.match_reason<>'refund_before_finance_approval'
     or new.payment_request_id is null
     or new.payment_event_id is null
     or new.merchant_id is null then
    return new;
  end if;

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

  -- Request lifecycle triggers may temporarily release/rematch the event.
  -- Re-bind the exact signed payment fact into a dedicated terminal state.
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

drop trigger if exists zz_resolve_preapproval_provider_refund_trg
on public.merchant_billing_payment_refunds;
create trigger zz_resolve_preapproval_provider_refund_trg
before insert or update
on public.merchant_billing_payment_refunds
for each row execute function public.resolve_preapproval_provider_refund();

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

  if v_event.status in ('applied','already_applied','ignored','superseded','refunded') then
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



create or replace function public.admin_merchant_billing_payment_event_action(
  p_actor_user_id uuid,
  p_event_id uuid,
  p_action text,
  p_reason text,
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
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
  v_action public.action_requests%rowtype;
  v_event public.merchant_billing_payment_events%rowtype;
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if v_kind not in ('recheck','ignore') then
    raise exception 'INVALID_PAYMENT_EVENT_ACTION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  if v_kind='ignore'
     and (
       v_reason is null
       or char_length(v_reason)<3
       or char_length(v_reason)>240
     ) then
    raise exception 'PAYMENT_EVENT_IGNORE_REASON_REQUIRED' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:merchant-billing-payment-event:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:merchant-billing-payment-event:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_event
  from public.merchant_billing_payment_events
  where id=p_event_id
  for update;

  if not found then
    raise exception 'PAYMENT_EVENT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_kind='recheck' then
    if v_event.status in ('applied','already_applied','ignored','superseded','refunded') then
      v_result:=jsonb_build_object(
        'ok',true,
        'eventId',v_event.id,
        'status',v_event.status,
        'matchReason',v_event.match_reason,
        'terminal',true
      );
    else
      v_result:=public.reconcile_merchant_billing_payment_event(v_event.id)
        ||jsonb_build_object('ok',true,'terminal',false);
    end if;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'merchant_billing_payment_event_rechecked',
      'merchant_billing_payment_event',
      v_event.id::text,
      jsonb_build_object(
        'provider',v_event.provider,
        'providerEventId',v_event.provider_event_id,
        'amountCents',v_event.amount_cents,
        'resultStatus',v_result->>'status',
        'matchReason',v_result->>'matchReason'
      )
    );

  else
    if v_event.status='matched_exact' then
      raise exception 'PAYMENT_EVENT_MATCHED_CANNOT_IGNORE'
        using errcode='40001';
    end if;

    if v_event.status<>'review_required' then
      raise exception 'PAYMENT_EVENT_NOT_REVIEWABLE'
        using errcode='40001';
    end if;

    update public.merchant_billing_payment_events
    set status='ignored',
        payment_request_id=null,
        merchant_id=null,
        match_reason='ignored_by_finance',
        ignored_at=clock_timestamp(),
        ignored_by=p_actor_user_id,
        ignore_reason=v_reason,
        updated_at=clock_timestamp()
    where id=v_event.id
    returning * into v_event;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'merchant_billing_payment_event_ignored',
      'merchant_billing_payment_event',
      v_event.id::text,
      jsonb_build_object(
        'provider',v_event.provider,
        'providerEventId',v_event.provider_event_id,
        'reconciliationKey',v_event.reconciliation_key,
        'amountCents',v_event.amount_cents,
        'reason',v_reason
      )
    );

    v_result:=jsonb_build_object(
      'ok',true,
      'eventId',v_event.id,
      'status',v_event.status,
      'matchReason',v_event.match_reason,
      'ignoredAt',v_event.ignored_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;




revoke all on function public.admin_merchant_billing_payment_event_action(
  uuid,uuid,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_payment_event_action(
  uuid,uuid,text,text,text,text
) to service_role,postgres;

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

  if new.match_reason<>'refund_before_finance_approval'
     or new.payment_request_id is null
     or new.payment_event_id is null
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

  return new;
end;
$$;

revoke all on function public.require_preapproval_refund_neutrality()
from public,anon,authenticated;
grant execute on function public.require_preapproval_refund_neutrality()
to postgres,service_role;

drop trigger if exists require_preapproval_refund_neutrality_trg
on public.merchant_billing_payment_refunds;
create constraint trigger require_preapproval_refund_neutrality_trg
after insert or update
on public.merchant_billing_payment_refunds
deferrable initially deferred
for each row execute function public.require_preapproval_refund_neutrality();
