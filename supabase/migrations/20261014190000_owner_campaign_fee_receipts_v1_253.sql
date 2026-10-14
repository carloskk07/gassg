-- TAMÃO V1.253: conservative, read-only confirmation of platform fees by campaign.
-- A daily statement may combine multiple orders: NEVER allocate grouped receipts pro rata.
-- A countable receipt must correspond to exactly one order/receivable, no prepaid fee credit,
-- with a matched provider payment event applied to that statement and no refund.
create schema if not exists platform_funding_private_v1_253;
revoke all on schema platform_funding_private_v1_253 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_253 to service_role;

create or replace function platform_funding_private_v1_253.fee_receipts(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $function$
declare
 v_month date:=coalesce(
  p_month,
  date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date
 );
 v_total bigint;
 v_rows jsonb;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'CAMPAIGN_FEE_RECEIPTS_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
   or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')+
     interval '2 months')::date
 then raise exception 'CAMPAIGN_FEE_RECEIPTS_MONTH_INVALID' using errcode='22023';end if;

 select count(*) into v_total from public.platform_owner_budget_allocations_v1_247 a
 where a.month_key=v_month;

 with selected as (
  select a.* from public.platform_owner_budget_allocations_v1_247 a
  where a.month_key=v_month
  order by a.created_at desc,a.allocation_id
  limit 50
 ), measured as (
  select a.*,coalesce(m.attributed_orders,0)::bigint attributed_orders,
    coalesce(m.provider_confirmed_orders,0)::bigint provider_confirmed_orders,
    coalesce(m.provider_confirmed_fee_cents,0)::bigint provider_confirmed_fee_cents
  from selected a
  left join lateral (
   select count(*)::bigint attributed_orders,
     count(*) filter(where evidence.provider_verified)::bigint provider_confirmed_orders,
     coalesce(sum(evidence.fee_cents)
       filter(where evidence.provider_verified),0)::bigint provider_confirmed_fee_cents
   from (
    select coalesce(pr.platform_fee_cents,0)::bigint fee_cents,
     (
       o.status='SETTLED' and o.financial_state='settled'
       and o.payment_confirmed_at is not null
       and pr.order_id=o.id and pr.merchant_id=o.merchant_id
       and pr.status='paid' and pr.platform_fee_cents>0
       and pr.prepaid_credit_applied_cents=0
       and s.id=pr.daily_statement_id and s.merchant_id=pr.merchant_id
       and s.status='paid' and s.resolution_kind='payment' and s.paid_at is not null
       and s.gross_fee_cents=pr.platform_fee_cents
       and s.prepaid_credit_applied_cents=0
       and s.amount_due_cents=pr.platform_fee_cents
       -- A daily statement with multiple receivables cannot be attributed safely
       -- to any particular order without a receipt-level split ledger.
       and (select count(*) from public.platform_receivables other
            where other.daily_statement_id=s.id)=1
       and (select count(*) from public.merchant_billing_payment_requests same_statement
            where same_statement.statement_id=s.id
              and same_statement.status='approved')=1
       and not exists(
        select 1 from public.platform_settlement_adjustments adj
        where adj.order_id=o.id and adj.adjustment_type='platform_fee_refund_due'
          and adj.status in ('open','paid')
       )
       and exists(
        select 1 from public.merchant_billing_payment_requests req
        join public.merchant_billing_payment_events ev
          on ev.id=req.provider_payment_event_id
        where req.statement_id=s.id
          and req.request_kind='statement_payment' and req.status='approved'
          and req.approval_source='provider_event'
          and req.merchant_id=s.merchant_id
          and req.expected_amount_cents=s.amount_due_cents
          and req.received_amount_cents=req.expected_amount_cents
          and ev.payment_request_id=req.id and ev.merchant_id=req.merchant_id
          and ev.status='applied' and ev.applied_at is not null
          and ev.currency='BRL' and ev.amount_cents=req.received_amount_cents
          and not exists(
            select 1 from public.merchant_billing_payment_refunds refund
            where refund.payment_request_id=req.id or refund.payment_event_id=ev.id
          )
       )
     ) as provider_verified
    from public.platform_owner_campaign_order_attributions_v1_252 x
    join public.orders o on o.id=x.order_id
    left join public.platform_receivables pr on pr.order_id=o.id
    left join public.merchant_daily_statements s on s.id=pr.daily_statement_id
    where x.allocation_id=a.allocation_id
   ) evidence
  ) m on true
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'allocationId',allocation_id,
   'campaignTag','tam-'||benefit_key||'-'||to_char(month_key,'YYYYMM')||'-'||campaign_reference,
   'attributedOrders',attributed_orders,
   'providerConfirmedOrders',provider_confirmed_orders,
   'providerConfirmedFeeCents',provider_confirmed_fee_cents,
   'notIndividuallyProvenOrders',attributed_orders-provider_confirmed_orders,
   'bankSettlementVerified',false,'roiMeasured',false,'marketingSpendPaidCents',null
 ) order by created_at desc,allocation_id),'[]'::jsonb)
 into v_rows from measured;

 return jsonb_build_object(
   'source','admin_owner_campaign_fee_receipts_v1_253',
   'month',v_month,'totalCampaigns',v_total,'rows',v_rows,
   'limit',50,'truncated',v_total>50,
   'evidenceLevel','provider_event_applied_single_order_statement_no_refund',
   'bankSettlementVerified',false,'roiMeasured',false,
   'marketingSpendPaidCents',null,
   'readOnly',true,'noTransfers',true,'newBenefitsEnabled',false,
   'spendableCents',0
 );
end;$function$;

revoke all on function platform_funding_private_v1_253.fee_receipts(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_253.fee_receipts(uuid,date)
 to service_role;

create or replace function public.admin_owner_campaign_fee_receipts_v1_253(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select platform_funding_private_v1_253.fee_receipts($1,$2)
$wrapper$;
revoke all on function public.admin_owner_campaign_fee_receipts_v1_253(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_campaign_fee_receipts_v1_253(uuid,date)
 to service_role;

do $acl$begin
 if has_function_privilege(
   'anon','public.admin_owner_campaign_fee_receipts_v1_253(uuid,date)','EXECUTE')
 or has_function_privilege(
   'authenticated','public.admin_owner_campaign_fee_receipts_v1_253(uuid,date)','EXECUTE')
 or has_table_privilege('authenticated','public.platform_receivables','SELECT')
 then raise exception 'CAMPAIGN_FEE_RECEIPTS_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
