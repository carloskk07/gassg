-- TAMÃO V1.209 — auditable, database-only operational issue episodes.
-- Records only grouped counts, without personal data, prices, order IDs or secret values.
-- Official portal verification remains an on-demand API-only signal, never falsely tracked by this job.
create table if not exists tamao_internal.operational_alert_state_v1_209(
  source text primary key check(source in ('incidents','support','finance','capture')),
  status text not null check(status in ('active','clear','unknown')),
  current_count integer check(current_count is null or current_count>=0),
  open_since timestamptz,
  last_positive_at timestamptz,
  last_cleared_at timestamptz,
  checked_at timestamptz not null,
  consecutive_checks integer not null default 0 check(consecutive_checks>=0),
  episodes integer not null default 0 check(episodes>=0)
);
create table if not exists tamao_internal.operational_alert_events_v1_209(
  id bigint generated always as identity primary key,
  source text not null check(source in ('incidents','support','finance','capture')),
  previous_status text check(previous_status in ('active','clear','unknown')),
  new_status text not null check(new_status in ('active','clear','unknown')),
  observed_at timestamptz not null,
  count_at_change integer check(count_at_change is null or count_at_change>=0)
);
create index if not exists operational_alert_events_recent_v1_209
  on tamao_internal.operational_alert_events_v1_209(observed_at desc,id desc);
revoke all on schema tamao_internal from public,anon,authenticated,service_role;
revoke all on tamao_internal.operational_alert_state_v1_209,
  tamao_internal.operational_alert_events_v1_209
  from public,anon,authenticated,service_role;

-- Invoker-only, restricted to an independent PostgreSQL cron execution.
create or replace function tamao_internal.record_operational_alert_lifecycle_v1_209()
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog
as $fn$
declare
  v_now timestamptz:=clock_timestamp();
  v_kind text;
  v_count integer;
  v_valid boolean;
  v_next text;
  v_prior tamao_internal.operational_alert_state_v1_209%rowtype;
  v_exists boolean;
  v_streak integer;
  v_episodes integer;
  v_open timestamptz;
  v_cleared timestamptz;
  v_last_positive timestamptz;
  v_health jsonb;
  v_processed integer:=0;
begin
  if session_user<>'postgres' then
    raise exception 'OPERATIONS_MONITOR_CRON_ONLY' using errcode='42501';
  end if;
  for v_kind in select unnest(array['incidents','support','finance','capture']) loop
    v_count:=null;v_valid:=true;v_health:=null;
    begin
      case v_kind
        when 'incidents' then
          select count(*)::integer into v_count from public.platform_incidents
            where status<>'resolved';
        when 'support' then
          select count(*)::integer into v_count from public.support_cases
            where status in ('open','in_review');
        when 'finance' then
          select (select count(*)::integer from public.reward_processing_failures
                    where resolved_at is null)
                +(select count(*)::integer from public.settlement_accounting_failures
                    where resolved_at is null)
            into v_count;
        when 'capture' then
          v_health:=tamao_internal.city_history_health_v1_207(v_now);
          if (v_health->>'status') in ('healthy','awaiting_first','in_grace') then
            v_count:=0;
          elsif (v_health->>'status') in (
             'missing_capture','run_failed','job_missing','job_disabled','job_changed',
             'watchdog_missing','watchdog_disabled','watchdog_changed','watchdog_late') then
            v_count:=1;
          else
            v_valid:=false;
          end if;
      end case;
      if v_count is null or v_count<0 then v_valid:=false; end if;
    exception when others then
      -- An unreadable source means UNKNOWN; never silently mark a problem cleared.
      v_count:=null;v_valid:=false;
    end;
    v_next:=case when not v_valid then 'unknown'
                 when v_count>0 then 'active' else 'clear' end;
    select * into v_prior from tamao_internal.operational_alert_state_v1_209
      where source=v_kind for update;
    v_exists:=found;
    if not v_exists then
      insert into tamao_internal.operational_alert_state_v1_209
        (source,status,current_count,open_since,last_positive_at,last_cleared_at,
         checked_at,consecutive_checks,episodes)
      values(v_kind,v_next,v_count,
        case when v_next='active' then v_now end,
        case when v_next='active' then v_now end,
        null,v_now,case when v_next='active' then 1 else 0 end,
        case when v_next='active' then 1 else 0 end);
      if v_next='active' then
        insert into tamao_internal.operational_alert_events_v1_209
          (source,previous_status,new_status,observed_at,count_at_change)
        values(v_kind,null,v_next,v_now,v_count);
      end if;
    else
      -- A previous unreadable observation interrupts continuity.
      v_streak:=case when v_next='active' and v_prior.status='active'
                     then v_prior.consecutive_checks+1
                     when v_next='active' then 1 else 0 end;
      v_episodes:=v_prior.episodes+
        case when v_next='active' and v_prior.status<>'active' then 1 else 0 end;
      v_open:=case when v_next='active' and v_prior.status='active'
                   then v_prior.open_since
                   when v_next='active' then v_now else null end;
      v_cleared:=case when v_next='clear' and v_prior.status='active' then v_now
                      else v_prior.last_cleared_at end;
      v_last_positive:=case when v_next='active' then v_now
                            else v_prior.last_positive_at end;
      update tamao_internal.operational_alert_state_v1_209 set
        status=v_next,current_count=v_count,
        open_since=v_open,last_positive_at=v_last_positive,
        last_cleared_at=v_cleared,checked_at=v_now,
        consecutive_checks=v_streak,episodes=v_episodes
       where source=v_kind;
      -- Log meaningful count growth once per database observation, not on each admin visit.
      if v_prior.status<>v_next or
        (v_prior.status='active' and v_next='active'
         and v_count>coalesce(v_prior.current_count,0)) then
        insert into tamao_internal.operational_alert_events_v1_209
          (source,previous_status,new_status,observed_at,count_at_change)
        values(v_kind,v_prior.status,v_next,v_now,v_count);
      end if;
    end if;
    v_processed:=v_processed+1;
  end loop;
  return jsonb_build_object('source','postgres_authoritative',
    'checkedAt',v_now,'sourcesProcessed',v_processed);
