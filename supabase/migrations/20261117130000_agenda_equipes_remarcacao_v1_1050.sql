-- TAMÃO V1.1050 — equipe opcional, slots por colaborador e remarcação atômica.
-- No Pix, OAuth tokens, payouts, commerce switches or real reminders.
begin;

create table public.agenda_staff (
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references public.agenda_pages(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id),
 name text not null check(length(btrim(name)) between 2 and 70),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(page_id,id)
);
create index agenda_staff_page_idx on public.agenda_staff(page_id,active);
alter table public.agenda_staff enable row level security;
revoke all on public.agenda_staff from public,anon,authenticated;
create policy agenda_staff_owner_select on public.agenda_staff
 for select to authenticated using(owner_id=(select auth.uid()));
create policy agenda_staff_owner_insert on public.agenda_staff
 for insert to authenticated with check(owner_id=(select auth.uid()) and
  public.discovery_verified_account() and exists(
   select 1 from public.agenda_pages p where p.id=page_id and p.owner_id=(select auth.uid())));
create policy agenda_staff_owner_update on public.agenda_staff
 for update to authenticated using(owner_id=(select auth.uid()))
 with check(owner_id=(select auth.uid()) and public.discovery_verified_account() and
  exists(select 1 from public.agenda_pages p where p.id=page_id and p.owner_id=(select auth.uid())));
grant select on public.agenda_staff to authenticated;
grant insert(page_id,name,active) on public.agenda_staff to authenticated;
grant update(name,active) on public.agenda_staff to authenticated;

alter table public.agenda_appointments
 add column staff_id uuid references public.agenda_staff(id),
 add column reschedule_count integer not null default 0
 check(reschedule_count between 0 and 20);
create index agenda_appointments_staff_idx on public.agenda_appointments(staff_id,starts_at)
 where status='confirmed';

create function public.agenda_staff_write_guard()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if new.owner_id is distinct from auth.uid() or not public.discovery_verified_account() or
  not exists(select 1 from public.agenda_pages p where p.id=new.page_id and p.owner_id=new.owner_id)
 then raise exception 'AGENDA_STAFF_OWNER_REQUIRED' using errcode='42501';end if;
 if tg_op='INSERT' then
  perform 1 from public.agenda_pages where id=new.page_id for update;
  if (select count(*) from public.agenda_staff where page_id=new.page_id)>=12
  then raise exception 'AGENDA_STAFF_LIMIT' using errcode='22023';end if;
 elsif new.page_id is distinct from old.page_id or new.owner_id is distinct from old.owner_id then
  raise exception 'AGENDA_STAFF_OWNER_FIXED' using errcode='42501';
 end if;
 if not new.active and (tg_op='INSERT' or old.active) and exists(
  select 1 from public.agenda_appointments a
  where a.staff_id=new.id and a.status='confirmed' and a.ends_at>now()
 ) then raise exception 'AGENDA_STAFF_HAS_BOOKINGS' using errcode='22023';end if;
 return new;
end $$;
revoke all on function public.agenda_staff_write_guard() from public,anon,authenticated;
create trigger agenda_staff_write_guard_trg before insert or update
 on public.agenda_staff for each row execute function public.agenda_staff_write_guard();

-- Legacy single-seat bookings must not bypass the new team selection.
-- Old bookings (staff_id IS NULL) block every collaborator's overlapping slot.
create function public.agenda_booking_staff_guard()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if new.status='confirmed' then
  if exists(select 1 from public.agenda_staff t where t.page_id=new.page_id and t.active)
     and new.staff_id is null
  then raise exception 'AGENDA_STAFF_SELECTION_REQUIRED' using errcode='22023';end if;
  if new.staff_id is not null and not exists(
    select 1 from public.agenda_staff t
    where t.id=new.staff_id and t.page_id=new.page_id and t.active)
  then raise exception 'AGENDA_STAFF_UNAVAILABLE' using errcode='22023';end if;
 end if;
 return new;
end $$;
revoke all on function public.agenda_booking_staff_guard() from public,anon,authenticated;
create trigger agenda_booking_staff_guard_trg before insert or update of staff_id,status
 on public.agenda_appointments for each row execute function public.agenda_booking_staff_guard();

-- Allowlist only public presentation fields; staff logins, user IDs and contacts stay private.
create or replace function public.agenda_public_page(p_slug text)
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
  ),'[]'::jsonb),
  'staff',coalesce((
   select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.created_at,t.id)
   from public.agenda_staff t where t.page_id=p.id and t.active
  ),'[]'::jsonb)
 ) from public.agenda_pages p where p.slug=p_slug and p.published
$$;
revoke all on function public.agenda_public_page(text) from public,anon,authenticated;
grant execute on function public.agenda_public_page(text) to anon,authenticated;

