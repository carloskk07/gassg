-- TAMÃO — Billing payment request FK coverage v1.73.1
-- Covers the plan_key foreign key reported by the production database advisor.

create index if not exists merchant_billing_payment_requests_plan_key_idx
  on public.merchant_billing_payment_requests(plan_key)
  where plan_key is not null;
