-- TAMÃO — D+1 statement resolution provenance + historical equation v1.115
-- Completes the resolved-statement proof that v1.113 intentionally left open.
--
-- A reversed receivable has two different meanings:
--   1) reversed before statement resolution -> it must NOT belong to the
--      historical paid/waived snapshot;
--   2) reversed after statement resolution -> it DID belong to that snapshot
--      and the later economic effect lives in settlement adjustments.
--
-- v1.114 made paid_at/waived_at authoritative. This migration adds the
-- resolution cause and uses both facts to prove the historical equation.
-- The special net-zero reversal path records the exact order that caused the
-- open statement to become paid at zero, avoiding sub-millisecond heuristics.

alter table public.merchant_daily_statements
  add column resolution_kind text,
  add column resolution_cause_order_id uuid;

alter table public.merchant_daily_statements
  add constraint merchant_daily_statements_resolution_cause_order_fkey
  foreign key(resolution_cause_order_id)
  references public.orders(id)
  on delete restrict;

create index merchant_daily_statements_resolution_cause_order_idx
  on public.merchant_daily_statements(resolution_cause_order_id)
  where resolution_cause_order_id is not null;

-- Deterministic backfill for resolved history.
update public.merchant_daily_statements s
set resolution_kind='net_zero_reversal',
    resolution_cause_order_id=x.order_id
from (
  select s2.id as statement_id,pr.order_id
  from public.merchant_daily_statements s2
  join public.platform_receivables pr
    on pr.daily_statement_id=s2.id
  join public.orders o
    on o.id=pr.order_id
  where s2.status='paid'
    and s2.amount_due_cents=0
    and s2.resolution_reference=
      'net-zero-order-reversal:'||o.public_code
) x
where s.id=x.statement_id;

update public.merchant_daily_statements
set resolution_kind='payment'
where status='paid'
  and amount_due_cents>0
  and resolution_kind is null;

update public.merchant_daily_statements
set resolution_kind='prepaid_credit'
where status='paid'
  and amount_due_cents=0
  and resolution_kind is null;

update public.merchant_daily_statements
set resolution_kind='waiver'
where status='waived'
  and resolution_kind is null;

alter table public.merchant_daily_statements
  add constraint merchant_daily_statements_resolution_provenance_shape
  check (
    (
      status in ('open','overdue')
      and resolution_kind is null
      and resolution_cause_order_id is null
    )
    or (
      status='waived'
      and resolution_kind='waiver'
      and resolution_cause_order_id is null
    )
    or (
      status='paid'
      and (
        (
          amount_due_cents>0
          and resolution_kind='payment'
          and resolution_cause_order_id is null
        )
        or (
          amount_due_cents=0
          and resolution_kind='prepaid_credit'
          and resolution_cause_order_id is null
        )
        or (
          amount_due_cents=0
          and resolution_kind='net_zero_reversal'
          and resolution_cause_order_id is not null
        )
      )
    )
  );

create or replace function public.enforce_merchant_daily_statement_resolution_lifecycle()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  v_cause_order_id uuid;
begin
  if tg_op='UPDATE'
     and old.status in ('paid','waived') then
    if new.status is distinct from old.status
       or new.paid_at is distinct from old.paid_at
       or new.waived_at is distinct from old.waived_at
       or new.resolution_kind is distinct from old.resolution_kind
       or new.resolution_cause_order_id
            is distinct from old.resolution_cause_order_id then
      raise exception 'DAILY_STATEMENT_RESOLUTION_IMMUTABLE:%',
        old.id
        using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='paid' then
    new.paid_at:=clock_timestamp();
    new.waived_at:=null;

    if new.amount_due_cents>0 then
      new.resolution_kind:='payment';
      new.resolution_cause_order_id:=null;
    else
      -- During reverse_settled_order_financials the statement is updated
      -- before the causal receivable is finally marked reversed. At this
      -- point that receivable is still open, so the system reference can be
      -- bound to one exact linked order without relying on clock ordering.
      select pr.order_id
      into v_cause_order_id
      from public.platform_receivables pr
      join public.orders o on o.id=pr.order_id
      where pr.daily_statement_id=new.id
        and pr.status='open'
        and greatest(
          pr.platform_fee_cents-pr.prepaid_credit_applied_cents,
          0
        )>0
        and new.resolution_reference=
          'net-zero-order-reversal:'||o.public_code
      limit 1;

      if found then
        new.resolution_kind:='net_zero_reversal';
        new.resolution_cause_order_id:=v_cause_order_id;
      else
        new.resolution_kind:='prepaid_credit';
        new.resolution_cause_order_id:=null;
      end if;
    end if;

  elsif new.status='waived' then
    new.waived_at:=clock_timestamp();
    new.paid_at:=null;
    new.resolution_kind:='waiver';
    new.resolution_cause_order_id:=null;

  else
    if new.paid_at is not null
       or new.waived_at is not null
       or new.resolution_kind is not null
       or new.resolution_cause_order_id is not null then
      raise exception 'DAILY_STATEMENT_UNRESOLVED_PROVENANCE_FORBIDDEN:%',
        new.id
        using errcode='23514';
    end if;

    new.paid_at:=null;
    new.waived_at:=null;
    new.resolution_kind:=null;
    new.resolution_cause_order_id:=null;
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_merchant_daily_statement_resolution_lifecycle()
from public,anon,authenticated;
grant execute on function public.enforce_merchant_daily_statement_resolution_lifecycle()
to postgres,service_role;

drop trigger if exists enforce_daily_statement_resolution_lifecycle_trg
on public.merchant_daily_statements;

create trigger enforce_daily_statement_resolution_lifecycle_trg
before insert or update of
  status,paid_at,waived_at,resolution_kind,resolution_cause_order_id
on public.merchant_daily_statements
for each row
execute function public.enforce_merchant_daily_statement_resolution_lifecycle();

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
  from public.merchant_daily_statements s
  join public.platform_receivables pr
    on pr.daily_statement_id=s.id
  where s.id=p_statement_id
    and (
      pr.status<>'reversed'
      or (
        pr.reversed_at is not null
        and pr.reversed_at>coalesce(s.paid_at,s.waived_at)
        and pr.order_id is distinct from s.resolution_cause_order_id
      )
    );
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

    if v_statement.resolution_kind='net_zero_reversal' then
      if not exists(
        select 1
        from public.platform_receivables pr
        join public.orders o on o.id=pr.order_id
        where pr.daily_statement_id=v_statement.id
          and pr.order_id=v_statement.resolution_cause_order_id
          and pr.status='reversed'
          and pr.reversed_at is not null
          and v_statement.resolution_reference=
            'net-zero-order-reversal:'||o.public_code
      ) then
        raise exception 'DAILY_STATEMENT_NET_ZERO_CAUSE_MISMATCH:%',
          v_statement.id
          using errcode='23514';
      end if;
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

-- Re-prove all existing statements with the new historical semantics.
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
        raise exception 'DAILY_STATEMENT_EXISTING_DRIFT_V1_115:%:%',
          v_statement_id,sqlerrm
          using errcode='23514';
    end;
  end loop;
end;
$function$;
