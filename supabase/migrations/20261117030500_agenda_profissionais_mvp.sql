-- TAMÃO Agenda V1: appointments without charges. No impact on commerce switch.
-- The owner must be an email/phone verified, non-anonymous account.
begin;

create table public.agenda_pages (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null unique default auth.uid() references auth.users(id),
 slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 4 and 60),
 title text not null check(length(btrim(title)) between 3 and 100),
 about text not null default '' check(length(about)<=1000),
 city text not null check(length(btrim(city)) between 2 and 100),
 public_area text not null default '' check(length(public_area)<=120),
 whatsapp_e164 text check(whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 photo_paths text[] not null default '{}',
 published boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint agenda_photos_limit check(cardinality(photo_paths)<=6)
);
create table public.agenda_services (
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references public.agenda_pages(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id),
 title text not null check(length(btrim(title)) between 3 and 100),
 duration_min integer not null check(duration_min between 15 and 240 and duration_min%15=0),
 price_cents integer not null check(price_cents between 0 and 2000000),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(page_id,id)
);
create table public.agenda_hours (
 page_id uuid not null references public.agenda_pages(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id),
 weekday integer not null check(weekday between 0 and 6),
 opens_min integer not null check(opens_min between 0 and 1380 and opens_min%30=0),
 closes_min integer not null check(closes_min between 30 and 1440 and closes_min%30=0),
 primary key(page_id,weekday),
 check(closes_min>opens_min)
);
create table public.agenda_appointments (
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references public.agenda_pages(id),
 service_id uuid not null references public.agenda_services(id),
 owner_id uuid not null references auth.users(id),
 customer_id uuid not null references auth.users(id),
 request_id uuid not null,
 customer_name text not null check(length(btrim(customer_name)) between 2 and 90),
 customer_phone text check(customer_phone is null or length(customer_phone)<=25),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
 created_at timestamptz not null default now(),
 cancelled_at timestamptz,
 check(ends_at>starts_at),
 unique(customer_id,request_id)
);
create index agenda_appointments_live_idx on public.agenda_appointments(page_id,starts_at,ends_at)
 where status='confirmed';
create index agenda_appointments_owner_idx on public.agenda_appointments(owner_id,starts_at desc);
create index agenda_appointments_customer_idx on public.agenda_appointments(customer_id,starts_at desc);
create index agenda_services_page_idx on public.agenda_services(page_id,active);

alter table public.agenda_pages enable row level security;
alter table public.agenda_services enable row level security;
alter table public.agenda_hours enable row level security;
alter table public.agenda_appointments enable row level security;
revoke all on public.agenda_pages,public.agenda_services,public.agenda_hours,public.agenda_appointments from public,anon,authenticated;

-- Existing Discovery photo bucket limits are retained. Only real uploaded
-- files belonging to this authenticated owner may decorate the Agenda page.
create function public.agenda_check_photos()
returns trigger language plpgsql security definer set search_path='pg_catalog'
as $$
declare v_path text;
begin
 if new.owner_id is distinct from auth.uid() or
    not public.discovery_verified_account() then
   raise exception 'AGENDA_VERIFIED_OWNER_REQUIRED' using errcode='42501';
 end if;
 foreach v_path in array new.photo_paths loop
   if v_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$'
      or split_part(v_path,'/',1)<>new.owner_id::text
      or not exists (
       select 1 from storage.objects o
        where o.bucket_id='tamao-discovery-photos' and o.name=v_path
          and o.owner_id=new.owner_id::text
          and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
      )
   then raise exception 'AGENDA_PHOTO_NOT_OWNED' using errcode='22023';end if;
 end loop;
 new.updated_at=now();
 return new;
end $$;
revoke all on function public.agenda_check_photos() from public,anon,authenticated;
create trigger agenda_pages_photos_guard before insert or update on public.agenda_pages
 for each row execute function public.agenda_check_photos();

create policy agenda_page_owner_select on public.agenda_pages
 for select to authenticated using(owner_id=(select auth.uid()));
create policy agenda_page_owner_insert on public.agenda_pages
 for insert to authenticated with check(owner_id=(select auth.uid()) and (select public.discovery_verified_account()));
create policy agenda_page_owner_update on public.agenda_pages
 for update to authenticated using(owner_id=(select auth.uid()))
 with check(owner_id=(select auth.uid()) and (select public.discovery_verified_account()));
grant select on public.agenda_pages to authenticated;
grant insert(slug,title,about,city,public_area,whatsapp_e164,photo_paths,published)
 on public.agenda_pages to authenticated;
grant update(slug,title,about,city,public_area,whatsapp_e164,photo_paths,published)
 on public.agenda_pages to authenticated;

create policy agenda_services_owner_select on public.agenda_services
 for select to authenticated using(owner_id=(select auth.uid()));
create policy agenda_services_owner_insert on public.agenda_services
 for insert to authenticated with check(
  owner_id=(select auth.uid()) and (select public.discovery_verified_account())
  and exists(select 1 from public.agenda_pages p where p.id=page_id and p.owner_id=(select auth.uid()))
 );
