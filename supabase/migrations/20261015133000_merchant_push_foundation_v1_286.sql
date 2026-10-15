-- TAMÃO V1.286 — secured subscriptions and deduplicated event intents.
-- This migration DOES NOT send push or imply provider/device delivery.
create table if not exists public.merchant_push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint_hash text not null unique check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  endpoint_url text not null check (char_length(endpoint_url) between 40 and 2048),
  p256dh text not null check (char_length(p256dh) between 40 and 200),
  auth_secret text not null check (char_length(auth_secret) between 12 and 120),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  registered_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  last_provider_accepted_at timestamptz,
  last_failure_at timestamptz,
  failure_reason_code text
);
create index if not exists merchant_push_subscriptions_member_idx
  on public.merchant_push_subscriptions(merchant_id,user_id)
  where active;
alter table public.merchant_push_subscriptions enable row level security;
revoke all on public.merchant_push_subscriptions from public,anon,authenticated;
revoke all on sequence public.merchant_push_subscriptions_id_seq from public,anon,authenticated;
grant select,insert,update on public.merchant_push_subscriptions to service_role;
grant usage,select on sequence public.merchant_push_subscriptions_id_seq to service_role;

create table if not exists public.merchant_push_outbox (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  order_id uuid not null references public.orders(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_kind text not null check (event_kind in ('new_offer','assigned_delivery')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  provider_status text not null default 'pending'
    check (provider_status in ('pending','provider_accepted','retry','expired','permanent_failure')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_attempt_at timestamptz,
  last_provider_response_code integer
);
create index if not exists merchant_push_outbox_pending_idx
  on public.merchant_push_outbox(next_attempt_at,id)
  where provider_status in ('pending','retry');
create index if not exists merchant_push_outbox_member_idx
  on public.merchant_push_outbox(merchant_id,user_id,created_at desc);
alter table public.merchant_push_outbox enable row level security;
revoke all on public.merchant_push_outbox from public,anon,authenticated;
revoke all on sequence public.merchant_push_outbox_id_seq from public,anon,authenticated;
grant select,insert,update on public.merchant_push_outbox to service_role;
grant usage,select on sequence public.merchant_push_outbox_id_seq to service_role;

-- Transactional intent only; a later sender must verify current membership and
-- subscription consent, check order status and expiry, and revalidate on delivery.
create or replace function public.merchant_push_queue_order_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog
as $body$
declare
  v_now timestamptz := clock_timestamp();
begin
  if new.status = 'OFFERED_TO_MERCHANT'
     and new.proposed_merchant_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from new.status
       or old.proposed_merchant_id is distinct from new.proposed_merchant_id)
     and (new.offer_expires_at is null or new.offer_expires_at > v_now) then
    insert into public.merchant_push_outbox(
      event_key,order_id,merchant_id,user_id,event_kind,expires_at)
    select new.id::text||':offer:'||new.version::text||':'||mm.user_id::text,
      new.id, new.proposed_merchant_id, mm.user_id,'new_offer',
      least(coalesce(new.offer_expires_at,v_now+interval '5 minutes'),v_now+interval '5 minutes')
    from public.merchant_members mm
    where mm.merchant_id=new.proposed_merchant_id and mm.active
      and mm.member_role in ('owner','manager','operator')
    on conflict (event_key) do nothing;
  end if;
  if new.assigned_delivery_user_id is not null
     and new.merchant_id is not null
     and new.status in ('PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING')
     and (tg_op = 'INSERT' or old.assigned_delivery_user_id is distinct from new.assigned_delivery_user_id) then
    insert into public.merchant_push_outbox(
      event_key,order_id,merchant_id,user_id,event_kind,expires_at)
    select new.id::text||':delivery:'||new.version::text||':'||mm.user_id::text,
      new.id,new.merchant_id,mm.user_id,'assigned_delivery',v_now+interval '30 minutes'
    from public.merchant_members mm
    where mm.merchant_id=new.merchant_id and mm.user_id=new.assigned_delivery_user_id
      and mm.active and mm.member_role='driver'
    on conflict (event_key) do nothing;
  end if;
  return new;
end
$body$;
revoke all on function public.merchant_push_queue_order_change() from public,anon,authenticated;
drop trigger if exists merchant_push_order_change_v1_286 on public.orders;
create trigger merchant_push_order_change_v1_286
  after insert or update of status, proposed_merchant_id, assigned_delivery_user_id
  on public.orders for each row
  execute function public.merchant_push_queue_order_change();
