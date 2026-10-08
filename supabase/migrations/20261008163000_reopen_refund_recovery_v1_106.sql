
-- TAMÃO — Reopen refund recovery after recovery-payment refund v1.106
-- A PSP refund of a payment that had recovered an earlier refund MUST NOT
-- create "recovery of recovery" chains. It reopens the original immutable
-- recovery obligation only by the amount actually refunded, preserving the
-- original allocated amount and every historical payment request.

alter table public.merchant_billing_refund_recoveries
  add column if not exists outstanding_cents bigint;

update public.merchant_billing_refund_recoveries
set outstanding_cents=case
  when status='recovered' then 0
  else amount_cents
end
where outstanding_cents is null;

alter table public.merchant_billing_refund_recoveries
  alter column outstanding_cents set not null;

alter table public.merchant_billing_refund_recoveries
  drop constraint if exists merchant_billing_refund_recoveries_outstanding_check,
  add constraint merchant_billing_refund_recoveries_outstanding_check
    check (outstanding_cents>=0 and outstanding_cents<=amount_cents);

alter table public.merchant_billing_refund_recoveries
  drop constraint if exists merchant_billing_refund_recoveries_state_shape;

alter table public.merchant_billing_refund_recoveries
  add constraint merchant_billing_refund_recoveries_state_shape check (
    (status='open'
      and outstanding_cents>0
      and recovery_payment_request_id is null
      and recovered_by is null
      and recovered_at is null)
    or
    (status='payment_pending'
      and outstanding_cents>0
      and recovery_payment_request_id is not null
      and recovered_by is null
      and recovered_at is null)
    or
    (status='recovered'
      and outstanding_cents=0
      and recovery_payment_request_id is not null
      and recovered_by is not null
      and recovered_at is not null)
  );

create or replace function public.initialize_refund_recovery_outstanding()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
begin
  new.outstanding_cents:=new.amount_cents;
  return new;
end;
$function$;

revoke all on function public.initialize_refund_recovery_outstanding()
from public,anon,authenticated;
grant execute on function public.initialize_refund_recovery_outstanding()
to postgres,service_role;

drop trigger if exists aa_initialize_refund_recovery_outstanding_trg
on public.merchant_billing_refund_recoveries;
create trigger aa_initialize_refund_recovery_outstanding_trg
before insert
on public.merchant_billing_refund_recoveries
for each row execute function public.initialize_refund_recovery_outstanding();

drop index if exists public.merchant_billing_payment_requests_refund_recovery_live_uq;
create unique index merchant_billing_payment_requests_refund_recovery_live_uq
  on public.merchant_billing_payment_requests(refund_recovery_id)
  where refund_recovery_id is not null
    and status='pending';

alter table public.merchant_billing_payment_refunds
  add column if not exists reopened_refund_recovery_id uuid
    references public.merchant_billing_refund_recoveries(id) on delete restrict;

create index if not exists merchant_billing_payment_refunds_reopened_recovery_idx
  on public.merchant_billing_payment_refunds(reopened_refund_recovery_id)
  where reopened_refund_recovery_id is not null;

alter table public.merchant_billing_payment_refunds
  drop constraint if exists merchant_billing_payment_refunds_status_check,
  add constraint merchant_billing_payment_refunds_status_check check (
    status in (
      'review_required','resolved_recovered','ignored_unrelated',
      'resolved_excess','resolved_preapproval','resolved_recovery_reopened'
    )
  );

