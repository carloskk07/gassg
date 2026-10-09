-- TAMÃO V1.135.1 — Multi-PSP provider FK index hygiene
-- Cover catalog foreign keys introduced by V1.135.

create index if not exists merchant_payment_routes_provider_idx
  on public.merchant_payment_routes(provider);

create index if not exists merchant_sale_payment_verifications_provider_idx
  on public.merchant_sale_payment_verifications(provider);
