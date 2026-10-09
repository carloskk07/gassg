-- TAMÃO V1.136 — OIDC-backed automated live portal attestation
-- Machine attestations are distinct from human admin actions. They can only
-- refresh factual portal health and never enable commerce or confirm warnings.

create table if not exists public.platform_portal_attestations (
  id uuid primary key default gen_random_uuid(),
  source_sha text not null,
  evidence_sha256 text not null,
  attestation_source text not null default 'github_oidc_edge',
  repository text not null,
  repository_id text not null,
  repository_owner_id text not null,
  workflow_ref text not null,
  run_id bigint not null,
  run_attempt integer not null,
  event_name text not null,
  evidence jsonb not null,
  verified_at timestamptz not null default clock_timestamp(),
  constraint platform_portal_attestations_source_sha_check
    check (source_sha ~ '^[0-9a-f]{40}$'),
  constraint platform_portal_attestations_evidence_sha_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint platform_portal_attestations_source_check
    check (attestation_source='github_oidc_edge'),
  constraint platform_portal_attestations_repository_check
    check (repository='carloskk07/gassg'),
  constraint platform_portal_attestations_repository_id_check
    check (repository_id='1399072319'),
  constraint platform_portal_attestations_owner_id_check
    check (repository_owner_id='171106109'),
  constraint platform_portal_attestations_workflow_check
    check (workflow_ref='carloskk07/gassg/.github/workflows/launch-readiness.yml@refs/heads/main'),
  constraint platform_portal_attestations_run_id_check
    check (run_id>0),
  constraint platform_portal_attestations_run_attempt_check
    check (run_attempt between 1 and 100),
  constraint platform_portal_attestations_event_check
    check (event_name in ('push','schedule','workflow_dispatch')),
  constraint platform_portal_attestations_evidence_check
    check (jsonb_typeof(evidence)='object')
);

create index if not exists platform_portal_attestations_verified_idx
  on public.platform_portal_attestations(verified_at desc);

create index if not exists platform_portal_attestations_source_verified_idx
  on public.platform_portal_attestations(source_sha,verified_at desc);

create index if not exists platform_portal_attestations_run_idx
  on public.platform_portal_attestations(run_id,run_attempt);

alter table public.platform_portal_attestations enable row level security;
revoke all on table public.platform_portal_attestations from public,anon,authenticated;
grant select,insert on table public.platform_portal_attestations to service_role;

create or replace function public.record_automated_portal_attestation(
  p_source_sha text,
  p_evidence_sha256 text,
  p_repository text,
  p_repository_id text,
  p_repository_owner_id text,
  p_workflow_ref text,
  p_run_id bigint,
  p_run_attempt integer,
  p_event_name text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_source_sha text:=lower(trim(coalesce(p_source_sha,'')));
  v_evidence_sha text:=lower(trim(coalesce(p_evidence_sha256,'')));
  v_attestation_id uuid;
  v_readiness jsonb;
begin
  if v_source_sha!~'^[0-9a-f]{40}$'
     or v_evidence_sha!~'^[0-9a-f]{64}$'
     or p_repository<>'carloskk07/gassg'
     or p_repository_id<>'1399072319'
     or p_repository_owner_id<>'171106109'
     or p_workflow_ref<>'carloskk07/gassg/.github/workflows/launch-readiness.yml@refs/heads/main'
     or p_run_id is null or p_run_id<=0
     or p_run_attempt is null or p_run_attempt<1 or p_run_attempt>100
     or p_event_name not in ('push','schedule','workflow_dispatch')
     or p_evidence is null
     or jsonb_typeof(p_evidence)<>'object'
     or coalesce((p_evidence->>'allPortalsReady')::boolean,false)<>true
     or coalesce((p_evidence->>'expectedSourceMatches')::boolean,false)<>true
     or lower(trim(coalesce(p_evidence->>'sourceSha','')))<>v_source_sha then
    raise exception 'AUTOMATED_PORTAL_ATTESTATION_INVALID' using errcode='22023';
  end if;

  insert into public.platform_portal_attestations(
    source_sha,evidence_sha256,attestation_source,
    repository,repository_id,repository_owner_id,workflow_ref,
    run_id,run_attempt,event_name,evidence,verified_at
  )
  values(
    v_source_sha,v_evidence_sha,'github_oidc_edge',
    p_repository,p_repository_id,p_repository_owner_id,p_workflow_ref,
    p_run_id,p_run_attempt,p_event_name,p_evidence,clock_timestamp()
  )
  returning id into v_attestation_id;

  update public.platform_launch_control
  set portals_verified_at=clock_timestamp(),
      portals_source_sha=v_source_sha,
      customer_portal_ok=true,
      merchant_portal_ok=true,
      admin_portal_ok=true,
      updated_at=clock_timestamp()
  where singleton=true;

  if not found then
    raise exception 'LAUNCH_CONTROL_MISSING' using errcode='P0002';
  end if;

  v_readiness:=public.platform_launch_readiness();

  return jsonb_build_object(
    'ok',true,
    'attestationId',v_attestation_id,
    'source','github_oidc_edge',
    'sourceSha',v_source_sha,
    'readiness',v_readiness
  );
end;
$function$;

revoke all on function public.record_automated_portal_attestation(
  text,text,text,text,text,text,bigint,integer,text,jsonb
) from public,anon,authenticated;
grant execute on function public.record_automated_portal_attestation(
  text,text,text,text,text,text,bigint,integer,text,jsonb
) to service_role;
