-- Published carpool listings need an owner-only, atomic seat adjustment.
-- No payments, bookings, vehicle dispatch, contact data or moderation bypass.
-- A seat count of zero removes a ride from the already-guarded public search.
create function public.discovery_update_ride_seats(
 p_listing_id uuid,p_seats_available integer)
returns integer language plpgsql volatile security definer
set search_path=pg_catalog as $ride_seats$
declare v_actor uuid:=(select auth.uid());v_total integer;
begin
 if v_actor is null or not public.discovery_verified_account() then
  raise exception 'RIDE_AUTH_REQUIRED' using errcode='42501';
 end if;
 if p_listing_id is null or p_seats_available is null or
   p_seats_available not between 0 and 8 then
  raise exception 'RIDE_INVALID_SEATS' using errcode='22023';
 end if;
 -- Lock the owner/listing and details against concurrent review/pause/edit.
 -- No forged owner_id or privileged status can be supplied by the caller.
 select r.seats_total into v_total from public.discovery_listings l
 join public.discovery_ride_details r on r.listing_id=l.id
 where l.id=p_listing_id and l.owner_id=v_actor and l.vertical='rides'
   and l.status='published' and r.departure_at>statement_timestamp()
 for update of l,r;
 if not found then
  raise exception 'RIDE_NOT_EDITABLE' using errcode='42501';
 end if;
 if p_seats_available>v_total then
  raise exception 'RIDE_EXCEEDS_CAPACITY' using errcode='22023';
 end if;
 update public.discovery_ride_details set seats_available=p_seats_available
 where listing_id=p_listing_id;
 return p_seats_available;
end $ride_seats$;
revoke all on function public.discovery_update_ride_seats(uuid,integer)
 from public,anon,authenticated;
grant execute on function public.discovery_update_ride_seats(uuid,integer)
 to authenticated;

-- Review the exact new privileged-function inventory, without disabling
-- launch fingerprint enforcement or changing any other readiness condition.
-- This is the canonical disposable full-schema result with one added
-- owner-scoped authenticated RPC and unchanged table ACL.
do $ride_launch_acl$
declare
 v_current jsonb:=public.tamao_launch_acl_posture_v1();
 v_old text:='''d795df150e91d9d758b6ccb4fd0386cd''';
 v_new text:='''820687783f9ba7ff7891facb891067f6''';
 v_def text;
begin
 if v_current->>'tableDigest'<>'67838fe06fa43d7692e12d8e11a3de91'
  or (v_current->>'tableCount')::integer<>7
  or v_current->>'rpcDigest'<>'820687783f9ba7ff7891facb891067f6'
  or (v_current->>'rpcCount')::integer<>29
 then raise exception 'RIDE_LAUNCH_FINGERPRINT_DRIFT' using errcode='42501';end if;
 select pg_catalog.pg_get_functiondef('public.platform_launch_readiness()'::pg_catalog.regprocedure)
 into v_def;
 if v_def is null or pg_catalog.strpos(v_def,v_old)=0
  or pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,''))
   <>pg_catalog.length(v_old)
 then raise exception 'RIDE_LAUNCH_EXPECTED_BASELINE_MISSING' using errcode='42501';end if;
 execute pg_catalog.replace(v_def,v_old,v_new);
 -- Unknown subsequent SECURITY DEFINER additions still change the digest
 -- and block commercial readiness; no toggle or allow-all path is introduced.
end $ride_launch_acl$;
