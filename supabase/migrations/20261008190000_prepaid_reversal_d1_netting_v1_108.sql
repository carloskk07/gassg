-- TAMÃO — Prepaid reversal provenance + D+1 reversal netting v1.108
-- Separates fee credit from cash. A post-settlement reversal restores exactly
-- the prepaid fee credit consumed by the order, while cash refunds/adjustments
-- cover only the postpaid portion that was actually paid. Open D+1 statements
-- are reduced in place and stale payment requests are retired.

alter table public.orders
  add column if not exists prepaid_fee_credit_source_plan_key_snapshot text
    references public.merchant_billing_plans(plan_key) on delete restrict,
  add column if not exists prepaid_fee_credit_reversed_at timestamptz;

update public.orders o
set prepaid_fee_credit_source_plan_key_snapshot=
  case
    when exists(
      select 1
      from public.merchant_billing_plans p
      where p.plan_key=o.billing_plan_key_snapshot
        and p.billing_mode='prepaid_credit'
    ) then o.billing_plan_key_snapshot
    else (
      select l.plan_key
      from public.merchant_fee_credit_ledger l
      join public.merchant_billing_plans p on p.plan_key=l.plan_key
      where l.merchant_id=o.merchant_id
        and l.entry_type='package_credit'
        and p.billing_mode='prepaid_credit'
        and l.created_at<=o.created_at
      order by l.created_at desc,l.id desc
      limit 1
    )
  end
where o.prepaid_fee_reserved_cents_snapshot>0
  and o.prepaid_fee_credit_source_plan_key_snapshot is null;

do $$
begin
  if exists(
    select 1
    from public.orders
    where prepaid_fee_reserved_cents_snapshot>0
      and prepaid_fee_credit_source_plan_key_snapshot is null
  ) then
    raise exception 'PREPAID_FEE_SOURCE_PLAN_BACKFILL_INCOMPLETE';
  end if;
end $$;

alter table public.orders
  drop constraint if exists orders_prepaid_fee_credit_source_plan_shape,
  drop constraint if exists orders_prepaid_fee_credit_reversal_shape;

alter table public.orders
  add constraint orders_prepaid_fee_credit_source_plan_shape
  check (
    (
      prepaid_fee_reserved_cents_snapshot=0
      and prepaid_fee_credit_source_plan_key_snapshot is null
    )
    or (
      prepaid_fee_reserved_cents_snapshot>0
      and prepaid_fee_credit_source_plan_key_snapshot is not null
    )
  ),
  add constraint orders_prepaid_fee_credit_reversal_shape
  check (
    prepaid_fee_credit_reversed_at is null
    or (
      financial_state='reversed'
      and prepaid_fee_credit_applied_cents>0
    )
  );

alter table public.merchant_fee_credit_ledger
  drop constraint if exists merchant_fee_credit_ledger_entry_type_check;

alter table public.merchant_fee_credit_ledger
  add constraint merchant_fee_credit_ledger_entry_type_check
  check (
    entry_type in (
      'package_credit','fee_consumption','reservation_release',
      'admin_adjustment','fee_reversal_credit'
    )
  );

create unique index if not exists merchant_fee_credit_ledger_order_reversal_uq
  on public.merchant_fee_credit_ledger(order_id)
  where entry_type='fee_reversal_credit'
    and order_id is not null;

