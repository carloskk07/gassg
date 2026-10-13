-- TAMÃO V1.207: self-contained city snapshot health, independent of browser sessions.
-- Database-only, no external webhooks or financial permissions. pg_cron uses UTC.
create table if not exists tamao_internal.city_history_health_config_v1_207(
  key text primary key check (key='daily'),
  installed_at timestamptz not null default clock_timestamp()
);
insert into tamao_internal.city_history_health_config_v1_207(key)
values('daily') on conflict(key) do nothing;

create table if not exists tamao_internal.city_history_health_checks_v1_207(
  due_at timestamptz primary key,
  checked_at timestamptz not null default clock_timestamp(),
  status text not null check (status in (
    'healthy','missing_capture','run_failed','in_grace',
    'job_missing','job_disabled','job_changed','watchdog_missing','watchdog_disabled','watchdog_changed'
  )),
  cron_run_status text,
  slot_capture_origin text check (slot_capture_origin in ('manual','scheduled'))
);
create index if not exists city_history_checks_recent_v1_207
  on tamao_internal.city_history_health_checks_v1_207(checked_at desc);
revoke all on schema tamao_internal from public,anon,authenticated,service_role;
revoke all on tamao_internal.city_history_health_config_v1_207,
  tamao_internal.city_history_health_checks_v1_207
  from public,anon,authenticated,service_role;

create or replace function tamao_internal.city_history_health_v1_207(
  p_as_of timestamptz default clock_timestamp()
)
returns jsonb language plpgsql stable security invoker
set search_path to pg_catalog
as $fn$
declare
  v_start timestamptz;
  v_first timestamptz;
  v_due timestamptz;
  v_capture_job cron.job%rowtype;
  v_watchdog_job cron.job%rowtype;
  v_slot public.admin_city_commercial_history_v1_205%rowtype;
  v_last_capture timestamptz;
  v_last_scheduled timestamptz;
  v_log_status text;
  v_watchdog_due timestamptz;
  v_watchdog_check tamao_internal.city_history_health_checks_v1_207%rowtype;
  v_status text:='awaiting_first';
begin
  if p_as_of is null then raise exception 'INVALID_HISTORY_HEALTH_CLOCK' using errcode='22023'; end if;
  select installed_at into v_start from tamao_internal.city_history_health_config_v1_207
   where key='daily';
  if v_start is null then raise exception 'HISTORY_MONITOR_UNCONFIGURED' using errcode='P0002'; end if;
  v_first:=(date_trunc('day',v_start at time zone 'UTC') at time zone 'UTC')
   + interval '12 hours 18 minutes';
  if v_first < v_start then v_first:=v_first+interval '1 day'; end if;
  v_due:=(date_trunc('day',p_as_of at time zone 'UTC') at time zone 'UTC')
   + interval '12 hours 18 minutes';
  if p_as_of<v_due then v_due:=v_due-interval '1 day'; end if;

  select * into v_capture_job from cron.job
    where jobname='tamao-city-commercial-history-daily-v1-206'
    order by jobid desc limit 1;
  select * into v_watchdog_job from cron.job
    where jobname='tamao-city-commercial-history-watchdog-v1-207'
    order by jobid desc limit 1;

  select captured_at into v_last_capture from public.admin_city_commercial_history_v1_205
    order by captured_at desc limit 1;
  select captured_at into v_last_scheduled from public.admin_city_commercial_history_v1_205
    where capture_origin='scheduled' order by captured_at desc limit 1;
  select * into v_watchdog_check from tamao_internal.city_history_health_checks_v1_207
    order by checked_at desc limit 1;

  if v_capture_job.jobid is null then v_status:='job_missing';
  elsif not v_capture_job.active then v_status:='job_disabled';
  elsif v_capture_job.schedule<>'18 12 * * *'
    or v_capture_job.username<>'postgres'
    or btrim(v_capture_job.command)<>'select tamao_internal.capture_city_commercial_history_auto_v1_206();'
    then v_status:='job_changed';
  elsif v_watchdog_job.jobid is null then v_status:='watchdog_missing';
  elsif not v_watchdog_job.active then v_status:='watchdog_disabled';
  elsif v_watchdog_job.schedule<>'5 13 * * *'
    or v_watchdog_job.username<>'postgres'
    or btrim(v_watchdog_job.command)<>'select tamao_internal.record_city_history_health_v1_207();'
    then v_status:='watchdog_changed';
  elsif v_due<v_first then v_status:='awaiting_first';
  else
    select * into v_slot from public.admin_city_commercial_history_v1_205
      where snapshot_bucket=date_trunc('hour',v_due) limit 1;
    select case when status in ('succeeded','failed','running') then status else 'unknown' end
      into v_log_status from cron.job_run_details
      where jobid=v_capture_job.jobid and start_time>=v_due
       and start_time<v_due+interval '1 hour'
      order by start_time desc,runid desc limit 1;

    if v_log_status='failed' then v_status:='run_failed';
    elsif v_slot.id is not null and
      (v_slot.capture_origin='scheduled' or v_log_status='succeeded') then
      v_status:='healthy';
    elsif p_as_of<v_due+interval '40 minutes' then v_status:='in_grace';
    else v_status:='missing_capture';
    end if;

    -- The watchdog has its own schedule. A successful capture does not prove it is running.
    v_watchdog_due:=v_due+interval '47 minutes'; -- 13:05 UTC
    if v_status='healthy' and p_as_of>=v_watchdog_due+interval '25 minutes' then
      if not exists(select 1 from tamao_internal.city_history_health_checks_v1_207 c
        where c.due_at=v_due) then
        v_status:='watchdog_late';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status',v_status,'asOf',p_as_of,
    'firstDueAt',v_first,
    'expectedAt',case when v_due>=v_first then v_due else v_first end,
    'graceMinutes',40,
    'captureJobActive',coalesce(v_capture_job.active,false),
    'watchdogJobActive',coalesce(v_watchdog_job.active,false),
    'lastCaptureAt',v_last_capture,
    'lastScheduledAt',v_last_scheduled,
    'slotCaptureOrigin',v_slot.capture_origin,
    'cronRunStatus',v_log_status,
    'lastWatchdogAt',v_watchdog_check.checked_at,
    'lastWatchdogStatus',v_watchdog_check.status,
    'watchdogDueAt',case when v_due>=v_first then v_watchdog_due else null end
  );