end;
$fn$;
revoke all on function tamao_internal.record_operational_alert_lifecycle_v1_209()
  from public,anon,authenticated,service_role;

-- Read-only trusted edge RPC: the user ID is checked against the live admin DB role.
create or replace function public.admin_operational_alert_lifecycle_v1_209(p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog
as $fn$
declare
  v_role text;
  v_sources text[];
  v_states jsonb;
  v_events jsonb;
  v_checked timestamptz;
  v_job cron.job%rowtype;
  v_status text;
  v_now timestamptz:=clock_timestamp();
begin
  select admin_role into v_role from public.platform_admins
   where user_id=p_actor_user_id and active
    and admin_role in ('superadmin','operations','finance','support','compliance','readonly')
   limit 1;
  if v_role is null then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;
  v_sources:=case v_role
    when 'superadmin' then array['incidents','support','finance','capture']
    when 'operations' then array['incidents','support','capture']
    when 'support' then array['incidents','support']
    when 'finance' then array['incidents','finance']
    when 'compliance' then array['incidents','capture']
    when 'readonly' then array['incidents','capture']
    else array[]::text[] end;
  select * into v_job from cron.job
    where jobname='tamao-operational-alert-lifecycle-v1-209' limit 1;
  select max(checked_at) into v_checked
    from tamao_internal.operational_alert_state_v1_209;
  v_status:=case
    when v_job.jobid is null then 'job_missing'
    when not v_job.active then 'job_disabled'
    when v_job.username<>'postgres' or v_job.schedule<>'43 * * * *'
      or btrim(v_job.command)<>'select tamao_internal.record_operational_alert_lifecycle_v1_209();'
      then 'job_changed'
    when v_checked is null then 'awaiting_first'
    when v_checked>v_now+interval '1 minute' then 'unverified'
    when v_now-v_checked>interval '90 minutes' then 'stale'
    else 'current' end;
  select coalesce(jsonb_agg(jsonb_build_object(
    'source',s.source,'status',s.status,'count',s.current_count,
    'openSince',s.open_since,'lastPositiveAt',s.last_positive_at,
    'lastClearedAt',s.last_cleared_at,'checkedAt',s.checked_at,
    'consecutiveChecks',s.consecutive_checks,'episodes',s.episodes)
    order by s.source),'[]'::jsonb)
   into v_states
   from tamao_internal.operational_alert_state_v1_209 s
   where s.source=any(v_sources);
  select coalesce(jsonb_agg(jsonb_build_object(
    'source',e.source,'previous',e.previous_status,'status',e.new_status,
    'at',e.observed_at,'count',e.count_at_change)
    order by e.observed_at desc,e.id desc),'[]'::jsonb)
   into v_events
   from (
     select * from tamao_internal.operational_alert_events_v1_209
     where source=any(v_sources)
     order by observed_at desc,id desc limit 12
   ) e;
  return jsonb_build_object(
    'source','database_authoritative','readOnly',true,
    'monitor',jsonb_build_object('status',v_status,'checkedAt',v_checked,
      'asOf',v_now,'cadence','hourly','maxAgeMinutes',90),
    'states',v_states,'events',v_events,
    'noPersonalData',true);
end;
$fn$;
revoke all on function public.admin_operational_alert_lifecycle_v1_209(uuid)
  from public,anon,authenticated;
grant execute on function public.admin_operational_alert_lifecycle_v1_209(uuid)
  to service_role;

-- One hour between observations; no network or key material required.
do $schedule$
begin
  if not exists(select 1 from cron.job
    where jobname='tamao-operational-alert-lifecycle-v1-209') then
    perform cron.schedule('tamao-operational-alert-lifecycle-v1-209',
      '43 * * * *',
      'select tamao_internal.record_operational_alert_lifecycle_v1_209();');
  end if;
end;
$schedule$;
