-- TAMÃO V1.206 — automatic daily evidence snapshot (09:18 America/Sao_Paulo / 12:18 UTC).
-- Uses existing PostgreSQL pg_cron, no API keys, external requests, or human impersonation.
-- Daily captures share the V1.205 immutable UTC-hour uniqueness with manual captures.
alter table public.admin_city_commercial_history_v1_205
  add column if not exists capture_origin text not null default 'manual';
alter table public.admin_city_commercial_history_v1_205
  alter column actor_user_id drop not null;
alter table public.admin_city_commercial_history_v1_205
  add constraint admin_city_history_origin_actor_v1_206
  check ((capture_origin='manual' and actor_user_id is not null)
      or (capture_origin='scheduled' and actor_user_id is null));

-- A private, non-Data-API schema, with invoker privileges only.
create schema if not exists tamao_internal authorization postgres;
revoke all on schema tamao_internal from public,anon,authenticated,service_role;

create or replace function tamao_internal.capture_city_commercial_history_auto_v1_206()
returns jsonb language plpgsql security invoker
set search_path = pg_catalog
as $fn$
declare
  v_bucket timestamptz:=date_trunc('hour',statement_timestamp());
  v_count integer;
  v_rows jsonb;
  v_saved public.admin_city_commercial_history_v1_205%rowtype;
begin
  -- The cron job belongs to postgres. Never permit caller-supplied identity or data.
  if session_user <> 'postgres' then
    raise exception 'COMMERCIAL_HISTORY_CRON_ONLY' using errcode='42501';
  end if;
  select * into v_saved from public.admin_city_commercial_history_v1_205
   where snapshot_bucket=v_bucket;
  if found then
    return jsonb_build_object('inserted',false,'reason','hour_already_recorded',
      'id',v_saved.id,'origin',v_saved.capture_origin);
  end if;

  select count(*)::integer into v_count from public.market_cities;
  if v_count=0 then
    raise exception 'COMMERCIAL_HISTORY_NO_CITY_SOURCE' using errcode='P0002';
  end if;

  -- Server-side official radar only. ANP is null unless a verified source exists.
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
  if jsonb_array_length(v_rows)=0
     or jsonb_array_length(v_rows)>v_count then
    raise exception 'COMMERCIAL_HISTORY_INCONSISTENT_SOURCE' using errcode='22023';
  end if;

  insert into public.admin_city_commercial_history_v1_205
    (snapshot_bucket,actor_user_id,capture_origin,city_count,sampled,city_rows)
  values(v_bucket,null,'scheduled',v_count,
    v_count>jsonb_array_length(v_rows),v_rows)
  on conflict(snapshot_bucket) do nothing
  returning * into v_saved;
  if not found then
    select * into v_saved from public.admin_city_commercial_history_v1_205
     where snapshot_bucket=v_bucket;
  end if;
  if v_saved.id is null then
    raise exception 'COMMERCIAL_HISTORY_WRITE_FAILED' using errcode='P0001';
  end if;
  return jsonb_build_object('id',v_saved.id,
    'inserted',v_saved.capture_origin='scheduled',
    'origin',v_saved.capture_origin,
    'cityCount',v_saved.city_count,
    'sampled',v_saved.sampled,
    'capturedAt',v_saved.captured_at);
end;
$fn$;
revoke all on function tamao_internal.capture_city_commercial_history_auto_v1_206()
  from public,anon,authenticated,service_role;

-- Existing administrative read RPC remains service_role-only.
-- Show capture provenance; do not expose actor IDs or any personal data.
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
    'origin',s.capture_origin,
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

-- PostgreSQL Cron runs under postgres, requires no service key.
-- Supabase pg_cron timezone on this project is GMT; 12:18 UTC = 09:18 in Brasilia.
do $schedule$
begin
  if not exists(select 1 from cron.job
    where jobname='tamao-city-commercial-history-daily-v1-206') then
    perform cron.schedule(
      'tamao-city-commercial-history-daily-v1-206',
      '18 12 * * *',
      'select tamao_internal.capture_city_commercial_history_auto_v1_206();'
    );
  end if;
end;
$schedule$;
