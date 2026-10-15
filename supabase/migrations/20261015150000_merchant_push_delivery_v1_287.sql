-- TAMÃO V1.287 — idempotent per-device push delivery ledger and leased worker claims.
-- A provider HTTP acceptance is NOT device delivery; no browser-visible DB grants.

create table if not exists public.merchant_push_deliveries (
  id bigint generated always as identity primary key,
  outbox_id bigint not null references public.merchant_push_outbox(id) on delete cascade,
  subscription_id bigint not null references public.merchant_push_subscriptions(id) on delete cascade,
  status text not null default 'pending'
    check(status in ('pending','leased','retry','provider_accepted','gone','expired','permanent_failure')),
  attempts smallint not null default 0 check(attempts between 0 and 8),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  leased_until timestamptz,
  last_attempt_at timestamptz,
  provider_status_code integer,
  failure_code text,
  accepted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(outbox_id,subscription_id)
);
create index if not exists merchant_push_deliveries_queue_idx
  on public.merchant_push_deliveries(next_attempt_at,id)
  where status in ('pending','retry','leased');
alter table public.merchant_push_deliveries enable row level security;
revoke all on table public.merchant_push_deliveries from public,anon,authenticated;
revoke all on sequence public.merchant_push_deliveries_id_seq from public,anon,authenticated;
grant select,insert,update on public.merchant_push_deliveries to service_role;
grant usage,select on sequence public.merchant_push_deliveries_id_seq to service_role;

-- Lock-free creation of each subscription delivery (UNIQUE handles concurrent runs).
-- A subscribed device only receives events emitted after it was registered.
create or replace function public.merchant_push_claim_due(p_limit integer default 8)
returns table(
  delivery_id bigint, lease_token uuid, subscription_id bigint,
  event_kind text, endpoint_url text, p256dh text, auth_secret text,
  expires_at timestamptz, order_id uuid
)
language plpgsql security definer set search_path='pg_catalog' as $fn$
declare
  v_now timestamptz:=clock_timestamp();
  v_limit integer:=least(greatest(coalesce(p_limit,8),1),8);
begin
  -- Purely administrative expiry. No user-supplied order mutation.
  update public.merchant_push_outbox ob set provider_status='expired'
  where ob.provider_status in ('pending','retry') and ob.expires_at<=v_now;

  insert into public.merchant_push_deliveries(outbox_id,subscription_id)
  select ob.id,sub.id
  from public.merchant_push_outbox ob
  join public.merchant_push_subscriptions sub
    on sub.merchant_id=ob.merchant_id and sub.user_id=ob.user_id
    and sub.active and sub.revoked_at is null and sub.registered_at<=ob.created_at
  join public.merchant_members mm
    on mm.merchant_id=ob.merchant_id and mm.user_id=ob.user_id and mm.active
  join public.orders o on o.id=ob.order_id
  where ob.provider_status in ('pending','retry') and ob.expires_at>v_now
    and (
      (ob.event_kind='new_offer' and mm.member_role in ('owner','manager','operator')
       and o.status='OFFERED_TO_MERCHANT'
       and o.proposed_merchant_id=ob.merchant_id
       and o.offer_expires_at>v_now)
      or
      (ob.event_kind='assigned_delivery' and mm.member_role='driver'
       and o.merchant_id=ob.merchant_id
       and o.assigned_delivery_user_id=ob.user_id
       and o.status in ('PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'))
    )
  on conflict(outbox_id,subscription_id) do nothing;

  update public.merchant_push_deliveries d set status='expired',
    leased_until=null,lease_token=null
  from public.merchant_push_outbox ob
  where d.outbox_id=ob.id and d.status in ('pending','retry','leased')
    and ob.expires_at<=v_now;

  -- Claim only rows that are still authorized NOW. A revoked subscription,
  -- role change or order transition prevents all subsequent attempts.
  return query
  with due as (
    select d.id
    from public.merchant_push_deliveries d
    join public.merchant_push_outbox ob on ob.id=d.outbox_id
    join public.merchant_push_subscriptions sub on sub.id=d.subscription_id
      and sub.merchant_id=ob.merchant_id and sub.user_id=ob.user_id
      and sub.active and sub.revoked_at is null
    join public.merchant_members mm on mm.merchant_id=ob.merchant_id
      and mm.user_id=ob.user_id and mm.active
    join public.orders o on o.id=ob.order_id
    where ((d.status in ('pending','retry') and d.next_attempt_at<=v_now)
      or(d.status='leased' and d.leased_until<=v_now))
      and d.attempts<8 and ob.expires_at>v_now
      and ob.provider_status in ('pending','retry')
      and (
        (ob.event_kind='new_offer' and mm.member_role in ('owner','manager','operator')
          and o.status='OFFERED_TO_MERCHANT' and o.proposed_merchant_id=ob.merchant_id
          and o.offer_expires_at>v_now)
        or (ob.event_kind='assigned_delivery' and mm.member_role='driver'
          and o.merchant_id=ob.merchant_id and o.assigned_delivery_user_id=ob.user_id
          and o.status in ('PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'))
      )
    order by d.next_attempt_at,d.id
    for update of d skip locked limit v_limit
  ), claimed as (
    update public.merchant_push_deliveries d
    set status='leased',attempts=d.attempts+1,
      last_attempt_at=v_now,
      leased_until=v_now+interval '45 seconds',
      lease_token=gen_random_uuid()
    from due where d.id=due.id
    returning d.id,d.outbox_id,d.subscription_id,d.lease_token
  )
  select c.id,c.lease_token,c.subscription_id,ob.event_kind,
     sub.endpoint_url,sub.p256dh,sub.auth_secret,ob.expires_at,ob.order_id
  from claimed c
  join public.merchant_push_outbox ob on ob.id=c.outbox_id
  join public.merchant_push_subscriptions sub on sub.id=c.subscription_id;
