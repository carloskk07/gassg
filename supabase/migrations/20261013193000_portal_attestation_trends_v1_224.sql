-- TAMÃO V1.224 — conservative read-only trends from persisted OIDC evidence and
-- PostgreSQL's own cron execution log. Historical observations are NOT uptime.
-- No new tables, write privileges, public RPC access or finance side effects.
create or replace function public.admin_portal_attestation_trends_v1_224(p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog
as $fn$
declare
  v_now timestamptz:=clock_timestamp();
  v_job cron.job%rowtype;
  v_last_run cron.job_run_details%rowtype;
  v_last_success timestamptz;
  v_valid_job boolean:=false;
  v_monitor text:='unverified';
  v_success_count integer:=0;
  v_failed_count integer:=0;
  v_obs_count integer:=0;
  v_clear_count integer:=0;
  v_active_count integer:=0;
  v_unknown_count integer:=0;
  v_episodes integer:=0;
  v_resolved integer:=0;
  v_open integer:=0;
  v_persistent integer:=0;
  v_last_open timestamptz;
  v_last_closed timestamptz;
  v_trend text:='insufficient_evidence';
begin
  if not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active
      and a.admin_role in ('superadmin','operations','readonly')) then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;
  select * into v_job from cron.job
    where jobname='tamao-portal-attestation-history-v1-223' limit 1;
  v_valid_job:=v_job.jobid is not null and v_job.active
    and v_job.username='postgres' and v_job.schedule='53 * * * *'
    and btrim(v_job.command)='select tamao_internal.record_portal_attestation_history_v1_223();';
  if v_job.jobid is not null then
    select * into v_last_run from cron.job_run_details
      where jobid=v_job.jobid order by start_time desc,runid desc limit 1;
    select max(start_time) into v_last_success
      from cron.job_run_details
      where jobid=v_job.jobid and status='succeeded';
    select count(*) filter (where status='succeeded')::integer,
      count(*) filter (where status='failed')::integer
    into v_success_count,v_failed_count
    from cron.job_run_details where jobid=v_job.jobid
      and start_time>=v_now-interval '24 hours'
      and start_time<=v_now+interval '1 minute';
  end if;
  select count(*)::integer,
    count(*) filter (where state='clear')::integer,
    count(*) filter (where state='active')::integer,
    count(*) filter (where state='unknown')::integer
  into v_obs_count,v_clear_count,v_active_count,v_unknown_count
  from tamao_internal.portal_attestation_observations_v1_223
  where observed_at>=v_now-interval '24 hours'
    and observed_at<=v_now+interval '1 minute';
  select count(*)::integer,
    count(*) filter (where resolved_at is not null)::integer,
    count(*) filter (where resolved_at is null)::integer,
    count(*) filter (where resolved_at is null and observations>=3
      and opened_at<=v_now-interval '2 hours')::integer,
    max(opened_at),max(resolved_at)
  into v_episodes,v_resolved,v_open,v_persistent,v_last_open,v_last_closed
  from tamao_internal.portal_attestation_episodes_v1_223
  where opened_at>=v_now-interval '30 days'
    and opened_at<=v_now+interval '1 minute';

  v_monitor:=case
    when v_job.jobid is null then 'job_missing'
    when not v_job.active then 'job_disabled'
    when not v_valid_job then 'job_changed'
    when v_last_run.runid is null then 'awaiting_first'
    when v_last_run.start_time>v_now+interval '1 minute' then 'unverified'
    when v_last_run.status='failed' and
      v_last_run.start_time>=v_now-interval '90 minutes' then 'run_failed'
    when v_last_success is null then 'unverified'
    when v_last_success>v_now+interval '1 minute' then 'unverified'
    when v_last_success<v_now-interval '90 minutes' then 'stale'
    else 'current' end;

  -- A trend requires independent *scheduled* executions, not manual
  -- observations. Fewer than three is unmeasured, never 100% healthy.
  v_trend:=case
    when v_monitor<>'current' then 'monitor_unverified'
    when v_success_count<3 or v_obs_count<3 then 'insufficient_evidence'
    when v_open>0 and v_persistent>0 then 'persistent_attestation_issue'
    when v_episodes>=2 then 'recurrent_attestation_issue'
    when v_open>0 or v_active_count>0 or v_unknown_count>0
      then 'attestation_attention'
    else 'no_recent_attestation_issue_observed' end;

  return jsonb_build_object(
    'source','postgres_authoritative_trends_v1_224',
    'readOnly',true,'noOutageClaim',true,'noPersonalData',true,
    'asOf',v_now,'monitor',jsonb_build_object(
      'status',v_monitor,'scheduled',v_valid_job,'cadence','hourly',
      'lastRunAt',v_last_run.start_time,
      'lastRunStatus',v_last_run.status,'lastSucceededAt',v_last_success),
    'last24h',jsonb_build_object(
      'scheduledSuccesses',v_success_count,'scheduledFailures',v_failed_count,
      'observedSlots',v_obs_count,'clearObservations',v_clear_count,
      'activeObservations',v_active_count,'unknownObservations',v_unknown_count),
    'last30d',jsonb_build_object(
      'episodes',v_episodes,'resolved',v_resolved,'open',v_open,
      'persistentOpen',v_persistent,'recurrent',v_episodes>=2,
      'lastOpenedAt',v_last_open,'lastRecoveredAt',v_last_closed),
    'trend',jsonb_build_object('status',v_trend,
      'scope','OIDC_evidence_only_not_portal_uptime',
      'minScheduledChecks',3,
      'coveragePercentage',null,
      'historicalSiteOutageProven',false));
end;
$fn$;
revoke all on function public.admin_portal_attestation_trends_v1_224(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_portal_attestation_trends_v1_224(uuid)
 to service_role;
