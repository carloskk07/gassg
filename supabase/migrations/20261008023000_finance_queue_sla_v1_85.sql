-- TAMÃO — Finance queue SLA observability v1.85
-- Operational SLA only: no payment/request is auto-cancelled or auto-approved.
-- Targets:
--   2h  exact provider match waiting for Finance confirmation
--   4h  provider event waiting in review_required
--   24h merchant payment notice still pending without exact provider match

create or replace function public.admin_merchant_billing_metrics(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
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
    v_oldest_pending,
    v_pending_under_1h_count,
    v_pending_1_4h_count,
    v_pending_4_24h_count,
    v_pending_over_24h_count,
    v_pending_over_24h_cents
  from public.merchant_billing_payment_requests;

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
    +v_pending_unmatched_over_24h_count;

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
      'breachCount',v_sla_breach_count
    ),
    'planMix',v_plan_mix
  );
end;
$$;

revoke all on function public.admin_merchant_billing_metrics(uuid)
from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_metrics(uuid)
to service_role, postgres;

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
  v_matched_sla_breach_count bigint:=0;
  v_event_review_sla_breach_count bigint:=0;
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
            when 'pending_payment_review_over_24h' then 2
            else 3
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
    count(*) filter (
      where issue_type in (
        'pending_payment_review_over_24h',
        'matched_payment_approval_sla_over_2h',
        'payment_event_review_sla_over_4h'
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
        'payment_event_review_sla_over_4h'
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
    'financeQueueSlaBreachCount',v_finance_sla_breach_count,
    'oldestFinanceSlaBreachAt',v_oldest_finance_sla,
    'slaTargets',jsonb_build_object(
      'matchedApprovalHours',2,
      'paymentEventReviewHours',4,
      'pendingPaymentHours',24
    ),
    'issues',v_issues
  );
end;
$$;

revoke all on function public.admin_merchant_billing_reconciliation(uuid)
from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_reconciliation(uuid)
to service_role, postgres;
