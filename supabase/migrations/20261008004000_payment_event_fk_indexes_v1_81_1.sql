-- TAMÃO — Provider payment event FK coverage v1.81.1

create index if not exists merchant_billing_payment_events_payment_request_idx
  on public.merchant_billing_payment_events(payment_request_id)
  where payment_request_id is not null;

create index if not exists merchant_billing_payment_events_merchant_idx
  on public.merchant_billing_payment_events(merchant_id)
  where merchant_id is not null;

create index if not exists merchant_billing_payment_events_applied_by_idx
  on public.merchant_billing_payment_events(applied_by)
  where applied_by is not null;
