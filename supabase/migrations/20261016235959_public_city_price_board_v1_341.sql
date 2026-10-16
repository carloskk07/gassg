-- TAMÃO V1.341 — city price board, sourced exclusively from real eligible stores.
-- Informational estimates, never quotes, never authorizes an order.
create or replace function public.public_city_price_board_v1_341(
 p_city text,p_state text
) returns jsonb
language plpgsql stable security definer
set search_path TO 'pg_catalog'
as $function$
declare
 v_city text:=btrim(coalesce(p_city,''));
 v_state text:=upper(btrim(coalesce(p_state,'')));
 v_products jsonb;
 v_count integer:=0;
begin
 if char_length(v_city)<2 or char_length(v_city)>80
   or v_state!~'^[A-Z]{2}$' then
   raise exception 'CITY_PRICE_BOARD_REGION_INVALID' using errcode='22023';
 end if;
 -- Scope is deliberately the identical city + platform commercial gate used
 -- for real offers. Offline, unauthorized or non-compliant stores never count.
 with eligible as(
  select ci.product_code,ci.price_cents+m.delivery_fee_cents as estimated_total_cents,
    greatest(ci.price_confirmed_at,m.delivery_fee_confirmed_at) as confirmed_at,
    m.id as merchant_id
  from public.merchants m
  join public.catalog_items ci on ci.merchant_id=m.id
  where m.id=any(public.market_city_offer_scope(v_city,v_state))
    and ci.active
    and ci.available_stock>0
    and ci.price_cents>0
    and m.delivery_fee_cents>=0
    and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
    and public.merchant_basket_compliance_current(m.id,array[ci.product_code])
 ), grouped as (
  select product_code,min(estimated_total_cents)::integer as lowest_cents,
    max(estimated_total_cents)::integer as highest_cents,
    count(distinct merchant_id)::integer as merchants,
    max(confirmed_at) as updated_at
  from eligible group by product_code
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'code',product_code,'fromCents',lowest_cents,'toCents',highest_cents,
  'merchantCount',merchants,'updatedAt',updated_at
 ) order by lowest_cents,product_code),'[]'::jsonb),
 count(*)::integer into v_products,v_count from grouped;
 return jsonb_build_object(
  'source','public_city_price_board_v1_341',
  'city',v_city,'state',v_state,
  'kind','eligible_merchant_estimates','real',true,
  'requiresPostalConfirmation',true,'notAQuote',true,
  'productCount',v_count,'products',v_products,
  'checkedAt',statement_timestamp());
end;
$function$;
revoke all on function public.public_city_price_board_v1_341(text,text)
 from public,anon,authenticated;
grant execute on function public.public_city_price_board_v1_341(text,text)
 to authenticated,service_role;
notify pgrst,'reload schema';
