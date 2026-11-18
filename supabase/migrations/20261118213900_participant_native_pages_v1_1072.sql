-- V1.1072 — durable, verified participant business/service pages.
-- This table is intentionally NOT a public REST directory: only the verified
-- owning account may read its configuration through the Data API.
-- Public read and all writes pass through the explicit audited Edge endpoint.
create table if not exists public.participant_pages_v1_1072 (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('merchant','customer','listing','agenda')),
  subject_id uuid not null,
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 4 and 80),
  template text not null default 'clean'
    check (template in ('clean','gold','rose')),
  headline text not null default '' check (length(headline) <= 110),
  tagline text not null default '' check (length(tagline) <= 320),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participant_pages_v1_1072_kind_subject_uniq unique (kind,subject_id)
);
create index if not exists participant_pages_v1_1072_owner_idx
  on public.participant_pages_v1_1072(owner_id,updated_at desc);
alter table public.participant_pages_v1_1072 enable row level security;
revoke all on public.participant_pages_v1_1072 from public, anon, authenticated;
grant select on public.participant_pages_v1_1072 to authenticated;
drop policy if exists participant_pages_v1_1072_owner_read on public.participant_pages_v1_1072;
create policy participant_pages_v1_1072_owner_read on public.participant_pages_v1_1072
  for select to authenticated
  using (owner_id=(select auth.uid()));
comment on table public.participant_pages_v1_1072 is
  'Private configuration for own native participant pages. No anonymous Data API reads; verified public pages are sanitized by Edge.';