create function public.agenda_available_staff_slots(
 p_service_id uuid,p_day date,p_staff_id uuid
) returns table(starts_at timestamptz,label text)
language plpgsql stable security definer set search_path='pg_catalog' as $$
declare v_page uuid;v_duration integer;v_open integer;v_close integer;
begin
 if p_day is null or p_day<((now() at time zone 'America/Sao_Paulo')::date)
    or p_day>((now() at time zone 'America/Sao_Paulo')::date+30) then return;end if;
 select p.id,s.duration_min,h.opens_min,h.closes_min
 into v_page,v_duration,v_open,v_close
 from public.agenda_services s
 join public.agenda_pages p on p.id=s.page_id and p.published
 join public.agenda_hours h on h.page_id=p.id and h.weekday=extract(dow from p_day)::int
 where s.id=p_service_id and s.active;
 if not found then return;end if;
 if p_staff_id is null and exists(select 1 from public.agenda_staff where page_id=v_page and active)
 then return;end if;
 if p_staff_id is not null and not exists(
  select 1 from public.agenda_staff where id=p_staff_id and page_id=v_page and active
 ) then return;end if;
 if exists(select 1 from public.agenda_closed_days where page_id=v_page and day=p_day)
 then return;end if;
 return query select slot.t,to_char(slot.t at time zone 'America/Sao_Paulo','HH24:MI')
 from generate_series(
  (p_day::timestamp+make_interval(mins=>v_open)) at time zone 'America/Sao_Paulo',
  (p_day::timestamp+make_interval(mins=>v_close-v_duration)) at time zone 'America/Sao_Paulo',
  interval '30 minutes'
 ) slot(t)
 where slot.t>now()+interval '60 minutes'
  and not exists(select 1 from public.agenda_appointments a
   where a.page_id=v_page and a.status='confirmed'
    and (a.staff_id IS NULL or p_staff_id IS NULL or a.staff_id=p_staff_id)
    and a.starts_at<slot.t+make_interval(mins=>v_duration) and a.ends_at>slot.t)
 order by slot.t limit 36;
end $$;
revoke all on function public.agenda_available_staff_slots(uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.agenda_available_staff_slots(uuid,date,uuid) to anon,authenticated;

-- New bookings are authenticated, verified, idempotent and serialized by page/day.
create function public.agenda_book_staff_slot(
 p_service_id uuid,p_starts_at timestamptz,p_name text,p_phone text,
 p_request_id uuid,p_staff_id uuid
) returns jsonb language plpgsql security definer set search_path='pg_catalog' as $$
declare
 v_user uuid:=(select auth.uid());
 v_page public.agenda_pages%rowtype;
 v_service public.agenda_services%rowtype;
 v_hours public.agenda_hours%rowtype;
 v_local timestamp;v_day date;v_end timestamptz;
 v_existing public.agenda_appointments%rowtype;v_id uuid;
begin
 if v_user is null or not public.discovery_verified_account() or p_request_id is null
 then raise exception 'AGENDA_VERIFIED_LOGIN_REQUIRED' using errcode='42501';end if;
 if length(btrim(coalesce(p_name,''))) not between 2 and 90
 or (nullif(btrim(coalesce(p_phone,'')),'') is not null
  and p_phone !~ '^\+?[0-9 ()-]{8,25}$')
 then raise exception 'AGENDA_CONTACT_INVALID' using errcode='22023';end if;
 select * into v_existing from public.agenda_appointments
 where customer_id=v_user and request_id=p_request_id;
 if found then return jsonb_build_object('id',v_existing.id,'status',v_existing.status,
  'starts_at',v_existing.starts_at);end if;
 select * into v_service from public.agenda_services where id=p_service_id and active for share;
 if not found then raise exception 'AGENDA_SERVICE_UNAVAILABLE' using errcode='22023';end if;
 select * into v_page from public.agenda_pages where id=v_service.page_id and published for share;
 if not found or v_page.owner_id=v_user
 then raise exception 'AGENDA_PAGE_UNAVAILABLE' using errcode='22023';end if;
 v_local:=p_starts_at at time zone 'America/Sao_Paulo';v_day:=v_local::date;
 if p_starts_at<=now()+interval '60 minutes'
  or v_day>((now() at time zone 'America/Sao_Paulo')::date+30)
  or extract(minute from v_local)::integer%30<>0
  or extract(second from v_local)<>0
 then raise exception 'AGENDA_INVALID_TIME' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext(v_page.id::text||':'||v_day::text));
 select * into v_existing from public.agenda_appointments
 where customer_id=v_user and request_id=p_request_id;
 if found then return jsonb_build_object('id',v_existing.id,'status',v_existing.status,
  'starts_at',v_existing.starts_at);end if;
 if p_staff_id is null and exists(
  select 1 from public.agenda_staff where page_id=v_page.id and active)
 then raise exception 'AGENDA_STAFF_SELECTION_REQUIRED' using errcode='22023';end if;
 if p_staff_id is not null and not exists(
  select 1 from public.agenda_staff where id=p_staff_id and page_id=v_page.id and active)
 then raise exception 'AGENDA_STAFF_UNAVAILABLE' using errcode='22023';end if;
 select * into v_hours from public.agenda_hours
 where page_id=v_page.id and weekday=extract(dow from v_local)::int;
 if not found
 or extract(hour from v_local)::int*60+extract(minute from v_local)::int<v_hours.opens_min
 or extract(hour from v_local)::int*60+extract(minute from v_local)::int+
  v_service.duration_min>v_hours.closes_min
 then raise exception 'AGENDA_OUTSIDE_WORKING_HOURS' using errcode='22023';end if;
 if exists(select 1 from public.agenda_closed_days where page_id=v_page.id and day=v_day)
 then raise exception 'AGENDA_DAY_CLOSED' using errcode='22023';end if;
 v_end:=p_starts_at+make_interval(mins=>v_service.duration_min);
 if exists(select 1 from public.agenda_appointments a
  where a.page_id=v_page.id and a.status='confirmed'
   and (a.staff_id IS NULL or p_staff_id IS NULL or a.staff_id=p_staff_id)
   and a.starts_at<v_end and a.ends_at>p_starts_at)
 then raise exception 'AGENDA_SLOT_ALREADY_TAKEN' using errcode='23505';end if;
 if (select count(*) from public.agenda_appointments a
  where a.customer_id=v_user and a.status='confirmed' and a.starts_at>now())>=8
 then raise exception 'AGENDA_BOOKING_LIMIT' using errcode='22023';end if;
 insert into public.agenda_appointments(
  page_id,service_id,owner_id,customer_id,request_id,
  customer_name,customer_phone,starts_at,ends_at,staff_id
 ) values(v_page.id,v_service.id,v_page.owner_id,v_user,p_request_id,
  btrim(p_name),nullif(btrim(coalesce(p_phone,'')),''),p_starts_at,v_end,p_staff_id)
 returning id into v_id;
 return jsonb_build_object('id',v_id,'status','confirmed','starts_at',p_starts_at);
