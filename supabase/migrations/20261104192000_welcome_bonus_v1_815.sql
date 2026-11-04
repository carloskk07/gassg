-- Bonus de boas-vindas TAMÃO, campanha #815.
-- Schema versionado; qualquer credito exige confirmacao e orçamento.
create table if not exists public.platform_welcome_campaign_v1_815 (
  campaign_key text primary key,
  enabled boolean not null default false,
  starts_at timestamptz,
  budget_cents integer not null check (budget_cents>=0),
  award_cents integer not null check (award_cents>0),
  max_awards integer not null check (max_awards>0),
  awarded_count integer not null default 0 check (awarded_count>=0),
  awarded_cents integer not null default 0 check (awarded_cents>=0),
  check (awarded_count<=max_awards and awarded_cents<=budget_cents)
);
alter table public.platform_welcome_campaign_v1_815 enable row level security;
revoke all on public.platform_welcome_campaign_v1_815 from anon, authenticated;
insert into public.platform_welcome_campaign_v1_815
(campaign_key,enabled,budget_cents,award_cents,max_awards)
values ('welcome_2026_815',false,10000,100,100)
on conflict (campaign_key) do nothing;
create table if not exists public.platform_welcome_grants_v1_815 (
 user_id uuid primary key,
 campaign_key text not null references public.platform_welcome_campaign_v1_815,
 amount_cents integer not null check(amount_cents>0),
 wallet_entry_id uuid not null unique references public.wallet_entries(id),
 granted_at timestamptz not null default now()
);
alter table public.platform_welcome_grants_v1_815 enable row level security;
revoke all on public.platform_welcome_grants_v1_815 from anon, authenticated;
