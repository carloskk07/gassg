-- TAMÃO — Merchant Billing Engine v1.72
-- Daily close D+1 + prepaid fee-credit packages + automatic sales hold.
-- Atomic order receivables remain the accounting source of truth.

create table if not exists public.merchant_billing_plans (
  plan_key text primary key,
  display_name text not null,
  billing_mode text not null
    check (billing_mode in ('postpaid_daily','prepaid_credit')),
  platform_fee_bps integer not null
    check (platform_fee_bps between 1 and 10000),
  purchase_amount_cents integer
    check (purchase_amount_cents is null or purchase_amount_cents > 0),
  credit_grant_cents integer
    check (credit_grant_cents is null or credit_grant_cents > 0),
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (billing_mode='postpaid_daily' and purchase_amount_cents is null and credit_grant_cents is null)
    or
    (billing_mode='prepaid_credit' and purchase_amount_cents is not null and credit_grant_cents is not null)
  )
);

alter table public.merchant_billing_plans enable row level security;
revoke all on table public.merchant_billing_plans from public, anon, authenticated;
grant all on table public.merchant_billing_plans to service_role;

insert into public.merchant_billing_plans(
  plan_key,display_name,billing_mode,platform_fee_bps,
  purchase_amount_cents,credit_grant_cents,active,sort_order
)
values
  ('flex_daily','Flex Diário','postpaid_daily',850,null,null,true,10),
  ('credit_300','Crédito 300','prepaid_credit',750,30000,30000,true,20),
  ('credit_1000','Crédito 1.000','prepaid_credit',700,100000,100000,true,30),
  ('credit_3000','Crédito 3.000','prepaid_credit',650,300000,300000,true,40)
on conflict(plan_key) do update
set display_name=excluded.display_name,
    billing_mode=excluded.billing_mode,
    platform_fee_bps=excluded.platform_fee_bps,
    purchase_amount_cents=excluded.purchase_amount_cents,
    credit_grant_cents=excluded.credit_grant_cents,
    active=excluded.active,
    sort_order=excluded.sort_order,
    updated_at=clock_timestamp();

create or replace function public.validate_merchant_billing_plan_economics()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_floor integer;
begin
  select
    coalesce(variable_cost_bps,0)
    +coalesce(cashback_bps,0)
    +coalesce(direct_referral_bps,0)
    +coalesce(minimum_contribution_bps,0)
  into v_floor
  from public.reward_policy
  where policy_key='default';

  if v_floor is null then
    raise exception 'FINANCIAL_POLICY_MISSING' using errcode='55000';
  end if;

  if new.platform_fee_bps < v_floor then
    raise exception 'BILLING_PLAN_BELOW_ECONOMIC_FLOOR' using errcode='22023';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_merchant_billing_plan_economics()
from public, anon, authenticated;
grant execute on function public.validate_merchant_billing_plan_economics()
to postgres, service_role;

drop trigger if exists validate_merchant_billing_plan_economics_trg
on public.merchant_billing_plans;
create trigger validate_merchant_billing_plan_economics_trg
before insert or update of platform_fee_bps
on public.merchant_billing_plans
for each row execute function public.validate_merchant_billing_plan_economics();

create table if not exists public.merchant_billing_accounts (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  plan_key text not null default 'flex_daily'
    references public.merchant_billing_plans(plan_key),
  credit_balance_cents bigint not null default 0
    check (credit_balance_cents >= 0),
  credit_reserved_cents bigint not null default 0
    check (credit_reserved_cents >= 0),
  sales_hold boolean not null default false,
  sales_hold_reason text,
  sales_hold_at timestamptz,
  last_daily_close_date date,
  updated_at timestamptz not null default clock_timestamp(),
  check (credit_reserved_cents <= credit_balance_cents)
);

alter table public.merchant_billing_accounts enable row level security;
revoke all on table public.merchant_billing_accounts from public, anon, authenticated;
grant all on table public.merchant_billing_accounts to service_role;

insert into public.merchant_billing_accounts(merchant_id,plan_key)
select m.id,'flex_daily'
from public.merchants m
on conflict(merchant_id) do nothing;

