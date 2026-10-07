-- TAMÃO — Billing FK indexes v1.72.1
-- Cover foreign keys added by the merchant billing engine.

create index if not exists merchant_billing_accounts_plan_key_idx
  on public.merchant_billing_accounts(plan_key);

create index if not exists merchant_daily_statements_resolved_by_idx
  on public.merchant_daily_statements(resolved_by)
  where resolved_by is not null;

create index if not exists merchant_fee_credit_ledger_created_by_idx
  on public.merchant_fee_credit_ledger(created_by)
  where created_by is not null;

create index if not exists merchant_fee_credit_ledger_order_id_idx
  on public.merchant_fee_credit_ledger(order_id)
  where order_id is not null;

create index if not exists merchant_fee_credit_ledger_plan_key_idx
  on public.merchant_fee_credit_ledger(plan_key)
  where plan_key is not null;
