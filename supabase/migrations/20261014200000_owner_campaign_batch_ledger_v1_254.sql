-- TAMÃO V1.254 — virtual immutable-evidence ledger of provider-paid batch statement lines.
-- Every cent is taken from the actual receivable's fee minus prepaid credits;
-- no proportional allocation and NO mutation, money movement, or new credit.
create schema if not exists platform_funding_private_v1_254;
revoke all on schema platform_funding_private_v1_254 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_254 to service_role;

-- Private virtual ledger. Restricted to batch statements containing at least
-- two receivables, so it never overlaps the single-order V1.253 result.
create or replace function platform_funding_private_v1_254.batch_ledger(p_month date)
returns table (
 allocation_id uuid, order_id uuid, statement_id uuid, payment_event_id uuid,
 receipt_line_cents bigint, batch_order_count bigint
) language sql stable security definer
set search_path=pg_catalog as $ledger$
with selected as (
 select a.allocation_id from public.platform_owner_budget_allocations_v1_247 a
 where a.month_key=p_month
 order by a.created_at desc,a.allocation_id limit 50
),
target_orders as (
 select x.allocation_id,x.order_id,pr.daily_statement_id
 from selected a
 join public.platform_owner_campaign_order_attributions_v1_252 x
   on x.allocation_id=a.allocation_id
 join public.platform_receivables pr on pr.order_id=x.order_id
 where pr.daily_statement_id is not null
),
candidate_statements as (
 select distinct t.daily_statement_id id from target_orders t
),
psp_confirmed as (
 select s.id statement_id,ev.id payment_event_id
 from candidate_statements c
 join public.merchant_daily_statements s on s.id=c.id
 join public.merchant_billing_payment_requests r
   on r.statement_id=s.id and r.merchant_id=s.merchant_id
 join public.merchant_billing_payment_events ev
   on ev.id=r.provider_payment_event_id
 where s.status='paid' and s.resolution_kind='payment'
   and s.paid_at is not null and s.amount_due_cents>0
   and r.status='approved' and r.request_kind='statement_payment'
   and r.approval_source='provider_event'
   and r.expected_amount_cents=s.amount_due_cents
   and r.received_amount_cents=r.expected_amount_cents
   and ev.payment_request_id=r.id and ev.merchant_id=r.merchant_id
   and ev.status='applied' and ev.applied_at is not null
   and ev.currency='BRL' and ev.amount_cents=r.received_amount_cents
   and (select count(*) from public.merchant_billing_payment_requests other
        where other.statement_id=s.id and other.status='approved')=1
   and not exists(
     select 1 from public.merchant_billing_payment_refunds refund
     where refund.payment_request_id=r.id or refund.payment_event_id=ev.id
   )
),
all_lines as (
 select v.statement_id,v.payment_event_id,
   count(*)::bigint line_count,
   coalesce(sum(pr.gross_total_cents),0)::bigint sum_sales,
   coalesce(sum(pr.platform_fee_cents),0)::bigint sum_fee,
   coalesce(sum(pr.prepaid_credit_applied_cents),0)::bigint sum_prepaid,
   coalesce(sum(pr.platform_fee_cents-pr.prepaid_credit_applied_cents),0)::bigint sum_due,
   bool_and(
     pr.merchant_id=s.merchant_id and o.merchant_id=s.merchant_id
     and o.status='SETTLED' and o.financial_state='settled'
     and o.payment_confirmed_at is not null
     and pr.status='paid' and pr.platform_fee_cents>0
     and pr.prepaid_credit_applied_cents>=0
     and pr.prepaid_credit_applied_cents<=pr.platform_fee_cents
     and not exists (
       select 1 from public.platform_settlement_adjustments adj
       where adj.order_id=o.id
         and adj.adjustment_type='platform_fee_refund_due'
         and adj.status in ('open','paid')
     )
   ) all_lines_valid
 from psp_confirmed v
 join public.merchant_daily_statements s on s.id=v.statement_id
 join public.platform_receivables pr on pr.daily_statement_id=s.id
 join public.orders o on o.id=pr.order_id
 group by v.statement_id,v.payment_event_id
),
valid_batches as (
 select t.statement_id,t.payment_event_id,t.line_count
 from all_lines t
 join public.merchant_daily_statements s on s.id=t.statement_id
 where t.line_count>=2 and t.all_lines_valid
   and t.sum_sales=s.gross_sales_cents
   and t.sum_fee=s.gross_fee_cents
   and t.sum_prepaid=s.prepaid_credit_applied_cents
   and t.sum_due=s.amount_due_cents
   and t.sum_due>0
)
select t.allocation_id,t.order_id,b.statement_id,b.payment_event_id,
  (pr.platform_fee_cents-pr.prepaid_credit_applied_cents)::bigint receipt_line_cents,
  b.line_count batch_order_count
