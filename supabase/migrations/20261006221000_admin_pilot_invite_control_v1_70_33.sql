-- TAMÃO V1.70.33 — autoridade administrativa para rotação/revogação de convite piloto.
-- O token em claro é gerado no navegador administrativo e nunca persiste no banco.
-- Somente o SHA-256 é recebido por esta autoridade server-side.

create or replace function public.admin_pilot_partner_invite_action(
  p_actor_user_id uuid,
  p_draft_id uuid,
  p_action text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_action public.action_requests%rowtype;
  v_draft public.pilot_partner_drafts%rowtype;
  v_invite public.pilot_partner_invites%rowtype;
  v_revoked integer:=0;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  p_action:=lower(trim(coalesce(p_action,'')));
  p_reason:=trim(coalesce(p_reason,''));
  p_token_hash:=lower(trim(coalesce(p_token_hash,'')));

  if p_action not in ('rotate','revoke') then
    raise exception 'INVALID_PILOT_INVITE_ADMIN_ACTION' using errcode='22023';
  end if;
  if p_draft_id is null then
    raise exception 'INVALID_PILOT_DRAFT' using errcode='22023';
  end if;
  if char_length(p_reason)<3 or char_length(p_reason)>1000 then
    raise exception 'PILOT_INVITE_REASON_REQUIRED' using errcode='22023';
  end if;
  if p_action='rotate' then
    if p_token_hash!~'^[0-9a-f]{64}$' then
      raise exception 'INVALID_PILOT_INVITE_HASH' using errcode='22023';
    end if;
    if p_expires_at is null
       or p_expires_at<=clock_timestamp()
       or p_expires_at>clock_timestamp()+interval '30 days' then
      raise exception 'INVALID_PILOT_INVITE_EXPIRY' using errcode='22023';
    end if;
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-pilot-invite:'||p_action,p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;
  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-pilot-invite:'||p_action
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_draft
  from public.pilot_partner_drafts
  where id=p_draft_id
  for update;

  if not found then
    raise exception 'PILOT_PARTNER_NOT_FOUND' using errcode='P0002';
  end if;
  if v_draft.onboarding_status='cancelled' then
    raise exception 'PILOT_PARTNER_CANCELLED' using errcode='40001';
  end if;
  if v_draft.merchant_id is not null or v_draft.onboarding_status='converted' then
    raise exception 'PILOT_PARTNER_ALREADY_CONVERTED' using errcode='40001';
  end if;

  update public.pilot_partner_invites
  set revoked_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where draft_id=p_draft_id
    and revoked_at is null
    and claimed_at is null;
  get diagnostics v_revoked=row_count;

  if p_action='rotate' then
    insert into public.pilot_partner_invites(
      draft_id,token_hash,expires_at
    )
    values(
      p_draft_id,p_token_hash,p_expires_at
    )
    returning * into v_invite;

    v_result:=jsonb_build_object(
      'ok',true,
      'action','rotate',
      'draftId',p_draft_id,
      'inviteId',v_invite.id,
      'expiresAt',v_invite.expires_at,
      'revokedPreviousCount',v_revoked
    );
  else
    v_result:=jsonb_build_object(
      'ok',true,
      'action','revoke',
      'draftId',p_draft_id,
      'revokedCount',v_revoked
    );
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_action='rotate'
      then 'rotate-pilot-partner-invite'
      else 'revoke-pilot-partner-invite'
    end,
    'pilot_partner_draft',
    p_draft_id::text,
    jsonb_build_object(
      'inviteId',case when p_action='rotate' then v_invite.id else null end,
      'expiresAt',case when p_action='rotate' then v_invite.expires_at else null end,
      'revokedCount',v_revoked,
      'reason',p_reason
    )
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_pilot_partner_invite_action(
  uuid,uuid,text,text,timestamptz,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_pilot_partner_invite_action(
  uuid,uuid,text,text,timestamptz,text,text,text
) to service_role;
