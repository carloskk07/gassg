-- TAMÃO V1.70.26 — Lead retry ordering authority
-- Persist every public lead idempotency key and serialize updates by logical lead.
-- A delayed retry can replay its original result but can never overwrite a newer submission.

create table if not exists public.prelaunch_lead_submissions(
  idempotency_key text primary key,
  request_hash text not null,
  lead_id uuid references public.prelaunch_leads(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint prelaunch_lead_submissions_key_check check (
    char_length(idempotency_key) between 12 and 120
    and idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  constraint prelaunch_lead_submissions_hash_check check (
    request_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint prelaunch_lead_submissions_completion_check check (
    (lead_id is null and completed_at is null)
    or (lead_id is not null and completed_at is not null)
  )
);

alter table public.prelaunch_lead_submissions enable row level security;
revoke all on table public.prelaunch_lead_submissions from public, anon, authenticated;

create index if not exists prelaunch_lead_submissions_lead_idx
  on public.prelaunch_lead_submissions(lead_id);

create or replace function public.capture_prelaunch_lead_idempotent(
  p_lead_type text,
  p_contact_name text,
  p_business_name text,
  p_phone text,
  p_postal_code text,
  p_interests text[],
  p_note text,
  p_source text,
  p_medium text,
  p_campaign text,
  p_content text,
  p_term text,
  p_referrer text,
  p_landing_path text,
  p_ip_hash text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_request public.prelaunch_lead_submissions%rowtype;
  v_lead public.prelaunch_leads%rowtype;
  v_existing boolean:=false;
  v_quota jsonb;
begin
  if p_lead_type not in ('customer','merchant') then
    raise exception 'INVALID_LEAD_TYPE' using errcode='22023';
  end if;
  if p_phone is null or p_phone!~'^[0-9]{10,13}$' then
    raise exception 'INVALID_PHONE' using errcode='22023';
  end if;
  if p_ip_hash is null or p_ip_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_IP_HASH' using errcode='22023';
  end if;
  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;
  if p_idempotency_key is not null and (
    char_length(p_idempotency_key)<12
    or char_length(p_idempotency_key)>120
    or p_idempotency_key!~'^[A-Za-z0-9._:-]+$'
  ) then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_idempotency_key is not null then
    insert into public.prelaunch_lead_submissions(idempotency_key,request_hash)
    values(p_idempotency_key,p_request_hash)
    on conflict(idempotency_key) do nothing;

    select *
    into v_request
    from public.prelaunch_lead_submissions
    where idempotency_key=p_idempotency_key
    for update;

    if not found then
      raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
    end if;
    if v_request.request_hash<>p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    if v_request.lead_id is not null then
      select *
      into v_lead
      from public.prelaunch_leads
      where id=v_request.lead_id;

      if not found then
        raise exception 'IDEMPOTENCY_RESULT_MISSING' using errcode='40001';
      end if;

      return jsonb_build_object(
        'ok',true,
        'leadId',v_lead.id,
        'leadType',v_lead.lead_type,
        'status',v_lead.status,
        'reused',true,
        'replayed',true
      );
    end if;
  end if;

  v_quota:=public.consume_prelaunch_lead_quota(
    p_ip_hash,
    'capture-prelaunch-lead',
    6,
    3600
  );
  if not coalesce((v_quota->>'allowed')::boolean,false) then
    return jsonb_build_object(
      'ok',false,
      'error','RATE_LIMITED',
      'retryAfterSeconds',coalesce((v_quota->>'retryAfterSeconds')::integer,3600)
    );
  end if;

  -- Serialize the logical lead, not just a particular HTTP attempt.
  perform pg_advisory_xact_lock(
    hashtextextended('prelaunch-lead:'||p_lead_type||':'||p_phone,0)
  );

  select *
  into v_lead
  from public.prelaunch_leads
  where lead_type=p_lead_type
    and phone=p_phone
  for update;

  v_existing:=found;

  if v_existing then
    update public.prelaunch_leads
    set contact_name=p_contact_name,
        business_name=case when p_lead_type='merchant' then p_business_name else null end,
        postal_code=p_postal_code,
        interests=coalesce(p_interests,array[]::text[]),
        note=p_note,
        consent_at=clock_timestamp(),
        source=p_source,
        medium=p_medium,
        campaign=p_campaign,
        content=p_content,
        term=p_term,
        referrer=p_referrer,
        landing_path=p_landing_path,
        ip_hash=p_ip_hash,
        submission_count=least(1000000,submission_count+1),
        last_submission_idempotency_key=p_idempotency_key,
        last_submission_hash=case when p_idempotency_key is null then null else p_request_hash end,
        updated_at=clock_timestamp()
    where id=v_lead.id
    returning * into v_lead;
  else
    insert into public.prelaunch_leads(
      lead_type,contact_name,business_name,phone,postal_code,interests,note,
      consent_at,source,medium,campaign,content,term,referrer,landing_path,
      ip_hash,last_submission_idempotency_key,last_submission_hash,updated_at
    )
    values(
      p_lead_type,p_contact_name,
      case when p_lead_type='merchant' then p_business_name else null end,
      p_phone,p_postal_code,coalesce(p_interests,array[]::text[]),p_note,
      clock_timestamp(),p_source,p_medium,p_campaign,p_content,p_term,p_referrer,
      p_landing_path,p_ip_hash,p_idempotency_key,
      case when p_idempotency_key is null then null else p_request_hash end,
      clock_timestamp()
    )
    returning * into v_lead;
  end if;

  if p_idempotency_key is not null then
    update public.prelaunch_lead_submissions
    set lead_id=v_lead.id,
        completed_at=clock_timestamp()
    where idempotency_key=p_idempotency_key
      and request_hash=p_request_hash;

    if not found then
      raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'leadId',v_lead.id,
    'leadType',v_lead.lead_type,
    'status',v_lead.status,
    'reused',v_existing,
    'replayed',false
  );
end;
$$;

revoke all on function public.capture_prelaunch_lead_idempotent(
  text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.capture_prelaunch_lead_idempotent(
  text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text
) to service_role;
