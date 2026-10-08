-- TAMÃO — Provider refund recovery obligations v1.97
-- A linked PSP refund is no longer resolved by an administrative note alone.
-- It creates an explicit recovery obligation that must be paid through the
-- existing payment request / provider event / Finance approval authorities.

do $$
begin
  if exists(
    select 1
    from public.merchant_billing_payment_refunds
    where status='resolved_recovered'
  ) then
    raise exception 'V197_LEGACY_RECOVERED_REFUND_REVIEW_REQUIRED'
      using errcode='40001';
  end if;
end $$;

create table if not exists public.merchant_billing_refund_recoveries (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null unique
    references public.merchant_billing_payment_refunds(id) on delete restrict,
  merchant_id uuid not null
    references public.merchants(id) on delete restrict,
  original_payment_request_id uuid not null
    references public.merchant_billing_payment_requests(id) on delete restrict,
  amount_cents bigint not null check (amount_cents>0),
  currency text not null default 'BRL' check (currency='BRL'),
  status text not null default 'open'
    check (status in ('open','payment_pending','recovered')),
  recovery_payment_request_id uuid
    references public.merchant_billing_payment_requests(id) on delete restrict,
  recovered_by uuid references auth.users(id) on delete set null,
  recovered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_billing_refund_recoveries_state_shape check (
    (status='open'
      and recovery_payment_request_id is null
      and recovered_by is null
      and recovered_at is null)
    or
    (status='payment_pending'
      and recovery_payment_request_id is not null
      and recovered_by is null
      and recovered_at is null)
    or
    (status='recovered'
      and recovery_payment_request_id is not null
      and recovered_by is not null
      and recovered_at is not null)
  )
);

alter table public.merchant_billing_refund_recoveries enable row level security;
revoke all on table public.merchant_billing_refund_recoveries
from public,anon,authenticated;
grant all on table public.merchant_billing_refund_recoveries
to service_role,postgres;

create index if not exists merchant_billing_refund_recoveries_merchant_idx
  on public.merchant_billing_refund_recoveries(merchant_id,status,created_at);

create index if not exists merchant_billing_refund_recoveries_original_request_idx
  on public.merchant_billing_refund_recoveries(original_payment_request_id);

create unique index if not exists merchant_billing_refund_recoveries_payment_request_uq
  on public.merchant_billing_refund_recoveries(recovery_payment_request_id)
  where recovery_payment_request_id is not null;

create index if not exists merchant_billing_refund_recoveries_recovered_by_idx
  on public.merchant_billing_refund_recoveries(recovered_by)
  where recovered_by is not null;

alter table public.merchant_billing_payment_requests
  add column if not exists refund_recovery_id uuid
    references public.merchant_billing_refund_recoveries(id) on delete restrict;

alter table public.merchant_billing_payment_requests
  drop constraint if exists merchant_billing_payment_requests_request_kind_check,
  drop constraint if exists merchant_billing_payment_requests_check;

alter table public.merchant_billing_payment_requests
  add constraint merchant_billing_payment_requests_request_kind_check
  check (
    request_kind in (
      'package_purchase','statement_payment','refund_recovery'
    )
  ),
  add constraint merchant_billing_payment_requests_check
  check (
    (
      request_kind='package_purchase'
      and plan_key is not null
      and statement_id is null
      and refund_recovery_id is null
      and platform_fee_bps_snapshot is not null
      and credit_grant_cents_snapshot is not null
    )
    or
    (
      request_kind='statement_payment'
      and plan_key is null
      and statement_id is not null
      and refund_recovery_id is null
      and platform_fee_bps_snapshot is null
      and credit_grant_cents_snapshot is null
    )
    or
    (
      request_kind='refund_recovery'
      and plan_key is null
      and statement_id is null
      and refund_recovery_id is not null
      and platform_fee_bps_snapshot is null
      and credit_grant_cents_snapshot is null
    )
  );

create index if not exists merchant_billing_payment_requests_refund_recovery_idx
  on public.merchant_billing_payment_requests(refund_recovery_id,requested_at desc)
  where refund_recovery_id is not null;

create unique index if not exists merchant_billing_payment_requests_refund_recovery_live_uq
  on public.merchant_billing_payment_requests(refund_recovery_id)
  where refund_recovery_id is not null
    and status in ('pending','approved');

