-- TAMÃO V1.239 — Clube TAMÃO: immutable, noncommercial package drafts + finance preview.
-- No customer purchases, coupon issuance, sponsor commitment, payment or checkout integration.
-- Every preview is a hypothetical scenario. Existing order/fee/reward ledgers remain untouched.
create table if not exists public.clube_package_drafts_v1_239 (
  package_key text primary key check (package_key in ('gas_3x5','water_5x2')),
  category text not null check (category in ('gas','water')),
  price_cents integer not null check (price_cents between 0 and 100000),
  coupon_count integer not null check (coupon_count between 1 and 12),
  discount_per_coupon_cents integer not null check (discount_per_coupon_cents between 1 and 10000),
  min_order_cents integer not null check (min_order_cents between 1 and 1000000),
  validity_days integer not null check (validity_days between 1 and 365),
  sales_enabled boolean not null default false check (sales_enabled = false),
  redemption_enabled boolean not null default false check (redemption_enabled = false),
  created_at timestamptz not null default now()
);
insert into public.clube_package_drafts_v1_239
 (package_key,category,price_cents,coupon_count,discount_per_coupon_cents,min_order_cents,validity_days)
values
 ('gas_3x5','gas',890,3,500,10000,180),
 ('water_5x2','water',490,5,200,3000,90)
on conflict (package_key) do nothing;
alter table public.clube_package_drafts_v1_239 enable row level security;
revoke all on table public.clube_package_drafts_v1_239 from public,anon,authenticated,service_role;
grant select on table public.clube_package_drafts_v1_239 to service_role;

create schema if not exists clube_internal_v1_239;
revoke all on schema clube_internal_v1_239 from public,anon,authenticated;
grant usage on schema clube_internal_v1_239 to service_role;

