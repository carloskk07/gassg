-- TAMÃO — Refund payment-event FK coverage v1.97.1
create index if not exists merchant_billing_payment_refunds_payment_event_idx
  on public.merchant_billing_payment_refunds(payment_event_id)
  where payment_event_id is not null;
