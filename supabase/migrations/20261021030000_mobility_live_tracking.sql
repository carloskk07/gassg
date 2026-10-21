-- Opt-in professional mobility; separate from carpool rides and product orders.
-- Location is private, overwritten in place, hidden after 45 seconds.
create table public.mobility_requests(
 id uuid primary key default gen_random_uuid(),
 rider_id uuid not null references auth.users(id),
 driver_id uuid not null references auth.users(id),
 listing_id uuid not null references public.discovery_listings(id),
 service text not null check(service in ('moto','carro')),
 origin_area text not null check(length(btrim(origin_area)) between 3 and 120),
 destination_area text not null check(length(btrim(destination_area)) between 3 and 120),
 status text not null default 'requested' check(status in
  ('requested','accepted','en_route','arrived','completed','cancelled','rejected','expired')),
 tracking_enabled boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null,
 constraint mobility_distinct_users check(rider_id<>driver_id)
);
create index mobility_rider_recent on public.mobility_requests(rider_id,created_at desc);
create index mobility_driver_recent on public.mobility_requests(driver_id,created_at desc);
create unique index mobility_one_active_rider on public.mobility_requests(rider_id)
 where status in ('accepted','en_route','arrived');
create unique index mobility_one_active_driver on public.mobility_requests(driver_id)
 where status in ('accepted','en_route','arrived');
create table public.mobility_live_positions(
 request_id uuid primary key references public.mobility_requests(id) on delete cascade,
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 accuracy_m double precision not null check(accuracy_m between 0 and 1000),
 updated_at timestamptz not null default now()
);
alter table public.mobility_requests enable row level security;
alter table public.mobility_live_positions enable row level security;
revoke all on public.mobility_requests,public.mobility_live_positions from public,anon,authenticated;
grant select on public.mobility_requests,public.mobility_live_positions to authenticated;
create policy mobility_request_participants on public.mobility_requests for select
 to authenticated using ((select auth.uid())=rider_id or (select auth.uid())=driver_id);
create policy mobility_position_live_participants on public.mobility_live_positions for select
 to authenticated using (updated_at>statement_timestamp()-interval '45 seconds'
  and exists(select 1 from public.mobility_requests r where r.id=request_id
   and ((select auth.uid())=r.rider_id or (select auth.uid())=r.driver_id)
   and r.status='en_route' and r.tracking_enabled and r.expires_at>statement_timestamp()
   and exists(select 1 from public.discovery_listings l
     where l.id=r.listing_id and l.status='published')));

create function public.mobility_create_request(
 p_listing_id uuid,p_service text,p_origin_area text,p_destination_area text)
returns uuid language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_user uuid:=(select auth.uid());v_driver uuid;v_id uuid;
begin
 if v_user is null or not public.discovery_verified_account()
 then raise exception 'MOBILITY_AUTH_REQUIRED' using errcode='42501';end if;
 if p_service is null or p_service not in ('moto','carro')
  or length(btrim(coalesce(p_origin_area,''))) not between 3 and 120
  or length(btrim(coalesce(p_destination_area,''))) not between 3 and 120
 then raise exception 'MOBILITY_INVALID_REQUEST' using errcode='22023';end if;
 select l.owner_id into v_driver from public.discovery_listings l
 join public.discovery_professional_details d on d.listing_id=l.id
 where l.id=p_listing_id and l.status='published' and l.vertical='professionals'
  and exists(select 1 from public.discovery_vertical_cities c where c.vertical='professionals'
   and c.state_code=l.state_code and c.city_key=l.city_key and c.enabled)
  and ((p_service='moto' and d.occupation ~* '(motot[aá]xi|moto.?taxi)')
    or (p_service='carro' and d.occupation ~* '(motorista|t[aá]xi|taxista)'));
 if v_driver is null or v_driver=v_user
 then raise exception 'MOBILITY_PROVIDER_UNAVAILABLE' using errcode='42501';end if;
 perform 1 from auth.users where id=v_user for update;
 update public.mobility_requests set status='expired',tracking_enabled=false,
  updated_at=statement_timestamp() where rider_id=v_user
  and expires_at<=statement_timestamp() and status in ('requested','accepted','en_route','arrived');
 delete from public.mobility_live_positions p using public.mobility_requests r
  where p.request_id=r.id and r.rider_id=v_user and r.status='expired';
 if exists(select 1 from public.mobility_requests where rider_id=v_user
  and status in ('requested','accepted','en_route','arrived') and expires_at>statement_timestamp())
 then raise exception 'MOBILITY_ACTIVE_REQUEST_EXISTS' using errcode='23505';end if;
 if (select count(*) from public.mobility_requests
    where rider_id=v_user and created_at>statement_timestamp()-interval '1 hour')>=5
 then raise exception 'MOBILITY_RATE_LIMIT' using errcode='22023';end if;
 insert into public.mobility_requests(rider_id,driver_id,listing_id,service,
  origin_area,destination_area,expires_at)
 values(v_user,v_driver,p_listing_id,p_service,btrim(p_origin_area),
  btrim(p_destination_area),statement_timestamp()+interval '10 minutes')
 returning id into v_id;
 return v_id;
