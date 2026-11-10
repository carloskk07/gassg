-- TAMÃO V1.931 — background net-proceeds verification: no new charge, refund, payout or sales activation.
-- Installed disabled. Enable only after Edge deployed + validated and authenticated MP reports confirmed.
create extension if not exists pg_net with schema extensions;

create table if not exists public.clube_coupon_net_auto_config_v1_931 (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 token_sha256 text not null check(token_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 activated_at timestamptz,
 last_enqueued_at timestamptz,
 last_request_id bigint
);
alter table public.clube_coupon_net_auto_config_v1_931 enable row level security;
revoke all on public.clube_coupon_net_auto_config_v1_931 from public,anon,authenticated;
grant select on public.clube_coupon_net_auto_config_v1_931 to service_role;

create table if not exists public.clube_coupon_net_auto_observations_v1_931 (
 invoice_id uuid primary key references public.clube_coupon_paid_invoices(id),
 status text not null check(status in (
  'awaiting_report','coverage_incomplete','provider_unavailable',
  'requires_review','net_verified')),
 reason text not null check(length(reason) between 2 and 120),
 last_checked_at timestamptz not null default clock_timestamp()
);
alter table public.clube_coupon_net_auto_observations_v1_931 enable row level security;
revoke all on public.clube_coupon_net_auto_observations_v1_931 from public,anon,authenticated;
grant select,insert,update on public.clube_coupon_net_auto_observations_v1_931 to service_role;

-- Automated actions get a distinct immutable machine audit, never falsely attributed to a human admin.
create table if not exists public.clube_coupon_net_auto_audit_v1_931 (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null unique references public.clube_coupon_paid_invoices(id),
 provider_order_id text not null,
 net_cents integer not null check(net_cents > 0),
 evidence_reference text not null check(length(evidence_reference) between 8 and 240),
 event text not null default 'auto_net_verified' check(event='auto_net_verified'),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table public.clube_coupon_net_auto_audit_v1_931 enable row level security;
revoke all on public.clube_coupon_net_auto_audit_v1_931 from public,anon,authenticated;
grant select on public.clube_coupon_net_auto_audit_v1_931 to service_role;

do $setup$
declare v_token text;
begin
 if not exists (select 1 from public.clube_coupon_net_auto_config_v1_931 where id) then
   if exists(select 1 from vault.secrets where name='tamao_coupon_net_auto_cron_token_v1_931') then
     raise exception 'COUPON_AUTO_VAULT_CONFIG_MISMATCH';
   end if;
   v_token:=encode(extensions.gen_random_bytes(32),'hex');
   perform vault.create_secret(v_token,'tamao_coupon_net_auto_cron_token_v1_931',
     'TAMÃO automatic read of MP release reports and guarded net evidence, no sale activation');
   insert into public.clube_coupon_net_auto_config_v1_931(id,enabled,token_sha256)
     values(true,false,encode(extensions.digest(v_token,'sha256'),'hex'));
   v_token:=null;
 end if;
end $setup$;

create or replace function public.clube_coupon_net_auto_authorize_v1_931(p_token_sha text)
returns boolean language sql stable security definer set search_path=pg_catalog
as $fn$
 select exists(select 1 from public.clube_coupon_net_auto_config_v1_931 c
  where c.id=true and c.enabled and p_token_sha ~ '^[0-9a-f]{64}$'
    and c.token_sha256=p_token_sha)
$fn$;
revoke all on function public.clube_coupon_net_auto_authorize_v1_931(text) from public,anon,authenticated;
grant execute on function public.clube_coupon_net_auto_authorize_v1_931(text) to service_role;

create or replace function public.clube_coupon_net_auto_pending_v1_931(p_limit integer default 2)
returns table (
 id uuid,status text,paid_at timestamptz,provider_order_id text,
 provider_payment_id text,sale_price_cents integer,coupon_face_cents integer,
 coupons_per_pack integer,sponsor_covered_cents integer
) language sql stable security invoker set search_path=pg_catalog
as $fn$
 select i.id,i.status,i.paid_at,i.provider_order_id,i.provider_payment_id,
        i.sale_price_cents,i.coupon_face_cents,i.coupons_per_pack,i.sponsor_covered_cents
 from public.clube_coupon_paid_invoices i
 left join public.clube_coupon_net_auto_observations_v1_931 o on o.invoice_id=i.id
 where i.status='paid' and i.paid_at is not null and i.provider_order_id is not null
   and i.provider_payment_id is not null and i.net_proceeds_verified_at is null
   and (o.last_checked_at is null or o.last_checked_at<clock_timestamp()-interval '30 minutes')
 order by coalesce(o.last_checked_at,'epoch'::timestamptz),i.paid_at
 limit least(greatest(coalesce(p_limit,2),1),2)
$fn$;
revoke all on function public.clube_coupon_net_auto_pending_v1_931(integer) from public,anon,authenticated;
grant execute on function public.clube_coupon_net_auto_pending_v1_931(integer) to service_role;

create or replace function public.clube_coupon_net_auto_register_v1_931(
 p_invoice_id uuid,p_provider_order_id text,p_net_cents integer,p_reference text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $fn$
declare v_result jsonb; v_audit_id uuid;
begin
 if not exists(select 1 from public.clube_coupon_net_auto_config_v1_931 where id=true and enabled) then
   raise exception 'COUPON_NET_AUTO_DISABLED' using errcode='42501';
 end if;
 if p_reference is null or p_reference not like 'mp-release:%'
   or length(p_reference) not between 20 and 240 then
   raise exception 'COUPON_NET_AUTO_REFERENCE_INVALID' using errcode='42501';
 end if;
 -- The legacy row-locking RPC is the sole engine for funding invariants.
 v_result:=public.clube_coupon_paid_net_proceeds_verify(
   p_invoice_id,p_provider_order_id,p_net_cents,p_reference
 );
 if v_result->>'ok' is distinct from 'true'
   or v_result->>'invoiceId' is distinct from p_invoice_id::text then
   raise exception 'COUPON_NET_AUTO_UNCONFIRMED' using errcode='P0001';
 end if;
 insert into public.clube_coupon_net_auto_audit_v1_931(
   invoice_id,provider_order_id,net_cents,evidence_reference)
 values(p_invoice_id,p_provider_order_id,p_net_cents,pg_catalog.btrim(p_reference))
 on conflict (invoice_id) do nothing;
 select id into v_audit_id from public.clube_coupon_net_auto_audit_v1_931
   where invoice_id=p_invoice_id and provider_order_id=p_provider_order_id
     and net_cents=p_net_cents and evidence_reference=pg_catalog.btrim(p_reference);
 if v_audit_id is null then
   raise exception 'COUPON_NET_AUTO_AUDIT_CONFLICT' using errcode='23505';
 end if;
 return v_result||pg_catalog.jsonb_build_object('auditId',v_audit_id,'auditRecorded',true,
   'source','coupon_mp_net_auto_v1_931','moneyMoved',false,'couponsActivated',false);
end $fn$;
revoke all on function public.clube_coupon_net_auto_register_v1_931(uuid,text,integer,text)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_net_auto_register_v1_931(uuid,text,integer,text)
 to service_role;

create or replace function public.clube_coupon_net_auto_cron_tick_v1_931()
returns boolean language plpgsql security definer set search_path=pg_catalog
as $fn$
declare v_token text; v_request_id bigint;
begin
 if not exists(select 1 from public.clube_coupon_net_auto_config_v1_931 where id=true and enabled) then
  return false;
 end if;
 select decrypted_secret into v_token from vault.decrypted_secrets
   where name='tamao_coupon_net_auto_cron_token_v1_931';
 if v_token !~ '^[0-9a-f]{64}$' or v_token is null then
  raise exception 'COUPON_AUTO_SECRET_UNAVAILABLE';
 end if;
 v_request_id:=net.http_post(
   url:='https://lgugwujpunhslavewffd.supabase.co/functions/v1/coupon-net-auto',
   headers:=pg_catalog.jsonb_build_object('Content-Type','application/json',
     'X-Tamao-Coupon-Cron-Token',v_token),
   body:='{"source":"supabase_cron_v1_931"}'::jsonb,
   timeout_milliseconds:=45000
 );
 update public.clube_coupon_net_auto_config_v1_931
   set last_enqueued_at=clock_timestamp(),last_request_id=v_request_id where id=true;
 v_token:=null;
 return true;
end $fn$;
revoke all on function public.clube_coupon_net_auto_cron_tick_v1_931()
 from public,anon,authenticated,service_role;

select cron.schedule('tamao-coupon-net-auto-v1-931','*/15 * * * *',
 'select public.clube_coupon_net_auto_cron_tick_v1_931()');
