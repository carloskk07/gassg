-- Chama São Gabriel — settlement adjustment FK index v1.6.8

create index if not exists platform_settlement_adjustments_merchant_idx
  on public.platform_settlement_adjustments(merchant_id,status,created_at);
