-- TAMÃO — Admin merchant billing control tower v1.76
-- Exact server-side aggregates for Finance/Superadmin/Readonly.
-- Avoids deriving financial KPIs from the paginated/limited admin lists.

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
    min(requested_at) filter (where status='pending')
  into
    v_pending_count,
    v_pending_cents,
    v_pending_package_count,
    v_pending_package_cents,
    v_pending_statement_count,
    v_pending_statement_cents,
    v_oldest_pending
  from public.merchant_billing_payment_requests;

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
    'planMix',v_plan_mix
  );
end;
$$;

revoke all on function public.admin_merchant_billing_metrics(uuid)
from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_metrics(uuid)
to service_role, postgres;
