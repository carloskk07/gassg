-- TAMÃO V1.70.28 — public request retry authority
-- Serializa retries com a mesma chave antes de consumir quota.
-- A quota e o insert vivem na mesma transação, evitando dupla cobrança de
-- rate-limit quando um ACK se perde e duas tentativas se sobrepõem.

create or replace function public.submit_public_request_idempotent(
  p_request_kind text,
  p_privacy_action text,
  p_contact_name text,
  p_contact_channel text,
  p_contact_value text,
  p_message text,
  p_source text,
  p_medium text,
  p_campaign text,
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
  v_existing public.public_requests%rowtype;
  v_inserted public.public_requests%rowtype;
  v_quota jsonb;
begin
  if p_request_kind not in ('general','support','privacy') then
    raise exception 'INVALID_REQUEST_KIND' using errcode='22023';
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
    perform pg_advisory_xact_lock(
      hashtextextended('public-request:'||p_idempotency_key,0)
    );

    select *
    into v_existing
    from public.public_requests
    where request_idempotency_key=p_idempotency_key
    for update;

    if found then
      if v_existing.request_hash<>p_request_hash then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
      end if;
      return jsonb_build_object(
        'ok',true,
        'requestId',v_existing.id,
        'requestKind',v_existing.request_kind,
        'status',v_existing.status,
        'createdAt',v_existing.created_at,
        'replayed',true
      );
    end if;
  end if;

  v_quota:=public.consume_prelaunch_lead_quota(
    p_ip_hash,
    'submit-public-request',
    5,
    3600
  );
  if not coalesce((v_quota->>'allowed')::boolean,false) then
    return jsonb_build_object(
      'ok',false,
      'error','RATE_LIMITED',
      'retryAfterSeconds',coalesce((v_quota->>'retryAfterSeconds')::integer,3600)
    );
  end if;

  insert into public.public_requests(
    request_kind,privacy_action,contact_name,contact_channel,contact_value,message,
    acknowledged_at,source,medium,campaign,referrer,landing_path,ip_hash,
    request_idempotency_key,request_hash
  )
  values(
    p_request_kind,p_privacy_action,p_contact_name,p_contact_channel,p_contact_value,p_message,
    clock_timestamp(),p_source,p_medium,p_campaign,p_referrer,p_landing_path,p_ip_hash,
    p_idempotency_key,case when p_idempotency_key is null then null else p_request_hash end
  )
  returning * into v_inserted;

  return jsonb_build_object(
    'ok',true,
    'requestId',v_inserted.id,
    'requestKind',v_inserted.request_kind,
    'status',v_inserted.status,
    'createdAt',v_inserted.created_at,
    'replayed',false
  );
end;
$$;

revoke all on function public.submit_public_request_idempotent(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.submit_public_request_idempotent(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text
) to service_role;
