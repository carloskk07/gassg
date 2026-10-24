-- TAMÃO: create one NON-SELLABLE paid-coupon draft, atomically audited.
-- Reuses the existing coupon package table and platform_admin_audit;
-- creates no product for sale, payment, voucher, balance or second ledger.
-- The original foundation granted service_role direct package writes.
-- Close that unlogged bypass: only the audited SECURITY DEFINER RPC can
-- prepare drafts. An activation workflow will require its own audit later.
revoke insert,update on public.clube_coupon_paid_packages from service_role;

create or replace function public.clube_coupon_paid_package_draft_create(
 p_actor_user_id uuid,
 p_package_key text,
 p_title text,
 p_sale_price_cents integer,
 p_coupon_face_cents integer,
 p_coupons_per_pack integer,
 p_valid_days integer
) returns jsonb
language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_audit_id uuid;
 v_obligation bigint;
 v_key text:=pg_catalog.btrim(p_package_key);
 v_title text:=pg_catalog.btrim(p_title);
begin
 if p_actor_user_id is null or not exists(
    select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active=true
      and a.admin_role='superadmin'
 ) then raise exception 'COUPON_DRAFT_SUPERADMIN_REQUIRED' using errcode='42501'; end if;
 -- Draft preparation is explicitly separated from live commercial release.
 if not exists(
    select 1 from public.platform_launch_control l
    where l.singleton=true and l.commerce_enabled=false
      and l.operation_mode='PRELAUNCH'
 ) then raise exception 'COUPON_DRAFT_PRELAUNCH_REQUIRED' using errcode='42501'; end if;
 if v_key is null or v_key !~ '^[a-z][a-z0-9_]{2,39}$'
    or v_title is null or pg_catalog.length(v_title) not between 6 and 120
    or p_sale_price_cents is null or p_sale_price_cents not between 100 and 1000000
    or p_coupon_face_cents is null or p_coupon_face_cents not between 100 and 1000000
    or p_coupons_per_pack is null or p_coupons_per_pack not between 1 and 15
    or p_valid_days is null or p_valid_days not between 1 and 365
 then raise exception 'COUPON_DRAFT_INPUT_INVALID' using errcode='22023'; end if;
 v_obligation:=p_coupon_face_cents::bigint*p_coupons_per_pack::bigint;
 if v_obligation>p_sale_price_cents then
   raise exception 'COUPON_DRAFT_FACE_EXCEEDS_GROSS' using errcode='22023';
 end if;
 -- Create-only: never update pre-existing packages or change verified flags.
 insert into public.clube_coupon_paid_packages(
    package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,
    valid_days,funding_verified,legal_terms_verified,redeem_settlement_verified,
    sale_enabled
 ) values(v_key,v_title,p_sale_price_cents,p_coupon_face_cents,
    p_coupons_per_pack,p_valid_days,false,false,false,false);
 -- Audit and draft are one transaction. Any rejected audit rolls back
 -- the draft, so a package cannot be created without accountable provenance.
 insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
 ) values(
    p_actor_user_id,'coupon_paid_package_draft_created',
    'clube_coupon_paid_package',v_key,
    pg_catalog.jsonb_build_object(
      'salePriceCents',p_sale_price_cents,
      'totalFaceObligationCents',v_obligation,
      'grossBufferCents',p_sale_price_cents-v_obligation,
      'saleEnabled',false,
      'fundingVerified',false,
      'requiresIndependentNetCostProof',true
    )
 ) returning id into v_audit_id;
 return pg_catalog.jsonb_build_object(
   'ok',true,'source','clube_coupon_paid_package_draft_v1',
   'packageKey',v_key,'auditId',v_audit_id,
   'saleEnabled',false,'fundingVerified',false,
   'legalTermsVerified',false,'redeemSettlementVerified',false,
   'grossBufferCents',p_sale_price_cents-v_obligation,
   'costCoverageVerified',false,'moneyMoved',false
 );
end
$$;
revoke all on function public.clube_coupon_paid_package_draft_create(
 uuid,text,text,integer,integer,integer,integer
) from public,anon,authenticated;
grant execute on function public.clube_coupon_paid_package_draft_create(
 uuid,text,text,integer,integer,integer,integer
) to service_role;