CREATE OR REPLACE FUNCTION public.snapshot_order_economics()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_policy public.reward_policy%rowtype;
  v_account public.merchant_billing_accounts%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_flex public.merchant_billing_plans%rowtype;
  v_package_fee integer:=0;
  v_flex_fee integer:=0;
  v_available bigint:=0;
  v_reservation integer:=0;
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
  new.prepaid_fee_credit_source_plan_key_snapshot:=null;
    return new;
  end if;

  new.variable_cost_bps_snapshot:=v_policy.variable_cost_bps;
  new.minimum_contribution_bps_snapshot:=v_policy.minimum_contribution_bps;
  new.cashback_bps_snapshot:=v_policy.cashback_bps;
  new.referral_bps_snapshot:=v_policy.direct_referral_bps;
  new.commission_hold_hours_snapshot:=v_policy.commission_hold_hours;
  new.prepaid_fee_reserved_cents_snapshot:=0;
  new.prepaid_fee_credit_source_plan_key_snapshot:=null;

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
    v_package_fee:=floor(
      (new.gross_total_cents::numeric*v_plan.platform_fee_bps)/10000
    )::integer;
    v_available:=greatest(
      v_account.credit_balance_cents-v_account.credit_reserved_cents,
      0
    );

    if v_package_fee>0 and v_available>=v_package_fee then
      new.platform_fee_bps_snapshot:=v_plan.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_plan.plan_key;
      new.prepaid_fee_reserved_cents_snapshot:=v_package_fee;
      new.prepaid_fee_credit_source_plan_key_snapshot:=v_plan.plan_key;

      update public.merchant_billing_accounts
      set credit_reserved_cents=credit_reserved_cents+v_package_fee,
          updated_at=clock_timestamp()
      where merchant_id=new.merchant_id;
    elsif v_available>0 then
      -- The prepaid discount only applies when the discounted fee is fully covered.
      -- Residual credit still pays down the final Flex-rate fee so no cent is stranded.
      v_flex_fee:=floor(
        (new.gross_total_cents::numeric*v_flex.platform_fee_bps)/10000
      )::integer;
      new.platform_fee_bps_snapshot:=v_flex.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_flex.plan_key;

      if v_flex_fee>0 then
        v_reservation:=least(v_flex_fee,v_available)::integer;
        new.prepaid_fee_reserved_cents_snapshot:=v_reservation;
        new.prepaid_fee_credit_source_plan_key_snapshot:=v_plan.plan_key;

        update public.merchant_billing_accounts
        set credit_reserved_cents=credit_reserved_cents+v_reservation,
            updated_at=clock_timestamp()
        where merchant_id=new.merchant_id;
      end if;
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
$function$;


CREATE OR REPLACE FUNCTION public.rebind_order_billing_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_policy public.reward_policy%rowtype;
  v_account public.merchant_billing_accounts%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_flex public.merchant_billing_plans%rowtype;
  v_package_fee integer:=0;
  v_flex_fee integer:=0;
  v_available bigint:=0;
  v_reservation integer:=0;
  v_basis_changed boolean:=
    new.merchant_id is distinct from old.merchant_id
    or new.gross_total_cents is distinct from old.gross_total_cents;
  v_snapshot_changed boolean:=
    new.platform_fee_bps_snapshot is distinct from old.platform_fee_bps_snapshot
    or new.billing_plan_key_snapshot is distinct from old.billing_plan_key_snapshot
    or new.prepaid_fee_reserved_cents_snapshot
       is distinct from old.prepaid_fee_reserved_cents_snapshot
    or new.prepaid_fee_credit_source_plan_key_snapshot
       is distinct from old.prepaid_fee_credit_source_plan_key_snapshot;