create or replace function public.ensure_provider_refund_recovery_obligation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
begin
  if new.status='review_required'
     and new.merchant_id is not null
     and new.payment_request_id is not null then

    insert into public.merchant_billing_refund_recoveries(
      refund_id,merchant_id,original_payment_request_id,
      amount_cents,currency,status
    )
    values(
      new.id,new.merchant_id,new.payment_request_id,
      new.amount_cents,new.currency,'open'
    )
    on conflict(refund_id) do nothing;

    select *
    into v_recovery
    from public.merchant_billing_refund_recoveries
    where refund_id=new.id
    for update;

    if not found
       or v_recovery.merchant_id is distinct from new.merchant_id
       or v_recovery.original_payment_request_id is distinct from new.payment_request_id
       or v_recovery.amount_cents is distinct from new.amount_cents
       or v_recovery.currency is distinct from new.currency then
      raise exception 'REFUND_RECOVERY_OBLIGATION_MISMATCH'
        using errcode='40001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_provider_refund_recovery_obligation()
from public,anon,authenticated;
grant execute on function public.ensure_provider_refund_recovery_obligation()
to postgres,service_role;

drop trigger if exists ensure_provider_refund_recovery_obligation_trg
on public.merchant_billing_payment_refunds;
create trigger ensure_provider_refund_recovery_obligation_trg
after insert or update of
  status,merchant_id,payment_request_id,amount_cents,currency
on public.merchant_billing_payment_refunds
for each row execute function public.ensure_provider_refund_recovery_obligation();

insert into public.merchant_billing_refund_recoveries(
  refund_id,merchant_id,original_payment_request_id,
  amount_cents,currency,status
)
select
  r.id,r.merchant_id,r.payment_request_id,
  r.amount_cents,r.currency,'open'
from public.merchant_billing_payment_refunds r
where r.status='review_required'
  and r.merchant_id is not null
  and r.payment_request_id is not null
on conflict(refund_id) do nothing;

create or replace function public.block_new_payment_request_during_provider_refund_review()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
begin
  if not exists(
    select 1
    from public.merchant_billing_payment_refunds r
    where r.merchant_id=new.merchant_id
      and r.status='review_required'
  ) then
    return new;
  end if;

  if new.request_kind='refund_recovery'
     and new.refund_recovery_id is not null then
    select rr.*
    into v_recovery
    from public.merchant_billing_refund_recoveries rr
    join public.merchant_billing_payment_refunds r
      on r.id=rr.refund_id
    where rr.id=new.refund_recovery_id
      and rr.merchant_id=new.merchant_id
      and rr.amount_cents=new.expected_amount_cents
      and rr.status in ('open','payment_pending')
      and r.status='review_required'
      and r.merchant_id=new.merchant_id
    for share;

    if found then
      return new;
    end if;

    raise exception 'INVALID_REFUND_RECOVERY_REQUEST'
      using errcode='40001';
  end if;

  raise exception 'PAYMENT_REFUND_REVIEW_BLOCKS_NEW_REQUEST'
    using errcode='40001';
end;
$$;

revoke all on function public.block_new_payment_request_during_provider_refund_review()
from public,anon,authenticated;
grant execute on function public.block_new_payment_request_during_provider_refund_review()
to postgres,service_role;

create or replace function public.sync_refund_recovery_after_payment_request()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.request_kind<>'refund_recovery'
     or new.refund_recovery_id is null
     or old.status is not distinct from new.status then
    return new;
  end if;

  if old.status='pending'
     and new.status in ('cancelled','rejected') then
    update public.merchant_billing_refund_recoveries rr
    set status='open',
        recovery_payment_request_id=null,
        updated_at=clock_timestamp()
    where rr.id=new.refund_recovery_id
      and rr.status='payment_pending'
      and rr.recovery_payment_request_id=new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_refund_recovery_after_payment_request()
from public,anon,authenticated;
grant execute on function public.sync_refund_recovery_after_payment_request()
to postgres,service_role;

drop trigger if exists sync_refund_recovery_after_payment_request_trg
on public.merchant_billing_payment_requests;
create trigger sync_refund_recovery_after_payment_request_trg
after update of status
on public.merchant_billing_payment_requests
for each row execute function public.sync_refund_recovery_after_payment_request();