end $$;
revoke all on function public.agenda_book_staff_slot(uuid,timestamptz,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.agenda_book_staff_slot(uuid,timestamptz,text,text,uuid,uuid) to authenticated;

-- Fail-closed atomic change of date. Same booking ID, same service and same
-- assigned staff; no temporary duplicate, no change of the person receiving.
create function public.agenda_reschedule_booking(
 p_appointment_id uuid,p_expected_starts_at timestamptz,p_new_starts_at timestamptz
) returns jsonb language plpgsql security definer set search_path='pg_catalog' as $$
declare
 v_user uuid:=(select auth.uid());
 v_current public.agenda_appointments%rowtype;
 v_service public.agenda_services%rowtype;
 v_hours public.agenda_hours%rowtype;
 v_local timestamp;v_day date;v_end timestamptz;
 v_old_day date;v_old_key integer;v_new_key integer;
begin
 if v_user is null or not public.discovery_verified_account()
 then raise exception 'AGENDA_VERIFIED_LOGIN_REQUIRED' using errcode='42501';end if;
 select * into v_current from public.agenda_appointments
 where id=p_appointment_id and status='confirmed';
 if not found or v_user not in(v_current.owner_id,v_current.customer_id)
 then raise exception 'AGENDA_BOOKING_NOT_ALLOWED' using errcode='42501';end if;
 if v_current.starts_at=p_new_starts_at
 then return jsonb_build_object('id',v_current.id,'status','confirmed',
   'starts_at',v_current.starts_at);end if;
 if v_current.starts_at is distinct from p_expected_starts_at
 then raise exception 'AGENDA_BOOKING_CHANGED' using errcode='22023';end if;
 v_local:=p_new_starts_at at time zone 'America/Sao_Paulo';
 v_day:=v_local::date;v_old_day:=(v_current.starts_at at time zone 'America/Sao_Paulo')::date;
 if v_current.starts_at<=now()+interval '60 minutes'
  or p_new_starts_at<=now()+interval '60 minutes'
  or v_day>((now() at time zone 'America/Sao_Paulo')::date+30)
  or extract(minute from v_local)::integer%30<>0 or extract(second from v_local)<>0
 then raise exception 'AGENDA_INVALID_TIME' using errcode='22023';end if;
 v_old_key:=hashtext(v_current.page_id::text||':'||v_old_day::text);
 v_new_key:=hashtext(v_current.page_id::text||':'||v_day::text);
 if v_old_key<=v_new_key then
  perform pg_advisory_xact_lock(v_old_key);if v_old_key<>v_new_key then perform pg_advisory_xact_lock(v_new_key);end if;
 else
  perform pg_advisory_xact_lock(v_new_key);perform pg_advisory_xact_lock(v_old_key);
 end if;
 select * into v_current from public.agenda_appointments
 where id=p_appointment_id for update;
 if not found or v_current.status<>'confirmed'
  or v_user not in(v_current.owner_id,v_current.customer_id)
 then raise exception 'AGENDA_BOOKING_NOT_ALLOWED' using errcode='42501';end if;
 if v_current.starts_at=p_new_starts_at
 then return jsonb_build_object('id',v_current.id,'status','confirmed',
  'starts_at',v_current.starts_at);end if;
 if v_current.starts_at is distinct from p_expected_starts_at
 then raise exception 'AGENDA_BOOKING_CHANGED' using errcode='22023';end if;
 if v_current.reschedule_count>=(case when v_current.customer_id=v_user then 2 else 20 end)
 then raise exception 'AGENDA_RESCHEDULE_LIMIT' using errcode='22023';end if;
 if not exists(select 1 from public.agenda_pages where id=v_current.page_id and published)
 then raise exception 'AGENDA_PAGE_UNAVAILABLE' using errcode='22023';end if;
 select * into v_service from public.agenda_services where id=v_current.service_id and active for share;
 if not found then raise exception 'AGENDA_SERVICE_UNAVAILABLE' using errcode='22023';end if;
 if v_current.staff_id is null and exists(
  select 1 from public.agenda_staff where page_id=v_current.page_id and active)
 then raise exception 'AGENDA_STAFF_SELECTION_REQUIRED' using errcode='22023';end if;
 if v_current.staff_id is not null and not exists(
  select 1 from public.agenda_staff where id=v_current.staff_id and page_id=v_current.page_id and active)
 then raise exception 'AGENDA_STAFF_UNAVAILABLE' using errcode='22023';end if;
 select * into v_hours from public.agenda_hours
 where page_id=v_current.page_id and weekday=extract(dow from v_local)::int;
 if not found or extract(hour from v_local)::int*60+extract(minute from v_local)::int<v_hours.opens_min
  or extract(hour from v_local)::int*60+extract(minute from v_local)::int+
    v_service.duration_min>v_hours.closes_min
 then raise exception 'AGENDA_OUTSIDE_WORKING_HOURS' using errcode='22023';end if;
 if exists(select 1 from public.agenda_closed_days where page_id=v_current.page_id and day=v_day)
 then raise exception 'AGENDA_DAY_CLOSED' using errcode='22023';end if;
 v_end:=p_new_starts_at+make_interval(mins=>v_service.duration_min);
 if exists(select 1 from public.agenda_appointments a
  where a.page_id=v_current.page_id and a.status='confirmed'
    and a.id<>v_current.id
    and (a.staff_id IS NULL or v_current.staff_id IS NULL or a.staff_id=v_current.staff_id)
    and a.starts_at<v_end and a.ends_at>p_new_starts_at)
 then raise exception 'AGENDA_SLOT_ALREADY_TAKEN' using errcode='23505';end if;
 update public.agenda_appointments
 set starts_at=p_new_starts_at,ends_at=v_end,reschedule_count=reschedule_count+1
 where id=v_current.id;
 return jsonb_build_object('id',v_current.id,'status','confirmed','starts_at',p_new_starts_at);
end $$;
revoke all on function public.agenda_reschedule_booking(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.agenda_reschedule_booking(uuid,timestamptz,timestamptz) to authenticated;

-- Existing function has a stable RPC signature; change response fields safely.
drop function public.agenda_my_bookings();
create function public.agenda_my_bookings()
returns table(
 id uuid,starts_at timestamptz,ends_at timestamptz,status text,
 page_id uuid,service_id uuid,page_title text,service_title text,slug text,
 staff_id uuid,staff_title text,reschedule_count integer
) language sql stable security definer set search_path='pg_catalog'
as $$
 select a.id,a.starts_at,a.ends_at,a.status,a.page_id,a.service_id,
  p.title,s.title,p.slug,a.staff_id,t.name,a.reschedule_count
 from public.agenda_appointments a
 join public.agenda_pages p on p.id=a.page_id
 join public.agenda_services s on s.id=a.service_id and s.page_id=a.page_id
 left join public.agenda_staff t on t.id=a.staff_id and t.page_id=a.page_id
 where a.customer_id=auth.uid() and a.status='confirmed' and a.starts_at>=now()
 order by a.starts_at limit 50
$$;
revoke all on function public.agenda_my_bookings() from public,anon,authenticated;
grant execute on function public.agenda_my_bookings() to authenticated;

commit;