begin
  if not v_basis_changed then
    if v_snapshot_changed then
      raise exception 'ORDER_BILLING_SNAPSHOT_IMMUTABLE'
        using errcode='23514';
    end if;
    return new;
  end if;

  if old.financial_state<>'pending'
     or old.status in ('CANCELLED','SETTLED')
     or old.dispatched_at is not null
     or old.delivered_at is not null
     or old.settled_at is not null
     or old.prepaid_fee_credit_consumed_at is not null
     or old.prepaid_fee_credit_released_at is not null then
    raise exception 'ORDER_BILLING_REBIND_TOO_LATE'
      using errcode='40001';
  end if;

  -- Match settlement's merchant-fee-credit lock namespace and acquire
  -- two-merchant moves in deterministic UUID-text order to avoid deadlocks.
  if old.merchant_id is not null
     and new.merchant_id is not null
     and old.merchant_id is distinct from new.merchant_id then
    if old.merchant_id::text<new.merchant_id::text then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'merchant-fee-credit:'||old.merchant_id::text,0
        )
      );
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'merchant-fee-credit:'||new.merchant_id::text,0
        )
      );
    else
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'merchant-fee-credit:'||new.merchant_id::text,0
        )
      );
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'merchant-fee-credit:'||old.merchant_id::text,0
        )
      );
    end if;
  elsif coalesce(new.merchant_id,old.merchant_id) is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'merchant-fee-credit:'
        ||coalesce(new.merchant_id,old.merchant_id)::text,
        0
      )
    );
  end if;

  if old.prepaid_fee_reserved_cents_snapshot>0 then
    if old.merchant_id is null then
      raise exception 'PREPAID_FEE_RESERVATION_OWNER_MISSING'
        using errcode='40001';
    end if;

    update public.merchant_billing_accounts
    set credit_reserved_cents=
          credit_reserved_cents-old.prepaid_fee_reserved_cents_snapshot,
        updated_at=clock_timestamp()
    where merchant_id=old.merchant_id
      and credit_reserved_cents>=old.prepaid_fee_reserved_cents_snapshot;

    if not found then
      raise exception 'PREPAID_FEE_RESERVATION_INCONSISTENT'
        using errcode='40001';
    end if;
  end if;

  new.prepaid_fee_reserved_cents_snapshot:=0;
  new.prepaid_fee_credit_source_plan_key_snapshot:=null;
  new.prepaid_fee_credit_applied_cents:=0;
  new.prepaid_fee_credit_consumed_at:=null;
  new.prepaid_fee_credit_released_at:=null;

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
    new.billing_plan_key_snapshot:=null;
    return new;
  end if;

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

  if not found then
    raise exception 'MERCHANT_BILLING_ACCOUNT_MISSING'
      using errcode='55000';
  end if;

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

  if not found then
    raise exception 'FLEX_BILLING_PLAN_MISSING' using errcode='55000';
  end if;

  if v_plan.plan_key is null then
    v_plan:=v_flex;
  end if;

  if v_plan.billing_mode='prepaid_credit' then
    v_package_fee:=floor(
      (new.gross_total_cents::numeric*v_plan.platform_fee_bps)/10000
    )::integer;
    v_available:=greatest(
      v_account.credit_balance_cents-v_account.credit_reserved_cents,
      0
    );

    if v_package_fee>0 and v_available>=v_package_fee then
      new.platform_fee_bps_snapshot:=v_plan.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_plan.plan_key;
      v_reservation:=v_package_fee;
    elsif v_available>0 then
      v_flex_fee:=floor(
        (new.gross_total_cents::numeric*v_flex.platform_fee_bps)/10000
      )::integer;
      new.platform_fee_bps_snapshot:=v_flex.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_flex.plan_key;
      v_reservation:=least(v_flex_fee,v_available)::integer;
    else
      new.platform_fee_bps_snapshot:=v_flex.platform_fee_bps;
      new.billing_plan_key_snapshot:=v_flex.plan_key;
    end if;
  else
    new.platform_fee_bps_snapshot:=v_plan.platform_fee_bps;
    new.billing_plan_key_snapshot:=v_plan.plan_key;
  end if;

  if v_reservation>0 then
    new.prepaid_fee_credit_source_plan_key_snapshot:=v_plan.plan_key;

    update public.merchant_billing_accounts
    set credit_reserved_cents=credit_reserved_cents+v_reservation,
        updated_at=clock_timestamp()
    where merchant_id=new.merchant_id
      and credit_balance_cents-credit_reserved_cents>=v_reservation;

    if not found then
      raise exception 'PREPAID_FEE_RESERVATION_RACE'
        using errcode='40001';
    end if;

    new.prepaid_fee_reserved_cents_snapshot:=v_reservation;
  end if;

  return new;
end;
$function$;


drop trigger if exists rebind_order_billing_snapshot_before_update
on public.orders;
create trigger rebind_order_billing_snapshot_before_update
before update of
  merchant_id,gross_total_cents,
  platform_fee_bps_snapshot,billing_plan_key_snapshot,
  prepaid_fee_reserved_cents_snapshot,
  prepaid_fee_credit_source_plan_key_snapshot
on public.orders
for each row execute function public.rebind_order_billing_snapshot();

