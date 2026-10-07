-- TAMÃO — Merchant billing payment requests v1.73
-- Merchant requests never create financial credit by themselves.
-- Admin approval is the only authority that can activate package credit or settle a daily statement.

create table if not exists public.merchant_billing_payment_requests (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  request_kind text not null
    check (request_kind in ('package_purchase','statement_payment')),
  plan_key text references public.merchant_billing_plans(plan_key),
  statement_id uuid references public.merchant_daily_statements(id) on delete restrict,
  expected_amount_cents bigint not null check (expected_amount_cents > 0),
  platform_fee_bps_snapshot integer
    check (platform_fee_bps_snapshot is null or platform_fee_bps_snapshot between 1 and 10000),
  credit_grant_cents_snapshot bigint
    check (credit_grant_cents_snapshot is null or credit_grant_cents_snapshot > 0),
  merchant_reference text not null
    check (char_length(merchant_reference) between 3 and 240),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default clock_timestamp(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  admin_reference text,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (request_kind='package_purchase'
      and plan_key is not null
      and statement_id is null
      and platform_fee_bps_snapshot is not null
      and credit_grant_cents_snapshot is not null)
    or
    (request_kind='statement_payment'
      and plan_key is null
      and statement_id is not null
      and platform_fee_bps_snapshot is null
      and credit_grant_cents_snapshot is null)
  )
);

alter table public.merchant_billing_payment_requests enable row level security;
revoke all on table public.merchant_billing_payment_requests from public, anon, authenticated;
grant all on table public.merchant_billing_payment_requests to service_role;

create index if not exists merchant_billing_payment_requests_merchant_idx
  on public.merchant_billing_payment_requests(merchant_id,requested_at desc);

create index if not exists merchant_billing_payment_requests_status_idx
  on public.merchant_billing_payment_requests(status,requested_at)
  where status='pending';

create index if not exists merchant_billing_payment_requests_requested_by_idx
  on public.merchant_billing_payment_requests(requested_by)
  where requested_by is not null;

create index if not exists merchant_billing_payment_requests_resolved_by_idx
  on public.merchant_billing_payment_requests(resolved_by)
  where resolved_by is not null;

create unique index if not exists merchant_billing_one_pending_package_uq
  on public.merchant_billing_payment_requests(merchant_id)
  where request_kind='package_purchase' and status='pending';

create unique index if not exists merchant_billing_one_pending_statement_uq
  on public.merchant_billing_payment_requests(statement_id)
  where request_kind='statement_payment' and status='pending';

alter table public.merchant_fee_credit_ledger
  add column if not exists payment_request_id uuid
    references public.merchant_billing_payment_requests(id) on delete restrict;

create unique index if not exists merchant_fee_credit_ledger_payment_request_uq
  on public.merchant_fee_credit_ledger(payment_request_id)
  where payment_request_id is not null;

create or replace function public.require_package_credit_payment_request()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.entry_type='package_credit' and new.payment_request_id is null then
    raise exception 'PACKAGE_PAYMENT_REQUEST_REQUIRED' using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function public.require_package_credit_payment_request()
from public, anon, authenticated;
grant execute on function public.require_package_credit_payment_request()
to postgres, service_role;

drop trigger if exists require_package_credit_payment_request_trg
on public.merchant_fee_credit_ledger;
create trigger require_package_credit_payment_request_trg
before insert on public.merchant_fee_credit_ledger
for each row execute function public.require_package_credit_payment_request();

create or replace function public.cancel_resolved_statement_payment_requests()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if old.status in ('open','overdue')
     and new.status in ('paid','waived')
     and old.status is distinct from new.status then
    update public.merchant_billing_payment_requests
    set status='cancelled',
        resolved_at=coalesce(resolved_at,clock_timestamp()),
        admin_reference=coalesce(admin_reference,'statement-resolved-elsewhere'),
        updated_at=clock_timestamp()
    where statement_id=new.id
      and request_kind='statement_payment'
      and status='pending';
  end if;
  return new;
end;
$$;

