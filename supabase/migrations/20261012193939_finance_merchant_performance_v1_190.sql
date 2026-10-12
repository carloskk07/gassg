-- V1.190: protected per-merchant financial aggregates; applied as finance_merchant_performance_v1_190.
CREATE OR REPLACE FUNCTION public.admin_finance_merchant_performance_v1_190(p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_role text;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_role := public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  with
  fee_totals as (
    select p.merchant_id,
      coalesce(sum(p.platform_fee_cents) filter (
        where p.status in ('open','paid','waived')
          and p.created_at>=v_now-interval '30 days'
      ),0)::bigint as recorded_fees_30d_cents,
      coalesce(sum(p.platform_fee_cents) filter (
        where p.status='open'
      ),0)::bigint as open_receivables_cents
    from public.platform_receivables p
    group by p.merchant_id
  ),
  statement_totals as (
    select s.merchant_id,
      count(*) filter (where s.status in ('open','overdue'))::bigint as open_count,
      coalesce(sum(s.amount_due_cents) filter (
        where s.status in ('open','overdue')
      ),0)::bigint as open_cents,
      count(*) filter (
        where s.status='overdue'
          or (s.status='open' and s.due_at<v_now)
      )::bigint as overdue_count,
      coalesce(sum(s.amount_due_cents) filter (
        where s.status='overdue'
          or (s.status='open' and s.due_at<v_now)
      ),0)::bigint as overdue_cents
    from public.merchant_daily_statements s
    group by s.merchant_id
  ),
  payment_totals as (
    select r.merchant_id,
      count(*) filter (
        where r.status='approved' and r.received_amount_cents is not null
          and r.received_amount_cents>=0 and r.resolved_at is not null
          and r.resolved_at<=v_now
      )::bigint as approved_count,
      coalesce(sum(r.received_amount_cents) filter (
        where r.status='approved' and r.received_amount_cents>=0
          and r.resolved_at is not null and r.resolved_at<=v_now
          and r.request_kind='statement_payment'
      ),0)::bigint as approved_daily_cents,
      coalesce(sum(r.received_amount_cents) filter (
        where r.status='approved' and r.received_amount_cents>=0
          and r.resolved_at is not null and r.resolved_at<=v_now
          and r.request_kind='package_purchase'
      ),0)::bigint as approved_packages_cents,
      coalesce(sum(r.received_amount_cents) filter (
        where r.status='approved' and r.received_amount_cents>=0
          and r.resolved_at is not null and r.resolved_at<=v_now
          and r.request_kind='refund_recovery'
      ),0)::bigint as approved_recoveries_cents,
      count(*) filter (where r.status='pending')::bigint as pending_count,
      coalesce(sum(r.expected_amount_cents) filter (
        where r.status='pending'
      ),0)::bigint as pending_cents,
      count(*) filter (
        where r.status='approved' and (
          r.received_amount_cents is null or r.received_amount_cents<0
          or r.resolved_at is null or r.resolved_at>v_now
        )
      )::bigint as unverifiable_approved_count
    from public.merchant_billing_payment_requests r
    group by r.merchant_id
  ),
  refund_totals as (
    select f.merchant_id,
      count(*)::bigint as linked_refund_count,
      coalesce(sum(f.amount_cents),0)::bigint as linked_refund_cents
    from public.merchant_billing_payment_refunds f
    where f.payment_request_id is not null
      and f.merchant_id is not null
      and f.status <> 'ignored_unrelated'
      and coalesce(f.occurred_at,f.received_at)<=v_now
    group by f.merchant_id
  ),
  merchant_rows as (
    select m.id as merchant_id,
      m.name as merchant_name,
      m.status as merchant_status,
      coalesce(nullif(btrim(d.city),''),'Município não informado') as city,
      coalesce(nullif(btrim(d.state),''),'—') as state,
      a.plan_key,coalesce(a.sales_hold,false) as sales_hold,
      coalesce(a.credit_balance_cents,0)::bigint as credit_balance_cents,
      coalesce(a.credit_reserved_cents,0)::bigint as credit_reserved_cents,
      coalesce(f.recorded_fees_30d_cents,0)::bigint as recorded_fees_30d_cents,
      coalesce(f.open_receivables_cents,0)::bigint as open_receivables_cents,
      coalesce(st.open_count,0)::bigint as open_statement_count,
      coalesce(st.open_cents,0)::bigint as open_statement_cents,
      coalesce(st.overdue_count,0)::bigint as overdue_statement_count,
      coalesce(st.overdue_cents,0)::bigint as overdue_statement_cents,
      coalesce(pa.approved_count,0)::bigint as approved_payment_count,
      coalesce(pa.approved_daily_cents,0)::bigint as approved_daily_cents,
      coalesce(pa.approved_packages_cents,0)::bigint as approved_packages_cents,
      coalesce(pa.approved_recoveries_cents,0)::bigint as approved_recoveries_cents,
      coalesce(pa.pending_count,0)::bigint as pending_payment_count,
      coalesce(pa.pending_cents,0)::bigint as pending_payment_cents,
      coalesce(pa.unverifiable_approved_count,0)::bigint as unverifiable_approved_count,
      coalesce(r.linked_refund_count,0)::bigint as linked_refund_count,
      coalesce(r.linked_refund_cents,0)::bigint as linked_refund_cents
    from public.merchants m
    left join public.merchant_business_details d on d.merchant_id=m.id
    left join public.merchant_billing_accounts a on a.merchant_id=m.id
    left join fee_totals f on f.merchant_id=m.id
    left join statement_totals st on st.merchant_id=m.id
    left join payment_totals pa on pa.merchant_id=m.id
    left join refund_totals r on r.merchant_id=m.id
  ),
  prioritized as (
    select * from merchant_rows
    order by overdue_statement_cents desc,
      open_statement_cents desc,
      recorded_fees_30d_cents desc,
      merchant_name asc,
      merchant_id asc
    limit 200
  )
  select pg_catalog.jsonb_build_object(
    'source','database_complete_per_merchant',
    'generatedAt',v_now,
    'totalMerchants',(select count(*)::bigint from merchant_rows),
    'rowLimit',200,
    'rows',(select coalesce(jsonb_agg(jsonb_build_object(
      'merchantId',x.merchant_id,
      'merchantName',x.merchant_name,
      'merchantStatus',x.merchant_status,
      'city',x.city,'state',x.state,
      'planKey',x.plan_key,'salesHold',x.sales_hold,
      'creditBalanceCents',x.credit_balance_cents,
      'creditReservedCents',x.credit_reserved_cents,
      'recordedFees30dCents',x.recorded_fees_30d_cents,
      'openReceivablesCents',x.open_receivables_cents,
      'openStatementCount',x.open_statement_count,
      'openStatementCents',x.open_statement_cents,
      'overdueStatementCount',x.overdue_statement_count,
      'overdueStatementCents',x.overdue_statement_cents,
      'approvedPaymentCount',x.approved_payment_count,
      'approvedDailyCents',x.approved_daily_cents,
      'approvedPackagesCents',x.approved_packages_cents,
      'approvedRecoveriesCents',x.approved_recoveries_cents,
      'pendingPaymentCount',x.pending_payment_count,
      'pendingPaymentCents',x.pending_payment_cents,
      'unverifiableApprovedCount',x.unverifiable_approved_count,
      'linkedRefundCount',x.linked_refund_count,
      'linkedRefundCents',x.linked_refund_cents
    ) order by x.overdue_statement_cents desc,
        x.open_statement_cents desc,x.recorded_fees_30d_cents desc,
        x.merchant_name asc,x.merchant_id asc),'[]'::jsonb)
      from prioritized x)
  ) into v_result;

  return v_result;
end;
$function$


revoke all on function public.admin_finance_merchant_performance_v1_190(uuid) from public, anon, authenticated;
grant execute on function public.admin_finance_merchant_performance_v1_190(uuid) to service_role;
