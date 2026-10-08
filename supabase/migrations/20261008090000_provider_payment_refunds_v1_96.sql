-- TAMÃO — Provider payment refund authority v1.96
-- Confirmed outbound Pix refunds are financial facts. They are linked by the
-- original bank EndToEndId. Safe prepaid credit can be reversed automatically;
-- all other post-approval refund value becomes an explicit recovery debt and
-- blocks new sales until Finance settles or waives it.

create table if not exists public.merchant_billing_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (
      char_length(provider) between 2 and 40
      and provider ~ '^[a-z0-9][a-z0-9._-]*$'
    ),
  provider_event_id text not null
    check (
      char_length(provider_event_id) between 6 and 160
      and provider_event_id !~ '[[:cntrl:]]'
    ),
  refund_end_to_end_id text not null
    check (
      char_length(refund_end_to_end_id) between 6 and 160
      and refund_end_to_end_id !~ '[[:cntrl:]]'
    ),
  original_end_to_end_id text not null
    check (
      char_length(original_end_to_end_id) between 6 and 160
      and original_end_to_end_id !~ '[[:cntrl:]]'
    ),
  payment_request_id uuid
    references public.merchant_billing_payment_requests(id) on delete restrict,
  merchant_id uuid
    references public.merchants(id) on delete restrict,
  refund_amount_cents bigint not null check (refund_amount_cents>0),
  original_amount_cents bigint not null check (original_amount_cents>0),
  currency text not null default 'BRL' check (currency='BRL'),
  occurred_at timestamptz not null,
  partial boolean not null,
  raw_payload_sha256 text not null
    check (raw_payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'received'
    check (status in ('received','applied','review_required')),
  action_type text
    check (
      action_type is null
      or action_type in (
        'package_credit_reversal',
        'recovery_debt',
        'request_cancelled_before_approval',
        'unapproved_payment_refund'
      )
    ),
  credit_reversed_cents bigint not null default 0
    check (credit_reversed_cents>=0),
  debt_created_cents bigint not null default 0
    check (debt_created_cents>=0),
  review_reason text
    check (
      review_reason is null
      or (
        char_length(review_reason) between 3 and 160
        and review_reason ~ '^[a-z0-9_:-]+$'
      )
    ),
  applied_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_billing_payment_refunds_amount_shape
    check (refund_amount_cents<=original_amount_cents),
  constraint merchant_billing_payment_refunds_applied_shape
    check (
      status<>'applied'
      or (
        payment_request_id is not null
        and merchant_id is not null
        and action_type is not null
        and applied_at is not null
        and credit_reversed_cents+debt_created_cents<=refund_amount_cents
      )
    ),
  constraint merchant_billing_payment_refunds_review_shape
    check (
      status<>'review_required'
      or review_reason is not null
    )
);

alter table public.merchant_billing_payment_refunds enable row level security;
revoke all on table public.merchant_billing_payment_refunds
from public,anon,authenticated;
grant all on table public.merchant_billing_payment_refunds
to service_role,postgres;

create unique index if not exists merchant_billing_payment_refunds_provider_event_uq
  on public.merchant_billing_payment_refunds(provider,provider_event_id);

create unique index if not exists merchant_billing_payment_refunds_provider_refund_e2e_uq
  on public.merchant_billing_payment_refunds(
    provider,lower(trim(refund_end_to_end_id))
  );

create index if not exists merchant_billing_payment_refunds_original_e2e_idx
  on public.merchant_billing_payment_refunds(
    provider,lower(trim(original_end_to_end_id)),occurred_at
  );

create index if not exists merchant_billing_payment_refunds_request_idx
  on public.merchant_billing_payment_refunds(payment_request_id,occurred_at)
  where payment_request_id is not null;

create index if not exists merchant_billing_payment_refunds_merchant_idx
  on public.merchant_billing_payment_refunds(merchant_id,occurred_at desc)
  where merchant_id is not null;

alter table public.merchant_fee_credit_ledger
  add column if not exists payment_refund_id uuid
    references public.merchant_billing_payment_refunds(id) on delete restrict;

create unique index if not exists merchant_fee_credit_ledger_payment_refund_uq
  on public.merchant_fee_credit_ledger(payment_refund_id)
  where payment_refund_id is not null;

