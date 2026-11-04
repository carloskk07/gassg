-- Universal coupon only. Previously configured gas/water drafts remain disabled
-- and hidden; do not delete historical configuration or affect invoicing.
create or replace function public.clube_coupon_home_prices_v1_820()
returns jsonb
language sql stable security definer
set search_path=pg_catalog
as $$
 select pg_catalog.jsonb_build_object(
  'source','clube_coupon_home_prices_v1_820',
  'packages',coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'key',p.package_key,
      'title',p.title,
      'priceCents',p.sale_price_cents,
      'faceCents',p.coupon_face_cents,
      'couponCount',p.coupons_per_pack,
      'validDays',p.valid_days,
      'minOrderCents',p.min_order_cents,
      'databaseReleased', (
        p.sale_enabled is true
        and p.funding_verified is true
        and p.legal_terms_verified is true
        and p.redeem_settlement_verified is true
        and exists (
          select 1 from public.clube_coupon_commercial_release_v1_819 r
          where r.package_key=p.package_key and r.enabled is true
            and r.owner_accepts_refund is true
            and r.owner_accepts_merchant_reimbursement is true
            and r.owner_accepts_no_merchant_yet is true
            and r.signed_terms_version='clube_coupon_terms_v1_813'
            and nullif(btrim(r.seller_name),'') is not null
            and nullif(btrim(r.seller_tax_document),'') is not null
            and nullif(btrim(r.seller_address),'') is not null
            and nullif(btrim(r.seller_support_email),'') is not null
        ))
    ) order by case p.package_key
      when 'all_products_3x5_sponsor' then 1
      when 'gas_3x5_sponsor' then 2
      else 3 end),
    '[]'::jsonb)
 )
 from public.clube_coupon_paid_packages p
 where p.package_key='all_products_3x5_sponsor'
   and p.sponsored_by_owner is true
   and p.sale_price_cents>=100
   and p.coupon_face_cents>=100
   and p.coupons_per_pack between 1 and 15
   and p.valid_days between 1 and 365;
$$;