create or replace function public.ensure_merchant_billing_account()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  insert into public.merchant_billing_accounts(merchant_id,plan_key)
  values(new.id,'flex_daily')
  on conflict(merchant_id) do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_merchant_billing_account()
from public, anon, authenticated;
grant execute on function public.ensure_merchant_billing_account()
to postgres, service_role;

drop trigger if exists ensure_merchant_billing_account_trg on public.merchants;
create trigger ensure_merchant_billing_account_trg
after insert on public.merchants
for each row execute function public.ensure_merchant_billing_account();

create table if not exists public.merchant_fee_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  entry_type text not null
    check (entry_type in ('package_credit','fee_consumption','reservation_release','admin_adjustment')),
  amount_cents bigint not null check (amount_cents <> 0),
  plan_key text references public.merchant_billing_plans(plan_key),
  reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.merchant_fee_credit_ledger enable row level security;
revoke all on table public.merchant_fee_credit_ledger from public, anon, authenticated;
grant all on table public.merchant_fee_credit_ledger to service_role;

create index if not exists merchant_fee_credit_ledger_merchant_idx
  on public.merchant_fee_credit_ledger(merchant_id,created_at desc);

alter table public.orders
  add column if not exists billing_plan_key_snapshot text,
  add column if not exists prepaid_fee_reserved_cents_snapshot integer not null default 0,
  add column if not exists prepaid_fee_credit_applied_cents integer not null default 0,
  add column if not exists prepaid_fee_credit_consumed_at timestamptz,
  add column if not exists prepaid_fee_credit_released_at timestamptz;

