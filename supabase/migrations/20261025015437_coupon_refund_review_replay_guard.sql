-- TAMÃO financeiro: a repetição de um reembolso confirmado pelo PSP
-- não pode encerrar uma revisão obrigatória de voucher reservado, já
-- consumido ou previamente retido. A classificação "refunded" somente
-- ocorre sem pendências de compensação/manual review.
-- Substitui IN-PLACE a RPC canônica da fundação 20261019170000;
-- não cria ledger paralelo, saldo, cupom, pagamento ou outro motor.
create or replace function public.clube_coupon_paid_payment_refund(
 p_invoice_id uuid,p_provider_order_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
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

 -- A previous review changes formerly RESERVED vouchers to review_required.
 -- Counting only "reserved" and "redeemed" accidentally makes a SECOND
 -- identical PSP webhook promote such unresolved invoices to "refunded".
 select count(*) into v_held from public.clube_coupon_paid_issuances
 where invoice_id=v_invoice.id
   and status in ('reserved','redeemed','review_required');
 if v_invoice.status='review_required' or v_held>0 then
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
$$;
revoke all on function public.clube_coupon_paid_payment_refund(uuid,text)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_paid_payment_refund(uuid,text)
 to service_role;
