-- TAMÃO V1.288 — secure, sub-minute Supabase Cron dispatcher.
-- CRITICAL: the scheduler is installed but initially DISABLED.
-- No token/private VAPID key is stored in GitHub, public views or the cron command.
create extension if not exists pg_net with schema extensions;

create table if not exists public.merchant_push_cron_config (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  token_sha256 text not null check(token_sha256 ~ '^[0-9a-f]{64}$'),
  installed_at timestamptz not null default clock_timestamp(),
  enabled_at timestamptz,
  last_enqueued_at timestamptz,
  last_net_request_id bigint
);
alter table public.merchant_push_cron_config enable row level security;
revoke all on public.merchant_push_cron_config from public,anon,authenticated;
grant select on public.merchant_push_cron_config to service_role;

-- Generate a high-entropy token entirely inside Postgres; keep the raw value
-- encrypted by Vault. Only its SHA-256 digest goes into the private config row.
do $setup$
declare
  v_token text;
  v_secrets integer;
  v_existing boolean;
begin
  select exists(select 1 from public.merchant_push_cron_config where id)
    into v_existing;
  select count(*) into v_secrets from vault.secrets
    where name='tamao_merchant_push_cron_token_v1_288';
  if not v_existing then
    if v_secrets<>0 then
      raise exception 'PUSH_CRON_VAULT_STATE_MISMATCH';
    end if;
    v_token:=encode(extensions.gen_random_bytes(32),'hex');
    perform vault.create_secret(
      v_token, 'tamao_merchant_push_cron_token_v1_288',
      'TAMÃO merchant Web Push internal 15-second cron bearer v1'
    );
    insert into public.merchant_push_cron_config(id,enabled,token_sha256)
    values(true,false,encode(extensions.digest(v_token,'sha256'),'hex'));
    v_token:=null;
  elsif v_secrets<>1 then
    raise exception 'PUSH_CRON_VAULT_STATE_MISMATCH';
  end if;
end
$setup$;

-- Invoked exclusively by the service-role Edge client after validating
-- the supplied raw bearer has exactly 64 lower-case hex characters.
create or replace function public.merchant_push_cron_authorize(p_token_sha text)
returns boolean language sql stable security definer
set search_path = pg_catalog
as $fn$
  select exists(
    select 1 from public.merchant_push_cron_config c
    where c.id=true and c.enabled
      and p_token_sha ~ '^[0-9a-f]{64}$'
      and c.token_sha256=p_token_sha
  )
$fn$;
revoke all on function public.merchant_push_cron_authorize(text)
  from public,anon,authenticated;
grant execute on function public.merchant_push_cron_authorize(text) to service_role;

-- Postgres owns this scheduler function; clients cannot invoke it.
-- When disabled there are NO outbound network requests, even though cron
-- wakes every 15 seconds. Enabled runs retrieve raw bearer only from Vault.
create or replace function public.merchant_push_cron_tick()
returns boolean language plpgsql security definer
set search_path = pg_catalog
as $fn$
declare
  v_secret text;
  v_id bigint;
begin
  if not exists(select 1 from public.merchant_push_cron_config
                where id=true and enabled) then
    return false;
  end if;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='tamao_merchant_push_cron_token_v1_288';
  if v_secret is null or v_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'PUSH_CRON_SECRET_MISSING';
  end if;
  v_id:=net.http_post(
    url:='https://lgugwujpunhslavewffd.supabase.co/functions/v1/merchant-push-delivery',
    headers:=pg_catalog.jsonb_build_object(
      'Content-Type','application/json',
      'X-Tamao-Cron-Token',v_secret
    ),
    body:='{"source":"supabase_cron_v1_288"}'::jsonb,
    timeout_milliseconds:=42000
  );
  update public.merchant_push_cron_config
    set last_enqueued_at=clock_timestamp(),last_net_request_id=v_id
    where id=true;
  v_secret:=null;
  return true;
end
$fn$;
revoke all on function public.merchant_push_cron_tick()
  from public,anon,authenticated;
-- No service-role grant: cron runs this as a privileged database owner.

select cron.schedule(
  'tamao-merchant-push-v1-288',
  '15 seconds',
  'select public.merchant_push_cron_tick()'
);
