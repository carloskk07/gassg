-- TAMÃO — public trust channel v1.50

create table if not exists public.public_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  request_kind text not null check (request_kind in ('general','support','privacy')),
  privacy_action text check (
    privacy_action is null
    or privacy_action in ('confirmation','access','correction','deletion','information','revocation','other')
  ),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  contact_channel text not null check (contact_channel in ('email','whatsapp')),
  contact_value text not null check (char_length(contact_value) between 5 and 180),
  message text not null check (char_length(message) between 10 and 2000),
  acknowledged_at timestamptz not null,
  source text check (source is null or char_length(source) <= 80),
  medium text check (medium is null or char_length(medium) <= 80),
  campaign text check (campaign is null or char_length(campaign) <= 120),
  referrer text check (referrer is null or char_length(referrer) <= 500),
  landing_path text check (landing_path is null or char_length(landing_path) <= 240),
  ip_hash text not null check (char_length(ip_hash) = 64),
  status text not null default 'new' check (status in ('new','in_review','resolved','closed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists public_requests_status_created_idx
  on public.public_requests(status,created_at desc);

create index if not exists public_requests_kind_created_idx
  on public.public_requests(request_kind,created_at desc);

alter table public.public_requests enable row level security;
revoke all on table public.public_requests from public, anon, authenticated;
grant all on table public.public_requests to service_role;