create or replace function clube_internal_v1_239.preview(
 p_actor uuid,
 p_package_key text,
 p_order_value_cents integer,
 p_fee_bps integer,
 p_merchant_sponsor_bps integer,
 p_brand_sponsor_bps integer,
 p_payment_cost_cents integer,
 p_variable_cost_cents integer,
 p_cashback_cost_cents integer,
 p_referral_cost_cents integer,
 p_minimum_contribution_cents integer
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare
 p public.clube_package_drafts_v1_239%rowtype;
 v_merch bigint;
 v_brand bigint;
 v_platform bigint;
 v_fee bigint;
 v_orders bigint;
 v_payment_net bigint;
 v_no_fee bigint;
 v_all_incremental bigint;
 v_no_fee_after_min bigint;
 v_incremental_after_min bigint;
begin
 if p_actor is null or not exists (
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active
  and a.admin_role in ('superadmin','finance')
 ) then
  raise exception 'CLUBE_PREVIEW_ACCESS_DENIED' using errcode='42501';
 end if;
 if p_package_key not in ('gas_3x5','water_5x2') or p_package_key is null
 or p_order_value_cents is null or p_order_value_cents not between 1 and 100000000
 or p_fee_bps is null or p_fee_bps not between 0 and 1500
 or p_merchant_sponsor_bps is null or p_merchant_sponsor_bps not between 0 and 10000
 or p_brand_sponsor_bps is null or p_brand_sponsor_bps not between 0 and 10000
 or p_merchant_sponsor_bps + p_brand_sponsor_bps > 10000
 or p_payment_cost_cents is null or p_payment_cost_cents not between 0 and 100000
 or p_variable_cost_cents is null or p_variable_cost_cents not between 0 and 100000
 or p_cashback_cost_cents is null or p_cashback_cost_cents not between 0 and 100000
 or p_referral_cost_cents is null or p_referral_cost_cents not between 0 and 100000
 or p_minimum_contribution_cents is null or p_minimum_contribution_cents not between 0 and 100000
 then raise exception 'CLUBE_PREVIEW_INVALID_INPUT' using errcode='22023';
 end if;
 select * into p from public.clube_package_drafts_v1_239 d
  where d.package_key = p_package_key;
 if p.package_key is null or p.sales_enabled or p.redemption_enabled then
  raise exception 'CLUBE_PREVIEW_POLICY_UNVERIFIED' using errcode='42501';
 end if;
 if p_order_value_cents < p.min_order_cents
    or p_order_value_cents <= p.discount_per_coupon_cents
    or p_payment_cost_cents > p.price_cents then
  raise exception 'CLUBE_PREVIEW_INVALID_INPUT' using errcode='22023';
 end if;
 -- Round the two independently funded shares DOWN. Remainder belongs to TAMÃO.
 v_merch:=floor(p.discount_per_coupon_cents::numeric*p_merchant_sponsor_bps/10000)::bigint;
 v_brand:=floor(p.discount_per_coupon_cents::numeric*p_brand_sponsor_bps/10000)::bigint;
 v_platform:=p.discount_per_coupon_cents-v_merch-v_brand;
 v_orders:=p.coupon_count::bigint;
 v_fee:=floor((p_order_value_cents-p.discount_per_coupon_cents)::numeric*p_fee_bps/10000)::bigint;
 v_payment_net:=p.price_cents-p_payment_cost_cents;
 -- Conservative scenario counts ZERO additional platform fee from coupon-attributed orders.
 -- Never claim that an existing customer's order is incremental.
 v_no_fee:=v_payment_net-v_orders*(v_platform+p_variable_cost_cents+
  p_cashback_cost_cents+p_referral_cost_cents);
 v_all_incremental:=v_no_fee+v_orders*v_fee;
 v_no_fee_after_min:=v_no_fee-v_orders*p_minimum_contribution_cents;
 v_incremental_after_min:=v_all_incremental-v_orders*p_minimum_contribution_cents;
 return jsonb_build_object(
  'source','clube_coupon_finance_preview_v1_239','readOnly',true,
  'salesEnabled',false,'redemptionEnabled',false,'noCharge',true,
  'noCouponIssued',true,'noMerchantSaleProceeds',true,
  'sponsorVerified',false,'isScenarioNotRealPayment',true,
  'packageKey',p.package_key,'category',p.category,
  'priceCents',p.price_cents,'couponCount',p.coupon_count,
  'discountPerCouponCents',p.discount_per_coupon_cents,
  'totalDiscountCents',v_orders*p.discount_per_coupon_cents,
  'validityDays',p.validity_days,'minOrderCents',p.min_order_cents,
  'orderValueCents',p_order_value_cents,
  'feeBps',p_fee_bps,
  'merchantSponsorBps',p_merchant_sponsor_bps,'brandSponsorBps',p_brand_sponsor_bps,
  'merchantSharePerCouponCents',v_merch,'brandSharePerCouponCents',v_brand,
  'tamaoSharePerCouponCents',v_platform,
  'totalTamaoSubsidyCents',v_platform*v_orders,
  'paymentCostCents',p_payment_cost_cents,'netPackageRevenueCents',v_payment_net,
  'illustrativeFeePerIncrementalOrderCents',v_fee,
  'scenarioZeroIncrementalOrdersCents',v_no_fee,
  'scenarioAllIncrementalOrdersCents',v_all_incremental,
  'scenarioZeroIncrementalAfterMinCents',v_no_fee_after_min,
  'scenarioAllIncrementalAfterMinCents',v_incremental_after_min,
  'sponsorFundingRequiredCents',(v_merch+v_brand)*v_orders,
  'scenariosAreNotForecasts',true,
  'activationRequirements',jsonb_build_array(
   'Revenda participante e acordo documentado por cidade/categoria',
   'Cobertura financeira comprovada, orçamento e limite de emissão',
   'Pagamento do pacote ao TAMÃO regularizado com tributos e política de estorno',
   'Reserva atômica e consumo do cupom somente após liquidação confirmada',
   'Tratamento de cancelamento, arrependimento, chargeback e devolução',
   'Aprovação financeira e implantação independente com testes')
 );
end;
$fn$;
revoke all on function clube_internal_v1_239.preview(uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)
 from public,anon,authenticated,service_role;
grant execute on function clube_internal_v1_239.preview(uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)
 to service_role;

create or replace function public.admin_clube_coupon_preview_v1_239(
 p_actor uuid,
 p_package_key text,
 p_order_value_cents integer,
 p_fee_bps integer,
 p_merchant_sponsor_bps integer,
 p_brand_sponsor_bps integer,
 p_payment_cost_cents integer,
 p_variable_cost_cents integer,
 p_cashback_cost_cents integer,
 p_referral_cost_cents integer,
 p_minimum_contribution_cents integer
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select clube_internal_v1_239.preview($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
$wrapper$;
revoke all on function public.admin_clube_coupon_preview_v1_239(uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_clube_coupon_preview_v1_239(uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)
 to service_role;
do $acl$ begin
 if has_table_privilege('anon','public.clube_package_drafts_v1_239','SELECT')
    or has_table_privilege('authenticated','public.clube_package_drafts_v1_239','SELECT')
    or has_table_privilege('authenticated','public.clube_package_drafts_v1_239','INSERT')
    or has_function_privilege('anon','public.admin_clube_coupon_preview_v1_239(uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.admin_clube_coupon_preview_v1_239(uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)','EXECUTE')
    or not has_function_privilege('service_role','public.admin_clube_coupon_preview_v1_239(uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)','EXECUTE')
 then raise exception 'CLUBE_PREVIEW_ACL_DRIFT' using errcode='42501'; end if;
end $acl$;