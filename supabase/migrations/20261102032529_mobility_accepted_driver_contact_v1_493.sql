-- #493: Show the advertised professional's public WhatsApp only to
-- an authenticated rider on an actively ACCEPTED ride. No rider phone,
-- GPS, unpublished contact, canceled/completed/expired contact or PSP.
create or replace function public.mobility_snapshot(p_request_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('id',r.id,'service',r.service,'status',
  case when r.expires_at<=statement_timestamp() and r.status in
   ('requested','accepted','en_route','arrived') then 'expired' else r.status end,
  'origin',r.origin_area,'destination',r.destination_area,
  'role',case when r.rider_id=(select auth.uid()) then 'rider' else 'driver' end,
  'expires_at',r.expires_at,'listing_title',l.title,
  'driver_whatsapp',case
    when r.rider_id=(select auth.uid())
      and r.status in ('accepted','en_route','arrived')
      and r.expires_at>statement_timestamp()
      and l.whatsapp_e164 ~ '^\+[1-9][0-9]{9,14}$'
      and public.mobility_driver_category_current(r.listing_id,r.driver_id,r.service)
    then l.whatsapp_e164
    else null end,
  'position',
  case when r.status='en_route' and r.tracking_enabled and
   l.status='published' and exists(
    select 1 from public.discovery_vertical_cities c
     where c.vertical='professionals' and c.state_code=l.state_code
      and c.city_key=l.city_key and c.enabled
   ) and r.expires_at>statement_timestamp() and
   p.updated_at>statement_timestamp()-interval '45 seconds'
   then jsonb_build_object('lat',p.latitude,'lon',p.longitude,
    'accuracy_m',p.accuracy_m,'updated_at',p.updated_at) else null end)
 from public.mobility_requests r
 join public.discovery_listings l on l.id=r.listing_id
 left join public.mobility_live_positions p on p.request_id=r.id
 where r.id=p_request_id and ((select auth.uid())=r.rider_id
  or (select auth.uid())=r.driver_id)
$$;
revoke all on function public.mobility_snapshot(uuid)
 from public,anon,authenticated;
grant execute on function public.mobility_snapshot(uuid) to authenticated;
