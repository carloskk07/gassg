-- TAMÃO — Provider refund FK coverage v1.96.1
-- Covers the refund -> payment event foreign key reported by the DB advisor.

create index if not exists merchant_billing_payment_refunds_payment_event_idx
  on public.merchant_billing_payment_refunds(payment_event_id)
  where payment_event_id is not null;
