-- Chama São Gabriel — secure first-admin login v1.44
-- Email eligibility is resolved only server-side by SHA-256. No plaintext
-- administrator email is persisted or returned to the browser.

create or replace function public.admin_login_mode(
  p_email_sha256_hex text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_hash text;
  v_active_admins integer:=0;
begin
  v_hash:=lower(trim(coalesce(p_email_sha256_hex,'')));

  if v_hash!~'^[0-9a-f]{64}$' then
    return 'denied';
  end if;

  if exists (
    select 1
    from public.platform_admins a
    join auth.users u on u.id=a.user_id
    where a.active
      and u.is_anonymous is false
      and u.email is not null
      and encode(extensions.digest(lower(btrim(u.email)),'sha256'),'hex')=v_hash
  ) then
    return 'existing_admin';
  end if;

  select count(*)::integer
  into v_active_admins
  from public.platform_admins
  where active;

  if v_active_admins=0
     and exists (
       select 1
       from public.platform_admin_bootstrap_reservations r
       where r.claimed_user_id is null
         and encode(r.email_sha256,'hex')=v_hash
     ) then
    return 'bootstrap_reserved';
  end if;

  return 'denied';
end;
$$;

revoke all on function public.admin_login_mode(text)
from public, anon, authenticated;
grant execute on function public.admin_login_mode(text)
to service_role;

create or replace function public.claim_reserved_platform_admin(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user auth.users%rowtype;
  v_hash bytea;
  v_active_admins integer:=0;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'INVALID_ADMIN_USER' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('platform-admin-email-bootstrap',0)
  );

  select *
  into v_user
  from auth.users
  where id=p_user_id
  for update;

  if not found then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_user.is_anonymous is true
     or v_user.email is null
     or v_user.email_confirmed_at is null then
    raise exception 'PERMANENT_CONFIRMED_IDENTITY_REQUIRED' using errcode='42501';
  end if;

  if exists (
    select 1
    from public.platform_admins a
    where a.user_id=p_user_id
      and a.active
  ) then
    return jsonb_build_object(
      'ok',true,
      'status','existing_admin'
    );
  end if;

  select count(*)::integer
  into v_active_admins
  from public.platform_admins
  where active;

  if v_active_admins>0 then
    return jsonb_build_object(
      'ok',true,
      'status','bootstrap_closed'
    );
  end if;

  v_hash:=extensions.digest(lower(btrim(v_user.email)),'sha256');

  perform 1
  from public.platform_admin_bootstrap_reservations r
  where r.email_sha256=v_hash
    and r.claimed_user_id is null
  for update;

  if not found then
    return jsonb_build_object(
      'ok',true,
      'status','not_reserved'
    );
  end if;

  v_result:=public.bootstrap_first_platform_admin(p_user_id);

  update public.platform_admin_bootstrap_reservations
  set claimed_user_id=p_user_id,
      claimed_at=clock_timestamp()
  where email_sha256=v_hash
    and claimed_user_id is null;

  if not found then
    raise exception 'ADMIN_BOOTSTRAP_RESERVATION_RACE' using errcode='40001';
  end if;

  return v_result||jsonb_build_object(
    'status','claimed'
  );
end;
$$;

revoke all on function public.claim_reserved_platform_admin(uuid)
from public, anon, authenticated;
grant execute on function public.claim_reserved_platform_admin(uuid)
to service_role;
