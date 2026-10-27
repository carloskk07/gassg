-- TAMÃO: tighten existing coupon order refund reconciliation, no money movement.
-- Coupon funding, redemption and merchant payout handlers remain unchanged.
-- A release to another customer's wallet can NEVER clear the original buyer's
-- cancellation refund, even if order_id was attached to the wrong wallet entry.
-- Existing privileged RPC and grants are preserved. PRELAUNCH unchanged.
create or replace function public.clube_coupon_paid_order_reconciliation(
 p_order_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_application public.clube_coupon_paid_order_applications%rowtype;
 v_order public.orders%rowtype;
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_merchant_payment record;
 v_source_count integer;
 v_release_cents bigint;
 v_state text;
begin
 select * into v_application from public.clube_coupon_paid_order_applications
 where order_id=p_order_id;
 if not found then raise exception 'COUPON_ORDER_NOT_FOUND' using errcode='P0002';end if;
 select * into v_order from public.orders where id=p_order_id;
 select * into v_invoice from public.clube_coupon_paid_invoices
 where id=v_application.invoice_id;
 if not found or v_order.id is null
 then raise exception 'COUPON_FINANCE_PROVENANCE_MISSING' using errcode='40001';end if;
 select count(*) into v_source_count from public.wallet_entries w
 where w.user_id=v_application.customer_user_id
 and w.bucket='cashback' and w.entry_type='cashback_seed'
 and w.amount_cents=v_application.face_cents
 and w.idempotency_key='clube-paid-coupon:'||v_application.voucher_id::text
 and w.metadata->>'invoiceId'=v_invoice.id::text
 and w.metadata->>'voucherId'=v_application.voucher_id::text;
 select * into v_merchant_payment from public.merchant_cashback_reimbursements
 where order_id=p_order_id;
 select coalesce(sum(w.amount_cents),0) into v_release_cents
 from public.wallet_entries w
 where w.order_id=p_order_id
   and w.user_id=v_application.customer_user_id
   and w.bucket='cashback' and w.entry_type='cashback_release';
 v_state:=case
 -- Never certify customer refund using another wallet owner's release,
 -- or a coupon application whose buyer / immutable order snapshots drift.
 when v_application.customer_user_id is distinct from v_order.customer_id
   or v_invoice.customer_user_id is distinct from v_order.customer_id
   or v_application.original_order_total_cents is distinct from v_order.total_cents
   or v_application.original_order_cashback_cents is distinct from v_order.cashback_reserved_cents
   then 'FINANCIAL_REVIEW'
 when v_invoice.status<>'paid' or
   v_invoice.net_proceeds_verified_at is null or
   v_source_count<>1 then 'FINANCIAL_REVIEW'
 when v_order.financial_reversed_at is not null then 'REVERSAL_REVIEW'
 when v_order.status='SETTLED' and
   v_merchant_payment.order_id is null then 'MERCHANT_REIMBURSEMENT_MISSING'
 when v_order.status='SETTLED' and
   v_merchant_payment.cashback_cents<>v_order.cashback_reserved_cents
     then 'MERCHANT_REIMBURSEMENT_MISMATCH'
 -- Internal 'paid' is only an operator/accounting entry, not an
 -- independent bank/provider settlement proof. Until the existing TAMÃO
 -- financial-evidence workflow verifies an external payout, fail closed.
 when v_order.status='SETTLED' and
   v_merchant_payment.status='paid' then 'MERCHANT_PAYOUT_UNVERIFIED'
 when v_order.status='SETTLED' and
   v_merchant_payment.status='open' then 'MERCHANT_REIMBURSEMENT_DUE'
 when v_order.status='CANCELLED' and
   v_release_cents>=v_application.original_order_cashback_cents
     then 'CUSTOMER_CREDIT_RETURNED'
 when v_order.status='CANCELLED' then 'CANCELLATION_REVIEW'
 else 'ORDER_IN_PROGRESS' end;
 return pg_catalog.jsonb_build_object(
  'source','clube_coupon_paid_order_reconciliation_v1',
  'orderId',v_order.id,'voucherId',v_application.voucher_id,
  'invoiceId',v_invoice.id,'status',v_state,
  'couponFaceCents',v_application.face_cents,
  'cashbackReservedCents',v_order.cashback_reserved_cents,
  'orderTotalCents',v_order.total_cents,
  'fundingNetProceedsCents',v_invoice.net_proceeds_cents,
  'originalQuotedMerchantId',v_application.quoted_merchant_id,
  'currentMerchantId',v_order.merchant_id,
  'merchantReimbursementCents',v_merchant_payment.cashback_cents,
  'merchantReimbursementStatus',v_merchant_payment.status,
  'merchantExternalSettlementVerified',false,
  'returnedCashbackCents',v_release_cents);
end
$$;
revoke all on function public.clube_coupon_paid_order_reconciliation(uuid)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_paid_order_reconciliation(uuid)
 to service_role;