create table if not exists public.merchant_billing_refund_debts (
  id uuid primary key default gen_random_uuid(),
  payment_refund_id uuid not null unique
    references public.merchant_billing_payment_refunds(id) on delete restrict,
  payment_request_id uuid not null
    references public.merchant_billing_payment_requests(id) on delete restrict,
  merchant_id uuid not null
    references public.merchants(id) on delete restrict,
  amount_cents bigint not null check (amount_cents>0),
  status text not null default 'open'
    check (status in ('open','paid','waived')),
  reason text not null
    check (char_length(reason) between 3 and 240),
  settled_at timestamptz,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolution_reference text
    check (
      resolution_reference is null
      or char_length(trim(resolution_reference)) between 3 and 240
    ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_billing_refund_debts_resolution_shape
    check (
      (
        status='open'
        and settled_at is null
        and resolved_by is null
        and resolution_reference is null
      )
      or (
        status in ('paid','waived')
        and settled_at is not null
        and resolved_by is not null
        and resolution_reference is not null
      )
    )
);

alter table public.merchant_billing_refund_debts enable row level security;
revoke all on table public.merchant_billing_refund_debts
from public,anon,authenticated;
grant all on table public.merchant_billing_refund_debts
to service_role,postgres;

create index if not exists merchant_billing_refund_debts_merchant_status_idx
  on public.merchant_billing_refund_debts(merchant_id,status,created_at);

create index if not exists merchant_billing_refund_debts_request_idx
  on public.merchant_billing_refund_debts(payment_request_id,created_at);

alter table public.merchant_billing_provider_charges
  add column if not exists refunded_amount_cents bigint not null default 0
    check (refunded_amount_cents>=0),
  add column if not exists last_refunded_at timestamptz;

alter table public.merchant_billing_provider_charges
  drop constraint if exists merchant_billing_provider_charges_refund_amount_shape;

alter table public.merchant_billing_provider_charges
  add constraint merchant_billing_provider_charges_refund_amount_shape
  check (
    paid_amount_cents is null
    or refunded_amount_cents<=paid_amount_cents
  );

create or replace function public.refresh_merchant_refund_debt_hold(
  p_merchant_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if p_merchant_id is null then
    return;
  end if;

  insert into public.merchant_billing_accounts(merchant_id,plan_key)
  values(p_merchant_id,'flex_daily')
  on conflict(merchant_id) do nothing;

  if exists(
    select 1
    from public.merchant_billing_refund_debts d
    where d.merchant_id=p_merchant_id
      and d.status='open'
      and d.amount_cents>0
  ) then
    update public.merchant_billing_accounts
    set sales_hold=true,
        sales_hold_reason='provider_payment_refund_debt',
        sales_hold_at=coalesce(sales_hold_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where merchant_id=p_merchant_id;
  else
    update public.merchant_billing_accounts
    set sales_hold=false,
        sales_hold_reason=null,
        sales_hold_at=null,
        updated_at=clock_timestamp()
    where merchant_id=p_merchant_id
      and sales_hold
      and sales_hold_reason='provider_payment_refund_debt';

    perform public.process_merchant_billing_enforcement();
  end if;
end;
$$;

revoke all on function public.refresh_merchant_refund_debt_hold(uuid)
from public,anon,authenticated;
grant execute on function public.refresh_merchant_refund_debt_hold(uuid)
to service_role,postgres;

create or replace function public.ingest_merchant_billing_payment_refund(
  p_provider text,
  p_provider_event_id text,
  p_refund_end_to_end_id text,
  p_original_end_to_end_id text,
  p_refund_amount_cents bigint,
  p_original_amount_cents bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_partial boolean,
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
  v_refund_e2e text:=trim(coalesce(p_refund_end_to_end_id,''));
  v_original_e2e text:=trim(coalesce(p_original_end_to_end_id,''));
  v_currency text:=upper(trim(coalesce(p_currency,'')));
  v_hash text:=lower(trim(coalesce(p_raw_payload_sha256,'')));
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_existing public.merchant_billing_payment_refunds%rowtype;
  v_event public.merchant_billing_payment_events%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_account public.merchant_billing_accounts%rowtype;
  v_charge public.merchant_billing_provider_charges%rowtype;
  v_total_refunded bigint:=0;
  v_available_credit bigint:=0;
  v_action text;
  v_debt bigint:=0;
  v_credit_reversed bigint:=0;
begin
  if char_length(v_provider)<2
     or char_length(v_provider)>40
     or v_provider!~'^[a-z0-9][a-z0-9._-]*$' then
    raise exception 'INVALID_PAYMENT_REFUND_PROVIDER' using errcode='22023';
  end if;

  if char_length(v_event_id)<6
     or char_length(v_event_id)>160
     or v_event_id~'[[:cntrl:]]' then
    raise exception 'INVALID_PAYMENT_REFUND_EVENT_ID' using errcode='22023';
  end if;

  if char_length(v_refund_e2e)<6
     or char_length(v_refund_e2e)>160
     or v_refund_e2e~'[[:cntrl:]]'
     or char_length(v_original_e2e)<6
     or char_length(v_original_e2e)>160
     or v_original_e2e~'[[:cntrl:]]' then
    raise exception 'INVALID_PAYMENT_REFUND_END_TO_END_ID' using errcode='22023';
  end if;

  if p_refund_amount_cents is null
     or p_refund_amount_cents<=0
     or p_original_amount_cents is null
     or p_original_amount_cents<=0
     or p_refund_amount_cents>p_original_amount_cents then
    raise exception 'INVALID_PAYMENT_REFUND_AMOUNT' using errcode='22023';
  end if;

  if v_currency<>'BRL' then
    raise exception 'UNSUPPORTED_PAYMENT_REFUND_CURRENCY' using errcode='22023';
  end if;

  if p_occurred_at is null
     or p_occurred_at>clock_timestamp()+interval '5 minutes'
     or p_occurred_at<clock_timestamp()-interval '90 days' then
    raise exception 'INVALID_PAYMENT_REFUND_TIMESTAMP' using errcode='22023';
  end if;

  if p_partial is null
     or p_partial is distinct from (p_refund_amount_cents<p_original_amount_cents) then
    raise exception 'INVALID_PAYMENT_REFUND_PARTIAL_FLAG' using errcode='22023';
  end if;

  if v_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_PAYMENT_REFUND_PAYLOAD_HASH' using errcode='22023';
  end if;

  insert into public.merchant_billing_payment_refunds(
    provider,provider_event_id,refund_end_to_end_id,original_end_to_end_id,
    refund_amount_cents,original_amount_cents,currency,occurred_at,partial,
    raw_payload_sha256
  )
  values(
    v_provider,v_event_id,v_refund_e2e,v_original_e2e,
    p_refund_amount_cents,p_original_amount_cents,v_currency,p_occurred_at,
    p_partial,v_hash
  )
  on conflict(provider,provider_event_id) do nothing
  returning * into v_refund;

  if v_refund.id is null then
    select *
    into v_existing
    from public.merchant_billing_payment_refunds
    where provider=v_provider
      and provider_event_id=v_event_id
    for update;

    if not found then
      raise exception 'PAYMENT_REFUND_IDEMPOTENCY_LOOKUP_FAILED'
        using errcode='40001';
    end if;

    if lower(trim(v_existing.refund_end_to_end_id))<>lower(v_refund_e2e)
       or lower(trim(v_existing.original_end_to_end_id))<>lower(v_original_e2e)
       or v_existing.refund_amount_cents<>p_refund_amount_cents
       or v_existing.original_amount_cents<>p_original_amount_cents
       or v_existing.currency<>v_currency
       or v_existing.partial<>p_partial
       or v_existing.raw_payload_sha256<>v_hash then
      raise exception 'PAYMENT_REFUND_IDEMPOTENCY_CONFLICT'
        using errcode='23505';
    end if;

    return jsonb_build_object(
      'ok',true,
      'replayed',true,
      'refundId',v_existing.id,
      'status',v_existing.status,
      'actionType',v_existing.action_type,
      'paymentRequestId',v_existing.payment_request_id,
      'merchantId',v_existing.merchant_id,
      'creditReversedCents',v_existing.credit_reversed_cents,
      'debtCreatedCents',v_existing.debt_created_cents,
      'reviewReason',v_existing.review_reason
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'merchant-billing-refund:'||v_provider||':'||lower(v_original_e2e),
      0
    )
  );

  select *
  into v_event
  from public.merchant_billing_payment_events e
  where e.provider=v_provider
    and lower(trim(e.reconciliation_key))=lower(v_original_e2e)
    and e.payment_request_id is not null
  order by
    case e.status
      when 'applied' then 0
      when 'already_applied' then 1
      when 'matched_exact' then 2
      else 3
    end,
    e.received_at asc,
    e.id
  limit 1
  for update;

  if found then
    select *
    into v_request
    from public.merchant_billing_payment_requests
    where id=v_event.payment_request_id
    for update;
  end if;

  if v_request.id is null then
    select *
    into v_request
    from public.merchant_billing_payment_requests r
    where lower(trim(coalesce(r.reconciliation_key,'')))=lower(v_original_e2e)
    order by
      case r.status when 'approved' then 0 when 'pending' then 1 else 2 end,
      r.resolved_at asc nulls last,
      r.id
    limit 1
    for update;
  end if;

  if v_request.id is null then
    select c.*
    into v_charge
    from public.merchant_billing_provider_charges c
    where c.provider=v_provider
      and lower(trim(coalesce(c.end_to_end_id,'')))=lower(v_original_e2e)
    order by c.completed_at asc nulls last,c.id
    limit 1
    for update;

    if found then
      select *
      into v_request
      from public.merchant_billing_payment_requests
      where id=v_charge.payment_request_id
      for update;
    end if;
  end if;

  if v_request.id is null then
    update public.merchant_billing_payment_refunds
    set status='review_required',
        review_reason='original_payment_not_found',
        updated_at=clock_timestamp()
    where id=v_refund.id
    returning * into v_refund;

    return jsonb_build_object(
      'ok',true,'replayed',false,'refundId',v_refund.id,
      'status',v_refund.status,'reviewReason',v_refund.review_reason
    );
  end if;

  update public.merchant_billing_payment_refunds
  set payment_request_id=v_request.id,
      merchant_id=v_request.merchant_id,
      updated_at=clock_timestamp()
  where id=v_refund.id
  returning * into v_refund;

  if p_original_amount_cents<>coalesce(
       v_request.received_amount_cents,
       v_request.expected_amount_cents
     ) then
    update public.merchant_billing_payment_refunds
    set status='review_required',
        review_reason='original_payment_amount_mismatch',
        updated_at=clock_timestamp()
    where id=v_refund.id
    returning * into v_refund;

    perform public.refresh_merchant_refund_debt_hold(v_request.merchant_id);

    return jsonb_build_object(
      'ok',true,'replayed',false,'refundId',v_refund.id,
      'status',v_refund.status,'paymentRequestId',v_request.id,
      'merchantId',v_request.merchant_id,
      'reviewReason',v_refund.review_reason
    );
  end if;

  select coalesce(sum(r.refund_amount_cents),0)
  into v_total_refunded
  from public.merchant_billing_payment_refunds r
  where r.provider=v_provider
    and lower(trim(r.original_end_to_end_id))=lower(v_original_e2e)
    and r.status<>'review_required'
       or r.id=v_refund.id;

  -- Repeat with explicit parentheses to keep cumulative proof scoped.
  select coalesce(sum(r.refund_amount_cents),0)
  into v_total_refunded
  from public.merchant_billing_payment_refunds r
  where r.provider=v_provider
    and lower(trim(r.original_end_to_end_id))=lower(v_original_e2e)
    and (r.status<>'review_required' or r.id=v_refund.id);

  if v_total_refunded>p_original_amount_cents then
    update public.merchant_billing_payment_refunds
    set status='review_required',
        review_reason='cumulative_refund_exceeds_original',
        updated_at=clock_timestamp()
    where id=v_refund.id
    returning * into v_refund;

    update public.merchant_billing_accounts
    set sales_hold=true,
        sales_hold_reason='provider_payment_refund_review',
        sales_hold_at=coalesce(sales_hold_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where merchant_id=v_request.merchant_id;

    return jsonb_build_object(
      'ok',true,'replayed',false,'refundId',v_refund.id,
      'status',v_refund.status,'paymentRequestId',v_request.id,
      'merchantId',v_request.merchant_id,
      'reviewReason',v_refund.review_reason
    );
  end if;

  update public.merchant_billing_provider_charges c
  set refunded_amount_cents=refunded_amount_cents+p_refund_amount_cents,
      last_refunded_at=p_occurred_at,
      updated_at=clock_timestamp()
  where c.payment_request_id=v_request.id
    and c.provider=v_provider
    and lower(trim(coalesce(c.end_to_end_id,'')))=lower(v_original_e2e)
    and refunded_amount_cents+p_refund_amount_cents
        <=coalesce(paid_amount_cents,p_original_amount_cents);

  if v_request.status='pending' then
    update public.merchant_billing_payment_events
    set status='superseded',
        payment_request_id=null,
        merchant_id=null,
        match_reason='payment_refunded_before_approval',
        updated_at=clock_timestamp()
    where provider=v_provider
      and lower(trim(reconciliation_key))=lower(v_original_e2e)
      and status in ('matched_exact','review_required','received');

    update public.merchant_billing_payment_requests
    set status='cancelled',
        admin_reference='provider-payment-refunded-before-approval',
        resolved_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=v_request.id
      and status='pending';

    v_action:='request_cancelled_before_approval';

  elsif v_request.status<>'approved' then
    v_action:='unapproved_payment_refund';

  elsif v_request.request_kind='package_purchase'
        and v_request.credit_grant_cents_snapshot
            =v_request.expected_amount_cents then

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'merchant-fee-credit:'||v_request.merchant_id::text,0
      )
    );

    select *
    into v_account
    from public.merchant_billing_accounts
    where merchant_id=v_request.merchant_id
    for update;

    v_available_credit:=greatest(
      coalesce(v_account.credit_balance_cents,0)
      -coalesce(v_account.credit_reserved_cents,0),
      0
    );

    if v_available_credit>=p_refund_amount_cents then
      update public.merchant_billing_accounts
      set credit_balance_cents=credit_balance_cents-p_refund_amount_cents,
          plan_key=case
            when credit_balance_cents-p_refund_amount_cents=0
             and credit_reserved_cents=0
              then 'flex_daily'
            else plan_key
          end,
          updated_at=clock_timestamp()
      where merchant_id=v_request.merchant_id;

      insert into public.merchant_fee_credit_ledger(
        merchant_id,entry_type,amount_cents,plan_key,reference,
        created_by,payment_refund_id
      )
      values(
        v_request.merchant_id,'admin_adjustment',
        -p_refund_amount_cents,v_request.plan_key,
        'provider-refund:'||v_refund.id::text,
        null,v_refund.id
      );

      v_credit_reversed:=p_refund_amount_cents;
      v_action:='package_credit_reversal';
    else
      v_debt:=p_refund_amount_cents;
      v_action:='recovery_debt';
    end if;

  else
    v_debt:=p_refund_amount_cents;
    v_action:='recovery_debt';
  end if;

  if v_debt>0 then
    insert into public.merchant_billing_refund_debts(
      payment_refund_id,payment_request_id,merchant_id,
      amount_cents,reason
    )
    values(
      v_refund.id,v_request.id,v_request.merchant_id,
      v_debt,
      case
        when v_request.request_kind='package_purchase'
          then 'Provider refund confirmed after prepaid credit was no longer safely reversible'
        else 'Provider refund confirmed after daily statement payment'
      end
    );

    perform public.refresh_merchant_refund_debt_hold(v_request.merchant_id);
  end if;

  update public.merchant_billing_payment_refunds
  set status='applied',
      action_type=v_action,
      credit_reversed_cents=v_credit_reversed,
      debt_created_cents=v_debt,
      applied_at=clock_timestamp(),
      review_reason=null,
      updated_at=clock_timestamp()
  where id=v_refund.id
  returning * into v_refund;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    null,
    'merchant_billing_provider_refund_applied',
    'merchant_billing_payment_refund',
    v_refund.id::text,
    jsonb_build_object(
      'provider',v_provider,
      'refundEndToEndId',v_refund_e2e,
      'originalEndToEndId',v_original_e2e,
      'refundAmountCents',p_refund_amount_cents,
      'paymentRequestId',v_request.id,
      'merchantId',v_request.merchant_id,
      'actionType',v_action,
      'creditReversedCents',v_credit_reversed,
      'debtCreatedCents',v_debt
    )
  );

  return jsonb_build_object(
    'ok',true,
    'replayed',false,
    'refundId',v_refund.id,
    'status',v_refund.status,
    'actionType',v_refund.action_type,
    'paymentRequestId',v_refund.payment_request_id,
    'merchantId',v_refund.merchant_id,
    'creditReversedCents',v_refund.credit_reversed_cents,
    'debtCreatedCents',v_refund.debt_created_cents
  );
end;
$$;

revoke all on function public.ingest_merchant_billing_payment_refund(
  text,text,text,text,bigint,bigint,text,timestamptz,boolean,text
) from public,anon,authenticated;
grant execute on function public.ingest_merchant_billing_payment_refund(
  text,text,text,text,bigint,bigint,text,timestamptz,boolean,text
) to service_role,postgres;

create or replace function public.admin_merchant_billing_refund_debt_action(
  p_actor_user_id uuid,
  p_debt_id uuid,
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
  v_debt public.merchant_billing_refund_debts%rowtype;
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if v_kind not in ('mark_paid','waive') then
    raise exception 'INVALID_REFUND_DEBT_ACTION' using errcode='22023';
  end if;

  if v_reference is null
     or char_length(v_reference)<3
     or char_length(v_reference)>240 then
    raise exception 'FINANCIAL_REFERENCE_REQUIRED' using errcode='22023';
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
    'admin-ops:merchant-billing-refund-debt:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>
        'admin-ops:merchant-billing-refund-debt:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_debt
  from public.merchant_billing_refund_debts
  where id=p_debt_id
  for update;

  if not found then
    raise exception 'REFUND_DEBT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_debt.status<>'open' then
    raise exception 'REFUND_DEBT_ALREADY_RESOLVED' using errcode='40001';
  end if;

  update public.merchant_billing_refund_debts
  set status=case when v_kind='mark_paid' then 'paid' else 'waived' end,
      settled_at=clock_timestamp(),
      resolved_by=p_actor_user_id,
      resolution_reference=v_reference,
      updated_at=clock_timestamp()
  where id=v_debt.id
  returning * into v_debt;

  perform public.refresh_merchant_refund_debt_hold(v_debt.merchant_id);

  v_result:=jsonb_build_object(
    'ok',true,
    'debtId',v_debt.id,
    'status',v_debt.status,
    'merchantId',v_debt.merchant_id,
    'amountCents',v_debt.amount_cents,
    'position',public.merchant_financial_position(v_debt.merchant_id)
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
    'merchant_billing_refund_debt_'||v_kind,
    'merchant_billing_refund_debt',
    v_debt.id::text,
    jsonb_build_object(
      'merchantId',v_debt.merchant_id,
      'amountCents',v_debt.amount_cents,
      'status',v_debt.status,
      'reference',v_reference
    )
  );

  return v_result;
end;
$$;

revoke all on function public.admin_merchant_billing_refund_debt_action(
  uuid,uuid,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_refund_debt_action(
  uuid,uuid,text,text,text,text
) to service_role,postgres;

create or replace function public.merchant_financial_position(p_merchant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_fees bigint:=0;
  v_cashback bigint:=0;
  v_platform_owes bigint:=0;
  v_merchant_owes bigint:=0;
  v_refund_debt bigint:=0;
  v_credit bigint:=0;
  v_reserved bigint:=0;
  v_hold boolean:=false;
  v_plan text;
begin
  if p_merchant_id is null then
    raise exception 'INVALID_MERCHANT' using errcode='22023';
  end if;

  select coalesce(sum(platform_fee_cents-prepaid_credit_applied_cents),0)
  into v_fees
  from public.platform_receivables
  where merchant_id=p_merchant_id
    and status='open';

  select coalesce(sum(cashback_cents),0)
  into v_cashback
  from public.merchant_cashback_reimbursements
  where merchant_id=p_merchant_id
    and status='open';

  select
    coalesce(sum(amount_cents) filter (
      where direction='platform_owes_merchant' and status='open'
    ),0),
    coalesce(sum(amount_cents) filter (
      where direction='merchant_owes_platform' and status='open'
    ),0)
  into v_platform_owes,v_merchant_owes
  from public.platform_settlement_adjustments
  where merchant_id=p_merchant_id;

  select coalesce(sum(amount_cents),0)
  into v_refund_debt
  from public.merchant_billing_refund_debts
  where merchant_id=p_merchant_id
    and status='open';

  select credit_balance_cents,credit_reserved_cents,sales_hold,plan_key
  into v_credit,v_reserved,v_hold,v_plan
  from public.merchant_billing_accounts
  where merchant_id=p_merchant_id;

  return jsonb_build_object(
    'merchantId',p_merchant_id,
    'billingPlanKey',v_plan,
    'prepaidCreditBalanceCents',coalesce(v_credit,0),
    'prepaidCreditReservedCents',coalesce(v_reserved,0),
    'financialSalesHold',coalesce(v_hold,false),
    'platformFeesReceivableCents',v_fees,
    'cashbackReimbursementPayableCents',v_cashback,
    'providerRefundRecoveryCents',v_refund_debt,
    'otherPlatformPayablesCents',v_platform_owes,
    'otherMerchantReceivablesCents',v_merchant_owes+v_refund_debt,
    'netDueToPlatformCents',
      v_fees+v_merchant_owes+v_refund_debt-v_cashback-v_platform_owes
  );
end;
$$;

revoke all on function public.merchant_financial_position(uuid)
from public,anon,authenticated;
grant execute on function public.merchant_financial_position(uuid)
to service_role,postgres;
