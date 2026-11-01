-- #493: motorist Web Push is separate from merchant orders, billing and GPS.
-- All event creation is transactional; no public endpoint, coordinates, phone,
-- route, customer identity or request ID are ever put in a push payload.
create table public.mobility_push_subscriptions(
 id bigint generated always as identity primary key,
 driver_id uuid not null references auth.users(id) on delete cascade,
 endpoint_hash text not null unique check(endpoint_hash ~ '^[0-9a-f]{64}$'),
 endpoint_url text not null check(char_length(endpoint_url) between 40 and 2048),
 p256dh text not null check(char_length(p256dh) between 75 and 200),
 auth_secret text not null check(char_length(auth_secret) between 15 and 120),
 active boolean not null default true,
 registered_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 last_provider_accepted_at timestamptz
);
create index mobility_push_subscriptions_driver on public.mobility_push_subscriptions(driver_id) where active;
alter table public.mobility_push_subscriptions enable row level security;
revoke all on public.mobility_push_subscriptions from public,anon,authenticated;
revoke all on sequence public.mobility_push_subscriptions_id_seq from public,anon,authenticated;
grant select,insert,update on public.mobility_push_subscriptions to service_role;
grant usage,select on sequence public.mobility_push_subscriptions_id_seq to service_role;

create table public.mobility_push_outbox(
 id bigint generated always as identity primary key,
 request_id uuid not null unique references public.mobility_requests(id) on delete cascade,
 driver_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 state text not null default 'pending'
  check(state in ('pending','provider_accepted','expired','finished'))
);
alter table public.mobility_push_outbox enable row level security;
revoke all on public.mobility_push_outbox from public,anon,authenticated;
revoke all on sequence public.mobility_push_outbox_id_seq from public,anon,authenticated;
grant select,insert,update on public.mobility_push_outbox to service_role;
grant usage,select on sequence public.mobility_push_outbox_id_seq to service_role;

create table public.mobility_push_deliveries(
 id bigint generated always as identity primary key,
 outbox_id bigint not null references public.mobility_push_outbox(id) on delete cascade,
 subscription_id bigint not null references public.mobility_push_subscriptions(id) on delete cascade,
 state text not null default 'pending'
  check(state in ('pending','leased','retry','provider_accepted','gone','expired','failed')),
 attempts smallint not null default 0 check(attempts between 0 and 5),
 next_attempt_at timestamptz not null default clock_timestamp(),
 lease_token uuid,
 leased_until timestamptz,
 provider_status_code integer,
 last_error_code text,
 accepted_at timestamptz,
 unique(outbox_id,subscription_id)
);
create index mobility_push_deliveries_due on public.mobility_push_deliveries(next_attempt_at,id)
 where state in ('pending','retry','leased');
alter table public.mobility_push_deliveries enable row level security;
revoke all on public.mobility_push_deliveries from public,anon,authenticated;
revoke all on sequence public.mobility_push_deliveries_id_seq from public,anon,authenticated;
grant select,insert,update on public.mobility_push_deliveries to service_role;
grant usage,select on sequence public.mobility_push_deliveries_id_seq to service_role;

create function public.mobility_push_queue_request()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $fn$
begin
 if new.status='requested' and new.expires_at>clock_timestamp() then
  insert into public.mobility_push_outbox(request_id,driver_id,expires_at)
  values(new.id,new.driver_id,least(new.expires_at,clock_timestamp()+interval '10 minutes'))
  on conflict(request_id) do nothing;
 end if;
 return new;
end $fn$;
revoke all on function public.mobility_push_queue_request() from public,anon,authenticated;
create trigger mobility_push_new_request after insert on public.mobility_requests
for each row execute function public.mobility_push_queue_request();

-- Claims are service-role ONLY and verify the CURRENT request and its
-- published, city-enabled, driver-owned listing at every retry. A cancelled,
-- accepted, expired, transferred or unpublished request is never re-sent.
create function public.mobility_push_claim_due(p_limit integer default 4)
returns table(delivery_id bigint,lease_token uuid,endpoint_url text,
 p256dh text,auth_secret text,expires_at timestamptz)
language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare v_now timestamptz:=clock_timestamp();
 v_limit integer:=least(greatest(coalesce(p_limit,4),1),8);
