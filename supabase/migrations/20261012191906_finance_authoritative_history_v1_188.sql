-- V1.188: historical finance facts from the full database, not a paginated UI sample.
-- Admin-only service-role RPC, with audited role revalidation in the Edge gateway.
create or replace function public.admin_finance_receipts_history_v1_188(p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $finance$
declare
  v_role text;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_role := public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode = '42501';
  end if;

  with
  kinds(kind) as (
    values ('package_purchase'::text),('statement_payment'::text),('refund_recovery'::text)
  ),
  approved as (
    select r.id, r.request_kind as kind, r.received_amount_cents as amount_cents,
           r.resolved_at as event_at
    from public.merchant_billing_payment_requests r
    where r.status='approved'
      and r.request_kind in (select kind from kinds)
      and r.received_amount_cents is not null
      and r.received_amount_cents>=0
      and r.resolved_at is not null
      and r.resolved_at<=v_now
  ),
  linked_refunds as (
    select f.id, a.kind, f.amount_cents, coalesce(f.occurred_at,f.received_at) as event_at
    from public.merchant_billing_payment_refunds f
    join approved a on a.id=f.payment_request_id
    where f.status<>'ignored_unrelated'
      and f.amount_cents>0
      and coalesce(f.occurred_at,f.received_at)<=v_now
  ),
  facts as (
    select a.kind, 'approval'::text as event_type, a.amount_cents, a.event_at from approved a
    union all
    select f.kind, 'refund'::text, f.amount_cents, f.event_at from linked_refunds f
  ),
  kind_rows as (
    select k.kind,
      count(*) filter (where f.event_type='approval')::bigint as approved_count,
      coalesce(sum(f.amount_cents) filter (where f.event_type='approval'),0)::bigint as approved_cents,
      count(*) filter (where f.event_type='refund')::bigint as refunded_count,
      coalesce(sum(f.amount_cents) filter (where f.event_type='refund'),0)::bigint as refunded_cents,
      coalesce(sum(f.amount_cents) filter (where f.event_type='approval' and f.event_at>=v_now-interval '30 days'),0)::bigint as approved_30d,
      coalesce(sum(f.amount_cents) filter (where f.event_type='refund' and f.event_at>=v_now-interval '30 days'),0)::bigint as refunded_30d
    from kinds k left join facts f on f.kind=k.kind
    group by k.kind
  ),
  periods(month_start) as (
    select generate_series(
      date_trunc('month',v_now at time zone 'America/Sao_Paulo')-interval '5 months',
      date_trunc('month',v_now at time zone 'America/Sao_Paulo'),interval '1 month'
    )
  ),
  month_rows as (
    select m.month_start,
      coalesce(sum(f.amount_cents) filter (where f.event_type='approval'),0)::bigint as approved_cents,
      coalesce(sum(f.amount_cents) filter (where f.event_type='refund'),0)::bigint as refunded_cents,
      count(*) filter (where f.event_type='approval')::bigint as approved_count
    from periods m
    left join facts f on date_trunc('month',f.event_at at time zone 'America/Sao_Paulo')=m.month_start
    group by m.month_start
  )
  select jsonb_build_object(
    'source','database_complete',
    'generatedAt',v_now,
    'timezone','America/Sao_Paulo',
    'window','six_calendar_months',
    'kindTotals',(select coalesce(jsonb_object_agg(k.kind,jsonb_build_object(
      'approvedCount',k.approved_count,
      'approvedCents',k.approved_cents,
      'linkedRefundCount',k.refunded_count,
      'linkedRefundCents',k.refunded_cents,
      'netAfterLinkedRefundsCents',k.approved_cents-k.refunded_cents,
      'approved30dCents',k.approved_30d,
      'linkedRefund30dCents',k.refunded_30d,
      'net30dCents',k.approved_30d-k.refunded_30d
    )),'{}'::jsonb) from kind_rows k),
    'monthly',(select coalesce(jsonb_agg(jsonb_build_object(
      'month',to_char(m.month_start,'YYYY-MM'),
      'approvedCount',m.approved_count,
      'approvedCents',m.approved_cents,
      'linkedRefundCents',m.refunded_cents,
      'netAfterLinkedRefundsCents',m.approved_cents-m.refunded_cents
    ) order by m.month_start),'[]'::jsonb) from month_rows m),
    'unlinkedRefundCount',(select count(*)::bigint from public.merchant_billing_payment_refunds f
      where f.payment_request_id is null and f.status<>'ignored_unrelated'),
    'unlinkedRefundCents',(select coalesce(sum(f.amount_cents),0)::bigint from public.merchant_billing_payment_refunds f
      where f.payment_request_id is null and f.status<>'ignored_unrelated'),
    'unverifiableApprovedCount',(select count(*)::bigint
      from public.merchant_billing_payment_requests r where r.status='approved'
       and (r.request_kind not in (select kind from kinds)
         or r.received_amount_cents is null or r.received_amount_cents<0
         or r.resolved_at is null or r.resolved_at>v_now))
  ) into v_result;
  return v_result;
end;
$finance$;

-- RPC can only be reached through the authenticated admin-ops server with service role.
revoke all on function public.admin_finance_receipts_history_v1_188(uuid) from public, anon, authenticated;
grant execute on function public.admin_finance_receipts_history_v1_188(uuid) to service_role;
