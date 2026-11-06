-- TAMÃO #862: financial history guard on full Mercado Pago refund.
-- #847 can legitimately reissue a redeemed voucher after an order cancellation,
-- leaving a durable order_application row while voucher status returns to issued.
-- Never automatically close the entire paid package until the historical
-- merchant liability and wallet reversal have been reviewed.
-- Does not change data, RLS, sale switches, rights, amounts or PSP settings.
CREATE OR REPLACE FUNCTION public.clube_coupon_paid_payment_refund(p_invoice_id uuid, p_provider_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_held integer;
begin
 select * into v_invoice from public.clube_coupon_paid_invoices
 where id=p_invoice_id for update;
 if not found or v_invoice.provider_order_id is distinct from p_provider_order_id
 then raise exception 'COUPON_REFUND_BINDING_MISMATCH';end if;

 -- Keep a completed clean refund idempotent; never produce another credit.
 if v_invoice.status='refunded' then
  return pg_catalog.jsonb_build_object(
   'ok',true,'refunded',true,'replayed',true);
 end if;

 -- Only #853 holds with a verified inbound Pix and absolutely no
 -- voucher issuance may be closed after an independently verified FULL PSP
 -- refund. Every other review requires manual accounting.
 if v_invoice.status='review_required'
   and v_invoice.coupon_settlement_hold_reason_v1_853 in
     ('PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT',
      'COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT')
   and v_invoice.paid_at is not null
   and length(coalesce(v_invoice.provider_payment_id,''))>=3
   and not exists (
     select 1 from public.clube_coupon_paid_issuances i
     where i.invoice_id=v_invoice.id
   )
   and not exists (
     select 1 from public.clube_coupon_paid_order_applications a
     where a.invoice_id=v_invoice.id
   )
 then
   update public.clube_coupon_paid_invoices
    set status='refunded',refunded_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=v_invoice.id;
   return pg_catalog.jsonb_build_object(
     'ok',true,'refunded',true,'reviewHoldClosed',true,'replayed',false);
 end if;

 -- A previous review changes formerly RESERVED vouchers to review_required.
 -- Counting only "reserved" and "redeemed" accidentally makes a SECOND
 -- identical PSP webhook promote such unresolved invoices to "refunded".
 select count(*) into v_held from public.clube_coupon_paid_issuances
 where invoice_id=v_invoice.id
   and status in ('reserved','redeemed','review_required');
 -- An order cancellation can reissue a voucher, restoring status='issued'
 -- while the immutable earlier paid-coupon order application still exists.
 -- A clean refund requires ZERO lifetime use, not merely no redeemed
 -- vouchers at this moment. Preserve merchant/payment reconciliation.
 if v_invoice.status='review_required' or v_held>0 or exists (
   select 1 from public.clube_coupon_paid_order_applications a
   where a.invoice_id=v_invoice.id
 ) then
  update public.clube_coupon_paid_invoices
   set status='review_required',updated_at=clock_timestamp()
   where id=v_invoice.id and status<>'review_required';
  update public.clube_coupon_paid_issuances
   set status='review_required',reserved_quote_id=null,reserved_at=null
   where invoice_id=v_invoice.id and status in ('issued','reserved');
  return pg_catalog.jsonb_build_object(
   'ok',false,'reviewRequired',true,'refunded',false);
 end if;

 update public.clube_coupon_paid_invoices
 set status='refunded',refunded_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=v_invoice.id;
 update public.clube_coupon_paid_issuances set status='void'
 where invoice_id=v_invoice.id and status='issued';
 return pg_catalog.jsonb_build_object(
  'ok',true,'refunded',true,'replayed',false);
end
$function$;
REVOKE ALL ON FUNCTION public.clube_coupon_paid_payment_refund(uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_coupon_paid_payment_refund(uuid,text)
 TO service_role;