create policy agenda_services_owner_update on public.agenda_services
 for update to authenticated using(owner_id=(select auth.uid()))
 with check(
  owner_id=(select auth.uid()) and (select public.discovery_verified_account())
  and exists(select 1 from public.agenda_pages p where p.id=page_id and p.owner_id=(select auth.uid()))
 );
grant select on public.agenda_services to authenticated;
grant insert(page_id,title,duration_min,price_cents,active) on public.agenda_services to authenticated;
grant update(title,duration_min,price_cents,active) on public.agenda_services to authenticated;

create policy agenda_hours_owner_select on public.agenda_hours
 for select to authenticated using(owner_id=(select auth.uid()));
create policy agenda_hours_owner_insert on public.agenda_hours
 for insert to authenticated with check(
  owner_id=(select auth.uid()) and (select public.discovery_verified_account())
  and exists(select 1 from public.agenda_pages p where p.id=page_id and p.owner_id=(select auth.uid()))
 );
create policy agenda_hours_owner_update on public.agenda_hours
 for update to authenticated using(owner_id=(select auth.uid()))
 with check(
  owner_id=(select auth.uid()) and (select public.discovery_verified_account())
  and exists(select 1 from public.agenda_pages p where p.id=page_id and p.owner_id=(select auth.uid()))
 );
create policy agenda_hours_owner_delete on public.agenda_hours
 for delete to authenticated using(owner_id=(select auth.uid()));
grant select,delete on public.agenda_hours to authenticated;
grant insert(page_id,weekday,opens_min,closes_min) on public.agenda_hours to authenticated;
grant update(opens_min,closes_min) on public.agenda_hours to authenticated;

create policy agenda_appointments_participants_read on public.agenda_appointments
 for select to authenticated using(owner_id=(select auth.uid()) or customer_id=(select auth.uid()));
grant select on public.agenda_appointments to authenticated;
-- No direct appointment insert/update/delete: only atomic, authorized RPCs.

-- Public view is deliberately an allowlisted JSON projection, never SELECT
-- from the underlying table. It omits account identities and booking contacts.
create function public.agenda_public_page(p_slug text)
returns jsonb language sql stable security definer set search_path='pg_catalog'
as $$
 select jsonb_build_object(
  'id',p.id,'slug',p.slug,'title',p.title,'about',p.about,
  'city',p.city,'public_area',p.public_area,'whatsapp',p.whatsapp_e164,
  'photos',p.photo_paths,
  'services',coalesce((
    select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,
      'duration_min',s.duration_min,'price_cents',s.price_cents) order by s.title)
    from public.agenda_services s where s.page_id=p.id and s.active
  ),'[]'::jsonb)
 ) from public.agenda_pages p
 where p.slug=p_slug and p.published
$$;
revoke all on function public.agenda_public_page(text) from public,anon,authenticated;
grant execute on function public.agenda_public_page(text) to anon,authenticated;

-- Slots generated in the service's São Paulo timezone; bookings are never
-- inferred from browser state. Only the next 30 days are bookable.
create function public.agenda_available_slots(p_service_id uuid,p_day date)
returns table(starts_at timestamptz,label text)
language plpgsql stable security definer set search_path='pg_catalog'
as $$
declare v_page uuid;v_duration integer;v_open integer;v_close integer;
begin
 if p_day<((now() at time zone 'America/Sao_Paulo')::date)
    or p_day>((now() at time zone 'America/Sao_Paulo')::date+30)
 then return;end if;
 select p.id,s.duration_min,h.opens_min,h.closes_min
 into v_page,v_duration,v_open,v_close
 from public.agenda_services s
 join public.agenda_pages p on p.id=s.page_id and p.published
 join public.agenda_hours h on h.page_id=p.id
  and h.weekday=extract(dow from p_day)::int
 where s.id=p_service_id and s.active;
 if not found then return;end if;
 return query
 select slot.t, to_char(slot.t at time zone 'America/Sao_Paulo','HH24:MI')
 from generate_series(
  (p_day::timestamp+make_interval(mins=>v_open)) at time zone 'America/Sao_Paulo',
  (p_day::timestamp+make_interval(mins=>v_close-v_duration)) at time zone 'America/Sao_Paulo',
  interval '30 minutes'
 ) as slot(t)
 where slot.t>now()+interval '60 minutes'
   and not exists(select 1 from public.agenda_appointments a
    where a.page_id=v_page and a.status='confirmed'
      and a.starts_at<slot.t+make_interval(mins=>v_duration)
      and a.ends_at>slot.t)
 order by slot.t limit 36;
end $$;
revoke all on function public.agenda_available_slots(uuid,date) from public,anon,authenticated;
grant execute on function public.agenda_available_slots(uuid,date) to anon,authenticated;

