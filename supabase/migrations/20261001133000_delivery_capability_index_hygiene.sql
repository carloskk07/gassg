-- Chama São Gabriel — database index hygiene v1.8.3

create index if not exists merchant_delivery_capabilities_verified_by_idx
  on public.merchant_delivery_capabilities(verified_by);

drop index if exists public.merchant_applications_live_cnpj_idx;
