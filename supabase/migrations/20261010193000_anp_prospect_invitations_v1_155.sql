-- V1.155: invite an ANP prospect through the existing merchant self-signup.
-- Invitation is NOT compliance, partner approval, merchant activation, or proof of contact.
create table if not exists public.anp_prospect_invites (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null references public.anp_glp_prospects(cnpj) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  revoked_at timestamptz,
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id),
  application_id uuid references public.merchant_applications(id),
  constraint anp_prospect_invite_claim_consistent
    check((claimed_at is null and claimed_by is null and application_id is null)
       or (claimed_at is not null and claimed_by is not null and application_id is not null))
);
create unique index if not exists anp_prospect_invites_one_unclaimed_idx
  on public.anp_prospect_invites(cnpj)
  where revoked_at is null and claimed_at is null;
create index if not exists anp_prospect_invites_recent_idx
  on public.anp_prospect_invites(cnpj,created_at desc);
alter table public.anp_prospect_invites enable row level security;
revoke all on public.anp_prospect_invites from public,anon,authenticated;
grant all on public.anp_prospect_invites to service_role;

create or replace function public.admin_anp_prospect_invite_action(
 p_actor_user_id uuid,p_cnpj text,p_action text,
 p_token_hash text default null,p_expires_at timestamptz default null,
 p_rotate boolean default false
)
returns jsonb
language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
 v_invite public.anp_prospect_invites%rowtype;
 v_status text;
 v_count integer;
begin
 if not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor_user_id and a.active
   and a.admin_role in ('superadmin','operations','compliance')) then
   raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_cnpj !~ '^[0-9]{14}$' or p_action not in ('issue','revoke') then
   raise exception 'INVALID_PROSPECT_INVITE_ACTION' using errcode='22023';
 end if;
 select prospect_status into v_status from public.anp_glp_prospects
   where cnpj=p_cnpj for update;
 if not found then raise exception 'PROSPECT_NOT_FOUND' using errcode='P0002'; end if;
 if v_status in ('dismissed','partner') then
   raise exception 'PROSPECT_NOT_INVITABLE' using errcode='42501';
 end if;
 if p_action='issue' then
   if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
      or p_expires_at is null
      or p_expires_at<=statement_timestamp()+interval '5 minutes'
      or p_expires_at>statement_timestamp()+interval '30 days' then
      raise exception 'INVALID_PROSPECT_INVITE' using errcode='22023';
   end if;
   select count(*) into v_count from public.anp_prospect_invites
     where cnpj=p_cnpj and created_at>=statement_timestamp()-interval '1 day';
   if v_count>=8 then raise exception 'INVITE_RATE_LIMIT' using errcode='42901'; end if;

   select * into v_invite from public.anp_prospect_invites
    where cnpj=p_cnpj and revoked_at is null and claimed_at is null for update;
   if found and v_invite.expires_at>statement_timestamp() and not p_rotate then
     raise exception 'PROSPECT_INVITE_ACTIVE' using errcode='40001';
   end if;
   update public.anp_prospect_invites set revoked_at=clock_timestamp()
     where cnpj=p_cnpj and revoked_at is null and claimed_at is null;

   insert into public.anp_prospect_invites(cnpj,token_hash,expires_at,created_by)
     values(p_cnpj,p_token_hash,p_expires_at,p_actor_user_id)
     returning * into v_invite;
   insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
     values(p_actor_user_id,'anp-prospect-invite','anp_glp_prospect',p_cnpj,
       jsonb_build_object('invite_action','issue','invite_id',v_invite.id,
         'expires_at',v_invite.expires_at));
   return jsonb_build_object('inviteId',v_invite.id,'status','active',
      'expiresAt',v_invite.expires_at);
 end if;

 update public.anp_prospect_invites
   set revoked_at=clock_timestamp()
   where cnpj=p_cnpj and claimed_at is null and revoked_at is null
   returning * into v_invite;
 if not found then raise exception 'PROSPECT_INVITE_NOT_ACTIVE' using errcode='P0002'; end if;
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
   values(p_actor_user_id,'anp-prospect-invite','anp_glp_prospect',p_cnpj,
     jsonb_build_object('invite_action','revoke','invite_id',v_invite.id));
 return jsonb_build_object('inviteId',v_invite.id,'status','revoked');
