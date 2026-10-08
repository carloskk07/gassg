-- TAMÃO — Provider payment refund quarantine v1.96
-- Confirmed PSP refunds are immutable financial facts. They never silently
-- reverse merchant credit or reopen a paid statement. Instead, TAMÃO links the
-- original Pix by EndToEndId, blocks new financial benefit, and requires a
-- Finance decision. Partial refunds accumulate against the original payment.

create table if not exists public.merchant_billing_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (
      char_length(provider) between 2 and 40
      and provider ~ '^[a-z0-9][a-z0-9._-]*$'
    ),
  provider_event_id text not null
    check (
      char_length(provider_event_id) between 6 and 180
      and provider_event_id !~ '[[:cntrl:]]'
    ),
  original_reconciliation_key text not null
    check (
      char_length(trim(original_reconciliation_key)) between 6 and 160
      and original_reconciliation_key !~ '[[:cntrl:]]'
    ),
  refund_reconciliation_key text not null
    check (
      char_length(trim(refund_reconciliation_key)) between 6 and 160
      and refund_reconciliation_key !~ '[[:cntrl:]]'
    ),
  amount_cents bigint not null check (amount_cents>0),
  currency text not null default 'BRL' check (currency='BRL'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  raw_payload_sha256 text not null
    check (raw_payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'review_required'
    check (status in ('review_required','resolved_recovered','ignored_unrelated')),
  payment_event_id uuid
    references public.merchant_billing_payment_events(id) on delete restrict,
  payment_request_id uuid
    references public.merchant_billing_payment_requests(id) on delete restrict,
  merchant_id uuid
    references public.merchants(id) on delete restrict,
  original_payment_amount_cents bigint
    check (
      original_payment_amount_cents is null
      or original_payment_amount_cents>0
    ),
  cumulative_refunded_cents bigint
    check (
      cumulative_refunded_cents is null
      or cumulative_refunded_cents>0
    ),
  match_reason text not null
    check (
      char_length(match_reason) between 3 and 120
      and match_reason ~ '^[a-z0-9_:-]+$'
    ),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_reference text
    check (
      resolution_reference is null
      or char_length(trim(resolution_reference)) between 3 and 240
    ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_billing_payment_refunds_resolution_shape check (
    (status='review_required'
      and resolved_at is null
      and resolved_by is null
      and resolution_reference is null)
    or
    (status in ('resolved_recovered','ignored_unrelated')
      and resolved_at is not null
      and resolved_by is not null
      and resolution_reference is not null)
  ),
  constraint merchant_billing_payment_refunds_link_shape check (
    (payment_request_id is null and merchant_id is null)
    or
    (payment_request_id is not null and merchant_id is not null)
  )
);

alter table public.merchant_billing_payment_refunds enable row level security;
revoke all on table public.merchant_billing_payment_refunds
from public,anon,authenticated;
grant all on table public.merchant_billing_payment_refunds
to service_role,postgres;

create unique index if not exists merchant_billing_payment_refunds_provider_event_uq
  on public.merchant_billing_payment_refunds(provider,provider_event_id);

create unique index if not exists merchant_billing_payment_refunds_refund_e2e_uq
  on public.merchant_billing_payment_refunds(
    provider,lower(trim(refund_reconciliation_key))
  );

create index if not exists merchant_billing_payment_refunds_original_e2e_idx
  on public.merchant_billing_payment_refunds(
    provider,lower(trim(original_reconciliation_key)),occurred_at
  );

create index if not exists merchant_billing_payment_refunds_request_idx
  on public.merchant_billing_payment_refunds(payment_request_id,occurred_at)
  where payment_request_id is not null;

create index if not exists merchant_billing_payment_refunds_merchant_idx
  on public.merchant_billing_payment_refunds(merchant_id,status,occurred_at)
  where merchant_id is not null;

create index if not exists merchant_billing_payment_refunds_resolved_by_idx
  on public.merchant_billing_payment_refunds(resolved_by)
  where resolved_by is not null;

create or replace function public.guard_provider_refund_fact_immutable()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.provider is distinct from old.provider
     or new.provider_event_id is distinct from old.provider_event_id
     or new.original_reconciliation_key is distinct from old.original_reconciliation_key
     or new.refund_reconciliation_key is distinct from old.refund_reconciliation_key
     or new.amount_cents is distinct from old.amount_cents
     or new.currency is distinct from old.currency
     or new.occurred_at is distinct from old.occurred_at
     or new.raw_payload_sha256 is distinct from old.raw_payload_sha256 then
    raise exception 'PROVIDER_REFUND_FACT_IMMUTABLE' using errcode='23514';
  end if;

  -- Ingestion reserves the provider event first, then may enrich that new row
  -- once with its authoritative TAMÃO linkage under the same transaction.
  -- After linkage (or after resolution) those derived facts are immutable.
  if old.status='review_required'
     and old.payment_event_id is null
     and old.payment_request_id is null
     and old.merchant_id is null
     and old.original_payment_amount_cents is null
     and old.cumulative_refunded_cents is null
     and old.match_reason='original_payment_not_found'
     and new.status='review_required'
     and new.resolved_at is null
     and new.resolved_by is null
     and new.resolution_reference is null then
    return new;
  end if;

  if new.payment_event_id is distinct from old.payment_event_id
     or new.payment_request_id is distinct from old.payment_request_id
     or new.merchant_id is distinct from old.merchant_id
     or new.original_payment_amount_cents is distinct from old.original_payment_amount_cents
     or new.cumulative_refunded_cents is distinct from old.cumulative_refunded_cents
     or new.match_reason is distinct from old.match_reason then
    raise exception 'PROVIDER_REFUND_FACT_IMMUTABLE' using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_provider_refund_fact_immutable()
from public,anon,authenticated;
grant execute on function public.guard_provider_refund_fact_immutable()
to postgres,service_role;

drop trigger if exists guard_provider_refund_fact_immutable_trg
on public.merchant_billing_payment_refunds;
create trigger guard_provider_refund_fact_immutable_trg
before update on public.merchant_billing_payment_refunds
for each row execute function public.guard_provider_refund_fact_immutable();

create or replace function public.process_merchant_billing_enforcement()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_overdue integer:=0;
  v_refund_held integer:=0;
  v_debt_held integer:=0;
  v_released integer:=0;
begin
  update public.merchant_daily_statements
  set status='overdue',
      updated_at=clock_timestamp()
  where status='open'
    and amount_due_cents>0
    and due_at<clock_timestamp();

  get diagnostics v_overdue=row_count;

  -- Provider refund review has priority over ordinary overdue-state holds.
  -- An unknown/custom hold reason is never overwritten here.
  update public.merchant_billing_accounts a
  set sales_hold=true,
      sales_hold_reason='provider_payment_refund_review',
      sales_hold_at=coalesce(a.sales_hold_at,clock_timestamp()),
      updated_at=clock_timestamp()
  where exists(
      select 1
      from public.merchant_billing_payment_refunds r
      where r.merchant_id=a.merchant_id
        and r.status='review_required'
    )
    and (
      not a.sales_hold
      or a.sales_hold_reason in (
        'daily_statement_overdue',
        'provider_payment_refund_review'
      )
    )
    and (
      not a.sales_hold
      or a.sales_hold_reason is distinct from 'provider_payment_refund_review'
    );

  get diagnostics v_refund_held=row_count;

  with debtors as (
    select distinct merchant_id
    from public.merchant_daily_statements
    where status='overdue'
      and amount_due_cents>0
  )
  update public.merchant_billing_accounts a
  set sales_hold=true,
      sales_hold_reason='daily_statement_overdue',
      sales_hold_at=coalesce(a.sales_hold_at,clock_timestamp()),
      updated_at=clock_timestamp()
  where exists(select 1 from debtors d where d.merchant_id=a.merchant_id)
    and not exists(
      select 1
      from public.merchant_billing_payment_refunds r
      where r.merchant_id=a.merchant_id
        and r.status='review_required'
    )
    and not a.sales_hold;

  get diagnostics v_debt_held=row_count;

  update public.merchant_billing_accounts a
  set sales_hold=false,
      sales_hold_reason=null,
      sales_hold_at=null,
      updated_at=clock_timestamp()
  where a.sales_hold
    and a.sales_hold_reason in (
      'daily_statement_overdue',
      'provider_payment_refund_review'
    )
    and not exists(
      select 1
      from public.merchant_billing_payment_refunds r
      where r.merchant_id=a.merchant_id
        and r.status='review_required'
    )
    and not exists(
      select 1
      from public.merchant_daily_statements s
      where s.merchant_id=a.merchant_id
        and s.status='overdue'
        and s.amount_due_cents>0
    );

  get diagnostics v_released=row_count;

  return jsonb_build_object(
    'ok',true,
    'statementsMarkedOverdue',v_overdue,
    'refundReviewHolds',v_refund_held,
    'merchantsHeld',v_refund_held+v_debt_held,
    'merchantsReleased',v_released
  );
end;
$$;

revoke all on function public.process_merchant_billing_enforcement()
from public,anon,authenticated;
grant execute on function public.process_merchant_billing_enforcement()
to postgres,service_role;

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
  v_event public.merchant_billing_payment_events%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_cumulative bigint:=0;
  v_reason text:='original_payment_not_found';
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

    return jsonb_build_object(
      'ok',true,
      'replayed',true,
      'refundId',v_existing.id,
      'status',v_existing.status,
      'paymentRequestId',v_existing.payment_request_id,
      'merchantId',v_existing.merchant_id,
      'matchReason',v_existing.match_reason,
      'cumulativeRefundedCents',v_existing.cumulative_refunded_cents
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'merchant-billing-refund:'||v_provider||':'||lower(v_original_key),
      0
    )
  );

  select e.*
  into v_event
  from public.merchant_billing_payment_events e
  where e.provider=v_provider
    and lower(trim(e.reconciliation_key))=lower(v_original_key)
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
    where r.provider=v_provider
      and lower(trim(r.original_reconciliation_key))=lower(v_original_key);

    if v_request.status='approved' then
      v_reason:=case
        when v_cumulative>v_event.amount_cents
          then 'refund_total_exceeds_original'
        when v_cumulative=v_event.amount_cents
          then 'full_refund_confirmed'
        else 'partial_refund_confirmed'
      end;
    else
      v_reason:=case
        when v_cumulative>v_event.amount_cents
          then 'refund_total_exceeds_original'
        else 'refund_before_finance_approval'
      end;
    end if;

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

    insert into public.merchant_billing_accounts(merchant_id,plan_key)
    values(v_request.merchant_id,'flex_daily')
    on conflict(merchant_id) do nothing;

    perform public.process_merchant_billing_enforcement();

  else
    update public.merchant_billing_payment_refunds
    set match_reason='original_payment_not_found',
        updated_at=clock_timestamp()
    where id=v_refund.id
    returning * into v_refund;
  end if;

  return jsonb_build_object(
    'ok',true,
    'replayed',v_replayed,
    'refundId',v_refund.id,
    'status',v_refund.status,
    'paymentRequestId',v_refund.payment_request_id,
    'merchantId',v_refund.merchant_id,
    'matchReason',v_refund.match_reason,
    'originalPaymentAmountCents',v_refund.original_payment_amount_cents,
    'cumulativeRefundedCents',v_refund.cumulative_refunded_cents
  );
end;
$$;

revoke all on function public.ingest_merchant_billing_payment_refund(
  text,text,text,text,bigint,text,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.ingest_merchant_billing_payment_refund(
  text,text,text,text,bigint,text,timestamptz,text
) to service_role,postgres;

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

  if not found then
    return jsonb_build_object(
      'ok',true,
      'refundId',v_refund.id,
      'status',v_refund.status,
      'paymentRequestId',null,
      'merchantId',null,
      'matchReason',v_refund.match_reason,
      'cumulativeRefundedCents',null
    );
  end if;

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

  insert into public.merchant_billing_accounts(merchant_id,plan_key)
  values(v_request.merchant_id,'flex_daily')
  on conflict(merchant_id) do nothing;

  perform public.process_merchant_billing_enforcement();

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

create or replace function public.refresh_provider_refunds_after_payment_event()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $refund_refresh$
declare
  v_refund_id uuid;
begin
  if new.payment_request_id is null
     or new.merchant_id is null
     or new.status not in ('matched_exact','applied','already_applied') then
    return new;
  end if;

  for v_refund_id in
    select r.id
    from public.merchant_billing_payment_refunds r
    where r.provider=new.provider
      and r.status='review_required'
      and r.payment_request_id is null
      and lower(trim(r.original_reconciliation_key))=
          lower(trim(new.reconciliation_key))
    order by r.occurred_at,r.id
  loop
    perform public.reconcile_merchant_billing_payment_refund(v_refund_id);
  end loop;

  return new;
end;
$refund_refresh$;

revoke all on function public.refresh_provider_refunds_after_payment_event()
from public,anon,authenticated;
grant execute on function public.refresh_provider_refunds_after_payment_event()
to postgres,service_role;

drop trigger if exists refresh_provider_refunds_after_payment_event_trg
on public.merchant_billing_payment_events;
create trigger refresh_provider_refunds_after_payment_event_trg
after insert or update of status,payment_request_id,merchant_id,reconciliation_key
on public.merchant_billing_payment_events
for each row execute function public.refresh_provider_refunds_after_payment_event();

create or replace function public.block_new_payment_request_during_provider_refund_review()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $
begin
  if exists(
    select 1
    from public.merchant_billing_payment_refunds r
    where r.merchant_id=new.merchant_id
      and r.status='review_required'
  ) then
    raise exception 'PAYMENT_REFUND_REVIEW_BLOCKS_NEW_REQUEST'
      using errcode='40001';
  end if;
  return new;
end;
$;

revoke all on function public.block_new_payment_request_during_provider_refund_review()
from public,anon,authenticated;
grant execute on function public.block_new_payment_request_during_provider_refund_review()
to postgres,service_role;

drop trigger if exists block_new_payment_request_during_provider_refund_review_trg
on public.merchant_billing_payment_requests;
create trigger block_new_payment_request_during_provider_refund_review_trg
before insert
on public.merchant_billing_payment_requests
for each row execute function public.block_new_payment_request_during_provider_refund_review();

create or replace function public.block_approval_with_unresolved_provider_refund()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.status='approved'
     and old.status is distinct from 'approved'
     and exists(
       select 1
       from public.merchant_billing_payment_refunds r
       where r.payment_request_id=new.id
         and r.status='review_required'
     ) then
    raise exception 'PAYMENT_REFUND_REVIEW_REQUIRED' using errcode='40001';
  end if;
  return new;
end;
$$;

revoke all on function public.block_approval_with_unresolved_provider_refund()
from public,anon,authenticated;
grant execute on function public.block_approval_with_unresolved_provider_refund()
to postgres,service_role;

drop trigger if exists block_approval_with_unresolved_provider_refund_trg
on public.merchant_billing_payment_requests;
create trigger block_approval_with_unresolved_provider_refund_trg
before update of status
on public.merchant_billing_payment_requests
for each row execute function public.block_approval_with_unresolved_provider_refund();

create or replace function public.admin_merchant_billing_refund_action(
  p_actor_user_id uuid,
  p_refund_id uuid,
  p_action text,
  p_reference text,
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
  v_reference text:=nullif(trim(coalesce(p_reference,'')),'');
  v_action public.action_requests%rowtype;
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if v_kind not in ('mark-recovered','dismiss-unrelated') then
    raise exception 'INVALID_PAYMENT_REFUND_ACTION' using errcode='22023';
  end if;

  if v_reference is null
     or char_length(v_reference)<3
     or char_length(v_reference)>240 then
    raise exception 'PAYMENT_REFUND_REFERENCE_REQUIRED' using errcode='22023';
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
    'admin-ops:merchant-billing-refund:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:merchant-billing-refund:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_refund
  from public.merchant_billing_payment_refunds
  where id=p_refund_id
  for update;

  if not found then
    raise exception 'PAYMENT_REFUND_NOT_FOUND' using errcode='P0002';
  end if;

  if v_refund.status<>'review_required' then
    raise exception 'PAYMENT_REFUND_ALREADY_RESOLVED' using errcode='40001';
  end if;

  if v_kind='mark-recovered' then
    if v_refund.payment_request_id is null or v_refund.merchant_id is null then
      raise exception 'PAYMENT_REFUND_NOT_LINKED' using errcode='40001';
    end if;

    update public.merchant_billing_payment_refunds
    set status='resolved_recovered',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_refund.id
    returning * into v_refund;

  else
    if v_refund.payment_request_id is not null
       or v_refund.merchant_id is not null then
      raise exception 'PAYMENT_REFUND_LINKED_CANNOT_DISMISS'
        using errcode='40001';
    end if;

    update public.merchant_billing_payment_refunds
    set status='ignored_unrelated',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_refund.id
    returning * into v_refund;
  end if;

  perform public.process_merchant_billing_enforcement();

  v_result:=jsonb_build_object(
    'ok',true,
    'refundId',v_refund.id,
    'status',v_refund.status,
    'merchantId',v_refund.merchant_id,
    'paymentRequestId',v_refund.payment_request_id,
    'resolutionReference',v_refund.resolution_reference
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'merchant_billing_refund_'||replace(v_kind,'-','_'),
    'merchant_billing_payment_refund',
    v_refund.id::text,
    jsonb_build_object(
      'merchantId',v_refund.merchant_id,
      'paymentRequestId',v_refund.payment_request_id,
      'originalEndToEndId',v_refund.original_reconciliation_key,
      'refundEndToEndId',v_refund.refund_reconciliation_key,
      'amountCents',v_refund.amount_cents,
      'reference',v_reference
    )
  );

  return v_result;
end;
$$;

revoke all on function public.admin_merchant_billing_refund_action(
  uuid,uuid,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_refund_action(
  uuid,uuid,text,text,text,text
) to service_role,postgres;
