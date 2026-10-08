-- TAMÃO — Daily statement / receivable equation v1.113
-- Fixes incremental D+1 close and proves open/overdue statements from their
-- linked receivables at COMMIT time.
--
-- Also makes the automatic "prepaid-credit" resolution explicit: a receivable
-- may be paid without resolved_by only when prepaid credit covers 100% of the
-- platform fee.

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
    or (
      status='paid'
      and paid_at is not null
      and waived_at is null
      and reversed_at is null
      and (
        (
          resolved_by is not null
          and resolution_reference is not null
        )
        or (
          resolved_by is null
          and resolution_reference='prepaid-credit'
          and prepaid_credit_applied_cents>=platform_fee_cents
        )
      )
    )
    or (
      status='waived'
      and paid_at is null
      and waived_at is not null
      and reversed_at is null
      and resolved_by is not null
      and resolution_reference is not null
    )
    or (
      status='reversed'
      and reversed_at is not null
    )
  );

create or replace function public.merchant_daily_statement_expected_open_totals(
  p_statement_id uuid
)
returns table(
  gross_sales_cents bigint,
  gross_fee_cents bigint,
  prepaid_credit_applied_cents bigint,
  amount_due_cents bigint
)
language sql
security definer
set search_path=pg_catalog
as $function$
  select
    coalesce(sum(
      case when pr.status<>'reversed' then pr.gross_total_cents else 0 end
    ),0)::bigint,
    coalesce(sum(
      case when pr.status<>'reversed' then pr.platform_fee_cents else 0 end
    ),0)::bigint,
    coalesce(sum(
      case
        when pr.status<>'reversed' then pr.prepaid_credit_applied_cents
        else 0
      end
    ),0)::bigint,
    coalesce(sum(
      case
        when pr.status='open'
          then greatest(
            pr.platform_fee_cents-pr.prepaid_credit_applied_cents,
            0
          )
        else 0
      end
    ),0)::bigint
  from public.platform_receivables pr
  where pr.daily_statement_id=p_statement_id;
$function$;

revoke all on function public.merchant_daily_statement_expected_open_totals(uuid)
from public,anon,authenticated;
grant execute on function public.merchant_daily_statement_expected_open_totals(uuid)
to postgres,service_role;

