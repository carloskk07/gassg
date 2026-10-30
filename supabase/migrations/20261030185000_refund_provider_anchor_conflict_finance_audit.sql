-- #493: Flag conflicting provider vs provisional refund anchors in existing Admin Finance reconciliation.
-- Read-only; no alteration to immutable PSP facts, merchant holds, recoveries or access grants.
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

    union all

    -- PSP correlation and an existing manual refund anchor disagree.
    -- Immutable refund facts must not be automatically reassigned.
    select
      'critical',
      'refund_provider_anchor_request_conflict',
      r.merchant_id,
      r.id::text,
      0::bigint,
      0::bigint,
      extract(epoch from (clock_timestamp()-r.received_at))/3600
    from public.merchant_billing_payment_refunds r
    join lateral (
      select e.payment_request_id
      from public.merchant_billing_payment_events e
      where e.provider=r.provider
        and lower(trim(e.reconciliation_key))=
            lower(trim(r.original_reconciliation_key))
        and e.payment_request_id is not null
        and e.merchant_id is not null
        and e.status in ('matched_exact','applied','already_applied')
      order by
        case e.status
          when 'applied' then 0
          when 'already_applied' then 1
          else 2
        end,
        e.received_at,e.id
      limit 1
    ) authoritative_event on true
    where r.status='review_required'
      and r.payment_request_id is not null
      and r.merchant_id is not null
      and r.payment_event_id is null
      and r.payment_request_id
          is distinct from authoritative_event.payment_request_id

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
