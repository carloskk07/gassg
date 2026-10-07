-- TAMÃO — Merchant billing reconciliation v1.77
-- Independent accounting audit for balances, reservations, payment requests and D+1 lifecycle.
-- Read-only: detects divergence without silently repairing financial state.

create index if not exists orders_prepaid_fee_open_reservation_idx
  on public.orders(merchant_id)
  where prepaid_fee_reserved_cents_snapshot>0
    and prepaid_fee_credit_consumed_at is null
    and prepaid_fee_credit_released_at is null
    and status<>'CANCELLED';

create or replace function public.admin_merchant_billing_reconciliation(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_role text;
  v_issue_count bigint:=0;
  v_critical_count bigint:=0;
  v_warning_count bigint:=0;
  v_stale_pending_count bigint:=0;
  v_oldest_stale timestamptz;
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
      'warning','pending_payment_review_over_24h',
      r.merchant_id,r.id::text,
      r.expected_amount_cents::bigint,
      r.expected_amount_cents::bigint,
      extract(epoch from (clock_timestamp()-r.requested_at))/3600
    from public.merchant_billing_payment_requests r
    where r.status='pending'
      and r.requested_at<clock_timestamp()-interval '24 hours'
  ),
  numbered as (
    select
      *,
      row_number() over(
        order by
          case severity when 'critical' then 0 else 1 end,
          issue_type,
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
    min(
      clock_timestamp()-(coalesce(age_hours,0)*interval '1 hour')
    ) filter (where issue_type='pending_payment_review_over_24h'),
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
    v_oldest_stale,
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
    'issues',v_issues
  );
end;
$$;

revoke all on function public.admin_merchant_billing_reconciliation(uuid)
from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_reconciliation(uuid)
to service_role, postgres;