alter table public.merchant_billing_payment_refunds
  drop constraint if exists merchant_billing_payment_refunds_resolution_shape,
  add constraint merchant_billing_payment_refunds_resolution_shape check (
    (
      status='review_required'
      and resolved_at is null
      and resolved_by is null
      and resolution_reference is null
    )
    or
    (
      status in ('resolved_preapproval','resolved_recovery_reopened')
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
  );

alter table public.merchant_billing_payment_refunds
  drop constraint if exists merchant_billing_payment_refunds_reopen_shape,
  add constraint merchant_billing_payment_refunds_reopen_shape check (
    (
      status='resolved_recovery_reopened'
      and reopened_refund_recovery_id is not null
      and match_reason='refund_of_recovery_payment'
    )
    or
    (
      status<>'resolved_recovery_reopened'
      and reopened_refund_recovery_id is null
    )
  );

create or replace function public.normalize_refund_recovery_payment_request_amount()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
begin
  if new.request_kind<>'refund_recovery' or new.refund_recovery_id is null then
    return new;
  end if;

  select *
  into v_recovery
  from public.merchant_billing_refund_recoveries
  where id=new.refund_recovery_id
    and merchant_id=new.merchant_id
  for share;

  if not found
     or v_recovery.status not in ('open','payment_pending')
     or v_recovery.outstanding_cents<=0 then
    raise exception 'INVALID_REFUND_RECOVERY_REQUEST'
      using errcode='40001';
  end if;

  new.expected_amount_cents:=v_recovery.outstanding_cents;
  return new;
end;
$function$;

revoke all on function public.normalize_refund_recovery_payment_request_amount()
from public,anon,authenticated;
grant execute on function public.normalize_refund_recovery_payment_request_amount()
to postgres,service_role;

drop trigger if exists aa_normalize_refund_recovery_payment_request_amount_trg
on public.merchant_billing_payment_requests;
create trigger aa_normalize_refund_recovery_payment_request_amount_trg
before insert
on public.merchant_billing_payment_requests
for each row execute function public.normalize_refund_recovery_payment_request_amount();

create or replace function public.resolve_refund_of_recovery_payment()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_request public.merchant_billing_payment_requests%rowtype;
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_original_refund public.merchant_billing_payment_refunds%rowtype;
  v_new_outstanding bigint;
begin
  if new.status<>'review_required'
     or new.payment_request_id is null
     or new.merchant_id is null then
    return new;
  end if;

  select *
  into v_request
  from public.merchant_billing_payment_requests
  where id=new.payment_request_id
    and merchant_id=new.merchant_id
  for update;

  if not found
     or v_request.request_kind<>'refund_recovery'
     or v_request.refund_recovery_id is null
     or v_request.status<>'approved' then
    return new;
  end if;

  select *
  into v_recovery
  from public.merchant_billing_refund_recoveries
  where id=v_request.refund_recovery_id
    and merchant_id=new.merchant_id
  for update;

  if not found
     or v_recovery.currency is distinct from new.currency
     or new.original_payment_amount_cents is distinct from
        v_request.expected_amount_cents then
    raise exception 'REFUND_RECOVERY_REOPEN_PARENT_MISMATCH'
      using errcode='40001';
  end if;

  if new.recoverable_amount_cents is null
     or new.excess_amount_cents is null
     or new.recoverable_amount_cents+new.excess_amount_cents<>new.amount_cents then
    raise exception 'REFUND_RECOVERY_REOPEN_ALLOCATION_INVALID'
      using errcode='40001';
  end if;

  v_new_outstanding:=least(
    v_recovery.amount_cents,
    v_recovery.outstanding_cents+new.recoverable_amount_cents
  );

  select *
  into v_original_refund
  from public.merchant_billing_payment_refunds
  where id=v_recovery.refund_id
    and merchant_id=new.merchant_id
  for update;

  if not found then
    raise exception 'REFUND_RECOVERY_ORIGINAL_REFUND_NOT_FOUND'
      using errcode='P0002';
  end if;

  if new.recoverable_amount_cents>0 then
    update public.merchant_billing_refund_recoveries
    set outstanding_cents=v_new_outstanding,
        status=case
          when status='payment_pending' and recovery_payment_request_id is not null
            then 'payment_pending'
          else 'open'
        end,
        recovery_payment_request_id=case
          when status='payment_pending' then recovery_payment_request_id
          else null
        end,
        recovered_by=null,
        recovered_at=null,
        updated_at=clock_timestamp()
    where id=v_recovery.id
    returning * into v_recovery;

    update public.merchant_billing_payment_refunds
    set status='review_required',
        resolved_by=null,
        resolved_at=null,
        resolution_reference=null,
        updated_at=clock_timestamp()
    where id=v_original_refund.id;
  end if;

  new.status:='resolved_recovery_reopened';
  new.reopened_refund_recovery_id:=v_recovery.id;
  new.match_reason:='refund_of_recovery_payment';
  new.resolved_by:=null;
  new.resolved_at:=clock_timestamp();
  new.resolution_reference:=
    'reopened-refund-recovery:'||v_recovery.id::text||':'||new.provider_event_id;

  perform public.process_merchant_billing_enforcement();
  return new;
end;
$function$;

revoke all on function public.resolve_refund_of_recovery_payment()
from public,anon,authenticated;
grant execute on function public.resolve_refund_of_recovery_payment()
to postgres,service_role;

drop trigger if exists zy_resolve_refund_of_recovery_payment_trg
on public.merchant_billing_payment_refunds;
create trigger zy_resolve_refund_of_recovery_payment_trg
before insert or update
on public.merchant_billing_payment_refunds
for each row execute function public.resolve_refund_of_recovery_payment();


CREATE OR REPLACE FUNCTION public.derive_provider_refund_allocation_split()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_allocated_elsewhere bigint:=0;
  v_remaining bigint:=0;
  v_recoverable bigint:=0;
  v_request public.merchant_billing_payment_requests%rowtype;
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

  select *
  into v_request
  from public.merchant_billing_payment_requests
  where id=new.payment_request_id;

  if not found then
    raise exception 'REFUND_ALLOCATION_PAYMENT_REQUEST_NOT_FOUND'
      using errcode='P0002';
  end if;

  if v_request.request_kind='refund_recovery' then
    select coalesce(sum(r.recoverable_amount_cents),0)
    into v_allocated_elsewhere
    from public.merchant_billing_payment_refunds r
    where r.payment_request_id=new.payment_request_id
      and r.id is distinct from new.id
      and r.recoverable_amount_cents is not null;
  else
    select coalesce(sum(rr.amount_cents),0)
    into v_allocated_elsewhere
    from public.merchant_billing_refund_recoveries rr
    where rr.original_payment_request_id=new.payment_request_id
      and rr.refund_id is distinct from new.id;
  end if;

  v_remaining:=greatest(
    new.original_payment_amount_cents-v_allocated_elsewhere,
    0
  );
  v_recoverable:=least(new.amount_cents,v_remaining);

  new.recoverable_amount_cents:=v_recoverable;
  new.excess_amount_cents:=new.amount_cents-v_recoverable;

  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.block_new_payment_request_during_provider_refund_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      and rr.outstanding_cents=new.expected_amount_cents
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
$function$;


CREATE OR REPLACE FUNCTION public.guard_provider_refund_fact_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

  -- Ingestion may enrich a previously unlinked immutable PSP fact exactly once.
  if old.status='review_required'
     and old.payment_event_id is null
     and old.payment_request_id is null
     and old.merchant_id is null
     and old.original_payment_amount_cents is null
     and old.cumulative_refunded_cents is null
     and old.recoverable_amount_cents is null
     and old.excess_amount_cents is null
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
     or new.recoverable_amount_cents is distinct from old.recoverable_amount_cents
     or new.excess_amount_cents is distinct from old.excess_amount_cents
     or new.reopened_refund_recovery_id is distinct from old.reopened_refund_recovery_id
     or new.match_reason is distinct from old.match_reason then
    raise exception 'PROVIDER_REFUND_FACT_IMMUTABLE' using errcode='23514';
  end if;

  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.require_refund_recovery_allocation_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_refund_id uuid;
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_parent public.merchant_billing_refund_recoveries%rowtype;
  v_original_refund public.merchant_billing_payment_refunds%rowtype;
begin
  v_refund_id:=case
    when tg_table_name='merchant_billing_payment_refunds'
      then nullif(to_jsonb(new)->>'id','')::uuid
    else nullif(to_jsonb(new)->>'refund_id','')::uuid
  end;

  select *
  into v_refund
  from public.merchant_billing_payment_refunds
  where id=v_refund_id;

  if not found then
    raise exception 'REFUND_ALLOCATION_REFUND_NOT_FOUND'
      using errcode='P0002';
  end if;

  select *
  into v_recovery
  from public.merchant_billing_refund_recoveries
  where refund_id=v_refund.id;

  if v_refund.payment_request_id is null then
    if found then
      raise exception 'REFUND_ALLOCATION_UNLINKED_HAS_RECOVERY'
        using errcode='23514';
    end if;
    return new;
  end if;

  if v_refund.recoverable_amount_cents is null
     or v_refund.excess_amount_cents is null
     or v_refund.recoverable_amount_cents+v_refund.excess_amount_cents
        <>v_refund.amount_cents then
    raise exception 'REFUND_ALLOCATION_SPLIT_INVALID'
      using errcode='23514';
  end if;

  if v_refund.status='resolved_recovery_reopened' then
    if found then
      raise exception 'REFUND_RECOVERY_REOPEN_CREATED_NESTED_OBLIGATION'
        using errcode='23514';
    end if;

    if v_refund.reopened_refund_recovery_id is null
       or v_refund.match_reason<>'refund_of_recovery_payment'
       or v_refund.resolved_at is null
       or v_refund.resolved_by is not null
       or v_refund.resolution_reference is null then
      raise exception 'REFUND_RECOVERY_REOPEN_SHAPE_INVALID'
        using errcode='23514';
    end if;

    select *
    into v_request
    from public.merchant_billing_payment_requests
    where id=v_refund.payment_request_id;

    if not found
       or v_request.request_kind<>'refund_recovery'
       or v_request.status<>'approved'
       or v_request.refund_recovery_id is distinct from
          v_refund.reopened_refund_recovery_id
       or v_request.merchant_id is distinct from v_refund.merchant_id
       or v_request.expected_amount_cents is distinct from
          v_refund.original_payment_amount_cents then
      raise exception 'REFUND_RECOVERY_REOPEN_PAYMENT_REQUEST_MISMATCH'
        using errcode='23514';
    end if;

    select *
    into v_parent
    from public.merchant_billing_refund_recoveries
    where id=v_refund.reopened_refund_recovery_id;

    if not found
       or v_parent.merchant_id is distinct from v_refund.merchant_id
       or v_parent.currency is distinct from v_refund.currency
       or v_parent.outstanding_cents<0
       or v_parent.outstanding_cents>v_parent.amount_cents then
      raise exception 'REFUND_RECOVERY_REOPEN_PARENT_MISMATCH'
        using errcode='23514';
    end if;

    select *
    into v_original_refund
    from public.merchant_billing_payment_refunds
    where id=v_parent.refund_id;

    if not found
       or v_original_refund.merchant_id is distinct from v_refund.merchant_id
       or not (
         (
           v_parent.outstanding_cents>0
           and v_parent.status in ('open','payment_pending')
           and v_original_refund.status='review_required'
         )
         or
         (
           v_parent.outstanding_cents=0
           and v_parent.status='recovered'
           and v_original_refund.status='resolved_recovered'
         )
       ) then
      raise exception 'REFUND_RECOVERY_REOPEN_ORIGINAL_REFUND_STATE_INVALID'
        using errcode='23514';
    end if;

    return new;
  end if;

  if v_refund.reopened_refund_recovery_id is not null then
    raise exception 'REFUND_RECOVERY_REOPEN_LINK_ON_OTHER_STATUS'
      using errcode='23514';
  end if;

  if v_refund.recoverable_amount_cents>0 then
    if not found
       or v_recovery.merchant_id is distinct from v_refund.merchant_id
       or v_recovery.original_payment_request_id is distinct from v_refund.payment_request_id
       or v_recovery.amount_cents is distinct from v_refund.recoverable_amount_cents
       or v_recovery.currency is distinct from v_refund.currency then
      raise exception 'REFUND_ALLOCATION_RECOVERY_MISMATCH'
        using errcode='23514';
    end if;
  elsif found then
    raise exception 'REFUND_ALLOCATION_ZERO_EXPOSURE_HAS_RECOVERY'
      using errcode='23514';
  end if;

  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.admin_merchant_billing_payment_request_action(p_actor_user_id uuid, p_payment_request_id uuid, p_action text, p_reference text, p_idempotency_key text, p_request_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
       or v_request.expected_amount_cents<=0
       or v_request.expected_amount_cents>v_recovery.outstanding_cents then
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
    set outstanding_cents=outstanding_cents-v_request.expected_amount_cents,
        status=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then 'recovered'
          else 'open'
        end,
        recovery_payment_request_id=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then v_request.id
          else null
        end,
        recovered_by=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then p_actor_user_id
          else null
        end,
        recovered_at=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then clock_timestamp()
          else null
        end,
        updated_at=clock_timestamp()
    where id=v_recovery.id
    returning * into v_recovery;

    if v_recovery.outstanding_cents=0 then
      update public.merchant_billing_payment_refunds
      set status='resolved_recovered',
          resolved_by=p_actor_user_id,
          resolved_at=clock_timestamp(),
          resolution_reference=
            'recovery-payment-request:'||v_request.id::text,
          updated_at=clock_timestamp()
      where id=v_refund.id;
    else
      update public.merchant_billing_payment_refunds
      set status='review_required',
          resolved_by=null,
          resolved_at=null,
          resolution_reference=null,
          updated_at=clock_timestamp()
      where id=v_refund.id;
    end if;

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
$function$;


CREATE OR REPLACE FUNCTION public.admin_merchant_billing_metrics(p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_role text;
  v_account_count bigint:=0;
  v_prepaid_account_count bigint:=0;
  v_flex_account_count bigint:=0;
  v_hold_count bigint:=0;
  v_credit_balance bigint:=0;
  v_credit_reserved bigint:=0;
  v_credit_available bigint:=0;
  v_open_statement_count bigint:=0;
  v_open_statement_cents bigint:=0;
  v_overdue_statement_count bigint:=0;
  v_overdue_statement_cents bigint:=0;
  v_due_24h_count bigint:=0;
  v_due_24h_cents bigint:=0;
  v_pending_count bigint:=0;
  v_pending_cents bigint:=0;
  v_pending_package_count bigint:=0;
  v_pending_package_cents bigint:=0;
  v_pending_statement_count bigint:=0;
  v_pending_statement_cents bigint:=0;
  v_pending_recovery_count bigint:=0;
  v_pending_recovery_cents bigint:=0;
  v_recovery_outstanding_count bigint:=0;
  v_recovery_outstanding_cents bigint:=0;
  v_recovery_open_count bigint:=0;
  v_recovery_open_cents bigint:=0;
  v_recovery_payment_pending_count bigint:=0;
  v_recovery_payment_pending_cents bigint:=0;
  v_recovery_oldest_open timestamptz;
  v_recovery_open_over_24h_count bigint:=0;
  v_recovery_open_over_24h_cents bigint:=0;
  v_oldest_pending timestamptz;
  v_pending_under_1h_count bigint:=0;
  v_pending_1_4h_count bigint:=0;
  v_pending_4_24h_count bigint:=0;
  v_pending_over_24h_count bigint:=0;
  v_pending_over_24h_cents bigint:=0;
  v_matched_count bigint:=0;
  v_matched_cents bigint:=0;
  v_matched_over_2h_count bigint:=0;
  v_matched_over_2h_cents bigint:=0;
  v_oldest_matched timestamptz;
  v_review_event_count bigint:=0;
  v_review_event_over_4h_count bigint:=0;
  v_oldest_review_event timestamptz;
  v_pending_unmatched_over_24h_count bigint:=0;
  v_sla_breach_count bigint:=0;
  v_plan_mix jsonb:='[]'::jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance','readonly') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  select
    count(*),
    count(*) filter (where p.billing_mode='prepaid_credit'),
    count(*) filter (where p.billing_mode='postpaid_daily'),
    count(*) filter (where a.sales_hold),
    coalesce(sum(a.credit_balance_cents),0),
    coalesce(sum(a.credit_reserved_cents),0),
    coalesce(sum(greatest(a.credit_balance_cents-a.credit_reserved_cents,0)),0)
  into
    v_account_count,
    v_prepaid_account_count,
    v_flex_account_count,
    v_hold_count,
    v_credit_balance,
    v_credit_reserved,
    v_credit_available
  from public.merchant_billing_accounts a
  left join public.merchant_billing_plans p on p.plan_key=a.plan_key;

  select
    count(*) filter (where status in ('open','overdue')),
    coalesce(sum(amount_due_cents) filter (where status in ('open','overdue')),0),
    count(*) filter (
      where status='overdue'
         or (status='open' and due_at<clock_timestamp())
    ),
    coalesce(sum(amount_due_cents) filter (
      where status='overdue'
         or (status='open' and due_at<clock_timestamp())
    ),0),
    count(*) filter (
      where status='open'
        and due_at>=clock_timestamp()
        and due_at<=clock_timestamp()+interval '24 hours'
    ),
    coalesce(sum(amount_due_cents) filter (
      where status='open'
        and due_at>=clock_timestamp()
        and due_at<=clock_timestamp()+interval '24 hours'
    ),0)
  into
    v_open_statement_count,
    v_open_statement_cents,
    v_overdue_statement_count,
    v_overdue_statement_cents,
    v_due_24h_count,
    v_due_24h_cents
  from public.merchant_daily_statements;

  select
    count(*) filter (where status='pending'),
    coalesce(sum(expected_amount_cents) filter (where status='pending'),0),
    count(*) filter (
      where status='pending' and request_kind='package_purchase'
    ),
    coalesce(sum(expected_amount_cents) filter (
      where status='pending' and request_kind='package_purchase'
    ),0),
    count(*) filter (
      where status='pending' and request_kind='statement_payment'
    ),
    coalesce(sum(expected_amount_cents) filter (
      where status='pending' and request_kind='statement_payment'
    ),0),
    count(*) filter (
      where status='pending' and request_kind='refund_recovery'
    ),
    coalesce(sum(expected_amount_cents) filter (
      where status='pending' and request_kind='refund_recovery'
    ),0),
    min(requested_at) filter (where status='pending'),
    count(*) filter (
      where status='pending'
        and requested_at>clock_timestamp()-interval '1 hour'
    ),
    count(*) filter (
      where status='pending'
        and requested_at<=clock_timestamp()-interval '1 hour'
        and requested_at>clock_timestamp()-interval '4 hours'
    ),
    count(*) filter (
      where status='pending'
        and requested_at<=clock_timestamp()-interval '4 hours'
        and requested_at>clock_timestamp()-interval '24 hours'
    ),
    count(*) filter (
      where status='pending'
        and requested_at<=clock_timestamp()-interval '24 hours'
    ),
    coalesce(sum(expected_amount_cents) filter (
      where status='pending'
        and requested_at<=clock_timestamp()-interval '24 hours'
    ),0)
  into
    v_pending_count,
    v_pending_cents,
    v_pending_package_count,
    v_pending_package_cents,
    v_pending_statement_count,
    v_pending_statement_cents,
    v_pending_recovery_count,
    v_pending_recovery_cents,
    v_oldest_pending,
    v_pending_under_1h_count,
    v_pending_1_4h_count,
    v_pending_4_24h_count,
    v_pending_over_24h_count,
    v_pending_over_24h_cents
  from public.merchant_billing_payment_requests;

  select
    count(*) filter (
      where status in ('open','payment_pending')
        and outstanding_cents>0
    ),
    coalesce(sum(outstanding_cents) filter (
      where status in ('open','payment_pending')
        and outstanding_cents>0
    ),0),
    count(*) filter (where status='open' and outstanding_cents>0),
    coalesce(sum(outstanding_cents) filter (
      where status='open' and outstanding_cents>0
    ),0),
    count(*) filter (where status='payment_pending' and outstanding_cents>0),
    coalesce(sum(outstanding_cents) filter (
      where status='payment_pending' and outstanding_cents>0
    ),0),
    min(updated_at) filter (where status='open' and outstanding_cents>0),
    count(*) filter (
      where status='open'
        and outstanding_cents>0
        and updated_at<=clock_timestamp()-interval '24 hours'
    ),
    coalesce(sum(outstanding_cents) filter (
      where status='open'
        and outstanding_cents>0
        and updated_at<=clock_timestamp()-interval '24 hours'
    ),0)
  into
    v_recovery_outstanding_count,
    v_recovery_outstanding_cents,
    v_recovery_open_count,
    v_recovery_open_cents,
    v_recovery_payment_pending_count,
    v_recovery_payment_pending_cents,
    v_recovery_oldest_open,
    v_recovery_open_over_24h_count,
    v_recovery_open_over_24h_cents
  from public.merchant_billing_refund_recoveries;

  select
    count(*),
    coalesce(sum(r.expected_amount_cents),0),
    count(*) filter (
      where e.updated_at<=clock_timestamp()-interval '2 hours'
    ),
    coalesce(sum(r.expected_amount_cents) filter (
      where e.updated_at<=clock_timestamp()-interval '2 hours'
    ),0),
    min(e.updated_at)
  into
    v_matched_count,
    v_matched_cents,
    v_matched_over_2h_count,
    v_matched_over_2h_cents,
    v_oldest_matched
  from public.merchant_billing_payment_events e
  join public.merchant_billing_payment_requests r
    on r.id=e.payment_request_id
  where e.status='matched_exact'
    and r.status='pending';

  select
    count(*),
    count(*) filter (
      where updated_at<=clock_timestamp()-interval '4 hours'
    ),
    min(updated_at)
  into
    v_review_event_count,
    v_review_event_over_4h_count,
    v_oldest_review_event
  from public.merchant_billing_payment_events
  where status='review_required';

  select count(*)
  into v_pending_unmatched_over_24h_count
  from public.merchant_billing_payment_requests r
  where r.status='pending'
    and r.requested_at<=clock_timestamp()-interval '24 hours'
    and not exists(
      select 1
      from public.merchant_billing_payment_events e
      where e.payment_request_id=r.id
        and e.status='matched_exact'
    );

  v_sla_breach_count:=
    v_matched_over_2h_count
    +v_review_event_over_4h_count
    +v_pending_unmatched_over_24h_count
    +v_recovery_open_over_24h_count;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'planKey',x.plan_key,
        'displayName',x.display_name,
        'billingMode',x.billing_mode,
        'platformFeeBps',x.platform_fee_bps,
        'accountCount',x.account_count,
        'creditBalanceCents',x.credit_balance_cents,
        'creditReservedCents',x.credit_reserved_cents
      )
      order by x.sort_order,x.plan_key
    ),
    '[]'::jsonb
  )
  into v_plan_mix
  from (
    select
      p.plan_key,
      p.display_name,
      p.billing_mode,
      p.platform_fee_bps,
      p.sort_order,
      count(a.merchant_id)::bigint as account_count,
      coalesce(sum(a.credit_balance_cents),0)::bigint as credit_balance_cents,
      coalesce(sum(a.credit_reserved_cents),0)::bigint as credit_reserved_cents
    from public.merchant_billing_plans p
    left join public.merchant_billing_accounts a on a.plan_key=p.plan_key
    where p.active
    group by
      p.plan_key,p.display_name,p.billing_mode,p.platform_fee_bps,p.sort_order
  ) x;

  return jsonb_build_object(
    'generatedAt',clock_timestamp(),
    'accountCount',v_account_count,
    'prepaidAccountCount',v_prepaid_account_count,
    'flexAccountCount',v_flex_account_count,
    'salesHoldCount',v_hold_count,
    'prepaidCreditBalanceCents',v_credit_balance,
    'prepaidCreditReservedCents',v_credit_reserved,
    'prepaidCreditAvailableCents',v_credit_available,
    'openStatementCount',v_open_statement_count,
    'openStatementCents',v_open_statement_cents,
    'overdueStatementCount',v_overdue_statement_count,
    'overdueStatementCents',v_overdue_statement_cents,
    'dueWithin24hCount',v_due_24h_count,
    'dueWithin24hCents',v_due_24h_cents,
    'pendingPaymentCount',v_pending_count,
    'pendingPaymentCents',v_pending_cents,
    'pendingPackageCount',v_pending_package_count,
    'pendingPackageCents',v_pending_package_cents,
    'pendingStatementPaymentCount',v_pending_statement_count,
    'pendingStatementPaymentCents',v_pending_statement_cents,
    'pendingRefundRecoveryCount',v_pending_recovery_count,
    'pendingRefundRecoveryCents',v_pending_recovery_cents,
    'refundRecoveryOutstandingCount',v_recovery_outstanding_count,
    'refundRecoveryOutstandingCents',v_recovery_outstanding_cents,
    'refundRecoveryOpenCount',v_recovery_open_count,
    'refundRecoveryOpenCents',v_recovery_open_cents,
    'refundRecoveryPaymentPendingCount',v_recovery_payment_pending_count,
    'refundRecoveryPaymentPendingCents',v_recovery_payment_pending_cents,
    'refundRecoveryOldestOpenAt',v_recovery_oldest_open,
    'oldestPendingRequestedAt',v_oldest_pending,
    'pendingAgeBuckets',jsonb_build_object(
      'under1hCount',v_pending_under_1h_count,
      'from1To4hCount',v_pending_1_4h_count,
      'from4To24hCount',v_pending_4_24h_count,
      'over24hCount',v_pending_over_24h_count,
      'over24hCents',v_pending_over_24h_cents
    ),
    'queueSla',jsonb_build_object(
      'matchedApprovalTargetHours',2,
      'eventReviewTargetHours',4,
      'pendingEscalationHours',24,
      'matchedAwaitingApprovalCount',v_matched_count,
      'matchedAwaitingApprovalCents',v_matched_cents,
      'matchedApprovalBreachCount',v_matched_over_2h_count,
      'matchedApprovalBreachCents',v_matched_over_2h_cents,
      'oldestMatchedAt',v_oldest_matched,
      'reviewEventCount',v_review_event_count,
      'reviewEventBreachCount',v_review_event_over_4h_count,
      'oldestReviewEventAt',v_oldest_review_event,
      'pendingUnmatchedOver24hCount',v_pending_unmatched_over_24h_count,
      'refundRecoveryOpenTargetHours',24,
      'refundRecoveryOpenBreachCount',v_recovery_open_over_24h_count,
      'refundRecoveryOpenBreachCents',v_recovery_open_over_24h_cents,
      'breachCount',v_sla_breach_count
    ),
    'planMix',v_plan_mix
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.admin_merchant_billing_reconciliation(p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_role text;
  v_issue_count bigint:=0;
  v_critical_count bigint:=0;
  v_warning_count bigint:=0;
  v_stale_pending_count bigint:=0;
  v_matched_sla_breach_count bigint:=0;
  v_event_review_sla_breach_count bigint:=0;
  v_refund_recovery_sla_breach_count bigint:=0;
  v_finance_sla_breach_count bigint:=0;
  v_oldest_stale timestamptz;
  v_oldest_finance_sla timestamptz;
  v_issues jsonb:='[]'::jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance','readonly') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  with
  ledger_balance as (
    select
      merchant_id,
      coalesce(sum(
        case
          when entry_type in ('package_credit','fee_consumption','admin_adjustment')
            then amount_cents
          else 0
        end
      ),0)::bigint as expected_balance_cents
    from public.merchant_fee_credit_ledger
    group by merchant_id
  ),
  order_reservations as (
    select
      merchant_id,
      coalesce(sum(prepaid_fee_reserved_cents_snapshot),0)::bigint
        as expected_reserved_cents
    from public.orders
    where prepaid_fee_reserved_cents_snapshot>0
      and prepaid_fee_credit_consumed_at is null
      and prepaid_fee_credit_released_at is null
      and status<>'CANCELLED'
    group by merchant_id
  ),
  refund_recovery_expected as (
    select
      r.id as refund_id,
      r.merchant_id,
      r.payment_request_id as original_payment_request_id,
      r.amount_cents as refund_amount_cents,
      r.currency,
      r.match_reason,
      greatest(
        least(
          r.amount_cents,
          coalesce(r.original_payment_amount_cents,0)
          -coalesce((
            select sum(rr2.amount_cents)
            from public.merchant_billing_refund_recoveries rr2
            where rr2.original_payment_request_id=r.payment_request_id
              and rr2.refund_id<>r.id
          ),0)
        ),
        0
      )::bigint as expected_recovery_cents
    from public.merchant_billing_payment_refunds r
    where r.status='review_required'
      and r.merchant_id is not null
      and r.payment_request_id is not null
  ),
  issue_rows as (
    select
      'critical'::text as severity,
      'account_ledger_balance_mismatch'::text as issue_type,
      a.merchant_id,
      a.merchant_id::text as entity_id,
      coalesce(l.expected_balance_cents,0)::bigint as expected_cents,
      a.credit_balance_cents::bigint as actual_cents,
      null::numeric as age_hours
    from public.merchant_billing_accounts a
    left join ledger_balance l on l.merchant_id=a.merchant_id
    where a.credit_balance_cents is distinct from coalesce(l.expected_balance_cents,0)

    union all

    select
      'critical','account_reserved_order_mismatch',
      a.merchant_id,a.merchant_id::text,
      coalesce(r.expected_reserved_cents,0)::bigint,
      a.credit_reserved_cents::bigint,
      null::numeric
    from public.merchant_billing_accounts a
    left join order_reservations r on r.merchant_id=a.merchant_id
    where a.credit_reserved_cents is distinct from coalesce(r.expected_reserved_cents,0)

    union all

    select
      'critical','flex_with_prepaid_credit',
      a.merchant_id,a.merchant_id::text,
      0::bigint,
      (a.credit_balance_cents+a.credit_reserved_cents)::bigint,
      null::numeric
    from public.merchant_billing_accounts a
    join public.merchant_billing_plans p on p.plan_key=a.plan_key
    where p.billing_mode='postpaid_daily'
      and (a.credit_balance_cents>0 or a.credit_reserved_cents>0)

    union all

    select
      'critical','approved_package_without_ledger_credit',
      r.merchant_id,r.id::text,
      r.credit_grant_cents_snapshot::bigint,
      coalesce(l.amount_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-r.resolved_at))/3600
    from public.merchant_billing_payment_requests r
    left join public.merchant_fee_credit_ledger l
      on l.payment_request_id=r.id
     and l.entry_type='package_credit'
    where r.request_kind='package_purchase'
      and r.status='approved'
      and (
        l.id is null
        or l.merchant_id is distinct from r.merchant_id
        or l.amount_cents is distinct from r.credit_grant_cents_snapshot
      )

    union all

    select
      'critical','linked_package_credit_not_approved',
      l.merchant_id,l.id::text,
      coalesce(r.credit_grant_cents_snapshot,0)::bigint,
      l.amount_cents::bigint,
      null::numeric
    from public.merchant_fee_credit_ledger l
    left join public.merchant_billing_payment_requests r
      on r.id=l.payment_request_id
    where l.entry_type='package_credit'
      and l.payment_request_id is not null
      and (
        r.id is null
        or r.status<>'approved'
        or r.request_kind<>'package_purchase'
        or r.merchant_id is distinct from l.merchant_id
        or r.credit_grant_cents_snapshot is distinct from l.amount_cents
      )

    union all

    select
      'critical','approved_statement_not_paid',
      r.merchant_id,r.id::text,
      r.expected_amount_cents::bigint,
      coalesce(s.amount_due_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-r.resolved_at))/3600
    from public.merchant_billing_payment_requests r
    left join public.merchant_daily_statements s on s.id=r.statement_id
    where r.request_kind='statement_payment'
      and r.status='approved'
      and (
        s.id is null
        or s.merchant_id is distinct from r.merchant_id
        or s.status<>'paid'
        or s.amount_due_cents is distinct from r.expected_amount_cents
      )

    union all

    select
      'warning','pending_statement_terms_changed',
      r.merchant_id,r.id::text,
      r.expected_amount_cents::bigint,
      coalesce(s.amount_due_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-r.requested_at))/3600
    from public.merchant_billing_payment_requests r
    left join public.merchant_daily_statements s on s.id=r.statement_id
    where r.request_kind='statement_payment'
      and r.status='pending'
      and (
        s.id is null
        or s.merchant_id is distinct from r.merchant_id
        or s.status not in ('open','overdue')
        or s.amount_due_cents is distinct from r.expected_amount_cents
      )

    union all

    select
      'critical','resolved_statement_has_open_receivable',
      s.merchant_id,s.id::text,
      0::bigint,
      coalesce(sum(
        greatest(pr.platform_fee_cents-pr.prepaid_credit_applied_cents,0)
      ) filter (where pr.status='open'),0)::bigint,
      null::numeric
    from public.merchant_daily_statements s
    join public.platform_receivables pr on pr.daily_statement_id=s.id
    where s.status in ('paid','waived')
    group by s.id,s.merchant_id
    having count(*) filter (
      where pr.status='open'
        and pr.platform_fee_cents-pr.prepaid_credit_applied_cents>0
    )>0

    union all

    select
      'warning','overdue_without_sales_hold',
      s.merchant_id,s.id::text,
      s.amount_due_cents::bigint,
      0::bigint,
      extract(epoch from (clock_timestamp()-s.due_at))/3600
    from public.merchant_daily_statements s
    join public.merchant_billing_accounts a on a.merchant_id=s.merchant_id
    where s.status='overdue'
      and s.amount_due_cents>0
      and not a.sales_hold

    union all

    select
      'warning','sales_hold_without_overdue_statement',
      a.merchant_id,a.merchant_id::text,
      0::bigint,
      0::bigint,
      case when a.sales_hold_at is null then null
        else extract(epoch from (clock_timestamp()-a.sales_hold_at))/3600
      end
    from public.merchant_billing_accounts a
    where a.sales_hold
      and a.sales_hold_reason='daily_statement_overdue'
      and not exists(
        select 1
        from public.merchant_daily_statements s
        where s.merchant_id=a.merchant_id
          and s.status='overdue'
          and s.amount_due_cents>0
      )

    union all

    select
      'critical','refund_review_recovery_mismatch',
      x.merchant_id,x.refund_id::text,
      x.expected_recovery_cents::bigint,
      coalesce(rr.amount_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-r.created_at))/3600
    from refund_recovery_expected x
    join public.merchant_billing_payment_refunds r
      on r.id=x.refund_id
    left join public.merchant_billing_refund_recoveries rr
      on rr.refund_id=x.refund_id
    where (
      x.expected_recovery_cents>0
      and (
        rr.id is null
        or rr.merchant_id is distinct from x.merchant_id
        or rr.original_payment_request_id is distinct from x.original_payment_request_id
        or rr.amount_cents is distinct from x.expected_recovery_cents
        or rr.currency is distinct from x.currency
        or rr.status not in ('open','payment_pending')
      )
    )
    or (
      x.expected_recovery_cents=0
      and rr.id is not null
    )

    union all

    select
      'critical','refund_recovery_exposure_cap_exceeded',
      rr.merchant_id,rr.original_payment_request_id::text,
      max(r.original_payment_amount_cents)::bigint,
      sum(rr.amount_cents)::bigint,
      null::numeric
    from public.merchant_billing_refund_recoveries rr
    join public.merchant_billing_payment_refunds r
      on r.id=rr.refund_id
    group by rr.merchant_id,rr.original_payment_request_id
    having sum(rr.amount_cents)>max(r.original_payment_amount_cents)

    union all

    select
      'critical','resolved_excess_with_recovery_obligation',
      r.merchant_id,r.id::text,
      0::bigint,
      coalesce(rr.amount_cents,0)::bigint,
      case when r.resolved_at is null then null
        else extract(epoch from (clock_timestamp()-r.resolved_at))/3600
      end
    from public.merchant_billing_payment_refunds r
    left join public.merchant_billing_refund_recoveries rr
      on rr.refund_id=r.id
    where r.status='resolved_excess'
      and (
        r.match_reason<>'refund_total_exceeds_original'
        or r.payment_request_id is null
        or r.merchant_id is null
        or rr.id is not null
      )

    union all

    select
      'critical','refund_recovery_request_mismatch',
      rr.merchant_id,rr.id::text,
      rr.outstanding_cents::bigint,
      coalesce(pr.expected_amount_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-rr.updated_at))/3600
    from public.merchant_billing_refund_recoveries rr
    left join public.merchant_billing_payment_requests pr
      on pr.id=rr.recovery_payment_request_id
    where (
      rr.status='payment_pending'
      and (
        pr.id is null
        or pr.request_kind<>'refund_recovery'
        or pr.refund_recovery_id is distinct from rr.id
        or pr.merchant_id is distinct from rr.merchant_id
        or (pr.expected_amount_cents<=0 or pr.expected_amount_cents>rr.outstanding_cents)
        or pr.status<>'pending'
      )
    )
    or (
      rr.status='recovered'
      and (
        pr.id is null
        or pr.request_kind<>'refund_recovery'
        or pr.refund_recovery_id is distinct from rr.id
        or pr.merchant_id is distinct from rr.merchant_id
        or rr.outstanding_cents<>0
        or pr.status<>'approved'
      )
    )

    union all

    select
      'critical','resolved_refund_without_recovered_obligation',
      r.merchant_id,r.id::text,
      r.amount_cents::bigint,
      coalesce(rr.amount_cents,0)::bigint,
      case when r.resolved_at is null then null
        else extract(epoch from (clock_timestamp()-r.resolved_at))/3600
      end
    from public.merchant_billing_payment_refunds r
    left join public.merchant_billing_refund_recoveries rr
      on rr.refund_id=r.id
    left join public.merchant_billing_payment_requests pr
      on pr.id=rr.recovery_payment_request_id
    where r.status='resolved_recovered'
      and (
        rr.id is null
        or rr.status<>'recovered'
        or pr.id is null
        or pr.status<>'approved'
        or pr.request_kind<>'refund_recovery'
        or r.resolution_reference is distinct from
          'recovery-payment-request:'||pr.id::text
      )

    union all

    select
      'critical','recovered_obligation_refund_not_resolved',
      rr.merchant_id,rr.id::text,
      rr.amount_cents::bigint,
      r.amount_cents::bigint,
      extract(epoch from (clock_timestamp()-rr.recovered_at))/3600
    from public.merchant_billing_refund_recoveries rr
    join public.merchant_billing_payment_refunds r
      on r.id=rr.refund_id
    where rr.status='recovered'
      and (rr.outstanding_cents<>0 or r.status<>'resolved_recovered')

    union all

    select
      'critical','refund_review_without_sales_hold',
      r.merchant_id,r.id::text,
      r.amount_cents::bigint,
      0::bigint,
      extract(epoch from (clock_timestamp()-r.created_at))/3600
    from public.merchant_billing_payment_refunds r
    left join public.merchant_billing_accounts a
      on a.merchant_id=r.merchant_id
    where r.status='review_required'
      and r.merchant_id is not null
      and r.payment_request_id is not null
      and coalesce(a.sales_hold,false)=false

    union all

    select
      'warning','refund_hold_without_review',
      a.merchant_id,a.merchant_id::text,
      0::bigint,0::bigint,
      case when a.sales_hold_at is null then null
        else extract(epoch from (clock_timestamp()-a.sales_hold_at))/3600
      end
    from public.merchant_billing_accounts a
    where a.sales_hold
      and a.sales_hold_reason='provider_payment_refund_review'
      and not exists(
        select 1
        from public.merchant_billing_payment_refunds r
        where r.merchant_id=a.merchant_id
          and r.status='review_required'
      )

    union all

    select
      'warning','refund_recovery_open_over_24h',
      rr.merchant_id,rr.id::text,
      rr.outstanding_cents::bigint,
      rr.outstanding_cents::bigint,
      extract(epoch from (clock_timestamp()-rr.updated_at))/3600
    from public.merchant_billing_refund_recoveries rr
    where rr.status='open'
      and rr.outstanding_cents>0
      and rr.updated_at<clock_timestamp()-interval '24 hours'

    union all

    select
      'warning','pending_payment_review_over_24h',
      r.merchant_id,r.id::text,
      r.expected_amount_cents::bigint,
      r.expected_amount_cents::bigint,
      extract(epoch from (clock_timestamp()-r.requested_at))/3600
    from public.merchant_billing_payment_requests r
    where r.status='pending'
      and r.requested_at<clock_timestamp()-interval '24 hours'
      and not exists(
        select 1
        from public.merchant_billing_payment_events e
        where e.payment_request_id=r.id
          and e.status='matched_exact'
      )

    union all

    select
      'warning','matched_payment_approval_sla_over_2h',
      r.merchant_id,e.id::text,
      r.expected_amount_cents::bigint,
      e.amount_cents::bigint,
      extract(epoch from (clock_timestamp()-e.updated_at))/3600
    from public.merchant_billing_payment_events e
    join public.merchant_billing_payment_requests r
      on r.id=e.payment_request_id
    where e.status='matched_exact'
      and r.status='pending'
      and e.updated_at<clock_timestamp()-interval '2 hours'

    union all

    select
      'warning','payment_event_review_sla_over_4h',
      e.merchant_id,e.id::text,
      e.amount_cents::bigint,
      e.amount_cents::bigint,
      extract(epoch from (clock_timestamp()-e.updated_at))/3600
    from public.merchant_billing_payment_events e
    where e.status='review_required'
      and e.updated_at<clock_timestamp()-interval '4 hours'
  ),
  numbered as (
    select
      *,
      row_number() over(
        order by
          case severity when 'critical' then 0 else 1 end,
          case issue_type
            when 'matched_payment_approval_sla_over_2h' then 0
            when 'payment_event_review_sla_over_4h' then 1
            when 'refund_recovery_open_over_24h' then 2
            when 'pending_payment_review_over_24h' then 3
            else 4
          end,
          age_hours desc nulls last,
          merchant_id,
          entity_id
      ) as rn
    from issue_rows
  )
  select
    count(*),
    count(*) filter (where severity='critical'),
    count(*) filter (where severity='warning'),
    count(*) filter (where issue_type='pending_payment_review_over_24h'),
    count(*) filter (where issue_type='matched_payment_approval_sla_over_2h'),
    count(*) filter (where issue_type='payment_event_review_sla_over_4h'),
    count(*) filter (where issue_type='refund_recovery_open_over_24h'),
    count(*) filter (
      where issue_type in (
        'pending_payment_review_over_24h',
        'matched_payment_approval_sla_over_2h',
        'payment_event_review_sla_over_4h',
        'refund_recovery_open_over_24h'
      )
    ),
    min(
      clock_timestamp()-(coalesce(age_hours,0)*interval '1 hour')
    ) filter (where issue_type='pending_payment_review_over_24h'),
    min(
      clock_timestamp()-(coalesce(age_hours,0)*interval '1 hour')
    ) filter (
      where issue_type in (
        'pending_payment_review_over_24h',
        'matched_payment_approval_sla_over_2h',
        'payment_event_review_sla_over_4h',
        'refund_recovery_open_over_24h'
      )
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'severity',severity,
          'issueType',issue_type,
          'merchantId',merchant_id,
          'entityId',entity_id,
          'expectedCents',expected_cents,
          'actualCents',actual_cents,
          'ageHours',case when age_hours is null then null else round(age_hours,2) end
        )
        order by rn
      ) filter (where rn<=100),
      '[]'::jsonb
    )
  into
    v_issue_count,
    v_critical_count,
    v_warning_count,
    v_stale_pending_count,
    v_matched_sla_breach_count,
    v_event_review_sla_breach_count,
    v_refund_recovery_sla_breach_count,
    v_finance_sla_breach_count,
    v_oldest_stale,
    v_oldest_finance_sla,
    v_issues
  from numbered;

  return jsonb_build_object(
    'generatedAt',clock_timestamp(),
    'healthy',v_issue_count=0,
    'issueCount',v_issue_count,
    'criticalCount',v_critical_count,
    'warningCount',v_warning_count,
    'stalePendingReviewCount',v_stale_pending_count,
    'oldestStalePendingAt',v_oldest_stale,
    'matchedApprovalSlaBreachCount',v_matched_sla_breach_count,
    'paymentEventReviewSlaBreachCount',v_event_review_sla_breach_count,
    'refundRecoveryOpenSlaBreachCount',v_refund_recovery_sla_breach_count,
    'financeQueueSlaBreachCount',v_finance_sla_breach_count,
    'oldestFinanceSlaBreachAt',v_oldest_finance_sla,
    'slaTargets',jsonb_build_object(
      'matchedApprovalHours',2,
      'paymentEventReviewHours',4,
      'refundRecoveryOpenHours',24,
      'pendingPaymentHours',24
    ),
    'issues',v_issues
  );
