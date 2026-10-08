-- TAMÃO — Prepaid source-plan FK coverage v1.110
-- Covers the V1.108 provenance FK used when restoring prepaid fee credit.

create index if not exists orders_prepaid_fee_credit_source_plan_key_idx
  on public.orders(prepaid_fee_credit_source_plan_key_snapshot)
  where prepaid_fee_credit_source_plan_key_snapshot is not null;