CREATE OR REPLACE FUNCTION public.ensure_order_settlement_accounting(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    set plan_key=case
          when credit_balance_cents-v_order.prepaid_fee_reserved_cents_snapshot=0
           and greatest(credit_reserved_cents-v_order.prepaid_fee_reserved_cents_snapshot,0)=0
            then 'flex_daily'
          else plan_key
        end,
        credit_balance_cents=credit_balance_cents-v_order.prepaid_fee_reserved_cents_snapshot,
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
        -v_credit_applied,v_order.prepaid_fee_credit_source_plan_key_snapshot,
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
    'prepaidCreditSourcePlanKey',v_order.prepaid_fee_credit_source_plan_key_snapshot,
    'postpaidDueCents',greatest(v_platform_fee-v_credit_applied,0),
    'cashbackReimbursementCents',v_order.cashback_reserved_cents,
    'dueAt',v_due_at
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.close_merchant_daily_finance(p_business_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      coalesce(sum(case
        when pr.status='open' then greatest(
          pr.platform_fee_cents-pr.prepaid_credit_applied_cents,0
        )
        else 0
      end),0)::bigint as amount_due
    from public.platform_receivables pr
    join public.orders o on o.id=pr.order_id
    where pr.daily_statement_id is null
      and pr.status<>'reversed'
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
      and pr.status<>'reversed'
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
$function$;


CREATE OR REPLACE FUNCTION public.validate_settlement_adjustment_fact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
         or new.amount_cents<>greatest(
              v_receivable.platform_fee_cents
              -v_receivable.prepaid_credit_applied_cents,
              0
            )
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
$function$;


CREATE OR REPLACE FUNCTION public.reverse_settled_order_financials(p_order_id uuid, p_reason text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_receivable public.platform_receivables%rowtype;
  v_reimbursement public.merchant_cashback_reimbursements%rowtype;
  v_statement public.merchant_daily_statements%rowtype;
  v_account public.merchant_billing_accounts%rowtype;
  v_source_plan public.merchant_billing_plans%rowtype;
  v_current_plan public.merchant_billing_plans%rowtype;
  v_existing public.order_financial_reversals%rowtype;
  v_restore_ledger_id uuid;
  v_target_plan_key text;
  v_credit_restored integer:=0;
  v_cash_refund_due integer:=0;
  v_result jsonb;
begin
  if p_reason is null
     or char_length(trim(p_reason))<3
     or char_length(trim(p_reason))>240 then
    raise exception 'INVALID_REVERSAL_REASON' using errcode='22023';
  end if;

  if p_reference is not null
     and (char_length(trim(p_reference))<3 or char_length(trim(p_reference))>120) then
    raise exception 'INVALID_REVERSAL_REFERENCE' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('reward:'||p_order_id::text,0)
  );

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cashback-user:'||v_order.customer_id::text,0)
  );

  select *
  into v_existing
  from public.order_financial_reversals
  where order_id=v_order.id;

  if found then
    return jsonb_build_object(
      'ok',true,
      'orderId',v_order.id,
      'financialState','reversed',
      'alreadyReversed',true,
      'reversedAt',coalesce(v_order.financial_reversed_at,v_existing.created_at)
    );
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.settled_at is null then
    raise exception 'ORDER_NOT_REVERSIBLE' using errcode='40001';
  end if;

  insert into public.order_financial_reversals(order_id,reason,reference)
  values(v_order.id,trim(p_reason),nullif(trim(p_reference),''))
  returning * into v_existing;

  if v_order.prepaid_fee_credit_applied_cents>0 then
    if v_order.prepaid_fee_credit_source_plan_key_snapshot is null then
      raise exception 'PREPAID_FEE_REVERSAL_SOURCE_PLAN_MISSING'
        using errcode='40001';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-fee-credit:'||v_order.merchant_id::text,0)
    );

    select *
    into v_account
    from public.merchant_billing_accounts
    where merchant_id=v_order.merchant_id
    for update;

    if not found then
      raise exception 'MERCHANT_BILLING_ACCOUNT_MISSING'
        using errcode='55000';
    end if;

    select *
    into v_source_plan
    from public.merchant_billing_plans
    where plan_key=v_order.prepaid_fee_credit_source_plan_key_snapshot
      and billing_mode='prepaid_credit'
      and active;

    if not found then
      raise exception 'PREPAID_FEE_REVERSAL_SOURCE_PLAN_INVALID'
        using errcode='40001';
    end if;

    select *
    into v_current_plan
    from public.merchant_billing_plans
    where plan_key=v_account.plan_key;

    v_target_plan_key:=v_source_plan.plan_key;
    if found
       and v_current_plan.billing_mode='prepaid_credit'
       and v_current_plan.active
       and v_current_plan.platform_fee_bps<=v_source_plan.platform_fee_bps then
      v_target_plan_key:=v_current_plan.plan_key;
    end if;

    insert into public.merchant_fee_credit_ledger(
      merchant_id,order_id,entry_type,amount_cents,plan_key,reference
    )
    values(
      v_order.merchant_id,v_order.id,'fee_reversal_credit',
      v_order.prepaid_fee_credit_applied_cents,
      v_order.prepaid_fee_credit_source_plan_key_snapshot,
      'order-reversal:'||v_order.public_code
    )
    on conflict(order_id)
      where entry_type='fee_reversal_credit' and order_id is not null
      do nothing
    returning id into v_restore_ledger_id;

    if v_restore_ledger_id is null then
      raise exception 'PREPAID_FEE_REVERSAL_ALREADY_APPLIED'
        using errcode='40001';
    end if;

    update public.merchant_billing_accounts
    set plan_key=v_target_plan_key,
        credit_balance_cents=
          credit_balance_cents+v_order.prepaid_fee_credit_applied_cents,
        updated_at=clock_timestamp()
    where merchant_id=v_order.merchant_id;

    if not found then
      raise exception 'PREPAID_FEE_REVERSAL_ACCOUNT_UPDATE_FAILED'
        using errcode='40001';
    end if;

    v_credit_restored:=v_order.prepaid_fee_credit_applied_cents;
  end if;

  select *
  into v_grant
  from public.order_reward_grants
  where order_id=v_order.id
  for update;

  if found and v_grant.reversed_at is null then
    if v_grant.referral_pending_cents>0
       and v_grant.referrer_user_id is not null then
      if v_grant.matured_at is null then
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        )
        values(
          v_grant.referrer_user_id,v_order.id,'commission_pending',
          'referral_pending_release',-v_grant.referral_pending_cents,
          'reversal:'||replace(v_order.id::text,'-','')||':referral-pending',
          jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
        )
        on conflict(idempotency_key) do nothing;
      else
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        )
        values(
          v_grant.referrer_user_id,v_order.id,'commission_available',
          'referral_reversal',-v_grant.referral_pending_cents,
          'reversal:'||replace(v_order.id::text,'-','')||':referral-available',
          jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
        )
        on conflict(idempotency_key) do nothing;
      end if;
    end if;

    update public.order_reward_grants
    set reversed_at=clock_timestamp(),
        reversal_reason=trim(p_reason)
    where order_id=v_order.id
      and reversed_at is null;
  end if;

  update public.referrals
  set qualified_order_id=null
  where qualified_order_id=v_order.id;

  select *
  into v_receivable
  from public.platform_receivables
  where order_id=v_order.id
  for update;

  if found then
    v_cash_refund_due:=greatest(
      v_receivable.platform_fee_cents
      -v_receivable.prepaid_credit_applied_cents,
      0
    );

    if v_receivable.daily_statement_id is not null then
      select *
      into v_statement
      from public.merchant_daily_statements
      where id=v_receivable.daily_statement_id
      for update;

      if not found then
        raise exception 'DAILY_STATEMENT_NOT_FOUND'
          using errcode='P0002';
      end if;

      if v_statement.status in ('open','overdue') then
        if v_statement.gross_sales_cents<v_receivable.gross_total_cents
           or v_statement.gross_fee_cents<v_receivable.platform_fee_cents
           or v_statement.prepaid_credit_applied_cents
              <v_receivable.prepaid_credit_applied_cents
           or v_statement.amount_due_cents<v_cash_refund_due then
          raise exception 'DAILY_STATEMENT_REVERSAL_INCONSISTENT'
            using errcode='40001';
        end if;

        update public.merchant_daily_statements
        set gross_sales_cents=
              gross_sales_cents-v_receivable.gross_total_cents,
            gross_fee_cents=
              gross_fee_cents-v_receivable.platform_fee_cents,
            prepaid_credit_applied_cents=
              prepaid_credit_applied_cents
              -v_receivable.prepaid_credit_applied_cents,
            amount_due_cents=amount_due_cents-v_cash_refund_due,
            status=case
              when amount_due_cents-v_cash_refund_due=0 then 'paid'
              else status
            end,
            resolution_reference=case
              when amount_due_cents-v_cash_refund_due=0
                then coalesce(
                  resolution_reference,
                  'net-zero-order-reversal:'||v_order.public_code
                )
              else resolution_reference
            end,
            updated_at=clock_timestamp()
        where id=v_statement.id
        returning * into v_statement;

        if v_cash_refund_due>0 then
          update public.merchant_billing_payment_requests
          set status='cancelled',
              resolved_at=clock_timestamp(),
              admin_reference='statement-adjusted-by-order-reversal',
              updated_at=clock_timestamp()
          where statement_id=v_statement.id
            and merchant_id=v_statement.merchant_id
            and request_kind='statement_payment'
            and status='pending';
        end if;

      elsif v_statement.status='paid'
         and v_receivable.status='paid'
         and v_cash_refund_due>0 then
        insert into public.platform_settlement_adjustments(
          order_id,merchant_id,adjustment_type,direction,
          amount_cents,status,reason,reference
        )
        values(
          v_order.id,v_receivable.merchant_id,'platform_fee_refund_due',
          'platform_owes_merchant',v_cash_refund_due,
          'open',trim(p_reason),nullif(trim(p_reference),'')
        )
        on conflict(order_id,adjustment_type) do nothing;
      end if;

    elsif v_receivable.status='paid' and v_cash_refund_due>0 then
      insert into public.platform_settlement_adjustments(
        order_id,merchant_id,adjustment_type,direction,
        amount_cents,status,reason,reference
      )
      values(
        v_order.id,v_receivable.merchant_id,'platform_fee_refund_due',
        'platform_owes_merchant',v_cash_refund_due,
        'open',trim(p_reason),nullif(trim(p_reference),'')
      )
      on conflict(order_id,adjustment_type) do nothing;
    end if;

    update public.platform_receivables
    set status='reversed',
        reversed_at=coalesce(reversed_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=v_order.id
      and status<>'reversed';
  end if;

  select *
  into v_reimbursement
  from public.merchant_cashback_reimbursements
  where order_id=v_order.id
  for update;

  if found then
    if v_reimbursement.status='paid'
       and v_reimbursement.cashback_cents>0 then
      insert into public.platform_settlement_adjustments(
        order_id,merchant_id,adjustment_type,direction,amount_cents,
        status,reason,reference
      )
      values(
        v_order.id,v_reimbursement.merchant_id,
        'cashback_reimbursement_recovery_due','merchant_owes_platform',
        v_reimbursement.cashback_cents,'open',
        trim(p_reason),nullif(trim(p_reference),'')
      )
      on conflict(order_id,adjustment_type) do nothing;
    end if;

    update public.merchant_cashback_reimbursements
    set status='reversed',
        reversed_at=coalesce(reversed_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=v_order.id
      and status<>'reversed';
  end if;

  update public.orders
  set financial_state='reversed',
      financial_reversed_at=clock_timestamp(),
      financial_reversal_reason=trim(p_reason),
      financial_reversal_reference=nullif(trim(p_reference),''),
      prepaid_fee_credit_reversed_at=case
        when v_credit_restored>0 then clock_timestamp()
        else prepaid_fee_credit_reversed_at
      end,
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id
  returning * into v_order;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,null,'system','FINANCIAL_REVERSED',
    'Liquidação financeira revertida',
    'Benefícios e recebíveis da plataforma foram estornados após confirmação da reversão.',
    jsonb_build_object(
      'reason',trim(p_reason),
      'reference',p_reference,
      'operationalStatus',v_order.status,
      'cashbackClawbackCents',coalesce(v_grant.cashback_cents,0),
      'cashbackClawbackMode','effective_balance_offset',
      'prepaidCreditRestoredCents',v_credit_restored,
      'cashRefundDueCents',v_cash_refund_due
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'status',v_order.status,
    'financialState',v_order.financial_state,
    'version',v_order.version,
    'alreadyReversed',false,
    'reversedAt',v_order.financial_reversed_at,
    'prepaidCreditRestoredCents',v_credit_restored,
    'cashRefundDueCents',v_cash_refund_due
  );

  return v_result;
end;
$function$;



-- Reconciliation must count restored prepaid fee credit in the canonical ledger balance.
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
          when entry_type in ('package_credit','fee_consumption','fee_reversal_credit','admin_adjustment')
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

revoke all on function public.admin_merchant_billing_reconciliation(uuid)
from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_reconciliation(uuid)
to service_role,postgres;
