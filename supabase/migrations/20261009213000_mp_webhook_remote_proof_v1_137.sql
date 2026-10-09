-- TAMÃO V1.137 — Signed Mercado Pago webhook remote-proof authority
-- A short-lived probe can be entered in Mercado Pago's official webhook
-- simulator. Only a valid provider HMAC can consume it. No financial mutation.

create table if not exists public.payment_webhook_probes (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  resource_id text not null unique,
  status text not null default 'pending',
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  provider_request_id text,
  evidence_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  constraint payment_webhook_probes_provider_check
    check (provider in ('mercadopago')),
  constraint payment_webhook_probes_resource_check
    check (
      resource_id ~ '^TAMAO-WEBHOOK-PROBE-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
  constraint payment_webhook_probes_status_check
    check (status in ('pending','verified','expired')),
  constraint payment_webhook_probes_expiry_check
    check (expires_at>requested_at and expires_at<=requested_at+interval '30 minutes'),
  constraint payment_webhook_probes_verified_pair_check
    check (
      (status='verified' and verified_at is not null and evidence_sha256 is not null)
      or (status<>'verified' and verified_at is null)
    ),
  constraint payment_webhook_probes_request_id_check
    check (
      provider_request_id is null
      or (
        char_length(provider_request_id) between 1 and 240
        and provider_request_id !~ '[[:cntrl:]]'
      )
    ),
  constraint payment_webhook_probes_evidence_check
    check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint payment_webhook_probes_metadata_check
    check (jsonb_typeof(metadata)='object')
);

create index if not exists payment_webhook_probes_provider_status_idx
  on public.payment_webhook_probes(provider,status,requested_at desc);

create index if not exists payment_webhook_probes_requested_by_idx
  on public.payment_webhook_probes(requested_by,requested_at desc);

create index if not exists payment_webhook_probes_verified_idx
  on public.payment_webhook_probes(provider,verified_at desc)
  where status='verified';

alter table public.payment_webhook_probes enable row level security;
revoke all on table public.payment_webhook_probes from public,anon,authenticated;
grant select,insert,update on table public.payment_webhook_probes to service_role;

create or replace function public.admin_create_payment_webhook_probe(
  p_actor_user_id uuid,
  p_provider text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_role text;
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_action public.action_requests%rowtype;
  v_probe public.payment_webhook_probes%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;
  if v_provider<>'mercadopago' then
    raise exception 'WEBHOOK_PROBE_PROVIDER_UNSUPPORTED' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:payment-webhook-probe:'||v_provider,p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found
     or v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:payment-webhook-probe:'||v_provider
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  update public.payment_webhook_probes
  set status='expired'
  where provider=v_provider
    and requested_by=p_actor_user_id
    and status='pending'
    and expires_at<=v_now;

  if exists(
    select 1
    from public.payment_webhook_probes
    where provider=v_provider
      and requested_by=p_actor_user_id
      and status='pending'
      and expires_at>v_now
  ) then
    select *
    into v_probe
    from public.payment_webhook_probes
    where provider=v_provider
      and requested_by=p_actor_user_id
      and status='pending'
      and expires_at>v_now
    order by requested_at desc
    limit 1
    for update;
  else
    insert into public.payment_webhook_probes(
      provider,resource_id,status,requested_by,requested_at,expires_at,metadata
    )
    values(
      v_provider,
      'TAMAO-WEBHOOK-PROBE-'||gen_random_uuid()::text,
      'pending',
      p_actor_user_id,
      v_now,
      v_now+interval '15 minutes',
      jsonb_build_object(
        'purpose','remote_webhook_registration_proof',
        'financialMutationAllowed',false
      )
    )
    returning * into v_probe;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'create_payment_webhook_probe',
      'payment_provider',
      v_provider,
      jsonb_build_object(
        'probeId',v_probe.id,
        'expiresAt',v_probe.expires_at,
        'financialMutationAllowed',false
      )
    );
  end if;

  v_result:=jsonb_build_object(
    'ok',true,
    'provider',v_provider,
    'probeId',v_probe.id,
    'resourceId',v_probe.resource_id,
    'status',v_probe.status,
    'requestedAt',v_probe.requested_at,
    'expiresAt',v_probe.expires_at,
    'financialMutationAttempted',false
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;

revoke all on function public.admin_create_payment_webhook_probe(
  uuid,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_create_payment_webhook_probe(
  uuid,text,text,text
) to service_role;

create or replace function public.consume_payment_webhook_probe(
  p_provider text,
  p_resource_id text,
  p_provider_request_id text,
  p_evidence_sha256 text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_resource text:=trim(coalesce(p_resource_id,''));
  v_request_id text:=nullif(trim(coalesce(p_provider_request_id,'')),'');
  v_hash text:=lower(trim(coalesce(p_evidence_sha256,'')));
  v_probe public.payment_webhook_probes%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if v_provider<>'mercadopago'
     or v_resource!~'^TAMAO-WEBHOOK-PROBE-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_hash!~'^[0-9a-f]{64}$'
     or p_metadata is null
     or jsonb_typeof(p_metadata)<>'object'
     or (v_request_id is not null and (
       char_length(v_request_id)>240 or v_request_id~'[[:cntrl:]]'
     )) then
    raise exception 'WEBHOOK_PROBE_INVALID' using errcode='22023';
  end if;

  select *
  into v_probe
  from public.payment_webhook_probes
  where provider=v_provider
    and resource_id=v_resource
  for update;

  if not found then
    raise exception 'WEBHOOK_PROBE_NOT_FOUND' using errcode='P0002';
  end if;

  if v_probe.status='verified' then
    return jsonb_build_object(
      'ok',true,
      'provider',v_provider,
      'probeId',v_probe.id,
      'resourceId',v_probe.resource_id,
      'status','verified',
      'verifiedAt',v_probe.verified_at,
      'replayed',true,
      'financialMutationAttempted',false
    );
  end if;

  if v_probe.status='expired' or v_probe.expires_at<=v_now then
    update public.payment_webhook_probes
    set status='expired'
    where id=v_probe.id;
    raise exception 'WEBHOOK_PROBE_EXPIRED' using errcode='22023';
  end if;

  update public.payment_webhook_probes
  set status='verified',
      verified_at=v_now,
      provider_request_id=v_request_id,
      evidence_sha256=v_hash,
      metadata=metadata||p_metadata||jsonb_build_object(
        'signatureVerified',true,
        'financialMutationAttempted',false
      )
  where id=v_probe.id
  returning * into v_probe;

  return jsonb_build_object(
    'ok',true,
    'provider',v_provider,
    'probeId',v_probe.id,
    'resourceId',v_probe.resource_id,
    'status','verified',
    'verifiedAt',v_probe.verified_at,
    'replayed',false,
    'financialMutationAttempted',false
  );
end;
$function$;

revoke all on function public.consume_payment_webhook_probe(
  text,text,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.consume_payment_webhook_probe(
  text,text,text,text,jsonb
) to service_role;
