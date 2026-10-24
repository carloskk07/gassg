-- TAMÃO: service-only coupon quote reservation must never hold an
-- unfunded voucher. This updates the ORIGINAL reserve RPC in place; no new
-- wallet, balance, coupon engine, table, user or merchant payout.
-- Source: 20261019170000_clube_coupon_paid_pix_financial_foundation.sql
-- Follows 20261019180000_clube_coupon_order_atomic_checkout.sql, which
-- added the net_proceeds_* proof columns. Only real, audited reconciliation
-- recorded via the existing financial flow can satisfy the guard.
create or replace function public.clube_coupon_paid_quote_reserve(
 p_customer_user_id uuid,p_voucher_id uuid,p_quote_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_invoice_id uuid;
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_voucher public.clube_coupon_paid_issuances%rowtype;
 v_quote record;
begin
 if p_customer_user_id is null or p_voucher_id is null or p_quote_id is null
 then raise exception 'COUPON_RESERVATION_INPUT_INVALID' using errcode='22023'; end if;
 select invoice_id into v_invoice_id from public.clube_coupon_paid_issuances
 where id=p_voucher_id;
 if not found then raise exception 'COUPON_NOT_FOUND' using errcode='P0002'; end if;
 select * into v_invoice from public.clube_coupon_paid_invoices
 where id=v_invoice_id for update;
 if not found or v_invoice.customer_user_id<>p_customer_user_id
 then raise exception 'COUPON_NOT_OWNED' using errcode='42501'; end if;
 select * into v_voucher from public.clube_coupon_paid_issuances
 where id=p_voucher_id for update;
 if not found or v_voucher.invoice_id<>v_invoice.id
    or v_voucher.customer_user_id<>p_customer_user_id
 then raise exception 'COUPON_OWNER_MISMATCH' using errcode='42501'; end if;
 if v_invoice.status<>'paid' or v_invoice.paid_at is null
    or v_invoice.provider_payment_id is null
    or v_invoice.provider_order_id is null
 then raise exception 'COUPON_PAYMENT_UNVERIFIED' using errcode='42501'; end if;
 if not exists(
   select 1 from public.clube_coupon_paid_packages p
   where p.package_key=v_invoice.package_key
     and p.funding_verified and p.legal_terms_verified
     and p.redeem_settlement_verified
 ) then raise exception 'COUPON_FUNDING_UNVERIFIED' using errcode='42501'; end if;
 -- Until sponsored-funding receipts are implemented, require the provider
 -- payment alone to cover the WHOLE outstanding face-value obligation.
 if v_invoice.sale_price_cents::bigint<
    v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint
 then raise exception 'COUPON_FUNDS_INSUFFICIENT' using errcode='42501'; end if;
 -- This RPC is service-role only, but must independently enforce the
 -- same *liquid* lastro as create_order. A gross approved Pix never gives
 -- permission to hold a voucher before reconciliation of provider fees.
 -- A reservation replay must also be blocked if the invoice was changed.
 if v_invoice.net_proceeds_verified_at is null
    or v_invoice.net_proceeds_reference is null
    or v_invoice.net_proceeds_cents is null
    or v_invoice.net_proceeds_cents::bigint<
       v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint
 then raise exception 'COUPON_NET_PROCEEDS_UNVERIFIED'
  using errcode='42501'; end if;
 if v_voucher.face_cents<>v_invoice.coupon_face_cents
    or v_voucher.expires_at<=clock_timestamp()
 then raise exception 'COUPON_EXPIRED_OR_CHANGED' using errcode='40001'; end if;
 select customer_id,gross_total_cents,consumed_at,expires_at
 into v_quote from public.quotes
 where id=p_quote_id for share;
 if not found or v_quote.customer_id<>p_customer_user_id
 then raise exception 'COUPON_QUOTE_NOT_OWNED' using errcode='42501'; end if;
 if v_quote.consumed_at is not null or v_quote.expires_at<=clock_timestamp()
 then raise exception 'COUPON_QUOTE_STALE' using errcode='40001'; end if;
 if v_quote.gross_total_cents<v_voucher.face_cents
 then raise exception 'COUPON_EXCEEDS_QUOTE' using errcode='22023'; end if;
 if v_voucher.status='reserved' and v_voucher.reserved_quote_id=p_quote_id
 then return pg_catalog.jsonb_build_object(
   'ok',true,'reserved',true,'replayed',true,
   'voucherId',v_voucher.id,'quoteId',p_quote_id,
   'faceCents',v_voucher.face_cents,'appliedCents',0);
 end if;
 if v_voucher.status<>'issued' or v_voucher.reserved_quote_id is not null
 then raise exception 'COUPON_NOT_AVAILABLE' using errcode='40001'; end if;
 if exists(select 1 from public.clube_coupon_paid_issuances c
    where c.reserved_quote_id=p_quote_id)
 then raise exception 'COUPON_QUOTE_ALREADY_RESERVED' using errcode='23505'; end if;
 update public.clube_coupon_paid_issuances
 set status='reserved',reserved_quote_id=p_quote_id,reserved_at=clock_timestamp()
 where id=v_voucher.id;
 return pg_catalog.jsonb_build_object(
   'ok',true,'reserved',true,'replayed',false,
   'voucherId',v_voucher.id,'quoteId',p_quote_id,
   'faceCents',v_voucher.face_cents,'appliedCents',0);
end
$$;
revoke all on function public.clube_coupon_paid_quote_reserve(uuid,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_paid_quote_reserve(uuid,uuid,uuid)
 to service_role;
