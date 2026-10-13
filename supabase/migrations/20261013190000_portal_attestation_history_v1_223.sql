-- TAMÃO V1.223 — Evidência horária da atestação GitHub OIDC, sem alegar uptime.
-- Apenas PostgreSQL/cron observa e escreve; browser e service_role não recebem acesso
-- direto aos registros internos. A atestação continua sendo autoridade independente.
create table if not exists tamao_internal.portal_attestation_episodes_v1_223(
  id bigint generated always as identity primary key,
  opened_at timestamptz not null,
  last_observed_at timestamptz not null,
  resolved_at timestamptz,
  opening_reason text not null check(opening_reason in
    ('OIDC_MISSING','OIDC_EXPIRED','SOURCE_SHA_MISMATCH','PORTALS_NOT_FRESH')),
  latest_reason text not null check(latest_reason in
    ('OIDC_MISSING','OIDC_EXPIRED','SOURCE_SHA_MISMATCH','PORTALS_NOT_FRESH')),
  first_sha text check(first_sha is null or first_sha ~ '^[a-f0-9]{40}$'),
  last_sha text check(last_sha is null or last_sha ~ '^[a-f0-9]{40}$'),
  recovered_sha text check(recovered_sha is null or recovered_sha ~ '^[a-f0-9]{40}$'),
  recovered_attestation_id uuid,
  observations integer not null default 1 check(observations>=1),
  constraint portal_episode_time_check check(resolved_at is null or resolved_at>=opened_at),
  constraint portal_episode_proof_check check(
    (resolved_at is null and recovered_attestation_id is null and recovered_sha is null)
    or (resolved_at is not null and recovered_attestation_id is not null and recovered_sha is not null))
);
create unique index if not exists portal_episode_one_open_v1_223
  on tamao_internal.portal_attestation_episodes_v1_223((1)) where resolved_at is null;
create index if not exists portal_episode_recent_v1_223
  on tamao_internal.portal_attestation_episodes_v1_223(opened_at desc,id desc);

create table if not exists tamao_internal.portal_attestation_state_v1_223(
  singleton boolean primary key default true check(singleton),
  state text not null check(state in ('active','clear','unknown')),
  checked_at timestamptz not null,
  source_sha text check(source_sha is null or source_sha ~ '^[a-f0-9]{40}$'),
  reason text,
  active_episode_id bigint references tamao_internal.portal_attestation_episodes_v1_223(id),
  consecutive_active integer not null default 0 check(consecutive_active>=0)
);
create table if not exists tamao_internal.portal_attestation_observations_v1_223(
  slot_at timestamptz primary key,
  observed_at timestamptz not null,
  state text not null check(state in ('active','clear','unknown')),
  reason text,
  source_sha text check(source_sha is null or source_sha ~ '^[a-f0-9]{40}$'),
  episode_id bigint references tamao_internal.portal_attestation_episodes_v1_223(id),
  proof_attestation_id uuid
);
revoke all on schema tamao_internal from public,anon,authenticated,service_role;
revoke all on tamao_internal.portal_attestation_episodes_v1_223,
  tamao_internal.portal_attestation_state_v1_223,
  tamao_internal.portal_attestation_observations_v1_223
  from public,anon,authenticated,service_role;

-- An hour-slot cannot be counted twice. Failed/unknown queries never close an episode.
create or replace function tamao_internal.record_portal_attestation_history_v1_223()
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog
as $fn$
declare
  v_now timestamptz:=clock_timestamp();
  v_slot timestamptz:=date_trunc('hour',clock_timestamp());
  v_att public.platform_portal_attestations%rowtype;
  v_readiness jsonb;
  v_prev tamao_internal.portal_attestation_state_v1_223%rowtype;
  v_next text:='unknown';
  v_reason text:='SOURCE_UNVERIFIED';
  v_sha text;
  v_episode bigint;
  v_proof boolean:=false;
