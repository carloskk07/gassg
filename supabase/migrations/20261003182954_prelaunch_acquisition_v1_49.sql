-- TAMÃO — acquisition prelaunch v1.49
-- Server-only lead capture for first customers and local partners.

create table if not exists public.prelaunch_leads (
  id uuid primary key default extensions.gen_random_uuid(),
  lead_type text not null check (lead_type in ('customer','merchant')),
  contact_name text check (contact_name is null or char_length(contact_name) between 2 and 120),
  business_name text check (business_name is null or char_length(business_name) between 2 and 120),
  phone text not null check (phone ~ '^[0-9]{10,13}$'),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  interests text[] not null default '{}'::text[],
  note text check (note is null or char_length(note) <= 500),
  consent_at timestamptz not null,
  source text check (source is null or char_length(source) <= 80),
  medium text check (medium is null or char_length(medium) <= 80),
  campaign text check (campaign is null or char_length(campaign) <= 120),
  content text check (content is null or char_length(content) <= 120),
  term text check (term is null or char_length(term) <= 120),
  referrer text check (referrer is null or char_length(referrer) <= 500),
  landing_path text check (landing_path is null or char_length(landing_path) <= 240),
  ip_hash text not null check (char_length(ip_hash) = 64),
  status text not null default 'new' check (status in ('new','contacted','qualified','converted','closed')),
  submission_count integer not null default 1 check (submission_count between 1 and 1000000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create unique index if not exists prelaunch_leads_type_phone_uidx
  on public.prelaunch_leads(lead_type,phone);

create index if not exists prelaunch_leads_status_created_idx
  on public.prelaunch_leads(status,created_at desc);

create index if not exists prelaunch_leads_type_created_idx
  on public.prelaunch_leads(lead_type,created_at desc);

alter table public.prelaunch_leads enable row level security;
revoke all on table public.prelaunch_leads from public, anon, authenticated;
grant all on table public.prelaunch_leads to service_role;

create table if not exists public.prelaunch_lead_rate_limits (
  ip_hash text not null check (char_length(ip_hash)=64),
  action_name text not null check (char_length(action_name) between 2 and 80),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count between 1 and 1000000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (ip_hash,action_name,window_started_at)
);

alter table public.prelaunch_lead_rate_limits enable row level security;
revoke all on table public.prelaunch_lead_rate_limits from public, anon, authenticated;
grant all on table public.prelaunch_lead_rate_limits to service_role;

create index if not exists prelaunch_lead_rate_limits_window_idx
  on public.prelaunch_lead_rate_limits(window_started_at);

create or replace function public.consume_prelaunch_lead_quota(
  p_ip_hash text,
  p_action_name text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_bucket timestamptz;
  v_count integer;
  v_retry integer;
begin
  if p_ip_hash is null or char_length(p_ip_hash) <> 64 then
    raise exception 'INVALID_IP_HASH' using errcode='22023';
  end if;
  if p_action_name is null or char_length(p_action_name) < 2 or char_length(p_action_name) > 80 then
    raise exception 'INVALID_RATE_ACTION' using errcode='22023';
  end if;
  if p_limit < 1 or p_limit > 1000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_RATE_LIMIT' using errcode='22023';
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.prelaunch_lead_rate_limits(
    ip_hash,action_name,window_started_at,request_count,updated_at
  )
  values(
    p_ip_hash,p_action_name,v_bucket,1,clock_timestamp()
  )
  on conflict(ip_hash,action_name,window_started_at)
  do update set
    request_count=public.prelaunch_lead_rate_limits.request_count+1,
    updated_at=clock_timestamp()
  returning request_count into v_count;

  v_retry := greatest(
    1,
    ceil(extract(epoch from (
      v_bucket + make_interval(secs=>p_window_seconds) - clock_timestamp()
    )))::integer
  );

  return jsonb_build_object(
    'allowed',v_count<=p_limit,
    'count',v_count,
    'limit',p_limit,
    'retryAfterSeconds',v_retry
  );
end;
$$;

revoke all on function public.consume_prelaunch_lead_quota(text,text,integer,integer)
from public, anon, authenticated;
grant execute on function public.consume_prelaunch_lead_quota(text,text,integer,integer)
to service_role;