begin
 update public.mobility_push_outbox set state='expired'
 where state='pending' and expires_at<=v_now;
 insert into public.mobility_push_deliveries(outbox_id,subscription_id)
 select o.id,s.id from public.mobility_push_outbox o
 join public.mobility_requests r on r.id=o.request_id
 join public.discovery_listings l on l.id=r.listing_id
 join public.discovery_vertical_cities c on c.vertical='professionals'
  and c.state_code=l.state_code and c.city_key=l.city_key and c.enabled
 join public.mobility_push_subscriptions s on s.driver_id=o.driver_id
  and s.active and s.revoked_at is null and s.registered_at<=o.created_at
 where o.state='pending' and o.expires_at>v_now
  and r.status='requested' and r.expires_at>v_now
  and r.driver_id=o.driver_id
  and l.owner_id=o.driver_id and l.vertical='professionals' and l.status='published'
 on conflict(outbox_id,subscription_id) do nothing;
 update public.mobility_push_deliveries d set state='expired',lease_token=null,leased_until=null
 from public.mobility_push_outbox o
 where d.outbox_id=o.id and d.state in ('pending','retry','leased')
  and o.expires_at<=v_now;
 return query
 with due as (
  select d.id from public.mobility_push_deliveries d
  join public.mobility_push_outbox o on o.id=d.outbox_id
  join public.mobility_requests r on r.id=o.request_id
   and r.driver_id=o.driver_id and r.status='requested' and r.expires_at>v_now
  join public.discovery_listings l on l.id=r.listing_id
   and l.owner_id=o.driver_id and l.status='published' and l.vertical='professionals'
  join public.discovery_vertical_cities c on c.vertical='professionals'
   and c.state_code=l.state_code and c.city_key=l.city_key and c.enabled
  join public.mobility_push_subscriptions s on s.id=d.subscription_id
   and s.driver_id=o.driver_id and s.active and s.revoked_at is null
  where o.state='pending' and o.expires_at>v_now
   and d.attempts<5
   and ((d.state in ('pending','retry') and d.next_attempt_at<=v_now)
     or (d.state='leased' and d.leased_until<=v_now))
  order by d.next_attempt_at,d.id for update of d skip locked limit v_limit
 ), claimed as (
  update public.mobility_push_deliveries d
  set state='leased',attempts=d.attempts+1,
   lease_token=gen_random_uuid(),leased_until=v_now+interval '45 seconds'
  from due where d.id=due.id
  returning d.id,d.outbox_id,d.subscription_id,d.lease_token
 )
 select d.id,d.lease_token,s.endpoint_url,s.p256dh,s.auth_secret,o.expires_at
 from claimed d join public.mobility_push_outbox o on o.id=d.outbox_id
 join public.mobility_push_subscriptions s on s.id=d.subscription_id;
end $fn$;
revoke all on function public.mobility_push_claim_due(integer) from public,anon,authenticated;
grant execute on function public.mobility_push_claim_due(integer) to service_role;

create function public.mobility_push_resolve_delivery(
 p_delivery_id bigint,p_lease_token uuid,p_outcome text,
 p_status integer default null,p_error_code text default null)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare d public.mobility_push_deliveries%rowtype;
 v_now timestamptz:=clock_timestamp();v_next text;
begin
 if p_outcome not in ('provider_accepted','gone','retry','failed','expired')
  or p_status is not null and (p_status<100 or p_status>599)
  or p_error_code is not null and
   (char_length(p_error_code)>50 or p_error_code !~ '^[A-Z0-9_]+$')
 then raise exception 'MOBILITY_PUSH_INVALID_RESULT' using errcode='22023';end if;
 select * into d from public.mobility_push_deliveries
 where id=p_delivery_id and state='leased' and lease_token=p_lease_token
 for update;
 if not found then return false;end if;
 v_next:=p_outcome;
 if p_outcome='retry' and (d.attempts>=5 or exists(
  select 1 from public.mobility_push_outbox o where o.id=d.outbox_id and o.expires_at<=v_now))
 then v_next:='expired';end if;
 update public.mobility_push_deliveries set state=v_next,lease_token=null,leased_until=null,
  provider_status_code=p_status,last_error_code=case when v_next='provider_accepted'
   then null else p_error_code end,
  accepted_at=case when v_next='provider_accepted' then v_now else accepted_at end,
  next_attempt_at=case when v_next='retry' then
   v_now+make_interval(secs=>least(120,5*power(2,least(d.attempts,5)))::integer)
   else next_attempt_at end
 where id=d.id;
 if v_next='gone' then
  update public.mobility_push_subscriptions set active=false,revoked_at=v_now
  where id=d.subscription_id;
 elsif v_next='provider_accepted' then
  update public.mobility_push_subscriptions set last_provider_accepted_at=v_now
  where id=d.subscription_id and active and revoked_at is null;
 end if;
 update public.mobility_push_outbox o set state=case
  when o.expires_at<=v_now then 'expired'
  when exists(select 1 from public.mobility_push_deliveries x
    where x.outbox_id=o.id and x.state in ('pending','retry','leased')) then 'pending'
  when exists(select 1 from public.mobility_push_deliveries x
    where x.outbox_id=o.id and x.state='provider_accepted') then 'provider_accepted'
  else 'finished' end
 where id=d.outbox_id;
 return true;
end $fn$;
revoke all on function public.mobility_push_resolve_delivery(bigint,uuid,text,integer,text)
 from public,anon,authenticated;
grant execute on function public.mobility_push_resolve_delivery(bigint,uuid,text,integer,text)
 to service_role;
