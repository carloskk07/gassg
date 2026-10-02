-- Chama São Gabriel — immutable financial facts and reconciliation evidence v1.20
-- Financial source amounts are derived from the settled order and become immutable.
-- Manual financial resolution requires an auditable reference and admin actor.

alter table public.platform_receivables
  add column if not exists resolved_by uuid references auth.users(id) on delete restrict,
  add column if not exists resolution_reference text;

alter table public.platform_receivables
  drop constraint if exists platform_receivables_resolution_reference_check;
alter table public.platform_receivables
  add constraint platform_receivables_resolution_reference_check
  check (
    resolution_reference is null
    or char_length(resolution_reference) between 3 and 240
  );

alter table public.merchant_cashback_reimbursements
  add column if not exists resolved_by uuid references auth.users(id) on delete restrict,
  add column if not exists resolution_reference text;

alter table public.merchant_cashback_reimbursements
  drop constraint if exists merchant_cashback_resolution_reference_check;
alter table public.merchant_cashback_reimbursements
  add constraint merchant_cashback_resolution_reference_check
  check (
    resolution_reference is null
    or char_length(resolution_reference) between 3 and 240
  );

alter table public.platform_settlement_adjustments
  add column if not exists resolved_by uuid references auth.users(id) on delete restrict,
  add column if not exists resolution_reference text;

alter table public.platform_settlement_adjustments
  drop constraint if exists platform_adjustment_resolution_reference_check;
alter table public.platform_settlement_adjustments
  add constraint platform_adjustment_resolution_reference_check
  check (
    resolution_reference is null
    or char_length(resolution_reference) between 3 and 240
  );

create index if not exists platform_receivables_resolved_by_idx
  on public.platform_receivables(resolved_by)
  where resolved_by is not null;

create index if not exists merchant_cashback_reimbursements_resolved_by_idx
  on public.merchant_cashback_reimbursements(resolved_by)
  where resolved_by is not null;

create index if not exists platform_settlement_adjustments_resolved_by_idx
  on public.platform_settlement_adjustments(resolved_by)
  where resolved_by is not null;

create or replace function public.validate_platform_receivable_fact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_expected_fee integer;
  v_expected_due timestamptz;
begin
  if tg_op='UPDATE' and (
    new.order_id is distinct from old.order_id
    or new.merchant_id is distinct from old.merchant_id
    or new.gross_total_cents is distinct from old.gross_total_cents
    or new.platform_fee_bps is distinct from old.platform_fee_bps
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.due_at is distinct from old.due_at
  ) then
    raise exception 'FINANCIAL_FACT_IMMUTABLE' using errcode='23514';
  end if;

  if tg_op='INSERT' then
    select * into v_order
    from public.orders
    where id=new.order_id
    for share;

    if not found then
      raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
    end if;

    if v_order.status<>'SETTLED'
       or v_order.financial_state<>'settled'
       or v_order.financial_reversed_at is not null
       or v_order.merchant_id is null
       or v_order.settled_at is null then
      raise exception 'ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING' using errcode='40001';
    end if;

    v_expected_fee:=floor(
      (v_order.gross_total_cents::numeric*v_order.platform_fee_bps_snapshot)/10000
    )::integer;
    v_expected_due:=v_order.settled_at+interval '7 days';

    if new.merchant_id<>v_order.merchant_id
       or new.gross_total_cents<>v_order.gross_total_cents
       or new.platform_fee_bps<>v_order.platform_fee_bps_snapshot
       or new.platform_fee_cents<>v_expected_fee
       or new.due_at<>v_expected_due then
      raise exception 'PLATFORM_RECEIVABLE_MISMATCH' using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_platform_receivable_fact()
from public, anon, authenticated;
grant execute on function public.validate_platform_receivable_fact()
to postgres, service_role;

drop trigger if exists validate_platform_receivable_fact on public.platform_receivables;
create trigger validate_platform_receivable_fact
before insert or update of order_id,merchant_id,gross_total_cents,platform_fee_bps,platform_fee_cents,due_at
on public.platform_receivables
for each row execute function public.validate_platform_receivable_fact();

