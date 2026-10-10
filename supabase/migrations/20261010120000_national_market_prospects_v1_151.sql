-- V1.151: national demand capture and ANP commercial prospect intelligence.
-- This migration NEVER enables commerce. Merchant readiness remains authoritative.
alter table public.prelaunch_leads
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists city_ibge_code text;
create index if not exists prelaunch_leads_state_city_idx
  on public.prelaunch_leads(state,city,created_at desc) where city is not null;

create table if not exists public.market_cities (
  state text not null check (state ~ '^[A-Z]{2}$'),
  city_key text not null check (city_key ~ '^[A-Z0-9 ]{2,120}$'),
  city_name text not null check (char_length(city_name) between 2 and 120),
  ibge_code text check (ibge_code is null or ibge_code ~ '^[0-9]{7}$'),
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  commerce_enabled boolean not null default false,
  activated_at timestamptz,
  primary key (state,city_key)
);
alter table public.market_cities enable row level security;
revoke all on public.market_cities from public,anon,authenticated;
grant all on public.market_cities to service_role;

-- One contact can have demand in multiple cities; lead identity remains deduplicated.
create table if not exists public.market_city_interests (
  lead_id uuid not null references public.prelaunch_leads(id) on delete cascade,
  postal_code text not null check (postal_code ~ '^[0-9]{8}$'),
  city text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  ibge_code text check (ibge_code is null or ibge_code ~ '^[0-9]{7}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (lead_id,postal_code)
);
create index if not exists market_city_interests_location_idx
  on public.market_city_interests(state,city,last_seen_at desc) where city is not null;
alter table public.market_city_interests enable row level security;
revoke all on public.market_city_interests from public,anon,authenticated;
grant all on public.market_city_interests to service_role;

create table if not exists public.anp_glp_prospects (
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  state text not null check (state ~ '^[A-Z]{2}$'),
  city_key text not null,
  city_name text not null,
  legal_name text not null,
  address_text text,
  distributor text,
  authorization text,
  sigaf_status text,
  source text not null default 'ANP_API_GLP',
  source_checked_at timestamptz not null,
  prospect_status text not null default 'uncontacted'
    check (prospect_status in ('uncontacted','contacted','interested','onboarding','partner','dismissed')),
  notes text,
  updated_at timestamptz not null default now(),
  primary key (cnpj),
  foreign key (state,city_key) references public.market_cities(state,city_key)
);
create index if not exists anp_glp_prospects_city_idx
  on public.anp_glp_prospects(state,city_key,prospect_status,source_checked_at desc);
alter table public.anp_glp_prospects enable row level security;
revoke all on public.anp_glp_prospects from public,anon,authenticated;
grant all on public.anp_glp_prospects to service_role;

create table if not exists public.anp_prospect_refreshes (
  state text not null,
  city_key text not null,
  last_checked_at timestamptz not null default now(),
  last_count integer not null default 0 check (last_count>=0),
  status text not null default 'ok' check (status in ('ok','unavailable')),
  last_error text,
  primary key (state,city_key),
  foreign key (state,city_key) references public.market_cities(state,city_key)
);
alter table public.anp_prospect_refreshes enable row level security;
revoke all on public.anp_prospect_refreshes from public,anon,authenticated;
grant all on public.anp_prospect_refreshes to service_role;