create or replace function public.merchant_billing_request_action(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_action text,
  p_plan_key text,
  p_statement_id uuid,
  p_refund_recovery_id uuid,
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
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_refund public.merchant_billing_payment_refunds%rowtype;
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

  if v_kind not in (
    'submit-package',
    'submit-statement-payment',
    'submit-refund-recovery',
    'cancel-request'
  ) then
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
     and (
       v_reference is null
       or char_length(v_reference)<3
       or char_length(v_reference)>240
     ) then
    raise exception 'PAYMENT_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'merchant-billing-request:'||p_merchant_id::text,
      0
    )
  );

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

  elsif v_kind='submit-refund-recovery' then
    if p_refund_recovery_id is null then
      raise exception 'REFUND_RECOVERY_ID_REQUIRED' using errcode='22023';
    end if;

    select rr.*
    into v_recovery
    from public.merchant_billing_refund_recoveries rr
    where rr.id=p_refund_recovery_id
      and rr.merchant_id=p_merchant_id
    for update;

    if not found then
      raise exception 'REFUND_RECOVERY_NOT_FOUND' using errcode='P0002';
    end if;

    select *
    into v_refund
    from public.merchant_billing_payment_refunds
    where id=v_recovery.refund_id
    for share;

    if not found
       or v_refund.status<>'review_required'
       or v_recovery.status='recovered' then
      raise exception 'REFUND_RECOVERY_NOT_PAYABLE' using errcode='40001';
    end if;

    select *
    into v_request
    from public.merchant_billing_payment_requests
    where refund_recovery_id=v_recovery.id
      and request_kind='refund_recovery'
      and status='pending'
    order by requested_at desc,id
    limit 1
    for update;

    if not found then
      insert into public.merchant_billing_payment_requests(
        merchant_id,request_kind,refund_recovery_id,
        expected_amount_cents,merchant_reference,requested_by
      )
      values(
        p_merchant_id,'refund_recovery',v_recovery.id,
        v_recovery.amount_cents,v_reference,p_actor_user_id
      )
      returning * into v_request;
    end if;

    update public.merchant_billing_refund_recoveries
    set status='payment_pending',
        recovery_payment_request_id=v_request.id,
        updated_at=clock_timestamp()
    where id=v_recovery.id
      and status in ('open','payment_pending');

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
    'refundRecoveryId',v_request.refund_recovery_id,
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
  uuid,uuid,text,text,uuid,uuid,uuid,text,text,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_request_action(
  uuid,uuid,text,text,uuid,uuid,uuid,text,text,text
) to service_role,postgres;

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
language sql
security definer
set search_path=pg_catalog
as $$
  select public.merchant_billing_request_action(
    p_actor_user_id,p_merchant_id,p_action,p_plan_key,p_statement_id,
    null,p_payment_request_id,p_merchant_reference,
    p_idempotency_key,p_request_hash
  );
$$;