do $$
begin
  if not exists(
    select 1 from pg_catalog.pg_constraint
    where conname='orders_prepaid_fee_snapshot_nonnegative'
      and conrelid='public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_prepaid_fee_snapshot_nonnegative
      check (
        prepaid_fee_reserved_cents_snapshot >= 0
        and prepaid_fee_credit_applied_cents >= 0
        and prepaid_fee_credit_applied_cents <= prepaid_fee_reserved_cents_snapshot
      );
  end if;
end
$$;

create table if not exists public.merchant_daily_statements (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  business_date date not null,
  gross_sales_cents bigint not null default 0 check (gross_sales_cents >= 0),
  gross_fee_cents bigint not null default 0 check (gross_fee_cents >= 0),
  prepaid_credit_applied_cents bigint not null default 0 check (prepaid_credit_applied_cents >= 0),
  amount_due_cents bigint not null default 0 check (amount_due_cents >= 0),
  status text not null default 'open'
    check (status in ('open','paid','overdue','waived')),
  due_at timestamptz not null,
  closed_at timestamptz not null default clock_timestamp(),
  paid_at timestamptz,
  waived_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_reference text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(merchant_id,business_date)
);

alter table public.merchant_daily_statements enable row level security;
revoke all on table public.merchant_daily_statements from public, anon, authenticated;
grant all on table public.merchant_daily_statements to service_role;

create index if not exists merchant_daily_statements_due_idx
  on public.merchant_daily_statements(status,due_at)
  where status in ('open','overdue');

alter table public.platform_receivables
  add column if not exists daily_statement_id uuid
    references public.merchant_daily_statements(id) on delete set null,
  add column if not exists prepaid_credit_applied_cents integer not null default 0;

do $$
begin
  if not exists(
    select 1 from pg_catalog.pg_constraint
    where conname='platform_receivables_credit_applied_check'
      and conrelid='public.platform_receivables'::regclass
  ) then
    alter table public.platform_receivables
      add constraint platform_receivables_credit_applied_check
      check (
        prepaid_credit_applied_cents >= 0
        and prepaid_credit_applied_cents <= platform_fee_cents
      );
  end if;
end
$$;

create index if not exists platform_receivables_statement_idx
  on public.platform_receivables(daily_statement_id,merchant_id);

create or replace function public.merchant_financial_sales_allowed(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select coalesce((
    select not a.sales_hold
    from public.merchant_billing_accounts a
    where a.merchant_id=p_merchant_id
  ),true);
$$;

revoke all on function public.merchant_financial_sales_allowed(uuid)
from public, anon, authenticated;
grant execute on function public.merchant_financial_sales_allowed(uuid)
to service_role, postgres;

create or replace function public.require_merchant_financial_sales_allowed()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $
begin
  if tg_table_name='quotes' then
    if new.merchant_id is not null
       and not public.merchant_financial_sales_allowed(new.merchant_id) then
      raise exception 'MERCHANT_FINANCIAL_SALES_HOLD' using errcode='42501';
    end if;
    return new;
  end if;

  if tg_table_name='orders' then
    if tg_op='INSERT' then
      if new.merchant_id is not null
         and not public.merchant_financial_sales_allowed(new.merchant_id) then
        raise exception 'MERCHANT_FINANCIAL_SALES_HOLD' using errcode='42501';
      end if;
      if new.proposed_merchant_id is not null
         and not public.merchant_financial_sales_allowed(new.proposed_merchant_id) then
        raise exception 'MERCHANT_FINANCIAL_SALES_HOLD' using errcode='42501';
      end if;
    else
      if new.merchant_id is distinct from old.merchant_id
         and new.merchant_id is not null
         and not public.merchant_financial_sales_allowed(new.merchant_id) then
        raise exception 'MERCHANT_FINANCIAL_SALES_HOLD' using errcode='42501';
      end if;
      if new.proposed_merchant_id is distinct from old.proposed_merchant_id
         and new.proposed_merchant_id is not null
         and not public.merchant_financial_sales_allowed(new.proposed_merchant_id) then
        raise exception 'MERCHANT_FINANCIAL_SALES_HOLD' using errcode='42501';
      end if;
    end if;
  end if;

  return new;
end;
$;

revoke all on function public.require_merchant_financial_sales_allowed()
from public, anon, authenticated;
grant execute on function public.require_merchant_financial_sales_allowed()
to postgres, service_role;

drop trigger if exists require_merchant_financial_sales_allowed_quote_trg
on public.quotes;
create trigger require_merchant_financial_sales_allowed_quote_trg
before insert on public.quotes
for each row execute function public.require_merchant_financial_sales_allowed();

drop trigger if exists require_merchant_financial_sales_allowed_order_trg
on public.orders;
create trigger require_merchant_financial_sales_allowed_order_trg
before insert or update of merchant_id,proposed_merchant_id on public.orders
for each row execute function public.require_merchant_financial_sales_allowed();

create or replace function public.snapshot_order_economics()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_policy public.reward_policy%rowtype;
  v_account public.merchant_billing_accounts%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_flex public.merchant_billing_plans%rowtype;
  v_projected_fee integer:=0;
  v_available bigint:=0;
begin
  select *
  into v_policy
  from public.reward_policy
  where policy_key='default'
  for share;

  if not found then
    raise exception 'FINANCIAL_POLICY_MISSING' using errcode='55000';
  end if;

  if not v_policy.active then
    new.platform_fee_bps_snapshot:=0;
    new.variable_cost_bps_snapshot:=0;
    new.minimum_contribution_bps_snapshot:=0;
    new.cashback_bps_snapshot:=0;
    new.referral_bps_snapshot:=0;
    new.commission_hold_hours_snapshot:=0;
    new.billing_plan_key_snapshot:=null;
    new.prepaid_fee_reserved_cents_snapshot:=0;
    return new;
  end if;

  new.variable_cost_bps_snapshot:=v_policy.variable_cost_bps;
  new.minimum_contribution_bps_snapshot:=v_policy.minimum_contribution_bps;
  new.cashback_bps_snapshot:=v_policy.cashback_bps;
  new.referral_bps_snapshot:=v_policy.direct_referral_bps;
  new.commission_hold_hours_snapshot:=v_policy.commission_hold_hours;
  new.prepaid_fee_reserved_cents_snapshot:=0;

  if new.merchant_id is null then
    new.platform_fee_bps_snapshot:=v_policy.platform_fee_bps;
    new.billing_plan_key_snapshot:='legacy_default';
    return new;
  end if;

  insert into public.merchant_billing_accounts(merchant_id,plan_key)
  values(new.merchant_id,'flex_daily')
  on conflict(merchant_id) do nothing;

  select *
  into v_account
  from public.merchant_billing_accounts
  where merchant_id=new.merchant_id
  for update;

  select *
  into v_plan
  from public.merchant_billing_plans
  where plan_key=v_account.plan_key
    and active;

  select *
  into v_flex
  from public.merchant_billing_plans
  where plan_key='flex_daily'
    and active;

  if v_flex.plan_key is null then
    raise exception 'FLEX_BILLING_PLAN_MISSING' using errcode='55000';
  end if;

  if v_plan.plan_key is null then
    v_plan:=v_flex;
  end if;

  if v_plan.billing_mode='prepaid_credit' then
    v_projected_fee:=floor(
      (new.gross_total_cents::numeric*v_plan.platform_fee_bps)/10000
    )::integer;
    v_available:=greatest(
      v_account.credit_balance_cents-v_account.credit_reserved_cents,
      0
    );

    if v_projected_fee>0 and v_available>=v_projected_fee then
      new.platform_fee_bps_snapshot:=v_plan.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_plan.plan_key;
      new.prepaid_fee_reserved_cents_snapshot:=v_projected_fee;

      update public.merchant_billing_accounts
      set credit_reserved_cents=credit_reserved_cents+v_projected_fee,
          updated_at=clock_timestamp()
      where merchant_id=new.merchant_id;
    else
      new.platform_fee_bps_snapshot:=v_flex.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_flex.plan_key;
    end if;
  else
    new.platform_fee_bps_snapshot:=v_plan.platform_fee_bps;
    new.billing_plan_key_snapshot:=v_plan.plan_key;
  end if;

  return new;
end;
$$;

revoke all on function public.snapshot_order_economics()
from public, anon, authenticated;
grant execute on function public.snapshot_order_economics()
to postgres, service_role;

create or replace function public.release_order_prepaid_fee_reservation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.status='CANCELLED'
     and old.status is distinct from new.status
     and new.prepaid_fee_reserved_cents_snapshot>0
     and new.prepaid_fee_credit_consumed_at is null
     and new.prepaid_fee_credit_released_at is null then

    update public.merchant_billing_accounts
    set credit_reserved_cents=greatest(
          credit_reserved_cents-new.prepaid_fee_reserved_cents_snapshot,
          0
        ),
        updated_at=clock_timestamp()
    where merchant_id=new.merchant_id;

    new.prepaid_fee_credit_released_at:=clock_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.release_order_prepaid_fee_reservation()
from public, anon, authenticated;
grant execute on function public.release_order_prepaid_fee_reservation()
to postgres, service_role;

drop trigger if exists release_order_prepaid_fee_reservation_trg
on public.orders;
create trigger release_order_prepaid_fee_reservation_trg
before update of status on public.orders
for each row execute function public.release_order_prepaid_fee_reservation();

create or replace function public.ensure_order_settlement_accounting(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_platform_fee integer:=0;
  v_credit_applied integer:=0;
  v_due_at timestamptz;
begin
  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.financial_reversed_at is not null
     or v_order.merchant_id is null
     or v_order.payment_confirmed_at is null
     or v_order.delivered_at is null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING' using errcode='40001';
  end if;

  v_platform_fee:=floor(
    (v_order.gross_total_cents::numeric*v_order.platform_fee_bps_snapshot)/10000
  )::integer;

  if v_order.prepaid_fee_reserved_cents_snapshot>0
     and v_order.prepaid_fee_credit_consumed_at is null
     and v_order.prepaid_fee_credit_released_at is null then

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-fee-credit:'||v_order.merchant_id::text,0)
    );

    update public.merchant_billing_accounts
    set credit_balance_cents=credit_balance_cents-v_order.prepaid_fee_reserved_cents_snapshot,
        credit_reserved_cents=greatest(
          credit_reserved_cents-v_order.prepaid_fee_reserved_cents_snapshot,
          0
        ),
        updated_at=clock_timestamp()
    where merchant_id=v_order.merchant_id
      and credit_balance_cents>=v_order.prepaid_fee_reserved_cents_snapshot
      and credit_reserved_cents>=v_order.prepaid_fee_reserved_cents_snapshot;

    if found then
      v_credit_applied:=least(
        v_order.prepaid_fee_reserved_cents_snapshot,
        v_platform_fee
      );

      update public.orders
      set prepaid_fee_credit_applied_cents=v_credit_applied,
          prepaid_fee_credit_consumed_at=clock_timestamp()
      where id=v_order.id;

      insert into public.merchant_fee_credit_ledger(
        merchant_id,order_id,entry_type,amount_cents,plan_key,reference
      )
      values(
        v_order.merchant_id,v_order.id,'fee_consumption',
        -v_credit_applied,v_order.billing_plan_key_snapshot,
        'order-settlement:'||v_order.public_code
      );
    else
      raise exception 'PREPAID_FEE_RESERVATION_INCONSISTENT' using errcode='40001';
    end if;
  end if;

  v_due_at:=(
    (
      (
        coalesce(
          v_order.settled_at,
          v_order.payment_confirmed_at,
          v_order.delivered_at,
          clock_timestamp()
        ) at time zone 'America/Sao_Paulo'
      )::date + 2
    )::timestamp at time zone 'America/Sao_Paulo'
  )-interval '1 second';

  insert into public.platform_receivables(
    order_id,merchant_id,gross_total_cents,
    platform_fee_bps,platform_fee_cents,status,due_at,
    prepaid_credit_applied_cents
  )
  values(
    v_order.id,v_order.merchant_id,v_order.gross_total_cents,
    v_order.platform_fee_bps_snapshot,v_platform_fee,
    'open',v_due_at,v_credit_applied
  )
  on conflict(order_id) do nothing;

  if v_order.cashback_reserved_cents>0 then
    insert into public.merchant_cashback_reimbursements(
      order_id,merchant_id,cashback_cents,status,due_at
    )
    values(
      v_order.id,v_order.merchant_id,v_order.cashback_reserved_cents,
      'open',v_due_at
    )
    on conflict(order_id) do nothing;
  end if;

  update public.settlement_accounting_failures
  set resolved_at=clock_timestamp(),
      next_retry_at=null,
      dead_lettered_at=null,
      updated_at=clock_timestamp()
  where order_id=v_order.id
    and resolved_at is null;

  return jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'billingPlanKey',v_order.billing_plan_key_snapshot,
    'platformFeeCents',v_platform_fee,
    'prepaidCreditAppliedCents',v_credit_applied,
    'postpaidDueCents',greatest(v_platform_fee-v_credit_applied,0),
    'cashbackReimbursementCents',v_order.cashback_reserved_cents,
    'dueAt',v_due_at
  );
end;
$$;

revoke all on function public.ensure_order_settlement_accounting(uuid)
from public, anon, authenticated;
grant execute on function public.ensure_order_settlement_accounting(uuid)
to postgres, service_role;

create or replace function public.close_merchant_daily_finance(
  p_business_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_date date:=coalesce(
    p_business_date,
    (clock_timestamp() at time zone 'America/Sao_Paulo')::date-1
  );
  v_due_at timestamptz;
  v_row record;
  v_statement_id uuid;
  v_count integer:=0;
  v_due bigint:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('merchant-daily-close:'||v_date::text,0));

  v_due_at:=(((v_date+2)::timestamp at time zone 'America/Sao_Paulo')-interval '1 second');

  for v_row in
    select
      pr.merchant_id,
      coalesce(sum(pr.gross_total_cents),0)::bigint as gross_sales,
      coalesce(sum(pr.platform_fee_cents),0)::bigint as gross_fee,
      coalesce(sum(pr.prepaid_credit_applied_cents),0)::bigint as prepaid_applied,
      coalesce(sum(pr.platform_fee_cents-pr.prepaid_credit_applied_cents),0)::bigint as amount_due
    from public.platform_receivables pr
    join public.orders o on o.id=pr.order_id
    where pr.daily_statement_id is null
      and (
        coalesce(o.settled_at,o.payment_confirmed_at,o.delivered_at,pr.created_at)
        at time zone 'America/Sao_Paulo'
      )::date=v_date
    group by pr.merchant_id
  loop
    insert into public.merchant_daily_statements(
      merchant_id,business_date,gross_sales_cents,gross_fee_cents,
      prepaid_credit_applied_cents,amount_due_cents,status,due_at
    )
    values(
      v_row.merchant_id,v_date,v_row.gross_sales,v_row.gross_fee,
      v_row.prepaid_applied,v_row.amount_due,
      case when v_row.amount_due=0 then 'paid' else 'open' end,
      v_due_at
    )
    on conflict(merchant_id,business_date) do update
    set gross_sales_cents=excluded.gross_sales_cents,
        gross_fee_cents=excluded.gross_fee_cents,
        prepaid_credit_applied_cents=excluded.prepaid_credit_applied_cents,
        amount_due_cents=excluded.amount_due_cents,
        due_at=excluded.due_at,
        status=case
          when merchant_daily_statements.status in ('paid','waived')
            then merchant_daily_statements.status
          when excluded.amount_due_cents=0 then 'paid'
          else 'open'
        end,
        updated_at=clock_timestamp()
    returning id into v_statement_id;

    update public.platform_receivables pr
    set daily_statement_id=v_statement_id,
        due_at=v_due_at,
        status=case
          when pr.platform_fee_cents-pr.prepaid_credit_applied_cents<=0
            then 'paid'
          else pr.status
        end,
        paid_at=case
          when pr.platform_fee_cents-pr.prepaid_credit_applied_cents<=0
            then coalesce(pr.paid_at,clock_timestamp())
          else pr.paid_at
        end,
        resolution_reference=case
          when pr.platform_fee_cents-pr.prepaid_credit_applied_cents<=0
            then coalesce(pr.resolution_reference,'prepaid-credit')
          else pr.resolution_reference
        end,
        updated_at=clock_timestamp()
    where pr.merchant_id=v_row.merchant_id
      and pr.daily_statement_id is null
      and exists(
        select 1 from public.orders o
        where o.id=pr.order_id
          and (
            coalesce(o.settled_at,o.payment_confirmed_at,o.delivered_at,pr.created_at)
            at time zone 'America/Sao_Paulo'
          )::date=v_date
      );

    update public.merchant_billing_accounts
    set last_daily_close_date=v_date,
        updated_at=clock_timestamp()
    where merchant_id=v_row.merchant_id;

    v_count:=v_count+1;
    v_due:=v_due+v_row.amount_due;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'businessDate',v_date,
    'statementsClosed',v_count,
    'postpaidDueCents',v_due,
    'dueAt',v_due_at
  );