create or replace function public.validate_cashback_reimbursement_fact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_expected_due timestamptz;
begin
  if tg_op='UPDATE' and (
    new.order_id is distinct from old.order_id
    or new.merchant_id is distinct from old.merchant_id
    or new.cashback_cents is distinct from old.cashback_cents
    or new.due_at is distinct from old.due_at
  ) then
    raise exception 'FINANCIAL_FACT_IMMUTABLE' using errcode='23514';
  end if;

  if tg_op='INSERT' then
    select * into v_order
    from public.orders
    where id=new.order_id
    for share;

    if not found then
      raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
    end if;

    if v_order.status<>'SETTLED'
       or v_order.financial_state<>'settled'
       or v_order.financial_reversed_at is not null
       or v_order.merchant_id is null
       or v_order.settled_at is null
       or v_order.cashback_reserved_cents<=0 then
      raise exception 'ORDER_NOT_ELIGIBLE_FOR_CASHBACK_REIMBURSEMENT' using errcode='40001';
    end if;

    v_expected_due:=v_order.settled_at+interval '7 days';

    if new.merchant_id<>v_order.merchant_id
       or new.cashback_cents<>v_order.cashback_reserved_cents
       or new.due_at<>v_expected_due then
      raise exception 'CASHBACK_REIMBURSEMENT_MISMATCH' using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_cashback_reimbursement_fact()
from public, anon, authenticated;
grant execute on function public.validate_cashback_reimbursement_fact()
to postgres, service_role;

drop trigger if exists validate_cashback_reimbursement_fact
on public.merchant_cashback_reimbursements;
create trigger validate_cashback_reimbursement_fact
before insert or update of order_id,merchant_id,cashback_cents,due_at
on public.merchant_cashback_reimbursements
for each row execute function public.validate_cashback_reimbursement_fact();

create or replace function public.validate_settlement_adjustment_fact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_reversal public.order_financial_reversals%rowtype;
  v_receivable public.platform_receivables%rowtype;
  v_reimbursement public.merchant_cashback_reimbursements%rowtype;
begin
  if tg_op='UPDATE' and (
    new.order_id is distinct from old.order_id
    or new.merchant_id is distinct from old.merchant_id
    or new.adjustment_type is distinct from old.adjustment_type
    or new.direction is distinct from old.direction
    or new.amount_cents is distinct from old.amount_cents
    or new.reason is distinct from old.reason
    or new.reference is distinct from old.reference
  ) then
    raise exception 'FINANCIAL_FACT_IMMUTABLE' using errcode='23514';
  end if;

  if tg_op='INSERT' then
    select * into v_reversal
    from public.order_financial_reversals
    where order_id=new.order_id;

    if not found then
      raise exception 'FINANCIAL_REVERSAL_REQUIRED' using errcode='40001';
    end if;

    if new.adjustment_type='platform_fee_refund_due' then
      select * into v_receivable
      from public.platform_receivables
      where order_id=new.order_id;

      if not found
         or new.merchant_id<>v_receivable.merchant_id
         or new.amount_cents<>v_receivable.platform_fee_cents
         or new.direction<>'platform_owes_merchant' then
        raise exception 'PLATFORM_FEE_ADJUSTMENT_MISMATCH' using errcode='23514';
      end if;

    elsif new.adjustment_type='cashback_reimbursement_recovery_due' then
      select * into v_reimbursement
      from public.merchant_cashback_reimbursements
      where order_id=new.order_id;

      if not found
         or new.merchant_id<>v_reimbursement.merchant_id
         or new.amount_cents<>v_reimbursement.cashback_cents
         or new.direction<>'merchant_owes_platform' then
        raise exception 'CASHBACK_RECOVERY_ADJUSTMENT_MISMATCH' using errcode='23514';
      end if;
    else
      raise exception 'INVALID_SETTLEMENT_ADJUSTMENT_TYPE' using errcode='22023';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_settlement_adjustment_fact()
from public, anon, authenticated;
grant execute on function public.validate_settlement_adjustment_fact()
to postgres, service_role;

