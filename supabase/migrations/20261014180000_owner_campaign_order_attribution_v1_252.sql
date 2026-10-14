-- TAMÃO V1.252: one immutable first-party UTM attribution per real order.
-- No merchant payout, founder budget consumption, credited commission or ROI.
create table public.platform_owner_campaign_order_attributions_v1_252 (
 order_id uuid primary key references public.orders(id) on delete restrict,
 allocation_id uuid not null references public.platform_owner_budget_allocations_v1_247(allocation_id) on delete restrict,
 attribution_source text not null default 'checkout_utm'
   check (attribution_source='checkout_utm'),
 attributed_at timestamptz not null default clock_timestamp()
);
create index owner_order_campaign_allocation_v1_252
 on public.platform_owner_campaign_order_attributions_v1_252(allocation_id);
alter table public.platform_owner_campaign_order_attributions_v1_252 enable row level security;
revoke all on public.platform_owner_campaign_order_attributions_v1_252
 from public,anon,authenticated,service_role;

create schema if not exists platform_funding_private_v1_252;
revoke all on schema platform_funding_private_v1_252 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_252 to service_role;

create or replace function platform_funding_private_v1_252.bind_order(
 p_customer uuid,p_order uuid,p_tag text
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $body$
declare
 v_order public.orders%rowtype;
 v_allocation uuid;
 v_existing uuid;
begin
 if p_customer is null or p_order is null or p_tag is null or
   char_length(p_tag)>150 or
   p_tag !~ '^tam-(customer_cashback|customer_referral|merchant_referral|clube_coupons)-[0-9]{6}-[a-z0-9_-]{8,80}$'
 then raise exception 'CAMPAIGN_ATTRIBUTION_INVALID' using errcode='22023';end if;

 select * into v_order from public.orders o where o.id=p_order;
 if not found or v_order.customer_id<>p_customer then
   raise exception 'CAMPAIGN_ATTRIBUTION_ORDER_DENIED' using errcode='42501';
 end if;

 select a.allocation_id into v_existing
 from public.platform_owner_campaign_order_attributions_v1_252 a
 where a.order_id=p_order;

 select a.allocation_id into v_allocation
 from public.platform_owner_budget_allocations_v1_247 a
 where 'tam-'||a.benefit_key||'-'||to_char(a.month_key,'YYYYMM')||'-'||a.campaign_reference=p_tag
   and v_order.created_at>=a.created_at
   and v_order.created_at<a.month_key::timestamp at time zone 'America/Sao_Paulo'+interval '1 month'
   and v_order.created_at>=a.month_key::timestamp at time zone 'America/Sao_Paulo'
   and (a.released_at is null or v_order.created_at<a.released_at)
 limit 1;
 if v_allocation is null then
   raise exception 'CAMPAIGN_ATTRIBUTION_NOT_ELIGIBLE' using errcode='22023';
 end if;
 if v_existing is not null then
   if v_existing<>v_allocation then
     raise exception 'CAMPAIGN_ATTRIBUTION_IMMUTABLE' using errcode='23505';end if;
   return jsonb_build_object('source','owner_order_attribution_v1_252',
       'recorded',true,'replayed',true,'noCharge',true,'spendableCents',0);
 end if;
 -- Bounded creation window prevents attaching campaign labels to historical orders.
 if v_order.created_at<clock_timestamp()-interval '10 minutes'
    or v_order.created_at>clock_timestamp()+interval '30 seconds'
 then raise exception 'CAMPAIGN_ATTRIBUTION_TOO_LATE' using errcode='22023';end if;

 insert into public.platform_owner_campaign_order_attributions_v1_252
   (order_id,allocation_id)
 values(p_order,v_allocation)
 on conflict (order_id) do nothing;
 select a.allocation_id into v_existing
 from public.platform_owner_campaign_order_attributions_v1_252 a
 where a.order_id=p_order;
 if v_existing is distinct from v_allocation then
   raise exception 'CAMPAIGN_ATTRIBUTION_IMMUTABLE' using errcode='23505';end if;
 return jsonb_build_object('source','owner_order_attribution_v1_252',
   'recorded',true,'replayed',false,'noCharge',true,'spendableCents',0);
end;$body$;
revoke all on function platform_funding_private_v1_252.bind_order(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_252.bind_order(uuid,uuid,text)
 to service_role;

create or replace function public.owner_order_campaign_bind_v1_252(
 p_customer uuid,p_order uuid,p_tag text
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_252.bind_order($1,$2,$3)
$wrap$;
revoke all on function public.owner_order_campaign_bind_v1_252(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.owner_order_campaign_bind_v1_252(uuid,uuid,text)
 to service_role;

create or replace function platform_funding_private_v1_252.results(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $report$
declare
 v_month date:=coalesce(p_month,date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_rows jsonb;v_total bigint;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'CAMPAIGN_ORDERS_READ_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
    or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')+interval '2 months')::date
 then raise exception 'CAMPAIGN_ORDERS_MONTH_INVALID' using errcode='22023';end if;

 select count(*) into v_total from public.platform_owner_budget_allocations_v1_247 a
 where a.month_key=v_month;

 select coalesce(jsonb_agg(jsonb_build_object(
   'allocationId',a.allocation_id,
   'campaignTag','tam-'||a.benefit_key||'-'||to_char(a.month_key,'YYYYMM')||'-'||a.campaign_reference,
   'createdOrders',coalesce(s.created_orders,0),
   'settledOrders',coalesce(s.settled_orders,0),
   'reversedOrders',coalesce(s.reversed_orders,0),
   'settledMerchantOrderValueCents',coalesce(s.merchant_gmv,0),
   'platformReceivedRevenueCents',null,
   'financialReturnMeasured',false
 ) order by a.created_at desc,a.allocation_id),'[]'::jsonb) into v_rows
 from (
   select * from public.platform_owner_budget_allocations_v1_247
   where month_key=v_month order by created_at desc,allocation_id limit 50
 ) a
 left join lateral (
   select count(*)::bigint created_orders,
     count(*) filter (where o.status='SETTLED'
        and o.financial_state='settled'
        and o.payment_confirmed_at is not null)::bigint settled_orders,
     count(*) filter (where o.financial_state='reversed')::bigint reversed_orders,
     coalesce(sum(o.total_cents) filter(where o.status='SETTLED'
       and o.financial_state='settled'
       and o.payment_confirmed_at is not null),0)::bigint merchant_gmv
   from public.platform_owner_campaign_order_attributions_v1_252 x
   join public.orders o on o.id=x.order_id
   where x.allocation_id=a.allocation_id
 )s on true;
 return jsonb_build_object(
   'source','admin_owner_campaign_orders_v1_252',
   'month',v_month,'totalCampaigns',v_total,
   'rows',v_rows,'limit',50,'truncated',v_total>50,
   'metricMeaning','first_party_checkout_utm_non_causal_attribution',
   'platformReceivedRevenueCents',null,'financialReturnMeasured',false,
   'readOnly',true,'plannedOnly',true,'noCharge',true,
   'spendableCents',0,'newBenefitsEnabled',false);
end;$report$;
revoke all on function platform_funding_private_v1_252.results(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_252.results(uuid,date) to service_role;
create or replace function public.admin_owner_campaign_orders_v1_252(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_252.results($1,$2)
$wrap$;
revoke all on function public.admin_owner_campaign_orders_v1_252(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_campaign_orders_v1_252(uuid,date)
 to service_role;

do $acl$begin
 if has_table_privilege('anon','public.platform_owner_campaign_order_attributions_v1_252','SELECT')
 or has_table_privilege('authenticated','public.platform_owner_campaign_order_attributions_v1_252','INSERT')
 or has_table_privilege('service_role','public.platform_owner_campaign_order_attributions_v1_252','UPDATE')
 or has_function_privilege('authenticated','public.owner_order_campaign_bind_v1_252(uuid,uuid,text)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_campaign_orders_v1_252(uuid,date)','EXECUTE')
 then raise exception 'CAMPAIGN_ORDER_ATTRIBUTION_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
