-- Chama São Gabriel — merchant team invitations and revocation v1.38

create table if not exists public.merchant_team_invites (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  email_normalized text not null,
  member_role text not null check (member_role in ('manager','operator','driver')),
  display_name text,
  invited_by uuid references auth.users(id) on delete set null,
  accepted_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default (now()+interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id,email_normalized),
  check (email_normalized=lower(trim(email_normalized))),
  check (char_length(email_normalized) between 3 and 160),
  check (
    display_name is null
    or (
      char_length(trim(display_name)) between 2 and 60
      and display_name=trim(display_name)
    )
  ),
  check (expires_at>created_at),
  check (accepted_at is null or accepted_user_id is not null)
);

alter table public.merchant_team_invites enable row level security;
revoke all on table public.merchant_team_invites from public, anon, authenticated;
grant all on table public.merchant_team_invites to service_role;

create index if not exists merchant_team_invites_invited_by_fk_idx
  on public.merchant_team_invites(invited_by);
create index if not exists merchant_team_invites_accepted_user_fk_idx
  on public.merchant_team_invites(accepted_user_id);
create index if not exists merchant_team_invites_pending_idx
  on public.merchant_team_invites(email_normalized,expires_at)
  where accepted_at is null and revoked_at is null;

create table if not exists public.merchant_team_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  invite_id uuid references public.merchant_team_invites(id) on delete set null,
  event_type text not null,
  detail text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.merchant_team_events enable row level security;
revoke all on table public.merchant_team_events from public, anon, authenticated;
grant all on table public.merchant_team_events to service_role;

create index if not exists merchant_team_events_merchant_created_idx
  on public.merchant_team_events(merchant_id,created_at desc);
create index if not exists merchant_team_events_actor_fk_idx
  on public.merchant_team_events(actor_user_id);
create index if not exists merchant_team_events_target_fk_idx
  on public.merchant_team_events(target_user_id);
create index if not exists merchant_team_events_invite_fk_idx
  on public.merchant_team_events(invite_id);

create or replace function public.merchant_team_snapshot(
  p_actor_user_id uuid,
  p_merchant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_role text;
  v_members jsonb;
  v_invites jsonb;
begin
  select mm.member_role
  into v_actor_role
  from public.merchant_members mm
  where mm.merchant_id=p_merchant_id
    and mm.user_id=p_actor_user_id
    and mm.active
  limit 1;

  if not found or v_actor_role not in ('owner','manager') then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId',mm.user_id,
        'email',u.email,
        'memberRole',mm.member_role,
        'displayName',mm.display_name,
        'active',mm.active,
        'isSelf',mm.user_id=p_actor_user_id,
        'createdAt',mm.created_at
      )
      order by
        case mm.member_role
          when 'owner' then 1
          when 'manager' then 2
          when 'operator' then 3
          else 4
        end,
        coalesce(mm.display_name,u.email,'')
    ),
    '[]'::jsonb
  )
  into v_members
  from public.merchant_members mm
  join auth.users u on u.id=mm.user_id
  where mm.merchant_id=p_merchant_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'inviteId',i.id,
        'email',i.email_normalized,
        'memberRole',i.member_role,
        'displayName',i.display_name,
        'expiresAt',i.expires_at,
        'createdAt',i.created_at
      )
      order by i.created_at desc
    ),
    '[]'::jsonb
  )
  into v_invites
  from public.merchant_team_invites i
  where i.merchant_id=p_merchant_id
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at>clock_timestamp();

  return jsonb_build_object(
    'actorRole',v_actor_role,
    'members',v_members,
    'pendingInvites',v_invites
  );
end;
$$;

