-- TAMÃO V1.291 — one-off Web Push device test; no order or cron changes.
-- All sensitive records and RPCs are service_role only.
create table if not exists public.merchant_push_test_runs(
 id uuid primary key default gen_random_uuid(),
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 subscription_id bigint not null references public.merchant_push_subscriptions(id) on delete cascade,
 state text not null default 'reserved'
   check(state in ('reserved','provider_accepted','gateway_rejected','expired','failed')),
 provider_http_status integer,
 failure_code text,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz
);
create index if not exists merchant_push_test_runs_throttle_idx
 on public.merchant_push_test_runs(user_id,created_at desc);
alter table public.merchant_push_test_runs enable row level security;
revoke all on public.merchant_push_test_runs from public,anon,authenticated;
grant select,insert,update on public.merchant_push_test_runs to service_role;

create or replace function public.merchant_push_test_credentials()
returns jsonb language sql stable security definer set search_path=pg_catalog as $fn$
 select coalesce((
  select pg_catalog.jsonb_build_object('publicKey',k.public_key,
   'privateKey',v.decrypted_secret,'subject',k.subject)
  from public.merchant_push_keyring k
  join vault.decrypted_secrets v on v.name='tamao_merchant_vapid_private_v1_289'
  where k.id and k.enrollment_enabled and k.subject='https://tamao.com.br'
    and k.public_key ~ '^[A-Za-z0-9_-]{87}$'
    and v.decrypted_secret ~ '^[A-Za-z0-9_-]{43}$'
 ),'{}'::jsonb)
$fn$;
revoke all on function public.merchant_push_test_credentials() from public,anon,authenticated;
grant execute on function public.merchant_push_test_credentials() to service_role;

-- Atomic throttle also rechecks membership, endpoint ownership, active opt-in.
-- Return the encryption keys ONLY to the protected test Edge function.
create or replace function public.merchant_push_test_reserve(
 p_merchant_id uuid,p_user_id uuid,p_endpoint_hash text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare
 v_sub public.merchant_push_subscriptions%rowtype;
 v_role text;
 v_run uuid;
begin
 if p_endpoint_hash !~ '^[0-9a-f]{64}$' then return '{}'::jsonb; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user_id::text),291);
 select mm.member_role into v_role from public.merchant_members mm
 where mm.user_id=p_user_id and mm.merchant_id=p_merchant_id and mm.active
   and mm.member_role in ('owner','manager','operator','driver');
 if not found then return '{}'::jsonb; end if;
 select * into v_sub from public.merchant_push_subscriptions s
 where s.user_id=p_user_id and s.merchant_id=p_merchant_id
  and s.endpoint_hash=p_endpoint_hash and s.active and s.revoked_at is null
 for update;
 if not found then return '{}'::jsonb; end if;
 if exists(select 1 from public.merchant_push_test_runs t
    where t.user_id=p_user_id
      and t.created_at>clock_timestamp()-interval '3 minutes') then
   return pg_catalog.jsonb_build_object('rateLimited',true);
 end if;
 insert into public.merchant_push_test_runs(merchant_id,user_id,subscription_id)
 values(p_merchant_id,p_user_id,v_sub.id) returning id into v_run;
 return pg_catalog.jsonb_build_object(
   'runId',v_run,
   'endpoint',v_sub.endpoint_url,
   'p256dh',v_sub.p256dh,
   'auth',v_sub.auth_secret
 );
end $fn$;
revoke all on function public.merchant_push_test_reserve(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.merchant_push_test_reserve(uuid,uuid,text) to service_role;

create or replace function public.merchant_push_test_finish(
 p_run_id uuid,p_user_id uuid,p_state text,p_status integer default null,
 p_failure_code text default null
) returns boolean language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if p_state not in ('provider_accepted','gateway_rejected','expired','failed')
    or p_status is not null and (p_status<100 or p_status>599)
    or p_failure_code is not null and
       (length(p_failure_code)>40 or p_failure_code !~ '^[A-Z0-9_]+$')
 then raise exception 'INVALID_TEST_RESULT' using errcode='22023'; end if;
 update public.merchant_push_test_runs
 set state=p_state,provider_http_status=p_status,
     failure_code=p_failure_code,completed_at=clock_timestamp()
 where id=p_run_id and user_id=p_user_id and state='reserved';
 return found;
end $fn$;
revoke all on function public.merchant_push_test_finish(uuid,uuid,text,integer,text)
 from public,anon,authenticated;
grant execute on function public.merchant_push_test_finish(uuid,uuid,text,integer,text)
 to service_role;