end $fn$;

revoke all on function public.merchant_push_claim_due(integer) from public,anon,authenticated;
grant execute on function public.merchant_push_claim_due(integer) to service_role;

create or replace function public.merchant_push_resolve_delivery(
  p_delivery_id bigint,p_lease_token uuid,p_outcome text,
  p_status integer default null,p_error_code text default null
) returns boolean
language plpgsql security definer set search_path='pg_catalog' as $fn$
declare
  v_row public.merchant_push_deliveries%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_next text;
begin
  if p_outcome not in ('provider_accepted','gone','retry','permanent_failure','expired')
    or p_error_code is not null and (char_length(p_error_code)>50 or p_error_code!~'^[A-Z0-9_]+$')
    or p_status is not null and (p_status<100 or p_status>599)
  then raise exception 'INVALID_PUSH_RESULT' using errcode='22023'; end if;

  select * into v_row from public.merchant_push_deliveries
  where id=p_delivery_id and status='leased' and lease_token=p_lease_token
  for update;
  if not found then return false; end if;
  v_next:=p_outcome;
  if v_row.attempts>=8 or exists(select 1 from public.merchant_push_outbox
    where id=v_row.outbox_id and expires_at<=v_now) then
    if p_outcome='retry' then v_next:='expired'; end if;
  end if;

  update public.merchant_push_deliveries d
  set status=v_next,lease_token=null,leased_until=null,
    provider_status_code=p_status,
    failure_code=case when v_next='provider_accepted' then null else p_error_code end,
    accepted_at=case when v_next='provider_accepted' then v_now else d.accepted_at end,
    next_attempt_at=case when v_next='retry' then
      v_now+make_interval(secs=>least(120,5*power(2,least(v_row.attempts,5)))::integer)
      else d.next_attempt_at end
  where d.id=v_row.id;

  if v_next='gone' then
    update public.merchant_push_subscriptions set active=false,revoked_at=v_now,
      last_failure_at=v_now,failure_reason_code='GONE'
    where id=v_row.subscription_id;
  elsif v_next='provider_accepted' then
    update public.merchant_push_subscriptions
      set last_provider_accepted_at=v_now,failure_reason_code=null
    where id=v_row.subscription_id and active and revoked_at is null;
  elsif v_next in ('retry','permanent_failure') then
    update public.merchant_push_subscriptions
      set last_failure_at=v_now,failure_reason_code=coalesce(p_error_code,'PROVIDER_ERROR')
    where id=v_row.subscription_id;
  end if;

  update public.merchant_push_outbox ob
  set provider_status=case
      when ob.expires_at<=v_now then 'expired'
      when exists(select 1 from public.merchant_push_deliveries dx
        where dx.outbox_id=ob.id and dx.status in ('pending','leased','retry')) then 'retry'
      when exists(select 1 from public.merchant_push_deliveries dx
        where dx.outbox_id=ob.id and dx.status='provider_accepted') then 'provider_accepted'
      else 'permanent_failure' end,
      last_attempt_at=v_now,
      attempts=least(10,ob.attempts+1),
      last_provider_response_code=p_status,
      next_attempt_at=v_now
  where ob.id=v_row.outbox_id;
  return true;
end $fn$;

revoke all on function public.merchant_push_resolve_delivery(bigint,uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.merchant_push_resolve_delivery(bigint,uuid,text,integer,text)
  to service_role;