end $$;

create function public.mobility_transition(p_request_id uuid,p_action text)
returns text language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_user uuid:=(select auth.uid());r public.mobility_requests%rowtype;v_next text;
begin
 if v_user is null or not public.discovery_verified_account()
 then raise exception 'MOBILITY_AUTH_REQUIRED' using errcode='42501';end if;
 select * into r from public.mobility_requests where id=p_request_id for update;
 if not found or v_user not in (r.rider_id,r.driver_id)
 then raise exception 'MOBILITY_FORBIDDEN' using errcode='42501';end if;
 if r.expires_at<=statement_timestamp() and r.status in ('requested','accepted','en_route','arrived')
 then
  update public.mobility_requests set status='expired',tracking_enabled=false,
   updated_at=statement_timestamp() where id=r.id;
  delete from public.mobility_live_positions where request_id=r.id;
  return 'expired';
 end if;
 v_next:=case
  when p_action='accept' and v_user=r.driver_id and r.status='requested' then 'accepted'
  when p_action='depart' and v_user=r.driver_id and r.status='accepted' then 'en_route'
  when p_action='arrive' and v_user=r.driver_id and r.status='en_route' then 'arrived'
  when p_action='finish' and v_user=r.driver_id and r.status='arrived' then 'completed'
  when p_action='reject' and v_user=r.driver_id and r.status='requested' then 'rejected'
  when p_action='cancel' and r.status in ('requested','accepted','en_route','arrived') then 'cancelled'
  else null end;
 if v_next is null then raise exception 'MOBILITY_INVALID_TRANSITION' using errcode='22023';end if;
 -- A queued request cannot be accepted after the listing/city is withdrawn.
 if v_next='accepted' and not exists(select 1 from public.discovery_listings l
   join public.discovery_vertical_cities c on c.vertical='professionals'
     and c.state_code=l.state_code and c.city_key=l.city_key and c.enabled
   where l.id=r.listing_id and l.owner_id=r.driver_id
    and l.vertical='professionals' and l.status='published') then
  raise exception 'MOBILITY_PROVIDER_UNAVAILABLE' using errcode='42501';
 end if;
 -- Expire abandoned older jobs before applying the unique active-driver index.
 if v_next='accepted' then
  update public.mobility_requests set status='expired',tracking_enabled=false,
   updated_at=statement_timestamp() where driver_id=r.driver_id and id<>r.id
    and expires_at<=statement_timestamp() and status in ('requested','accepted','en_route','arrived');
  delete from public.mobility_live_positions p using public.mobility_requests x
   where p.request_id=x.id and x.driver_id=r.driver_id and x.status='expired';
 end if;
 update public.mobility_requests set status=v_next,tracking_enabled=false,
  expires_at=case when v_next='accepted' then statement_timestamp()+interval '90 minutes' else expires_at end,
  updated_at=statement_timestamp() where id=r.id;
 delete from public.mobility_live_positions where request_id=r.id;
 return v_next;
end $$;