end;
$$;

revoke all on function public.close_merchant_daily_finance(date)
from public, anon, authenticated;
grant execute on function public.close_merchant_daily_finance(date)
to postgres, service_role;

create or replace function public.process_merchant_billing_enforcement()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_overdue integer:=0;
  v_held integer:=0;
  v_released integer:=0;
begin
  update public.merchant_daily_statements
  set status='overdue',
      updated_at=clock_timestamp()
  where status='open'
    and amount_due_cents>0
    and due_at<clock_timestamp();

  get diagnostics v_overdue=row_count;

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
    and not a.sales_hold;

  get diagnostics v_held=row_count;

  update public.merchant_billing_accounts a
  set sales_hold=false,
      sales_hold_reason=null,
      sales_hold_at=null,
      updated_at=clock_timestamp()
  where a.sales_hold
    and a.sales_hold_reason='daily_statement_overdue'
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
    'merchantsHeld',v_held,
    'merchantsReleased',v_released
  );
end;
$$;

revoke all on function public.process_merchant_billing_enforcement()
from public, anon, authenticated;
grant execute on function public.process_merchant_billing_enforcement()
to postgres, service_role;

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
    'otherPlatformPayablesCents',v_platform_owes,
    'otherMerchantReceivablesCents',v_merchant_owes,
    'netDueToPlatformCents',
      v_fees+v_merchant_owes-v_cashback-v_platform_owes
  );