-- Advisory lock by page/day serializes competing bookings even when they
-- target overlapping services with different durations.
create function public.agenda_book_slot(
 p_service_id uuid,p_starts_at timestamptz,p_name text,p_phone text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='pg_catalog'
as $$
declare
 v_user uuid:=(select auth.uid());
 v_page public.agenda_pages%rowtype;
 v_service public.agenda_services%rowtype;
 v_hours public.agenda_hours%rowtype;
 v_local timestamp;
 v_day date;
 v_end timestamptz;
 v_existing public.agenda_appointments%rowtype;
 v_id uuid;
begin
 if v_user is null or not public.discovery_verified_account()
    or p_request_id is null then
   raise exception 'AGENDA_VERIFIED_LOGIN_REQUIRED' using errcode='42501';
 end if;
 if length(btrim(coalesce(p_name,''))) not between 2 and 90
   or (nullif(btrim(coalesce(p_phone,'')),'') is not null
       and p_phone !~ '^\+?[0-9 ()-]{8,25}$') then
   raise exception 'AGENDA_CONTACT_INVALID' using errcode='22023';
 end if;
 select * into v_existing from public.agenda_appointments
  where customer_id=v_user and request_id=p_request_id;
 if found then
   return jsonb_build_object('id',v_existing.id,'status',v_existing.status,
    'starts_at',v_existing.starts_at);
 end if;
 select * into v_service from public.agenda_services
  where id=p_service_id and active for share;
 if not found then raise exception 'AGENDA_SERVICE_UNAVAILABLE' using errcode='22023';end if;
 select * into v_page from public.agenda_pages
  where id=v_service.page_id and published for share;
 if not found or v_page.owner_id=v_user then
   raise exception 'AGENDA_PAGE_UNAVAILABLE' using errcode='22023';
 end if;
 v_local:=p_starts_at at time zone 'America/Sao_Paulo';
 v_day:=v_local::date;
 if p_starts_at<=now()+interval '60 minutes'
   or v_day>((now() at time zone 'America/Sao_Paulo')::date+30)
   or extract(minute from v_local)::int%30<>0
   or extract(second from v_local)<>0 then
   raise exception 'AGENDA_INVALID_TIME' using errcode='22023';
 end if;
 -- Both selected slots and actual writes use the same lock namespace.
 perform pg_advisory_xact_lock(hashtext(v_page.id::text||':'||v_day::text));
 select * into v_existing from public.agenda_appointments
   where customer_id=v_user and request_id=p_request_id;
 if found then
   return jsonb_build_object('id',v_existing.id,'status',v_existing.status,
      'starts_at',v_existing.starts_at);
 end if;
 select * into v_hours from public.agenda_hours
  where page_id=v_page.id and weekday=extract(dow from v_local)::int;
 if not found or extract(hour from v_local)::int*60+extract(minute from v_local)::int<v_hours.opens_min
  or extract(hour from v_local)::int*60+extract(minute from v_local)::int+v_service.duration_min>v_hours.closes_min
 then raise exception 'AGENDA_OUTSIDE_WORKING_HOURS' using errcode='22023';end if;
 v_end:=p_starts_at+make_interval(mins=>v_service.duration_min);
 if exists(select 1 from public.agenda_appointments a
   where a.page_id=v_page.id and a.status='confirmed'
     and a.starts_at<v_end and a.ends_at>p_starts_at) then
   raise exception 'AGENDA_SLOT_ALREADY_TAKEN' using errcode='23505';
 end if;
 if (select count(*) from public.agenda_appointments a
   where a.customer_id=v_user and a.status='confirmed' and a.starts_at>now())>=8
 then raise exception 'AGENDA_BOOKING_LIMIT' using errcode='22023';end if;
 insert into public.agenda_appointments
  (page_id,service_id,owner_id,customer_id,request_id,customer_name,customer_phone,starts_at,ends_at)
 values(v_page.id,v_service.id,v_page.owner_id,v_user,p_request_id,btrim(p_name),
   nullif(btrim(coalesce(p_phone,'')),''),p_starts_at,v_end)
 returning id into v_id;
 return jsonb_build_object('id',v_id,'status','confirmed','starts_at',p_starts_at);
end $$;
revoke all on function public.agenda_book_slot(uuid,timestamptz,text,text,uuid) from public,anon,authenticated;
grant execute on function public.agenda_book_slot(uuid,timestamptz,text,text,uuid) to authenticated;

create function public.agenda_cancel_booking(p_appointment_id uuid)
returns boolean language plpgsql security definer set search_path='pg_catalog'
as $$
declare v_owner uuid;v_customer uuid;v_status text;v_user uuid:=(select auth.uid());
begin
 if v_user is null then raise exception 'LOGIN_REQUIRED' using errcode='42501';end if;
 select owner_id,customer_id,status into v_owner,v_customer,v_status
 from public.agenda_appointments where id=p_appointment_id for update;
 if not found or v_user not in (v_owner,v_customer)
 then raise exception 'AGENDA_NOT_ALLOWED' using errcode='42501';end if;
 if v_status='cancelled' then return true;end if;
 update public.agenda_appointments
 set status='cancelled',cancelled_at=clock_timestamp()
 where id=p_appointment_id;
 return true;
end $$;
revoke all on function public.agenda_cancel_booking(uuid) from public,anon,authenticated;
grant execute on function public.agenda_cancel_booking(uuid) to authenticated;
commit;