end;
$function$;



CREATE OR REPLACE FUNCTION public.require_manual_payment_refund_anchor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
       'refund_total_exceeds_original',
       'refund_of_recovery_payment'
     ) then
    raise exception 'MANUAL_PAYMENT_REFUND_ANCHOR_INVALID'
      using errcode='23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.require_manual_payment_refund_anchor()
from public,anon,authenticated;
grant execute on function public.require_manual_payment_refund_anchor()
to postgres,service_role;

create or replace function public.require_refund_recovery_reopen_consistency()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_request public.merchant_billing_payment_requests%rowtype;
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_original_refund public.merchant_billing_payment_refunds%rowtype;
begin
  if new.status<>'resolved_recovery_reopened' then
    return new;
  end if;

  select * into v_request
  from public.merchant_billing_payment_requests
  where id=new.payment_request_id;

  select * into v_recovery
  from public.merchant_billing_refund_recoveries
  where id=new.reopened_refund_recovery_id;

  if not found then
    raise exception 'REFUND_RECOVERY_REOPEN_PROOF_MISSING'
      using errcode='23514';
  end if;

  select * into v_original_refund
  from public.merchant_billing_payment_refunds
  where id=v_recovery.refund_id;

  if v_request.id is null
     or v_request.request_kind<>'refund_recovery'
     or v_request.status<>'approved'
     or v_request.refund_recovery_id is distinct from v_recovery.id
     or v_request.merchant_id is distinct from new.merchant_id
     or v_request.expected_amount_cents is distinct from
        new.original_payment_amount_cents
     or v_recovery.merchant_id is distinct from new.merchant_id
     or v_recovery.outstanding_cents<0
     or v_recovery.outstanding_cents>v_recovery.amount_cents
     or v_original_refund.id is null
     or v_original_refund.merchant_id is distinct from new.merchant_id
     or not (
       (
         v_recovery.outstanding_cents>0
         and v_recovery.status in ('open','payment_pending')
         and v_original_refund.status='review_required'
       )
       or
       (
         v_recovery.outstanding_cents=0
         and v_recovery.status='recovered'
         and v_original_refund.status='resolved_recovered'
       )
     )
     or exists(
       select 1
       from public.merchant_billing_refund_recoveries nested
       where nested.refund_id=new.id
     ) then
    raise exception 'REFUND_RECOVERY_REOPEN_PROOF_INVALID'
      using errcode='23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.require_refund_recovery_reopen_consistency()