drop trigger if exists validate_settlement_adjustment_fact
on public.platform_settlement_adjustments;
create trigger validate_settlement_adjustment_fact
before insert or update of
  order_id,merchant_id,adjustment_type,direction,amount_cents,reason,reference
on public.platform_settlement_adjustments
for each row execute function public.validate_settlement_adjustment_fact();

alter table public.platform_receivables
  drop constraint if exists platform_receivables_resolution_lifecycle;
alter table public.platform_receivables
  add constraint platform_receivables_resolution_lifecycle
  check (
    (
      status='open'
      and paid_at is null
      and waived_at is null
      and reversed_at is null
      and resolved_by is null
      and resolution_reference is null
    )
    or
    (
      status='paid'
      and paid_at is not null
      and waived_at is null
      and reversed_at is null
      and resolved_by is not null
      and resolution_reference is not null
    )
    or
    (
      status='waived'
      and paid_at is null
      and waived_at is not null
      and reversed_at is null
      and resolved_by is not null
      and resolution_reference is not null
    )
    or
    (
      status='reversed'
      and reversed_at is not null
    )
  );

alter table public.merchant_cashback_reimbursements
  drop constraint if exists merchant_cashback_resolution_lifecycle;
alter table public.merchant_cashback_reimbursements
  add constraint merchant_cashback_resolution_lifecycle
  check (
    (
      status='open'
      and paid_at is null
      and reversed_at is null
      and resolved_by is null
      and resolution_reference is null
    )
    or
    (
      status='paid'
      and paid_at is not null
      and reversed_at is null
      and resolved_by is not null
      and resolution_reference is not null
    )
    or
    (
      status='reversed'
      and reversed_at is not null
    )
  );

alter table public.platform_settlement_adjustments
  drop constraint if exists platform_adjustment_resolution_lifecycle;
alter table public.platform_settlement_adjustments
  add constraint platform_adjustment_resolution_lifecycle
  check (
    (
      status='open'
      and settled_at is null
      and resolved_by is null
      and resolution_reference is null
    )
    or
    (
      status in ('paid','waived')
      and settled_at is not null
      and resolved_by is not null
      and resolution_reference is not null
    )
  );

create or replace function public.admin_financial_action(
  p_actor_user_id uuid,
  p_kind text,
  p_target_id uuid,
  p_action text,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row jsonb;
  v_reference text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  v_reference:=nullif(trim(p_reference),'');

  if v_reference is null
     or char_length(v_reference)<3
     or char_length(v_reference)>240 then
    raise exception 'FINANCIAL_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  if p_kind='platform_receivable' then
    if p_action not in ('paid','waived') then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.platform_receivables
    set status=p_action,
        paid_at=case when p_action='paid' then clock_timestamp() else null end,
        waived_at=case when p_action='waived' then clock_timestamp() else null end,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where order_id=p_target_id
      and status='open'
    returning to_jsonb(platform_receivables.*) into v_row;

  elsif p_kind='cashback_reimbursement' then
    if p_action<>'paid' then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.merchant_cashback_reimbursements
    set status='paid',
        paid_at=clock_timestamp(),
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where order_id=p_target_id
      and status='open'
    returning to_jsonb(merchant_cashback_reimbursements.*) into v_row;

  elsif p_kind='settlement_adjustment' then
    if p_action not in ('paid','waived') then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.platform_settlement_adjustments
    set status=p_action,
        settled_at=clock_timestamp(),
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference
    where id=p_target_id
      and status='open'
    returning to_jsonb(platform_settlement_adjustments.*) into v_row;

  else
    raise exception 'INVALID_FINANCIAL_KIND' using errcode='22023';
  end if;

  if v_row is null then
    raise exception 'FINANCIAL_ITEM_NOT_OPEN' using errcode='40001';
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,'financial_'||p_action,p_kind,p_target_id::text,
    jsonb_build_object('reference',v_reference,'result',v_row)
  );

  return jsonb_build_object(
    'ok',true,
    'kind',p_kind,
    'action',p_action,
    'item',v_row
  );
end;
$$;

revoke all on function public.admin_financial_action(uuid,text,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.admin_financial_action(uuid,text,uuid,text,text)
to service_role;