begin
  if session_user<>'postgres' then
    raise exception 'PORTAL_HISTORY_CRON_ONLY' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(184223,223);
  if exists(select 1 from tamao_internal.portal_attestation_observations_v1_223
    where slot_at=v_slot) then
    return jsonb_build_object('recorded',false,'reason','ALREADY_OBSERVED');
  end if;
  begin
    select * into v_att from public.platform_portal_attestations
      where attestation_source='github_oidc_edge'
      order by verified_at desc,id desc limit 1;
    v_readiness:=public.platform_launch_readiness();
    v_sha:=nullif(v_readiness->>'portalsSourceSha','');
    if v_readiness is null or jsonb_typeof(v_readiness)<>'object'
      or (v_readiness->>'portalsFresh') not in ('true','false') then
      v_next:='unknown';v_reason:='SOURCE_UNVERIFIED';
    elsif v_att.id is null then
      v_next:='active';v_reason:='OIDC_MISSING';
    elsif v_att.verified_at>v_now+interval '1 minute'
      or v_att.verified_at<v_now-interval '60 minutes' then
      v_next:='active';v_reason:='OIDC_EXPIRED';
    elsif v_sha is null or v_sha!~'^[a-f0-9]{40}$'
      or v_sha<>v_att.source_sha then
      v_next:='active';v_reason:='SOURCE_SHA_MISMATCH';
    elsif (v_readiness->>'portalsFresh')::boolean is not true then
      v_next:='active';v_reason:='PORTALS_NOT_FRESH';
    else
      v_next:='clear';v_reason:='OIDC_FRESH_AND_SHA_MATCH';
      v_proof:=true;
    end if;
  exception when others then
    v_next:='unknown';v_reason:='SOURCE_UNVERIFIED';v_proof:=false;
    v_sha:=null;
  end;

  insert into tamao_internal.portal_attestation_state_v1_223
    (singleton,state,checked_at,source_sha,reason,active_episode_id,consecutive_active)
  values(true,'unknown',v_now,null,'NOT_YET_OBSERVED',null,0)
  on conflict(singleton) do nothing;
  select * into v_prev from tamao_internal.portal_attestation_state_v1_223
    where singleton=true for update;

  v_episode:=v_prev.active_episode_id;
  if v_next='active' then
    if v_episode is null then
      insert into tamao_internal.portal_attestation_episodes_v1_223
        (opened_at,last_observed_at,opening_reason,latest_reason,first_sha,last_sha)
      values(v_now,v_now,v_reason,v_reason,v_sha,v_sha)
      returning id into v_episode;
    else
      update tamao_internal.portal_attestation_episodes_v1_223
      set last_observed_at=v_now,latest_reason=v_reason,last_sha=v_sha,
          observations=observations+1
      where id=v_episode and resolved_at is null;
      if not found then
        raise exception 'PORTAL_EPISODE_INCONSISTENT' using errcode='P0001';
      end if;
    end if;
  elsif v_next='clear' and v_episode is not null and v_proof then
    update tamao_internal.portal_attestation_episodes_v1_223
    set resolved_at=v_now,last_observed_at=v_now,recovered_sha=v_sha,
        recovered_attestation_id=v_att.id
    where id=v_episode and resolved_at is null;
    if not found then
      raise exception 'PORTAL_EPISODE_INCONSISTENT' using errcode='P0001';
    end if;
    v_episode:=null;
  end if;

  update tamao_internal.portal_attestation_state_v1_223 set
    state=v_next,checked_at=v_now,source_sha=v_sha,reason=v_reason,
    active_episode_id=v_episode,
    consecutive_active=case when v_next='active'
      then case when v_prev.state='active' then v_prev.consecutive_active+1 else 1 end
      else 0 end
  where singleton=true;

  insert into tamao_internal.portal_attestation_observations_v1_223
    (slot_at,observed_at,state,reason,source_sha,episode_id,proof_attestation_id)
  values(v_slot,v_now,v_next,v_reason,v_sha,v_episode,
    case when v_proof then v_att.id end);

  return jsonb_build_object('recorded',true,'state',v_next,'reason',v_reason,
    'checkedAt',v_now,'activeEpisodeId',v_episode,'source','postgres_hourly_oidc_evidence');
end;
$fn$;
revoke all on function tamao_internal.record_portal_attestation_history_v1_223()
 from public,anon,authenticated,service_role;

-- Role-scoped, read-only RPC; only the existing admin Edge gateway may call.
create or replace function public.admin_portal_attestation_history_v1_223(p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog
as $fn$
declare
  v_now timestamptz:=clock_timestamp();
  v_job cron.job%rowtype;
  v_state tamao_internal.portal_attestation_state_v1_223%rowtype;
  v_status text;
  v_episodes jsonb;
begin
  if not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active
      and a.admin_role in ('superadmin','operations','readonly')) then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;
  select * into v_job from cron.job
    where jobname='tamao-portal-attestation-history-v1-223' limit 1;
  select * into v_state from tamao_internal.portal_attestation_state_v1_223
    where singleton=true;
  v_status:=case
    when v_job.jobid is null then 'job_missing'
    when not v_job.active then 'job_disabled'
    when v_job.username<>'postgres' or v_job.schedule<>'53 * * * *'
      or btrim(v_job.command)<>'select tamao_internal.record_portal_attestation_history_v1_223();'
      then 'job_changed'
    when v_state.checked_at is null then 'awaiting_first'
    when v_state.checked_at>v_now+interval '1 minute' then 'unverified'
    when v_now-v_state.checked_at>interval '90 minutes' then 'stale'
    else 'current' end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',e.id,'openedAt',e.opened_at,'lastObservedAt',e.last_observed_at,
      'resolvedAt',e.resolved_at,'openingReason',e.opening_reason,
      'latestReason',e.latest_reason,'observations',e.observations,
      'sourceSha',e.first_sha,'recoveredSha',e.recovered_sha,
      'recoveredByOidc',e.recovered_attestation_id is not null)
    order by e.opened_at desc,e.id desc),'[]'::jsonb)
  into v_episodes
  from (select * from tamao_internal.portal_attestation_episodes_v1_223
    order by opened_at desc,id desc limit 12) e;
  return jsonb_build_object(
    'source','postgres_authoritative_v1_223','readOnly',true,
    'monitor',jsonb_build_object('status',v_status,'checkedAt',v_state.checked_at,
      'asOf',v_now,'cadence','hourly','scope','oidc_freshness_not_site_uptime'),
    'state',jsonb_build_object('status',v_state.state,'checkedAt',v_state.checked_at,
      'reason',v_state.reason,'sourceSha',v_state.source_sha,
      'consecutiveActive',v_state.consecutive_active,
      'activeEpisodeId',v_state.active_episode_id),
    'episodes',v_episodes,
    'recurrenceScope','verified_oidc_evidence_episodes_only',
    'noPersonalData',true,'noOutageClaim',true);
end;
$fn$;
revoke all on function public.admin_portal_attestation_history_v1_223(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_portal_attestation_history_v1_223(uuid)
 to service_role;

do $schedule$
begin
 if not exists(select 1 from cron.job
   where jobname='tamao-portal-attestation-history-v1-223') then
   perform cron.schedule('tamao-portal-attestation-history-v1-223',
     '53 * * * *',
     'select tamao_internal.record_portal_attestation_history_v1_223();');
 end if;
end;
$schedule$;
