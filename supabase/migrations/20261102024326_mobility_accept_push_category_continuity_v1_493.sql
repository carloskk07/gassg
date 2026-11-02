-- #493: An advert cannot switch from motorcycle to car (or vice versa)
-- while a ride is pending and then accept or receive driver notifications
-- for a category that is no longer advertised. No new browser privileges.
-- This matches the existing INSERT category trigger in
-- 20261101211234_mobility_service_category_integrity_v1_493.sql.
create function public.mobility_driver_category_current(
 p_listing_id uuid,p_driver_id uuid,p_service text)
returns boolean language sql stable security definer set search_path=pg_catalog
as $category$
 select exists(
  select 1 from public.discovery_listings l
  join public.discovery_professional_details d on d.listing_id=l.id
  where l.id=p_listing_id and l.owner_id=p_driver_id
   and l.vertical='professionals' and l.status='published'
   and exists(select 1 from public.discovery_vertical_cities c
     where c.vertical='professionals' and c.state_code=l.state_code
       and c.city_key=l.city_key and c.enabled)
   and p_service=case
    when d.occupation ~* '(motot[aá]xi|moto.?taxi)' then 'moto'
    when d.occupation ~* '(motorista|t[aá]xi|taxista)' then 'carro'
    else null end
 )
$category$;
revoke all on function public.mobility_driver_category_current(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.mobility_driver_category_current(uuid,uuid,text)
 to service_role;

-- A queued ride must pass the same category check again at the actual
-- 'requested' -> 'accepted' transition, even if the listing changed.
-- The existing rider cancellation / driver rejection paths remain available.
create function public.mobility_accept_current_category_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $guard$
begin
 if not public.mobility_driver_category_current(new.listing_id,new.driver_id,new.service)
 then raise exception 'MOBILITY_PROVIDER_UNAVAILABLE' using errcode='42501';end if;
 return new;
end $guard$;
revoke all on function public.mobility_accept_current_category_guard()
 from public,anon,authenticated;
create trigger mobility_accept_matching_category
 before update of status on public.mobility_requests
 for each row
 when (old.status='requested' and new.status='accepted')
 execute function public.mobility_accept_current_category_guard();

-- Private push queue must not deliver a mismatched request, neither during
-- leasing nor between leasing and the final remote-provider HTTP call.
create or replace function public.mobility_push_claim_due(p_limit integer default 4)
returns table(delivery_id bigint,lease_token uuid,endpoint_url text,
 p256dh text,auth_secret text,expires_at timestamptz)
language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare v_now timestamptz:=clock_timestamp();
 v_limit integer:=least(greatest(coalesce(p_limit,4),1),8);
begin
 update public.mobility_push_outbox ob set state='expired'
 where ob.state='pending' and ob.expires_at<=v_now;
 insert into public.mobility_push_deliveries(outbox_id,subscription_id,next_attempt_at)
 select o.id,s.id,v_now from public.mobility_push_outbox o
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
  and public.mobility_driver_category_current(r.listing_id,o.driver_id,r.service)
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
  where public.mobility_driver_category_current(r.listing_id,o.driver_id,r.service)
    and o.state='pending' and o.expires_at>v_now
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

create or replace function public.mobility_push_delivery_allowed(
 p_delivery_id bigint,p_lease_token uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog
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
  where public.mobility_driver_category_current(r.listing_id,o.driver_id,r.service)
   and d.id=p_delivery_id and d.lease_token=p_lease_token
   and d.state='leased' and d.leased_until>clock_timestamp()
   and o.state='pending' and o.expires_at>clock_timestamp()
 )
$fn$;
revoke all on function public.mobility_push_delivery_allowed(bigint,uuid)
 from public,anon,authenticated;
grant execute on function public.mobility_push_delivery_allowed(bigint,uuid)
 to service_role;
