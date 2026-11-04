-- Public price snapshot for precisely the three owner-sponsored Clube TAMÃO packages.
-- Read-only RPC returns no seller/user/transaction fields and NEVER enables payment.
-- The Pix checkout continues to use its independent legal, funding and PSP gates.
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
 where p.package_key in (
   'all_products_3x5_sponsor','gas_3x5_sponsor','water_5x2_sponsor'
 )
   and p.sponsored_by_owner is true
   and p.sale_price_cents>=100
   and p.coupon_face_cents>=100
   and p.coupons_per_pack between 1 and 15
   and p.valid_days between 1 and 365;
$$;
revoke all on function public.clube_coupon_home_prices_v1_820() from public,anon,authenticated;
grant execute on function public.clube_coupon_home_prices_v1_820() to anon,authenticated;

-- Exact launch ACL fingerprint must be reviewed when adding the read-only endpoint.
do $$
declare v_before jsonb; v_after jsonb; v_definition text;
begin
 v_before:=public.tamao_launch_acl_posture_v1();
 if v_before->>'rpcDigest' is distinct from '632ccbc703c18608dbbbfd0a4179b708'
    or (v_before->>'rpcCount')::integer<>32
    or v_before->>'tableDigest' is distinct from '67838fe06fa43d7692e12d8e11a3de91'
 then raise exception 'COUPON_PUBLIC_PRICE_ACL_DRIFT'; end if;
 select pg_get_functiondef('public.platform_launch_readiness()'::regprocedure)
   into v_definition;
 if position('632ccbc703c18608dbbbfd0a4179b708' in v_definition)=0 then
   raise exception 'COUPON_PUBLIC_PRICE_LAUNCH_BASELINE_DRIFT'; end if;
 v_after:=public.tamao_launch_acl_posture_v1();
 execute replace(v_definition,'632ccbc703c18608dbbbfd0a4179b708',
                               v_after->>'rpcDigest');
end;
$$;