revoke all on function public.cancel_resolved_statement_payment_requests()
from public, anon, authenticated;
grant execute on function public.cancel_resolved_statement_payment_requests()
to postgres, service_role;

drop trigger if exists cancel_resolved_statement_payment_requests_trg
on public.merchant_daily_statements;
create trigger cancel_resolved_statement_payment_requests_trg
after update of status on public.merchant_daily_statements
for each row execute function public.cancel_resolved_statement_payment_requests();

create or replace function public.merchant_billing_request_action(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_action text,
  p_plan_key text,
  p_statement_id uuid,
  p_payment_request_id uuid,
  p_merchant_reference text,
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
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_reference text:=nullif(trim(p_merchant_reference),'');
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

  if v_kind not in ('submit-package','submit-statement-payment','cancel-request') then
    raise exception 'INVALID_BILLING_REQUEST_ACTION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  if v_kind<>'cancel-request'
     and (v_reference is null or char_length(v_reference)<3 or char_length(v_reference)>240) then
    raise exception 'PAYMENT_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(
    p_idempotency_key,p_actor_user_id,
    'merchant-ops:billing-request:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'merchant-ops:billing-request:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  if v_kind='submit-package' then
    select *
    into v_plan
    from public.merchant_billing_plans
    where plan_key=p_plan_key
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
      insert into public.merchant_billing_payment_requests(
        merchant_id,request_kind,plan_key,expected_amount_cents,
        platform_fee_bps_snapshot,credit_grant_cents_snapshot,
        merchant_reference,requested_by
      )
      values(
        p_merchant_id,'package_purchase',v_plan.plan_key,
        v_plan.purchase_amount_cents,v_plan.platform_fee_bps,
        v_plan.credit_grant_cents,v_reference,p_actor_user_id
      )
      returning * into v_request;
    end if;

  elsif v_kind='submit-statement-payment' then
    if p_statement_id is null then
      raise exception 'STATEMENT_ID_REQUIRED' using errcode='22023';
    end if;

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
      insert into public.merchant_billing_payment_requests(
        merchant_id,request_kind,statement_id,expected_amount_cents,
        merchant_reference,requested_by
      )
      values(
        p_merchant_id,'statement_payment',v_statement.id,
        v_statement.amount_due_cents,v_reference,p_actor_user_id
      )
      returning * into v_request;
    end if;

  else
    if p_payment_request_id is null then
      raise exception 'PAYMENT_REQUEST_ID_REQUIRED' using errcode='22023';
    end if;

    select *
    into v_request
    from public.merchant_billing_payment_requests
    where id=p_payment_request_id
      and merchant_id=p_merchant_id
    for update;

    if not found then
      raise exception 'PAYMENT_REQUEST_NOT_FOUND' using errcode='P0002';
    end if;

    if v_request.status<>'pending' then
      raise exception 'PAYMENT_REQUEST_ALREADY_RESOLVED' using errcode='40001';
    end if;

    update public.merchant_billing_payment_requests
    set status='cancelled',
        resolved_at=clock_timestamp(),
        admin_reference='cancelled-by-merchant',
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;
  end if;

  v_result:=jsonb_build_object(
    'ok',true,
    'paymentRequestId',v_request.id,
    'requestKind',v_request.request_kind,
    'status',v_request.status,
    'merchantId',v_request.merchant_id,
    'planKey',v_request.plan_key,
    'statementId',v_request.statement_id,
    'expectedAmountCents',v_request.expected_amount_cents
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.merchant_billing_request_action(
  uuid,uuid,text,text,uuid,uuid,text,text,text
) from public, anon, authenticated;
grant execute on function public.merchant_billing_request_action(
  uuid,uuid,text,text,uuid,uuid,text,text,text
) to service_role;

create or replace function public.admin_merchant_billing_payment_request_action(
  p_actor_user_id uuid,
  p_payment_request_id uuid,
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
  v_action public.action_requests%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_statement public.merchant_daily_statements%rowtype;
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_reference text:=nullif(trim(p_reference),'');
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if p_payment_request_id is null then
    raise exception 'PAYMENT_REQUEST_ID_REQUIRED' using errcode='22023';
  end if;

  if v_kind not in ('approve','reject') then
    raise exception 'INVALID_PAYMENT_REQUEST_ACTION' using errcode='22023';
  end if;

  if v_reference is null or char_length(v_reference)<3 or char_length(v_reference)>240 then
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

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:merchant-billing-payment-request:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:merchant-billing-payment-request:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_request
  from public.merchant_billing_payment_requests
  where id=p_payment_request_id
  for update;

  if not found then
    raise exception 'PAYMENT_REQUEST_NOT_FOUND' using errcode='P0002';
  end if;

  if v_request.status<>'pending' then
    raise exception 'PAYMENT_REQUEST_ALREADY_RESOLVED' using errcode='40001';
  end if;

  if v_kind='reject' then
    update public.merchant_billing_payment_requests
    set status='rejected',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;
  elsif v_request.request_kind='package_purchase' then
    select *
    into v_plan
    from public.merchant_billing_plans
    where plan_key=v_request.plan_key
      and active
      and billing_mode='prepaid_credit'
    for share;

    if not found
       or v_plan.purchase_amount_cents is distinct from v_request.expected_amount_cents
       or v_plan.credit_grant_cents is distinct from v_request.credit_grant_cents_snapshot
       or v_plan.platform_fee_bps is distinct from v_request.platform_fee_bps_snapshot then
      raise exception 'PACKAGE_TERMS_CHANGED' using errcode='40001';
    end if;

    insert into public.merchant_billing_accounts(merchant_id,plan_key)
    values(v_request.merchant_id,'flex_daily')
    on conflict(merchant_id) do nothing;

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-fee-credit:'||v_request.merchant_id::text,0)
    );

    update public.merchant_billing_accounts
    set plan_key=v_plan.plan_key,
        credit_balance_cents=credit_balance_cents+v_request.credit_grant_cents_snapshot,
        updated_at=clock_timestamp()
    where merchant_id=v_request.merchant_id;

    insert into public.merchant_fee_credit_ledger(
      merchant_id,entry_type,amount_cents,plan_key,reference,created_by,payment_request_id
    )
    values(
      v_request.merchant_id,'package_credit',
      v_request.credit_grant_cents_snapshot,v_request.plan_key,
      v_reference,p_actor_user_id,v_request.id
    );

    update public.merchant_billing_payment_requests
    set status='approved',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;
  else
    select *
    into v_statement
    from public.merchant_daily_statements
    where id=v_request.statement_id
      and merchant_id=v_request.merchant_id
    for update;

    if not found then
      raise exception 'STATEMENT_NOT_FOUND' using errcode='P0002';
    end if;

    if v_statement.status not in ('open','overdue')
       or v_statement.amount_due_cents is distinct from v_request.expected_amount_cents then
      raise exception 'STATEMENT_TERMS_CHANGED' using errcode='40001';
    end if;

    update public.merchant_daily_statements
    set status='paid',
        paid_at=clock_timestamp(),
        waived_at=null,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_statement.id;

    update public.platform_receivables
    set status='paid',
        paid_at=clock_timestamp(),
        waived_at=null,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where daily_statement_id=v_statement.id
      and status='open';

    update public.merchant_billing_payment_requests
    set status='approved',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;
  end if;

  perform public.process_merchant_billing_enforcement();

  v_result:=jsonb_build_object(
    'ok',true,
    'paymentRequestId',v_request.id,
    'requestKind',v_request.request_kind,
    'status',v_request.status,
    'merchantId',v_request.merchant_id,
    'position',public.merchant_financial_position(v_request.merchant_id)
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
    'merchant_billing_payment_request_'||v_kind,
    'merchant_billing_payment_request',
    v_request.id::text,
    jsonb_build_object(
      'merchantId',v_request.merchant_id,
      'requestKind',v_request.request_kind,
      'planKey',v_request.plan_key,
      'statementId',v_request.statement_id,
      'expectedAmountCents',v_request.expected_amount_cents,
      'reference',v_reference
    )
  );

  return v_result;
end;
$$;

revoke all on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,text,text
) to service_role;