from target_orders t
join valid_batches b on b.statement_id=t.daily_statement_id
join public.platform_receivables pr on pr.order_id=t.order_id
where pr.platform_fee_cents>pr.prepaid_credit_applied_cents
$ledger$;
revoke all on function platform_funding_private_v1_254.batch_ledger(date)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_254.batch_ledger(date) to service_role;

create or replace function platform_funding_private_v1_254.batch_report(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $report$
declare
 v_month date:=coalesce(p_month,
   date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_count bigint;v_rows jsonb;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active
     and a.admin_role in ('superadmin','finance')
 ) then raise exception 'CAMPAIGN_BATCH_LEDGER_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
    or v_month>(date_trunc('month',
      clock_timestamp() at time zone 'America/Sao_Paulo')+interval '2 months')::date
 then raise exception 'CAMPAIGN_BATCH_LEDGER_MONTH_INVALID' using errcode='22023';end if;
 select count(*) into v_count from public.platform_owner_budget_allocations_v1_247 a
 where a.month_key=v_month;
 with selected as (
  select a.* from public.platform_owner_budget_allocations_v1_247 a
  where a.month_key=v_month
  order by a.created_at desc,a.allocation_id
  limit 50
 ), verified_lines as (
  select * from platform_funding_private_v1_254.batch_ledger(v_month)
 ), grouped as (
  select l.allocation_id,
   count(*)::bigint verified_orders,
   count(distinct l.statement_id)::bigint verified_statements,
   coalesce(sum(l.receipt_line_cents),0)::bigint allocated_net_fee_cents
  from verified_lines l group by l.allocation_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'allocationId',a.allocation_id,
   'campaignTag','tam-'||a.benefit_key||'-'||to_char(a.month_key,'YYYYMM')||'-'||a.campaign_reference,
   'verifiedBatchOrders',coalesce(g.verified_orders,0),
   'verifiedBatchStatements',coalesce(g.verified_statements,0),
   'providerSupportedNetFeeCents',coalesce(g.allocated_net_fee_cents,0),
   'entrySource','receivable_net_fee_statement_exact_payment_event',
   'bankSettlementVerified',false,'roiMeasured',false,
   'cashAvailableCents',0,'paidMarketingCostCents',null
 ) order by a.created_at desc,a.allocation_id),'[]'::jsonb)
 into v_rows
 from selected a left join grouped g on g.allocation_id=a.allocation_id;
 return jsonb_build_object(
  'source','admin_owner_campaign_batch_ledger_v1_254',
  'month',v_month,'totalCampaigns',v_count,'rows',v_rows,
  'limit',50,'truncated',v_count>50,
  'evidenceLevel','psp_paid_statement_balances_exact_all_lines_no_refunds',
  'batchOnly',true,'noDoubleCountingWithV253',true,
  'bankSettlementVerified',false,'roiMeasured',false,
  'paidMarketingCostCents',null,'cashAvailableCents',0,
  'readOnly',true,'noTransfers',true,'newBenefitsEnabled',false
 );
end;$report$;
revoke all on function platform_funding_private_v1_254.batch_report(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_254.batch_report(uuid,date)
 to service_role;

create or replace function public.admin_owner_campaign_batch_ledger_v1_254(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select platform_funding_private_v1_254.batch_report($1,$2)
$wrapper$;
revoke all on function public.admin_owner_campaign_batch_ledger_v1_254(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_campaign_batch_ledger_v1_254(uuid,date)
 to service_role;

-- Indexes help trace individually paid PSP statements without scanning every ledger.
create index if not exists owner_batch_v1_254_receivables_statement
 on public.platform_receivables(daily_statement_id)
 where daily_statement_id is not null;
create index if not exists owner_batch_v1_254_requests_statement_approved
 on public.merchant_billing_payment_requests(statement_id)
 where statement_id is not null and status='approved';

do $acl$begin
 if has_function_privilege('anon',
     'public.admin_owner_campaign_batch_ledger_v1_254(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated',
     'public.admin_owner_campaign_batch_ledger_v1_254(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated',
     'platform_funding_private_v1_254.batch_ledger(date)','EXECUTE')
 then raise exception 'CAMPAIGN_BATCH_LEDGER_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