end;
$$;

revoke all on function public.merchant_financial_position(uuid)
from public, anon, authenticated;
grant execute on function public.merchant_financial_position(uuid)
to service_role, postgres;

create or replace function public.admin_merchant_billing_action(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_action text,
  p_plan_key text,
  p_statement_id uuid,
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
  v_plan public.merchant_billing_plans%rowtype;
  v_statement public.merchant_daily_statements%rowtype;
  v_result jsonb;
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_reference text:=nullif(trim(p_reference),'');
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if p_merchant_id is null then
    raise exception 'INVALID_MERCHANT' using errcode='22023';
  end if;

  if v_kind not in ('confirm-package','set-flex','mark-statement-paid','waive-statement') then
    raise exception 'INVALID_BILLING_ACTION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  if v_reference is null or char_length(v_reference)<3 or char_length(v_reference)>240 then
    raise exception 'FINANCIAL_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:merchant-billing:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:merchant-billing:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  insert into public.merchant_billing_accounts(merchant_id,plan_key)
  values(p_merchant_id,'flex_daily')
  on conflict(merchant_id) do nothing;

  if v_kind='confirm-package' then
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

    update public.merchant_billing_accounts
    set plan_key=v_plan.plan_key,
        credit_balance_cents=credit_balance_cents+v_plan.credit_grant_cents,
        updated_at=clock_timestamp()
    where merchant_id=p_merchant_id;

    insert into public.merchant_fee_credit_ledger(
      merchant_id,entry_type,amount_cents,plan_key,reference,created_by
    )
    values(
      p_merchant_id,'package_credit',v_plan.credit_grant_cents,
      v_plan.plan_key,v_reference,p_actor_user_id
    );

  elsif v_kind='set-flex' then
    if exists(
      select 1 from public.merchant_billing_accounts
      where merchant_id=p_merchant_id
        and (credit_reserved_cents>0 or credit_balance_cents>0)
    ) then
      raise exception 'PREPAID_CREDIT_STILL_AVAILABLE' using errcode='40001';
    end if;

    update public.merchant_billing_accounts
    set plan_key='flex_daily',
        updated_at=clock_timestamp()
    where merchant_id=p_merchant_id;

  else
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

    if v_statement.status in ('paid','waived') then
      raise exception 'STATEMENT_ALREADY_RESOLVED' using errcode='40001';
    end if;

    update public.merchant_daily_statements
    set status=case when v_kind='mark-statement-paid' then 'paid' else 'waived' end,
        paid_at=case when v_kind='mark-statement-paid' then clock_timestamp() else null end,
        waived_at=case when v_kind='waive-statement' then clock_timestamp() else null end,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_statement.id
    returning * into v_statement;

    update public.platform_receivables
    set status=case when v_kind='mark-statement-paid' then 'paid' else 'waived' end,
        paid_at=case when v_kind='mark-statement-paid' then clock_timestamp() else paid_at end,
        waived_at=case when v_kind='waive-statement' then clock_timestamp() else waived_at end,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where daily_statement_id=v_statement.id
      and status='open';
  end if;

  perform public.process_merchant_billing_enforcement();

  v_result:=jsonb_build_object(
    'ok',true,
    'merchantId',p_merchant_id,
    'action',v_kind,
    'position',public.merchant_financial_position(p_merchant_id)
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
    'merchant_billing_'||replace(v_kind,'-','_'),
    'merchant',
    p_merchant_id::text,
    jsonb_build_object(
      'planKey',p_plan_key,
      'statementId',p_statement_id,
      'reference',v_reference
    )
  );

  return v_result;
end;
$$;

revoke all on function public.admin_merchant_billing_action(
  uuid,uuid,text,text,uuid,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_action(
  uuid,uuid,text,text,uuid,text,text,text
) to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='tamao-merchant-daily-finance-close';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  perform cron.schedule(
    'tamao-merchant-daily-finance-close',
    '5 3 * * *',
    'select public.close_merchant_daily_finance();'
  );

  select jobid into v_jobid from cron.job where jobname='tamao-merchant-billing-enforcement';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  perform cron.schedule(
    'tamao-merchant-billing-enforcement',
    '*/15 * * * *',
    'select public.process_merchant_billing_enforcement();'
  );
end
$$;