-- Explicit driver-initiated permission in the database. A delayed GPS packet
-- must never restore tracking after STOP, even if it arrives out of order.
create function public.mobility_start_position(p_request_id uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $mobility_start$
declare v_user uuid:=(select auth.uid());r public.mobility_requests%rowtype;
begin
 if v_user is null or not public.discovery_verified_account() then
   raise exception 'MOBILITY_AUTH_REQUIRED' using errcode='42501';end if;
 select * into r from public.mobility_requests where id=p_request_id for update;
 if not found or r.driver_id<>v_user or r.status<>'en_route'
    or r.expires_at<=statement_timestamp() or not exists(select 1 from public.discovery_listings l
    join public.discovery_vertical_cities c on c.vertical='professionals'
     and c.state_code=l.state_code and c.city_key=l.city_key and c.enabled
    where l.id=r.listing_id and l.owner_id=v_user
      and l.vertical='professionals' and l.status='published') then
  raise exception 'MOBILITY_START_FORBIDDEN' using errcode='42501';end if;
 update public.mobility_requests set tracking_enabled=true,updated_at=statement_timestamp()
  where id=r.id;
 return true;
end $mobility_start$;

create function public.mobility_publish_position(
 p_request_id uuid,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_user uuid:=(select auth.uid());r public.mobility_requests%rowtype;
begin
 if v_user is null or not public.discovery_verified_account()
 then raise exception 'MOBILITY_AUTH_REQUIRED' using errcode='42501';end if;
 if p_latitude is null or p_longitude is null or
  p_accuracy_m is null or p_latitude not between -90 and 90 or
  p_longitude not between -180 and 180 or p_accuracy_m not between 0 and 1000
 then raise exception 'MOBILITY_INVALID_POSITION' using errcode='22023';end if;
 select * into r from public.mobility_requests where id=p_request_id for update;
 if not found or r.driver_id<>v_user or r.status<>'en_route'
   or not r.tracking_enabled or r.expires_at<=statement_timestamp() or not exists(select 1 from public.discovery_listings l
    join public.discovery_vertical_cities c on c.vertical='professionals'
     and c.state_code=l.state_code and c.city_key=l.city_key and c.enabled
    where l.id=r.listing_id and l.owner_id=v_user
      and l.vertical='professionals' and l.status='published')
 then raise exception 'MOBILITY_POSITION_FORBIDDEN' using errcode='42501';end if;
 if exists(select 1 from public.mobility_live_positions where request_id=r.id
   and updated_at>statement_timestamp()-interval '5 seconds') then return false;end if;
 insert into public.mobility_live_positions(request_id,latitude,longitude,accuracy_m,updated_at)
 values(r.id,p_latitude,p_longitude,p_accuracy_m,statement_timestamp())
 on conflict(request_id) do update set latitude=excluded.latitude,
 longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,updated_at=excluded.updated_at;
 return true;
end $$;

create function public.mobility_stop_position(p_request_id uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_user uuid:=(select auth.uid());
begin
 if v_user is null or not exists(select 1 from public.mobility_requests
  where id=p_request_id and driver_id=v_user)
 then raise exception 'MOBILITY_FORBIDDEN' using errcode='42501';end if;
 update public.mobility_requests set tracking_enabled=false,updated_at=statement_timestamp()
  where id=p_request_id and driver_id=v_user;
 delete from public.mobility_live_positions where request_id=p_request_id;
 return true;
end $$;

create function public.mobility_snapshot(p_request_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('id',r.id,'service',r.service,'status',
  case when r.expires_at<=statement_timestamp() and r.status in
   ('requested','accepted','en_route','arrived') then 'expired' else r.status end,
  'origin',r.origin_area,'destination',r.destination_area,
  'role',case when r.rider_id=(select auth.uid()) then 'rider' else 'driver' end,
  'expires_at',r.expires_at,'listing_title',l.title,'position',
  case when r.status='en_route' and r.tracking_enabled and
   l.status='published' and
   r.expires_at>statement_timestamp() and
   p.updated_at>statement_timestamp()-interval '45 seconds'
   then jsonb_build_object('lat',p.latitude,'lon',p.longitude,
    'accuracy_m',p.accuracy_m,'updated_at',p.updated_at) else null end)
 from public.mobility_requests r
 join public.discovery_listings l on l.id=r.listing_id
 left join public.mobility_live_positions p on p.request_id=r.id
 where r.id=p_request_id and ((select auth.uid())=r.rider_id
  or (select auth.uid())=r.driver_id)
$$;

create function public.mobility_my_requests()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(z.item order by z.created_at desc),'[]'::jsonb)
 from(select r.created_at,jsonb_build_object('id',r.id,'service',r.service,
  'role',case when r.rider_id=(select auth.uid()) then 'rider' else 'driver' end,
  'status',case when r.expires_at<=statement_timestamp() and r.status in
   ('requested','accepted','en_route','arrived') then 'expired' else r.status end,
  'origin',r.origin_area,'destination',r.destination_area,'expires_at',r.expires_at,
  'listing_title',l.title) item
 from public.mobility_requests r join public.discovery_listings l on l.id=r.listing_id
 where ((select auth.uid())=r.rider_id or (select auth.uid())=r.driver_id)
  and r.created_at>statement_timestamp()-interval '7 days'
 order by r.created_at desc limit 30) z
$$;

-- Only authenticated calls; no direct table writes, no anonymous GPS reads.
revoke all on function public.mobility_create_request(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.mobility_transition(uuid,text) from public,anon,authenticated;
revoke all on function public.mobility_start_position(uuid) from public,anon,authenticated;
revoke all on function public.mobility_publish_position(uuid,double precision,double precision,double precision) from public,anon,authenticated;
revoke all on function public.mobility_stop_position(uuid) from public,anon,authenticated;
revoke all on function public.mobility_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.mobility_my_requests() from public,anon,authenticated;
grant execute on function public.mobility_create_request(uuid,text,text,text),
 public.mobility_transition(uuid,text),
 public.mobility_start_position(uuid),
 public.mobility_publish_position(uuid,double precision,double precision,double precision),
 public.mobility_stop_position(uuid),public.mobility_snapshot(uuid),
 public.mobility_my_requests() to authenticated;

-- A lost browser tab may not finish its final stop RPC. Server-side cleanup
-- clears stale locations even if neither participant returns to the page.
create function public.mobility_cleanup_expired()
returns void language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 update public.mobility_requests set status='expired',tracking_enabled=false,
  updated_at=statement_timestamp()
  where expires_at<=statement_timestamp() and
   status in ('requested','accepted','en_route','arrived');
 delete from public.mobility_live_positions p
  where p.updated_at<statement_timestamp()-interval '3 minutes'
   or not exists(select 1 from public.mobility_requests r
    where r.id=p.request_id and r.status='en_route'
     and r.tracking_enabled and r.expires_at>statement_timestamp());
end $$;
revoke all on function public.mobility_cleanup_expired() from public,anon,authenticated;
do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('tamao-mobility-gps-cleanup',
   '*/5 * * * *','select public.mobility_cleanup_expired()');
 end if;
end $cron$;