create or replace function public.assert_merchant_daily_statement_equation(
  p_statement_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_statement public.merchant_daily_statements%rowtype;
  v_expected record;
begin
  if p_statement_id is null then
    return;
  end if;

  select *
  into v_statement
  from public.merchant_daily_statements
  where id=p_statement_id;

  if not found then
    if exists(
      select 1
      from public.platform_receivables pr
      where pr.daily_statement_id=p_statement_id
    ) then
      raise exception 'DAILY_STATEMENT_MISSING_FOR_RECEIVABLES:%',
        p_statement_id
        using errcode='23514';
    end if;
    return;
  end if;

  if exists(
    select 1
    from public.platform_receivables pr
    where pr.daily_statement_id=v_statement.id
      and pr.merchant_id is distinct from v_statement.merchant_id
  ) then
    raise exception 'DAILY_STATEMENT_MERCHANT_MISMATCH:%',
      v_statement.id
      using errcode='23514';
  end if;

  if exists(
    select 1
    from public.platform_receivables pr
    where pr.daily_statement_id=v_statement.id
      and pr.due_at is distinct from v_statement.due_at
  ) then
    raise exception 'DAILY_STATEMENT_DUE_AT_MISMATCH:%',
      v_statement.id
      using errcode='23514';
  end if;

  if v_statement.status in ('open','overdue') then
    if exists(
      select 1
      from public.platform_receivables pr
      where pr.daily_statement_id=v_statement.id
        and (
          pr.status='waived'
          or (
            pr.status='paid'
            and greatest(
              pr.platform_fee_cents-pr.prepaid_credit_applied_cents,
              0
            )>0
          )
        )
    ) then
      raise exception 'DAILY_STATEMENT_COMPONENT_LIFECYCLE_INVALID:%',
        v_statement.id
        using errcode='23514';
    end if;

    select *
    into v_expected
    from public.merchant_daily_statement_expected_open_totals(v_statement.id);

    if v_expected.amount_due_cents<=0 then
      raise exception 'DAILY_STATEMENT_OPEN_WITHOUT_DUE:%',
        v_statement.id
        using errcode='23514';
    end if;

    if v_statement.gross_sales_cents
         is distinct from v_expected.gross_sales_cents
       or v_statement.gross_fee_cents
         is distinct from v_expected.gross_fee_cents
       or v_statement.prepaid_credit_applied_cents
         is distinct from v_expected.prepaid_credit_applied_cents
       or v_statement.amount_due_cents
         is distinct from v_expected.amount_due_cents then
      raise exception 'DAILY_STATEMENT_RECEIVABLE_EQUATION_MISMATCH:%:%:%:%:%:%:%:%:%',
        v_statement.id,
        v_statement.gross_sales_cents,
        v_expected.gross_sales_cents,
        v_statement.gross_fee_cents,
        v_expected.gross_fee_cents,
        v_statement.prepaid_credit_applied_cents,
        v_expected.prepaid_credit_applied_cents,
        v_statement.amount_due_cents,
        v_expected.amount_due_cents
        using errcode='23514';
    end if;

  elsif v_statement.status in ('paid','waived') then
    if exists(
      select 1
      from public.platform_receivables pr
      where pr.daily_statement_id=v_statement.id
        and pr.status='open'
    ) then
      raise exception 'DAILY_STATEMENT_RESOLVED_WITH_OPEN_RECEIVABLE:%',
        v_statement.id
        using errcode='23514';
    end if;

    if v_statement.status='paid'
       and exists(
         select 1
         from public.platform_receivables pr
         where pr.daily_statement_id=v_statement.id
           and pr.status='waived'
       ) then
      raise exception 'DAILY_STATEMENT_PAID_WITH_WAIVED_RECEIVABLE:%',
        v_statement.id
        using errcode='23514';
    end if;
  end if;
end;
$function$;

revoke all on function public.assert_merchant_daily_statement_equation(uuid)
from public,anon,authenticated;
grant execute on function public.assert_merchant_daily_statement_equation(uuid)
to postgres,service_role;

create or replace function public.require_merchant_daily_statement_equation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_old_statement_id uuid;
  v_new_statement_id uuid;
begin
  if tg_op<>'INSERT' then
    v_old:=to_jsonb(old);
  end if;

  if tg_op<>'DELETE' then
    v_new:=to_jsonb(new);
  end if;

  if tg_table_name='merchant_daily_statements' then
    if tg_op<>'INSERT' then
      v_old_statement_id:=nullif(v_old->>'id','')::uuid;
    end if;
    if tg_op<>'DELETE' then
      v_new_statement_id:=nullif(v_new->>'id','')::uuid;
    end if;

    if tg_op='UPDATE'
       and (v_old->>'merchant_id')
           is not distinct from (v_new->>'merchant_id')
       and (v_old->>'gross_sales_cents')
           is not distinct from (v_new->>'gross_sales_cents')
       and (v_old->>'gross_fee_cents')
           is not distinct from (v_new->>'gross_fee_cents')
       and (v_old->>'prepaid_credit_applied_cents')
           is not distinct from (v_new->>'prepaid_credit_applied_cents')
       and (v_old->>'amount_due_cents')
           is not distinct from (v_new->>'amount_due_cents')
       and (v_old->>'status')
           is not distinct from (v_new->>'status')
       and (v_old->>'due_at')
           is not distinct from (v_new->>'due_at') then
      return new;
    end if;

  elsif tg_table_name='platform_receivables' then
    if tg_op<>'INSERT' then
      v_old_statement_id:=
        nullif(v_old->>'daily_statement_id','')::uuid;
    end if;
    if tg_op<>'DELETE' then
      v_new_statement_id:=
        nullif(v_new->>'daily_statement_id','')::uuid;
    end if;

    if tg_op='UPDATE'
       and (v_old->>'daily_statement_id')
           is not distinct from (v_new->>'daily_statement_id')
       and (v_old->>'merchant_id')
           is not distinct from (v_new->>'merchant_id')
       and (v_old->>'gross_total_cents')
           is not distinct from (v_new->>'gross_total_cents')
       and (v_old->>'platform_fee_cents')
           is not distinct from (v_new->>'platform_fee_cents')
       and (v_old->>'prepaid_credit_applied_cents')
           is not distinct from (v_new->>'prepaid_credit_applied_cents')
       and (v_old->>'status')
           is not distinct from (v_new->>'status')
       and (v_old->>'due_at')
           is not distinct from (v_new->>'due_at') then
      return new;
    end if;
  end if;

  if v_old_statement_id is not null then
    perform public.assert_merchant_daily_statement_equation(
      v_old_statement_id
    );
  end if;

  if v_new_statement_id is not null
     and v_new_statement_id is distinct from v_old_statement_id then
    perform public.assert_merchant_daily_statement_equation(
      v_new_statement_id
    );
  elsif tg_op='INSERT' and v_new_statement_id is not null then
    perform public.assert_merchant_daily_statement_equation(
      v_new_statement_id
    );
  end if;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

revoke all on function public.require_merchant_daily_statement_equation()
from public,anon,authenticated;
grant execute on function public.require_merchant_daily_statement_equation()
to postgres,service_role;

drop trigger if exists require_daily_statement_equation_on_statement_trg
on public.merchant_daily_statements;
create constraint trigger require_daily_statement_equation_on_statement_trg
after insert or update or delete
on public.merchant_daily_statements
deferrable initially deferred
for each row execute function public.require_merchant_daily_statement_equation();

drop trigger if exists require_daily_statement_equation_on_receivable_trg
on public.platform_receivables;
create constraint trigger require_daily_statement_equation_on_receivable_trg
after insert or update or delete
on public.platform_receivables
deferrable initially deferred
for each row execute function public.require_merchant_daily_statement_equation();

create or replace function public.close_merchant_daily_finance(
  p_business_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_date date:=coalesce(
    p_business_date,
    (clock_timestamp() at time zone 'America/Sao_Paulo')::date-1
  );
  v_due_at timestamptz;
  v_row record;
  v_totals record;
  v_statement_id uuid;
  v_previous_status text;
  v_previous_amount_due bigint;
  v_count integer:=0;
  v_due bigint:=0;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('merchant-daily-close:'||v_date::text,0)
  );

  v_due_at:=(
    ((v_date+2)::timestamp at time zone 'America/Sao_Paulo')
    -interval '1 second'
  );

  for v_row in
    select distinct pr.merchant_id
    from public.platform_receivables pr
    join public.orders o on o.id=pr.order_id
    where pr.daily_statement_id is null
      and pr.status<>'reversed'
      and (
        coalesce(
          o.settled_at,
          o.payment_confirmed_at,
          o.delivered_at,
          pr.created_at
        ) at time zone 'America/Sao_Paulo'
      )::date=v_date
    order by pr.merchant_id
  loop
    select s.id,s.status,s.amount_due_cents
    into v_statement_id,v_previous_status,v_previous_amount_due
    from public.merchant_daily_statements s
    where s.merchant_id=v_row.merchant_id
      and s.business_date=v_date
    for update;

    if found then
      if v_previous_status in ('paid','waived') then
        raise exception 'DAILY_STATEMENT_LATE_RECEIVABLE_AFTER_RESOLUTION:%:%',
          v_statement_id,v_row.merchant_id
          using errcode='40001';
      end if;
    else
      insert into public.merchant_daily_statements(
        merchant_id,business_date,gross_sales_cents,gross_fee_cents,
        prepaid_credit_applied_cents,amount_due_cents,status,due_at
      )
      values(
        v_row.merchant_id,v_date,0,0,0,0,'open',v_due_at
      )
      returning id,status,amount_due_cents
      into v_statement_id,v_previous_status,v_previous_amount_due;
    end if;

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
        resolved_by=case
          when pr.platform_fee_cents-pr.prepaid_credit_applied_cents<=0
            then null
          else pr.resolved_by
        end,
        resolution_reference=case
          when pr.platform_fee_cents-pr.prepaid_credit_applied_cents<=0
            then 'prepaid-credit'
          else pr.resolution_reference
        end,
        updated_at=clock_timestamp()
    where pr.merchant_id=v_row.merchant_id
      and pr.daily_statement_id is null
      and pr.status<>'reversed'
      and exists(
        select 1
        from public.orders o
        where o.id=pr.order_id
          and (
            coalesce(
              o.settled_at,
              o.payment_confirmed_at,
              o.delivered_at,
              pr.created_at
            ) at time zone 'America/Sao_Paulo'
          )::date=v_date
      );

    select *
    into v_totals
    from public.merchant_daily_statement_expected_open_totals(
      v_statement_id
    );

    update public.merchant_daily_statements
    set gross_sales_cents=v_totals.gross_sales_cents,
        gross_fee_cents=v_totals.gross_fee_cents,
        prepaid_credit_applied_cents=
          v_totals.prepaid_credit_applied_cents,
        amount_due_cents=v_totals.amount_due_cents,
        due_at=v_due_at,
        status=case
          when v_totals.amount_due_cents=0 then 'paid'
          when v_previous_status='overdue' then 'overdue'
          else 'open'
        end,
        updated_at=clock_timestamp()
    where id=v_statement_id;

    if v_previous_amount_due is distinct from v_totals.amount_due_cents then
      update public.merchant_billing_payment_requests
      set status='cancelled',
          resolved_at=clock_timestamp(),
          admin_reference='statement-recalculated-by-daily-close',
          updated_at=clock_timestamp()
      where statement_id=v_statement_id
        and merchant_id=v_row.merchant_id
        and request_kind='statement_payment'
        and status='pending'
        and expected_amount_cents is distinct from v_totals.amount_due_cents;
    end if;

    update public.merchant_billing_accounts
    set last_daily_close_date=v_date,
        updated_at=clock_timestamp()
    where merchant_id=v_row.merchant_id;

    v_count:=v_count+1;
    v_due:=v_due+v_totals.amount_due_cents;
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

revoke all on function public.close_merchant_daily_finance(date)
from public,anon,authenticated;
grant execute on function public.close_merchant_daily_finance(date)
to postgres,service_role;

-- Existing statements must already satisfy the final-state equation.
do $function$
declare
  v_statement_id uuid;
begin
  for v_statement_id in
    select id
    from public.merchant_daily_statements
    order by id
  loop
    begin
      perform public.assert_merchant_daily_statement_equation(v_statement_id);
    exception
      when others then
        raise exception 'DAILY_STATEMENT_EXISTING_DRIFT:%:%',
          v_statement_id,sqlerrm
          using errcode='23514';
    end;
  end loop;
end;
$function$;