revoke all on function public.merchant_billing_request_action(
  uuid,uuid,text,text,uuid,uuid,text,text,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_request_action(
  uuid,uuid,text,text,uuid,uuid,text,text,text
) to service_role,postgres;

create or replace function public.merchant_billing_pix_charge_prepare(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_plan_key text,
  p_statement_id uuid,
  p_refund_recovery_id uuid,
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
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_charge public.merchant_billing_provider_charges%rowtype;
  v_correlation text;
  v_result jsonb;
  v_target_count integer:=
    (case when p_plan_key is not null then 1 else 0 end)
    +(case when p_statement_id is not null then 1 else 0 end)
    +(case when p_refund_recovery_id is not null then 1 else 0 end);
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

  if v_target_count<>1 then
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
        'pix-auto:'||v_correlation,p_actor_user_id
      )
      returning * into v_request;
    end if;

  elsif p_statement_id is not null then
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
        'pix-auto:'||v_correlation,p_actor_user_id
      )
      returning * into v_request;
    end if;

  else
    select rr.*
    into v_recovery
    from public.merchant_billing_refund_recoveries rr
    where rr.id=p_refund_recovery_id
      and rr.merchant_id=p_merchant_id
    for update;

    if not found then
      raise exception 'REFUND_RECOVERY_NOT_FOUND' using errcode='P0002';
    end if;

    select *
    into v_refund
    from public.merchant_billing_payment_refunds
    where id=v_recovery.refund_id
    for share;

    if not found
       or v_refund.status<>'review_required'
       or v_recovery.status='recovered' then
      raise exception 'REFUND_RECOVERY_NOT_PAYABLE' using errcode='40001';
    end if;

    select *
    into v_request
    from public.merchant_billing_payment_requests
    where refund_recovery_id=v_recovery.id
      and request_kind='refund_recovery'
      and status='pending'
    order by requested_at desc,id
    limit 1
    for update;

    if not found then
      v_correlation:=gen_random_uuid()::text;
      insert into public.merchant_billing_payment_requests(
        merchant_id,request_kind,refund_recovery_id,
        expected_amount_cents,merchant_reference,requested_by
      )
      values(
        p_merchant_id,'refund_recovery',v_recovery.id,
        v_recovery.amount_cents,
        'pix-auto:'||v_correlation,p_actor_user_id
      )
      returning * into v_request;
    end if;

    update public.merchant_billing_refund_recoveries
    set status='payment_pending',
        recovery_payment_request_id=v_request.id,
        updated_at=clock_timestamp()
    where id=v_recovery.id
      and status in ('open','payment_pending');
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

  if found
     and v_charge.status='active'
     and v_charge.expires_at is not null
     and v_charge.expires_at<=clock_timestamp() then
    update public.merchant_billing_provider_charges
    set status='expired',
        expired_at=coalesce(expired_at,expires_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where id=v_charge.id;

    v_charge.id:=null;
  end if;

  if v_charge.id is null then
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
    'refundRecoveryId',v_request.refund_recovery_id,
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
  uuid,uuid,text,uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_pix_charge_prepare(
  uuid,uuid,text,uuid,uuid,text,text
) to service_role,postgres;

create or replace function public.merchant_billing_pix_charge_prepare(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_plan_key text,
  p_statement_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language sql
security definer
set search_path=pg_catalog
as $$
  select public.merchant_billing_pix_charge_prepare(
    p_actor_user_id,p_merchant_id,p_plan_key,p_statement_id,
    null,p_idempotency_key,p_request_hash
  );
$$;

revoke all on function public.merchant_billing_pix_charge_prepare(
  uuid,uuid,text,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_pix_charge_prepare(
  uuid,uuid,text,uuid,text,text
) to service_role,postgres;

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
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_refund public.merchant_billing_payment_refunds%rowtype;
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
     or v_action.action_name<>
        'admin-ops:merchant-billing-payment-request:'||v_kind
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
        credit_balance_cents=
          credit_balance_cents+v_request.credit_grant_cents_snapshot,
        updated_at=clock_timestamp()
    where merchant_id=v_request.merchant_id;

    insert into public.merchant_fee_credit_ledger(
      merchant_id,entry_type,amount_cents,plan_key,
      reference,created_by,payment_request_id
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

  elsif v_request.request_kind='statement_payment' then
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
       or v_statement.amount_due_cents is distinct from
          v_request.expected_amount_cents then
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

  elsif v_request.request_kind='refund_recovery' then
    select rr.*
    into v_recovery
    from public.merchant_billing_refund_recoveries rr
    where rr.id=v_request.refund_recovery_id
      and rr.merchant_id=v_request.merchant_id
    for update;

    if not found
       or v_recovery.status<>'payment_pending'
       or v_recovery.recovery_payment_request_id is distinct from v_request.id
       or v_recovery.amount_cents is distinct from v_request.expected_amount_cents then
      raise exception 'REFUND_RECOVERY_TERMS_CHANGED' using errcode='40001';
    end if;

    select *
    into v_refund
    from public.merchant_billing_payment_refunds
    where id=v_recovery.refund_id
      and merchant_id=v_request.merchant_id
    for update;

    if not found or v_refund.status<>'review_required' then
      raise exception 'REFUND_RECOVERY_TERMS_CHANGED' using errcode='40001';
    end if;

    update public.merchant_billing_payment_requests
    set status='approved',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;

    update public.merchant_billing_refund_recoveries
    set status='recovered',
        recovered_by=p_actor_user_id,
        recovered_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=v_recovery.id;

    update public.merchant_billing_payment_refunds
    set status='resolved_recovered',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        resolution_reference=
          'recovery-payment-request:'||v_request.id::text,
        updated_at=clock_timestamp()
    where id=v_refund.id;

  else
    raise exception 'INVALID_PAYMENT_REQUEST_KIND' using errcode='40001';
  end if;

  perform public.process_merchant_billing_enforcement();

  v_result:=jsonb_build_object(
    'ok',true,
    'paymentRequestId',v_request.id,
    'requestKind',v_request.request_kind,
    'status',v_request.status,
    'merchantId',v_request.merchant_id,
    'refundRecoveryId',v_request.refund_recovery_id,
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
      'refundRecoveryId',v_request.refund_recovery_id,
      'expectedAmountCents',v_request.expected_amount_cents,
      'reference',v_reference
    )
  );

  return v_result;
end;
$$;

revoke all on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,text,text
) to service_role,postgres;

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
     or v_action.action_name<>
        'admin-ops:merchant-billing-refund:'||v_kind
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
    raise exception 'PAYMENT_REFUND_RECOVERY_PAYMENT_REQUIRED'
      using errcode='40001';
  end if;

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
