-- TAMÃO v1.63 — onboarding assistido de revenda/piloto sem SQL manual.
-- Cria a revenda como PENDING. Compliance permanece pendente até validação explícita.

create table if not exists public.merchant_business_details (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  legal_name text not null check(char_length(trim(legal_name)) between 2 and 180),
  trade_name text not null check(char_length(trim(trade_name)) between 2 and 120),
  responsible_name text not null check(char_length(trim(responsible_name)) between 2 and 120),
  phone text not null check(phone ~ '^[0-9]{10,13}$'),
  whatsapp text not null check(whatsapp ~ '^[0-9]{10,13}$'),
  postal_code text not null check(postal_code ~ '^[0-9]{8}$'),
  city text not null check(char_length(trim(city)) between 2 and 120),
  state text not null default 'RS' check(state ~ '^[A-Z]{2}$'),
  address_text text not null check(char_length(trim(address_text)) between 5 and 240),
  admin_notes text check(admin_notes is null or char_length(admin_notes)<=2000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.merchant_business_details enable row level security;
revoke all on table public.merchant_business_details from public, anon, authenticated;
grant all on table public.merchant_business_details to service_role;
