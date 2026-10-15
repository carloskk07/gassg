-- TAMÃO V1.289 — One-time VAPID key setup, generated and kept inside trusted Supabase services.
-- No private key is stored in migration history, source code, a browser or a job command.
create table if not exists public.merchant_push_keyring (
  id boolean primary key default true check (id),
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{87}$'),
  subject text not null check (subject ~ '^https://tamao[.]com[.]br$'),
  enrolled_at timestamptz not null default clock_timestamp(),
  enrollment_enabled boolean not null default true,
  sender_enabled boolean not null default false,
  sender_enabled_at timestamptz
);
alter table public.merchant_push_keyring enable row level security;
revoke all on public.merchant_push_keyring from public,anon,authenticated;
grant select on public.merchant_push_keyring to service_role;

-- Provision is strictly one-time. Private scalar is passed directly from
-- a short-lived Edge function to Vault, never returned by any API.
create or replace function public.merchant_push_install_vapid(
  p_public_key text,p_private_key text,p_subject text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $fn$
declare
  v_public text;
begin
  if p_public_key !~ '^[A-Za-z0-9_-]{87}$'
     or p_private_key !~ '^[A-Za-z0-9_-]{43}$'
     or p_subject is distinct from 'https://tamao.com.br'
    then raise exception 'INVALID_VAPID_KEY' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(289, 1);
  select public_key into v_public from public.merchant_push_keyring where id=true;
  if found then
    if v_public<>p_public_key then
      raise exception 'VAPID_ALREADY_PROVISIONED' using errcode='23505';
    end if;
    return pg_catalog.jsonb_build_object('installed',true,'publicKey',v_public);
  end if;
  if exists(select 1 from vault.secrets where name='tamao_merchant_vapid_private_v1_289') then
    raise exception 'VAPID_VAULT_ALREADY_PRESENT';
  end if;
  perform vault.create_secret(p_private_key,'tamao_merchant_vapid_private_v1_289',
    'TAMÃO single long-lived P-256 VAPID signing key (do not rotate with active devices)');
  insert into public.merchant_push_keyring(id,public_key,subject,enrollment_enabled,sender_enabled)
  values(true,p_public_key,p_subject,true,false);
  return pg_catalog.jsonb_build_object('installed',true,'publicKey',p_public_key);
end $fn$;
revoke all on function public.merchant_push_install_vapid(text,text,text)
  from public,anon,authenticated;
grant execute on function public.merchant_push_install_vapid(text,text,text) to service_role;

-- The bootstrap bearer is independent of the *disabled* delivery scheduler
-- but protected by the same 256-bit Vault secret.
create or replace function public.merchant_push_bootstrap_authorize(p_token_sha text)
returns boolean language sql stable security definer set search_path=pg_catalog
as $fn$
 select exists(select 1 from public.merchant_push_cron_config c
 where c.id and p_token_sha ~ '^[a-f0-9]{64}$' and c.token_sha256=p_token_sha)
$fn$;
revoke all on function public.merchant_push_bootstrap_authorize(text)
  from public,anon,authenticated;
grant execute on function public.merchant_push_bootstrap_authorize(text) to service_role;

-- Only the public key / flags are returned. No JWT from client roles can invoke it.
create or replace function public.merchant_push_public_config()
returns jsonb language sql stable security definer set search_path=pg_catalog
as $fn$
 select coalesce(
  (select pg_catalog.jsonb_build_object('available',enrollment_enabled,
    'publicKey',case when enrollment_enabled then public_key else null end,
    'testMode',not sender_enabled)
   from public.merchant_push_keyring where id=true),
  '{"available":false,"publicKey":null,"testMode":true}'::jsonb)
$fn$;
revoke all on function public.merchant_push_public_config()
  from public,anon,authenticated;
grant execute on function public.merchant_push_public_config() to service_role;

-- A privileged bootstrap call is launched once through Vault/pg_net.
-- The raw bootstrap credential never appears in SQL source or GitHub.
create or replace function public.merchant_push_bootstrap_once()
returns bigint language plpgsql security definer set search_path=pg_catalog
as $fn$
declare v_token text;v_request_id bigint;
begin
  if exists(select 1 from public.merchant_push_keyring where id=true) then
    return null;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets
    where name='tamao_merchant_push_cron_token_v1_288';
  if v_token is null or v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'PUSH_BOOTSTRAP_SECRET_UNAVAILABLE';
  end if;
  v_request_id:=net.http_post(
    url:='https://lgugwujpunhslavewffd.supabase.co/functions/v1/merchant-push-vapid-setup',
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json',
      'X-Tamao-Cron-Token',v_token),
    body:='{"source":"vapid_setup_v1_289"}'::jsonb,
    timeout_milliseconds:=20000
  );
  v_token:=null;
  return v_request_id;
end $fn$;
revoke all on function public.merchant_push_bootstrap_once()
 from public,anon,authenticated;
-- Intentionally no client or service_role EXECUTE grant: owner only.
