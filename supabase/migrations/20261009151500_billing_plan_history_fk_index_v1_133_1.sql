-- TAMÃO — Billing plan history FK index hygiene v1.133.1
-- Covers the auth.users FK created by V1.133 so deletes/lookups do not require
-- a full scan of the immutable billing-plan history.

create index if not exists merchant_billing_plan_history_changed_by_idx
  on public.merchant_billing_plan_history(changed_by)
  where changed_by is not null;