end;
$fn$;
revoke all on function tamao_internal.city_history_health_v1_207(timestamptz)
 from public,anon,authenticated,service_role;

create or replace function tamao_internal.record_city_history_health_v1_207()
returns jsonb language plpgsql security invoker
set search_path to pg_catalog
as $fn$
declare
  v_health jsonb;
  v_due timestamptz;
  v_status text;
  v_inserted boolean:=false;
begin
  if session_user<>'postgres' then
    raise exception 'HISTORY_MONITOR_CRON_ONLY' using errcode='42501';
  end if;
  v_health:=tamao_internal.city_history_health_v1_207(clock_timestamp());
  v_due:=(v_health->>'expectedAt')::timestamptz;
  v_status:=v_health->>'status';
  if v_due is null or v_status='awaiting_first' or v_status='in_grace' then
    return jsonb_build_object('recorded',false,'status',v_status);
  end if;
  insert into tamao_internal.city_history_health_checks_v1_207
    (due_at,status,cron_run_status,slot_capture_origin)
  values(v_due,v_status,v_health->>'cronRunStatus',v_health->>'slotCaptureOrigin')
  on conflict(due_at) do nothing;
  get diagnostics v_inserted = row_count;
  return jsonb_build_object('recorded',v_inserted,'status',v_status,'expectedAt',v_due);
end;
$fn$;
revoke all on function tamao_internal.record_city_history_health_v1_207()
 from public,anon,authenticated,service_role;

-- Existing service-role-only RPC; authorized admin actor is verified AGAIN in PostgreSQL.
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
    'snapshots',v_history,'limit',16,'containsPersonalData',false,
    'scheduler',jsonb_build_object('active',exists(select 1 from cron.job j
      where j.jobname='tamao-city-commercial-history-daily-v1-206' and j.active),
      'cadence','daily','utcTime','12:18'),
    'health',tamao_internal.city_history_health_v1_207(clock_timestamp()));
end;
$fn$;
revoke all on function public.admin_list_city_commercial_history_v1_205(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_list_city_commercial_history_v1_205(uuid) to service_role;

-- Daily independent verification after the capture grace period.
do $schedule$
begin
  if not exists(select 1 from cron.job
    where jobname='tamao-city-commercial-history-watchdog-v1-207') then
    perform cron.schedule('tamao-city-commercial-history-watchdog-v1-207',
      '5 13 * * *',
      'select tamao_internal.record_city_history_health_v1_207();');
  end if;
end;
$schedule$;
