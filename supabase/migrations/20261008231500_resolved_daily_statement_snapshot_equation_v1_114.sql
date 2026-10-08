-- TAMÃO — Resolved daily statement snapshot equation v1.114
-- Open/overdue statements are live net positions and exclude reversed receivables.
-- Paid/waived statements are historical settlement snapshots: their original
-- billed totals must continue to include later-reversed receivables, because
-- post-resolution reversals are represented separately by settlement adjustments.

create or replace function public.merchant_daily_statement_expected_resolved_totals(
  p_statement_id uuid
)
returns table(
  gross_sales_cents bigint,
  gross_fee_cents bigint,
  prepaid_credit_applied_cents bigint,
  original_amount_due_cents bigint
)
language sql
security definer
set search_path=pg_catalog
as $function$
  select
    coalesce(sum(pr.gross_total_cents),0)::bigint,
    coalesce(sum(pr.platform_fee_cents),0)::bigint,
    coalesce(sum(pr.prepaid_credit_applied_cents),0)::bigint,
    coalesce(sum(
      greatest(
        pr.platform_fee_cents-pr.prepaid_credit_applied_cents,
        0
      )
    ),0)::bigint
  from public.platform_receivables pr
  where pr.daily_statement_id=p_statement_id;
$function$;

revoke all on function public.merchant_daily_statement_expected_resolved_totals(uuid)
from public,anon,authenticated;
grant execute on function public.merchant_daily_statement_expected_resolved_totals(uuid)
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

  if not exists(
    select 1
    from public.platform_receivables pr
    where pr.daily_statement_id=v_statement.id
  ) then
    raise exception 'DAILY_STATEMENT_WITHOUT_RECEIVABLES:%',
      v_statement.id
      using errcode='23514';
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

    select *
    into v_expected
    from public.merchant_daily_statement_expected_resolved_totals(
      v_statement.id
    );

    if v_statement.gross_sales_cents
         is distinct from v_expected.gross_sales_cents
       or v_statement.gross_fee_cents
         is distinct from v_expected.gross_fee_cents
       or v_statement.prepaid_credit_applied_cents
         is distinct from v_expected.prepaid_credit_applied_cents
       or v_statement.amount_due_cents
         is distinct from v_expected.original_amount_due_cents then
      raise exception 'DAILY_STATEMENT_RESOLVED_SNAPSHOT_MISMATCH:%:%:%:%:%:%:%:%:%',
        v_statement.id,
        v_statement.gross_sales_cents,
        v_expected.gross_sales_cents,
        v_statement.gross_fee_cents,
        v_expected.gross_fee_cents,
        v_statement.prepaid_credit_applied_cents,
        v_expected.prepaid_credit_applied_cents,
        v_statement.amount_due_cents,
        v_expected.original_amount_due_cents
        using errcode='23514';
    end if;
  end if;
end;
$function$;

revoke all on function public.assert_merchant_daily_statement_equation(uuid)
from public,anon,authenticated;
grant execute on function public.assert_merchant_daily_statement_equation(uuid)
to postgres,service_role;

-- Re-prove every existing statement under the stronger resolved-snapshot rule.
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
        raise exception 'DAILY_STATEMENT_EXISTING_DRIFT_V1_114:%:%',
          v_statement_id,sqlerrm
          using errcode='23514';
    end;
  end loop;
end;
$function$;