from public,anon,authenticated;
grant execute on function public.require_refund_recovery_reopen_consistency()
to postgres,service_role;

drop trigger if exists require_refund_recovery_reopen_consistency_trg
on public.merchant_billing_payment_refunds;
create constraint trigger require_refund_recovery_reopen_consistency_trg
after insert or update
on public.merchant_billing_payment_refunds
deferrable initially deferred
for each row execute function public.require_refund_recovery_reopen_consistency();



revoke all on function public.derive_provider_refund_allocation_split()
from public,anon,authenticated;
grant execute on function public.derive_provider_refund_allocation_split()
to postgres,service_role;

revoke all on function public.block_new_payment_request_during_provider_refund_review()
from public,anon,authenticated;
grant execute on function public.block_new_payment_request_during_provider_refund_review()
to postgres,service_role;

revoke all on function public.guard_provider_refund_fact_immutable()
from public,anon,authenticated;
grant execute on function public.guard_provider_refund_fact_immutable()
to postgres,service_role;

revoke all on function public.require_refund_recovery_allocation_consistency()
from public,anon,authenticated;
grant execute on function public.require_refund_recovery_allocation_consistency()
to postgres,service_role;

revoke all on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,text,text
) to postgres,service_role;

revoke all on function public.admin_merchant_billing_metrics(uuid)
from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_metrics(uuid)
to postgres,service_role;

revoke all on function public.admin_merchant_billing_reconciliation(uuid)
from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_reconciliation(uuid)
to postgres,service_role;
