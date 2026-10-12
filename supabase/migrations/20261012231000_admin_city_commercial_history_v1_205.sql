-- TAMÃO V1.205 — server-authoritative, append-only city commercial history.
-- No personal data, no merchant pricing/payment data, no implied sales/conversions.
create table if not exists public.admin_city_commercial_history_v1_205 (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  snapshot_bucket timestamptz not null unique,
  captured_at timestamptz not null default pg_catalog.clock_timestamp(),
  actor_user_id uuid not null references auth.users(id),
  city_count integer not null check (city_count >= 0),
  sampled boolean not null,
  source text not null default 'admin_expansion_radar_v1_154'
    check (source='admin_expansion_radar_v1_154'),
  city_rows jsonb not null check (jsonb_typeof(city_rows)='array'
    and jsonb_array_length(city_rows) <= 60),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index if not exists admin_city_commercial_history_recent_v1_205
  on public.admin_city_commercial_history_v1_205(captured_at desc,id desc);
alter table public.admin_city_commercial_history_v1_205 enable row level security;
revoke all on table public.admin_city_commercial_history_v1_205 from public,anon,authenticated;
grant select,insert on table public.admin_city_commercial_history_v1_205 to service_role;
-- Deliberately no public policies: even authenticated admins use the authenticated edge route.

create or replace function public.admin_capture_city_commercial_history_v1_205(p_actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog
as $fn$
declare
  v_bucket timestamptz:=date_trunc('hour',statement_timestamp());
  v_count integer;
  v_rows jsonb;
  v_saved public.admin_city_commercial_history_v1_205%rowtype;
  v_inserted boolean:=false;
begin
  if not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active
      and a.admin_role in ('superadmin','operations'))
  then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501'; end if;

  select count(*)::integer into v_count from public.market_cities;
  if v_count=0 then
    raise exception 'COMMERCIAL_HISTORY_NO_CITY_SOURCE' using errcode='P0002';
  end if;

  -- The source is recomputed in PostgreSQL. The browser cannot submit counts.
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',r.state||':'||r.city_key,
    'label',r.city||'/'||r.state,
    'state',r.state,
    'paused',r.admin_paused,
    'interests',r.interested_customers,
    'anp',case when r.anp_source_status='ok' then r.anp_prospects else null end,
    'registered',r.registered_merchants,
    'eligible',r.eligible_merchants,
    'uncontacted',r.uncontacted,
    'onboarding',r.onboarding,
    'overdue',r.overdue_followups
  ) order by r.state,r.city_key),'[]'::jsonb)
  into v_rows from public.admin_expansion_radar(60) r;
  if jsonb_array_length(v_rows)=0 then
    raise exception 'COMMERCIAL_HISTORY_SOURCE_EMPTY' using errcode='P0002';
  end if;
  if jsonb_array_length(v_rows)>v_count then
    raise exception 'COMMERCIAL_HISTORY_INCONSISTENT' using errcode='22023';
  end if;

  insert into public.admin_city_commercial_history_v1_205
    (snapshot_bucket,actor_user_id,city_count,sampled,city_rows)
  values(v_bucket,p_actor_user_id,v_count,v_count>jsonb_array_length(v_rows),v_rows)
  on conflict(snapshot_bucket) do nothing
  returning * into v_saved;
  if found then
    v_inserted:=true;
    insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
    values(p_actor_user_id,'commercial-history-capture','city_commercial_history',
      v_saved.id::text,jsonb_build_object('city_count',v_count,
      'captured_rows',jsonb_array_length(v_rows),'sampled',v_saved.sampled,
      'source','server_authoritative'));
  else
    select * into v_saved from public.admin_city_commercial_history_v1_205
    where snapshot_bucket=v_bucket;
  end if;
  if v_saved.id is null then
    raise exception 'COMMERCIAL_HISTORY_WRITE_FAILED' using errcode='P0001';
  end if;
  return jsonb_build_object('id',v_saved.id,
    'capturedAt',v_saved.captured_at,
    'inserted',v_inserted,
    'sampled',v_saved.sampled,
    'cityCount',v_saved.city_count,
    'rowCount',jsonb_array_length(v_saved.city_rows),
    'source','server_authoritative');
end;
$fn$;
revoke all on function public.admin_capture_city_commercial_history_v1_205(uuid)
  from public,anon,authenticated;
grant execute on function public.admin_capture_city_commercial_history_v1_205(uuid)
  to service_role;

create or replace function public.admin_list_city_commercial_history_v1_205(p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog
as $fn$
declare v_history jsonb;
begin
  if not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active
      and a.admin_role in ('superadmin','operations','compliance','readonly'))
  then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,
    'capturedAt',s.captured_at,
    'cityCount',s.city_count,
    'sampled',s.sampled,
    'source',s.source,
    'rows',s.city_rows
  ) order by s.captured_at desc,s.id desc),'[]'::jsonb)
  into v_history from (
    select * from public.admin_city_commercial_history_v1_205
    order by captured_at desc,id desc limit 16
  ) s;
  return jsonb_build_object('source','database_authoritative',
    'snapshots',v_history,'limit',16,'containsPersonalData',false);
end;
$fn$;
revoke all on function public.admin_list_city_commercial_history_v1_205(uuid)
  from public,anon,authenticated;
grant execute on function public.admin_list_city_commercial_history_v1_205(uuid)
  to service_role;