end;
$func$;
revoke all on function public.admin_anp_prospect_invite_action(uuid,text,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.admin_anp_prospect_invite_action(uuid,text,text,text,timestamptz,boolean) to service_role;

-- Validate token and CNPJ *before* the application is modified.
create or replace function public.validate_anp_prospect_invite(
  p_token text,p_cnpj text,p_user_id uuid default null
)
returns jsonb
language plpgsql stable security definer
set search_path to pg_catalog
as $func$
declare
  v_invite public.anp_prospect_invites%rowtype;
begin
 if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,240}$'
    or p_cnpj !~ '^[0-9]{14}$' then
    raise exception 'INVALID_PROSPECT_INVITE' using errcode='22023';
 end if;
 select * into v_invite from public.anp_prospect_invites
  where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
   and cnpj=p_cnpj;
 if not found then raise exception 'PROSPECT_INVITE_CNPJ_MISMATCH' using errcode='42501'; end if;
 if v_invite.revoked_at is not null then raise exception 'PROSPECT_INVITE_REVOKED' using errcode='42501'; end if;
 if v_invite.expires_at<=statement_timestamp() then raise exception 'PROSPECT_INVITE_EXPIRED' using errcode='42501'; end if;
 if v_invite.claimed_at is not null and v_invite.claimed_by is distinct from p_user_id then
   raise exception 'PROSPECT_INVITE_ALREADY_CLAIMED' using errcode='42501';
 end if;
 return jsonb_build_object('cnpj',v_invite.cnpj,'inviteId',v_invite.id);
end;
$func$;
revoke all on function public.validate_anp_prospect_invite(text,text,uuid) from public,anon,authenticated;
grant execute on function public.validate_anp_prospect_invite(text,text,uuid) to service_role;

-- Claim is strictly bound to the authenticated permanent user and their own application.
create or replace function public.claim_anp_prospect_invite(
  p_user_id uuid,p_application_id uuid,p_token text
)
returns jsonb
language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
  v_app public.merchant_applications%rowtype;
  v_invite public.anp_prospect_invites%rowtype;
begin
 if p_user_id is null or p_application_id is null then
   raise exception 'INVALID_PROSPECT_INVITE' using errcode='22023';
 end if;
 if not exists(select 1 from auth.users u
    where u.id=p_user_id and u.is_anonymous is false
      and u.email_confirmed_at is not null) then
   raise exception 'PERMANENT_IDENTITY_REQUIRED' using errcode='42501';
 end if;
 select * into v_app from public.merchant_applications
  where id=p_application_id and applicant_user_id=p_user_id for update;
 if not found or v_app.status not in ('pending','rejected') then
    raise exception 'PROSPECT_APPLICATION_NOT_ELIGIBLE' using errcode='42501';
 end if;
 perform public.validate_anp_prospect_invite(p_token,regexp_replace(v_app.cnpj,'[^0-9]','','g'),p_user_id);
 select * into v_invite from public.anp_prospect_invites
  where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and cnpj=regexp_replace(v_app.cnpj,'[^0-9]','','g')
    and claimed_by=p_user_id and application_id=v_app.id
    and claimed_at is not null;
 if found then
   return jsonb_build_object('inviteId',v_invite.id,'cnpj',v_invite.cnpj,
     'applicationId',v_app.id,'applicationStatus',v_app.status,'linked',true,'reused',true);
 end if;
 select * into v_invite from public.anp_prospect_invites
  where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and cnpj=regexp_replace(v_app.cnpj,'[^0-9]','','g')
    and revoked_at is null and claimed_at is null
    and expires_at>statement_timestamp() for update;
 if not found then raise exception 'PROSPECT_INVITE_NOT_AVAILABLE' using errcode='40001'; end if;
 update public.anp_prospect_invites
  set claimed_at=clock_timestamp(),claimed_by=p_user_id,application_id=v_app.id
  where id=v_invite.id;
 -- CRM is only a status for completed signup, never merchant activation.
 update public.anp_glp_prospects
 set prospect_status='onboarding',crm_version=crm_version+1,
     updated_at=clock_timestamp()
 where cnpj=v_invite.cnpj and prospect_status in ('uncontacted','contacted','interested');
 return jsonb_build_object('inviteId',v_invite.id,'cnpj',v_invite.cnpj,
   'applicationId',v_app.id,'applicationStatus',v_app.status,'linked',true);
end;
$func$;
revoke all on function public.claim_anp_prospect_invite(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_anp_prospect_invite(uuid,uuid,text) to service_role;