revoke all on function public.merchant_team_snapshot(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.merchant_team_snapshot(uuid,uuid)
to service_role;

create or replace function public.claim_merchant_team_invites(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_email text;
  v_is_anonymous boolean;
  v_invite public.merchant_team_invites%rowtype;
  v_existing_role text;
  v_existing_active boolean;
  v_claimed integer:=0;
  v_merchants uuid[]:=array[]::uuid[];
begin
  select lower(trim(u.email)),coalesce(u.is_anonymous,false)
  into v_email,v_is_anonymous
  from auth.users u
  where u.id=p_user_id;

  if not found or v_is_anonymous or v_email is null or v_email='' then
    return jsonb_build_object('claimedCount',0,'merchantIds','[]'::jsonb);
  end if;

  for v_invite in
    select *
    from public.merchant_team_invites i
    where i.email_normalized=v_email
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at>clock_timestamp()
    order by i.created_at
    for update
  loop
    v_existing_role:=null;
    v_existing_active:=null;

    select mm.member_role,mm.active
    into v_existing_role,v_existing_active
    from public.merchant_members mm
    where mm.merchant_id=v_invite.merchant_id
      and mm.user_id=p_user_id;

    if found and v_existing_role='owner' then
      update public.merchant_team_invites
      set revoked_at=clock_timestamp(),
          updated_at=clock_timestamp()
      where id=v_invite.id;
      continue;
    end if;

    if not found then
      insert into public.merchant_members(
        merchant_id,user_id,member_role,active,display_name
      )
      values(
        v_invite.merchant_id,p_user_id,v_invite.member_role,true,v_invite.display_name
      );
    elsif not coalesce(v_existing_active,false) then
      update public.merchant_members
      set member_role=v_invite.member_role,
          active=true,
          display_name=coalesce(v_invite.display_name,display_name)
      where merchant_id=v_invite.merchant_id
        and user_id=p_user_id;
    end if;

    update public.merchant_team_invites
    set accepted_user_id=p_user_id,
        accepted_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=v_invite.id;

    insert into public.merchant_team_events(
      merchant_id,actor_user_id,target_user_id,invite_id,event_type,detail,metadata
    )
    values(
      v_invite.merchant_id,p_user_id,p_user_id,v_invite.id,
      'TEAM_INVITE_CLAIMED',
      'Convite de equipe reivindicado no primeiro login autenticado.',
      jsonb_build_object('memberRole',v_invite.member_role)
    );

    v_claimed:=v_claimed+1;
    v_merchants:=array_append(v_merchants,v_invite.merchant_id);
  end loop;

  return jsonb_build_object(
    'claimedCount',v_claimed,
    'merchantIds',to_jsonb(v_merchants)
  );
end;
$$;

revoke all on function public.claim_merchant_team_invites(uuid)
from public, anon, authenticated;
grant execute on function public.claim_merchant_team_invites(uuid)
to service_role;

create or replace function public.merchant_team_mutate(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_action text,
  p_email text,
  p_member_role text,
  p_display_name text,
  p_target_user_id uuid,
  p_invite_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_actor_role text;
  v_email text;
  v_display_name text;
  v_existing_user_id uuid;
  v_existing_is_anonymous boolean;
  v_existing_role text;
  v_existing_active boolean;
  v_invite public.merchant_team_invites%rowtype;
  v_target_role text;
  v_result jsonb;
  v_cleared integer:=0;
begin
  if p_actor_user_id is null or p_merchant_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_action not in ('invite','revoke-member','revoke-invite') then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,'merchant-team:'||p_action,p_request_hash
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
     or v_action.action_name<>'merchant-team:'||p_action
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select mm.member_role
  into v_actor_role
  from public.merchant_members mm
  where mm.merchant_id=p_merchant_id
    and mm.user_id=p_actor_user_id
    and mm.active
  limit 1;

  if not found or v_actor_role not in ('owner','manager') then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  if p_action='invite' then
    v_email:=lower(trim(coalesce(p_email,'')));
    v_display_name:=nullif(trim(coalesce(p_display_name,'')),'');
    if char_length(v_email)<3
       or char_length(v_email)>160
       or v_email!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'INVALID_EMAIL' using errcode='22023';
    end if;
    if p_member_role not in ('manager','operator','driver') then
      raise exception 'INVALID_MEMBER_ROLE' using errcode='22023';
    end if;
    if p_member_role='manager' and v_actor_role<>'owner' then
      raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
    end if;
    if v_display_name is not null
       and (char_length(v_display_name)<2 or char_length(v_display_name)>60) then
      raise exception 'INVALID_DISPLAY_NAME' using errcode='22023';
    end if;

    select u.id,coalesce(u.is_anonymous,false)
    into v_existing_user_id,v_existing_is_anonymous
    from auth.users u
    where lower(trim(u.email))=v_email
    order by u.created_at
    limit 1;

    if found and not v_existing_is_anonymous then
      if v_existing_user_id=p_actor_user_id then
        raise exception 'SELF_TEAM_INVITE' using errcode='22023';
      end if;

      v_existing_role:=null;
      v_existing_active:=null;
      select mm.member_role,mm.active
      into v_existing_role,v_existing_active
      from public.merchant_members mm
      where mm.merchant_id=p_merchant_id
        and mm.user_id=v_existing_user_id;

      if found and coalesce(v_existing_active,false) then
        if v_existing_role<>p_member_role then
          raise exception 'MEMBER_ALREADY_ACTIVE' using errcode='23505';
        end if;
        if v_display_name is not null then
          update public.merchant_members
          set display_name=v_display_name
          where merchant_id=p_merchant_id
            and user_id=v_existing_user_id;
        end if;
      elsif found then
        if v_existing_role='owner'
           or (v_existing_role='manager' and v_actor_role<>'owner') then
          raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
        end if;
        update public.merchant_members
        set member_role=p_member_role,
            active=true,
            display_name=coalesce(v_display_name,display_name)
        where merchant_id=p_merchant_id
          and user_id=v_existing_user_id;
      else
        insert into public.merchant_members(
          merchant_id,user_id,member_role,active,display_name
        )
        values(
          p_merchant_id,v_existing_user_id,p_member_role,true,v_display_name
        );
      end if;
    else
      v_existing_user_id:=null;
    end if;

    insert into public.merchant_team_invites(
      merchant_id,email_normalized,member_role,display_name,invited_by,
      accepted_user_id,accepted_at,revoked_at,expires_at,updated_at
    )
    values(
      p_merchant_id,v_email,p_member_role,v_display_name,p_actor_user_id,
      v_existing_user_id,
      case when v_existing_user_id is not null then clock_timestamp() else null end,
      null,
      clock_timestamp()+interval '7 days',
      clock_timestamp()
    )
    on conflict(merchant_id,email_normalized) do update
    set member_role=excluded.member_role,
        display_name=excluded.display_name,
        invited_by=excluded.invited_by,
        accepted_user_id=excluded.accepted_user_id,
        accepted_at=excluded.accepted_at,
        revoked_at=null,
        expires_at=excluded.expires_at,
        updated_at=clock_timestamp()
    returning * into v_invite;

    insert into public.merchant_team_events(
      merchant_id,actor_user_id,target_user_id,invite_id,event_type,detail,metadata
    )
    values(
      p_merchant_id,p_actor_user_id,v_existing_user_id,v_invite.id,
      case when v_existing_user_id is null then 'TEAM_INVITED' else 'TEAM_MEMBER_LINKED' end,
      case when v_existing_user_id is null
        then 'Convite de equipe criado para vínculo no primeiro login.'
        else 'Conta existente vinculada à equipe.'
      end,
      jsonb_build_object(
        'email',v_email,
        'memberRole',p_member_role
      )
    );

    v_result:=jsonb_build_object(
      'ok',true,
      'status',case when v_existing_user_id is null then 'pending' else 'linked' end,
      'inviteId',v_invite.id,
      'email',v_email,
      'memberRole',p_member_role,
      'displayName',v_display_name,
      'expiresAt',v_invite.expires_at
    );

  elsif p_action='revoke-member' then
    if p_target_user_id is null then
      raise exception 'INVALID_MEMBER' using errcode='22023';
    end if;
    if p_target_user_id=p_actor_user_id then
      raise exception 'SELF_ACCESS_CHANGE' using errcode='22023';
    end if;

    select mm.member_role,mm.active
    into v_target_role,v_existing_active
    from public.merchant_members mm
    where mm.merchant_id=p_merchant_id
      and mm.user_id=p_target_user_id
    for update;

    if not found or not coalesce(v_existing_active,false) then
      v_result:=jsonb_build_object(
        'ok',true,
        'alreadyInactive',true,
        'targetUserId',p_target_user_id
      );
    else
      if v_target_role='owner'
         or (v_target_role='manager' and v_actor_role<>'owner') then
        raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
      end if;

      if exists(
        select 1
        from public.orders o
        where o.merchant_id=p_merchant_id
          and o.assigned_delivery_user_id=p_target_user_id
          and o.status in ('OUT_FOR_DELIVERY','ARRIVING')
      ) then
        raise exception 'MEMBER_HAS_ACTIVE_DELIVERY' using errcode='40001';
      end if;

      with cleared as (
        update public.orders
        set assigned_delivery_user_id=null,
            delivery_assigned_at=null,
            delivery_assigned_by=null,
            version=version+1,
            updated_at=clock_timestamp()
        where merchant_id=p_merchant_id
          and assigned_delivery_user_id=p_target_user_id
          and dispatched_at is null
          and status in ('PREPARING','AT_RISK')
        returning id
      ),
      logged as (
        insert into public.order_events(
          order_id,actor_user_id,actor_type,event_type,title,detail
        )
        select
          id,p_actor_user_id,'merchant','DELIVERY_UNASSIGNED',
          'Responsável pela entrega removido',
          'O membro perdeu acesso antes da saída e a entrega voltou para a fila de atribuição.'
        from cleared
        returning 1
      )
      select count(*) into v_cleared from logged;

      update public.merchant_members
      set active=false
      where merchant_id=p_merchant_id
        and user_id=p_target_user_id;

      insert into public.merchant_team_events(
        merchant_id,actor_user_id,target_user_id,event_type,detail,metadata
      )
      values(
        p_merchant_id,p_actor_user_id,p_target_user_id,
        'TEAM_MEMBER_REVOKED',
        'Acesso de membro da equipe revogado.',
        jsonb_build_object(
          'memberRole',v_target_role,
          'clearedPredispatchAssignments',v_cleared
        )
      );

      v_result:=jsonb_build_object(
        'ok',true,
        'targetUserId',p_target_user_id,
        'memberRole',v_target_role,
        'clearedPredispatchAssignments',v_cleared
      );
    end if;

  else
    if p_invite_id is null then
      raise exception 'INVALID_INVITE' using errcode='22023';
    end if;

    select *
    into v_invite
    from public.merchant_team_invites
    where id=p_invite_id
      and merchant_id=p_merchant_id
    for update;

    if not found then
      raise exception 'INVITE_NOT_FOUND' using errcode='P0002';
    end if;

    if v_invite.member_role='manager' and v_actor_role<>'owner' then
      raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
    end if;

    if v_invite.accepted_at is not null then
      raise exception 'INVITE_ALREADY_ACCEPTED' using errcode='40001';
    end if;

    update public.merchant_team_invites
    set revoked_at=coalesce(revoked_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where id=v_invite.id
    returning * into v_invite;

    insert into public.merchant_team_events(
      merchant_id,actor_user_id,invite_id,event_type,detail,metadata
    )
    values(
      p_merchant_id,p_actor_user_id,v_invite.id,
      'TEAM_INVITE_REVOKED',
      'Convite pendente de equipe revogado.',
      jsonb_build_object(
        'email',v_invite.email_normalized,
        'memberRole',v_invite.member_role
      )
    );

    v_result:=jsonb_build_object(
      'ok',true,
      'inviteId',v_invite.id,
      'revokedAt',v_invite.revoked_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.merchant_team_mutate(
  uuid,uuid,text,text,text,text,uuid,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.merchant_team_mutate(
  uuid,uuid,text,text,text,text,uuid,uuid,text,text
) to service_role;
