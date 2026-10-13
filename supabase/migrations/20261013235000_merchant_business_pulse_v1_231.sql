-- TAMÃO V1.231 — private, read-only commercial pulse for each merchant.
-- Orders are not payouts; only non-reversed SETTLED orders enter historical sales.
-- No subscription, promotion, advertising, payment, invoice or reward is created.
create or replace function public.merchant_business_pulse_v1_231(
 p_actor_user_id uuid, p_merchant_id uuid
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog as $fn$
declare
 v_now timestamptz:=statement_timestamp();
 v_metrics jsonb;
 v_products jsonb;
begin
 if p_actor_user_id is null or p_merchant_id is null
    or not exists(
      select 1 from public.merchant_members mm
      where mm.user_id=p_actor_user_id and mm.merchant_id=p_merchant_id
        and mm.active and mm.member_role in ('owner','manager')
    ) then
    raise exception 'BUSINESS_PULSE_PERMISSION_DENIED' using errcode='42501';
 end if;

 with scoped as (
   select o.id,o.status,o.financial_state,o.total_cents
   from public.orders o
   where o.merchant_id=p_merchant_id
     and o.created_at>=v_now-interval '30 days'
     and o.created_at<=v_now
 )
 select jsonb_build_object(
   'ordersCreated',count(*)::bigint,
   'settledOrders',count(*) filter(
     where status='SETTLED' and financial_state='settled')::bigint,
   'cancelledOrders',count(*) filter(where status='CANCELLED')::bigint,
   'reversedOrders',count(*) filter(
     where status='SETTLED' and financial_state='reversed')::bigint,
   'activeOrders',count(*) filter(
     where status not in ('SETTLED','CANCELLED'))::bigint,
   'settledSalesCents',coalesce(sum(greatest(total_cents,0))
     filter(where status='SETTLED' and financial_state='settled'),0)::bigint
 ) into v_metrics from scoped;

 select coalesce(jsonb_agg(jsonb_build_object(
   'name', p.product_name,
   'quantity',p.units,
   'salesCents',p.gross_cents
 ) order by p.units desc,p.product_name),'[]'::jsonb)
 into v_products
 from (
   select max(left(oi.product_name,100)) as product_name,
          sum(oi.quantity)::bigint as units,
          sum(greatest(oi.line_total_cents,0))::bigint as gross_cents
   from public.orders o
   join public.order_items oi on oi.order_id=o.id
   where o.merchant_id=p_merchant_id
     and o.created_at>=v_now-interval '30 days'
     and o.created_at<=v_now
     and o.status='SETTLED' and o.financial_state='settled'
   group by oi.product_code
   order by sum(oi.quantity) desc,max(left(oi.product_name,100))
   limit 5
 ) p;

 return jsonb_build_object(
   'source','merchant_business_pulse_v1_231',
   'merchantId',p_merchant_id,
   'generatedAt',v_now,
   'periodDays',30,
   'readOnly',true,
   'salesNotPlatformRevenue',true,
   'adsBillingEnabled',false,
   'proBillingEnabled',false,
   'metrics',v_metrics,
   'topProducts',v_products
 );
end;
$fn$;
revoke all on function public.merchant_business_pulse_v1_231(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.merchant_business_pulse_v1_231(uuid,uuid)
 to service_role;
