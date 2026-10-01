-- Chama São Gabriel — admin/compliance FK indexes v1.7.2

create index if not exists merchant_compliance_verified_by_idx
  on public.merchant_compliance(verified_by)
  where verified_by is not null;

create index if not exists platform_admins_created_by_idx
  on public.platform_admins(created_by)
  where created_by is not null;
