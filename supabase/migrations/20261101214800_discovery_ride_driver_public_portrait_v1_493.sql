-- Caronas must show a moderated driver photo like moto/car profiles.
-- A face is only verified by the human reviewer, never by this trigger.
-- Protect both owner's review transition and Admin publication: a forged
-- request or direct SQL status update cannot publish a photoless ride.
create function public.discovery_ride_driver_photo_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $ride_portrait$
begin
 if new.vertical='rides'
  and new.status in ('review','published')
  and not public.discovery_verified_photo_paths(new.id) then
  raise exception 'RIDE_DRIVER_PUBLIC_PHOTO_REQUIRED' using errcode='22023';
 end if;
 return new;
end $ride_portrait$;
revoke all on function public.discovery_ride_driver_photo_guard()
 from public,anon,authenticated;
create trigger discovery_ride_driver_photo_on_review
before update of status on public.discovery_listings
for each row
when (old.status is distinct from new.status)
execute function public.discovery_ride_driver_photo_guard();

-- No new table grants, browser-executable privileged functions, booking,
-- price, finance or GPS mutations. Old published data is unchanged.
