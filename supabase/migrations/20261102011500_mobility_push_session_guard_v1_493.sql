-- #493: Prevent Web Push after remote sign-out, session revocation or
-- switch to another account on the same browser. Historical merchant Web Push
-- from 15/10/2026 remains untouched. No new grants to browser roles.
-- New mobility subscriptions only: as of initial rollout there are zero.
alter table public.mobility_push_subscriptions
 add column auth_session_id uuid;
-- Never silently accept an unbound subscription: fail migration if any
-- existing device would need explicit re-enrollment.
alter table public.mobility_push_subscriptions
 alter column auth_session_id set not null;
create index mobility_push_session_active_idx on
 public.mobility_push_subscriptions(auth_session_id) where active;
-- A user account alone is insufficient to send a push: the original
-- consented auth session must still exist AND belong to the driver.
-- Supabase Auth sessions disappear when the session is revoked/signed out.
create or replace function public.mobility_push_claim_due(p_limit integer default 4)
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
 join auth.sessions sess on sess.id=s.auth_session_id and sess.user_id=s.driver_id
  and (sess.not_after is null or sess.not_after>v_now)
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
  join auth.sessions sess on sess.id=s.auth_session_id and sess.user_id=s.driver_id
   and (sess.not_after is null or sess.not_after>v_now)
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

-- Safe read for existing device, not a new enrollment and never a provider
-- send. Requires both the exact session and matching endpoint credential.
create function public.mobility_push_device_is_active(
 p_driver uuid,p_session uuid,p_endpoint_hash text)
returns boolean language sql stable security definer set search_path=pg_catalog
as $fn$
 select exists(
  select 1 from public.mobility_push_subscriptions sub
  join auth.sessions ses on ses.id=sub.auth_session_id
   and ses.user_id=sub.driver_id
   and (ses.not_after is null or ses.not_after>clock_timestamp())
  where sub.driver_id=p_driver and sub.auth_session_id=p_session
   and sub.endpoint_hash=p_endpoint_hash and sub.active and sub.revoked_at is null
 )
$fn$;
revoke all on function public.mobility_push_device_is_active(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.mobility_push_device_is_active(uuid,uuid,text)
 to service_role;


-- A lease is not lasting authorization. Recheck the exact assigned session,
-- current ride state and public listing immediately before EVERY HTTP send.
-- This closes the window after leasing but before the 4/8-second provider call.
create function public.mobility_push_delivery_allowed(
 p_delivery_id bigint,p_lease_token uuid)
returns boolean language sql stable security definer set search_path=pg_catalog
as $fn$
 select exists(
  select 1 from public.mobility_push_deliveries d
  join public.mobility_push_outbox o on o.id=d.outbox_id
  join public.mobility_requests r on r.id=o.request_id
   and r.driver_id=o.driver_id and r.status='requested'
   and r.expires_at>clock_timestamp()
  join public.discovery_listings l on l.id=r.listing_id
   and l.owner_id=o.driver_id and l.vertical='professionals'
   and l.status='published'
  join public.discovery_vertical_cities c on c.vertical='professionals'
   and c.state_code=l.state_code and c.city_key=l.city_key and c.enabled
  join public.mobility_push_subscriptions sub on sub.id=d.subscription_id
   and sub.driver_id=o.driver_id and sub.active and sub.revoked_at is null
   and sub.registered_at<=o.created_at
  join auth.sessions ses on ses.id=sub.auth_session_id
   and ses.user_id=sub.driver_id
   and (ses.not_after is null or ses.not_after>clock_timestamp())
  where d.id=p_delivery_id and d.lease_token=p_lease_token
   and d.state='leased' and d.leased_until>clock_timestamp()
   and o.state='pending' and o.expires_at>clock_timestamp()
 )
$fn$;
revoke all on function public.mobility_push_delivery_allowed(bigint,uuid)
 from public,anon,authenticated;
grant execute on function public.mobility_push_delivery_allowed(bigint,uuid)
 to service_role;
