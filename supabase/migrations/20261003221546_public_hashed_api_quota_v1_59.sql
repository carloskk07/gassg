-- TAMÃO v1.59 — quota pública por hash sem identidade fictícia.
-- Para endpoints pré-auth: evita FK de auth.users e mantém browser roles fechadas.

create table if not exists public.public_hashed_rate_limits (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  action_name text not null check (char_length(action_name) between 2 and 80),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count >= 1),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (key_hash,action_name,window_started_at)
);

create index if not exists public_hashed_rate_limits_updated_idx
  on public.public_hashed_rate_limits(updated_at);

alter table public.public_hashed_rate_limits enable row level security;
revoke all on table public.public_hashed_rate_limits from public, anon, authenticated;
grant all on table public.public_hashed_rate_limits to service_role;

create or replace function public.consume_hashed_api_quota(
  p_key_hash text,
  p_action_name text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_bucket timestamptz;
  v_count integer;
  v_retry integer;
begin
  if p_key_hash is null
     or char_length(p_key_hash) <> 64
     or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_RATE_KEY_HASH' using errcode='22023';
  end if;

  if p_action_name is null
     or char_length(p_action_name) < 2
     or char_length(p_action_name) > 80 then
    raise exception 'INVALID_RATE_ACTION' using errcode='22023';
  end if;

  if p_limit < 1 or p_limit > 1000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_RATE_LIMIT' using errcode='22023';
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.public_hashed_rate_limits(
    key_hash,action_name,window_started_at,request_count,updated_at
  )
  values(
    p_key_hash,p_action_name,v_bucket,1,clock_timestamp()
  )
  on conflict(key_hash,action_name,window_started_at)
  do update set
    request_count=public.public_hashed_rate_limits.request_count+1,
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

revoke all on function public.consume_hashed_api_quota(text,text,integer,integer)
from public, anon, authenticated;
grant execute on function public.consume_hashed_api_quota(text,text,integer,integer)
to service_role;
