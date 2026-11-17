-- TAMÃO Agenda V1.1051 — pausas pontuais, fila consentida e presença.
-- Nenhum pagamento, webhook, alteração de comércio ou envio automático.
begin;

create table public.agenda_staff_blocks(
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references public.agenda_pages(id) on delete cascade,
 owner_id uuid not null references auth.users(id),
 staff_id uuid references public.agenda_staff(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 created_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '12 hours')
);
create index agenda_staff_blocks_page_idx on public.agenda_staff_blocks(page_id,starts_at,ends_at);
alter table public.agenda_staff_blocks enable row level security;
revoke all on public.agenda_staff_blocks from public,anon,authenticated;
create policy agenda_staff_blocks_owner_read on public.agenda_staff_blocks
 for select to authenticated using(owner_id=(select auth.uid()));
grant select on public.agenda_staff_blocks to authenticated;

create table public.agenda_waitlist(
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references public.agenda_pages(id) on delete cascade,
 service_id uuid not null references public.agenda_services(id),
 staff_id uuid references public.agenda_staff(id),
 owner_id uuid not null references auth.users(id),
 customer_id uuid not null references auth.users(id),
 day date not null,
 customer_name text check(customer_name is null or length(btrim(customer_name)) between 2 and 90),
 customer_phone text check(customer_phone is null or customer_phone ~ '^\+?[0-9 ()-]{8,25}
 status text not null default 'waiting' check(status in ('waiting','withdrawn','contacted')),
 constraint agenda_waitlist_active_contact check(status<>'waiting' or (customer_name is not null and customer_phone is not null)),
 created_at timestamptz not null default now(),
 closed_at timestamptz
);
create unique index agenda_waitlist_unique_active on public.agenda_waitlist(
 customer_id,service_id,coalesce(staff_id,'00000000-0000-0000-0000-000000000000'::uuid),day)
 where status='waiting';
create index agenda_waitlist_owner_idx on public.agenda_waitlist(owner_id,day,created_at)
 where status='waiting';
create index agenda_waitlist_customer_idx on public.agenda_waitlist(customer_id,day)
 where status='waiting';
alter table public.agenda_waitlist enable row level security;
revoke all on public.agenda_waitlist from public,anon,authenticated;
create policy agenda_waitlist_participants_read on public.agenda_waitlist
 for select to authenticated
 using(owner_id=(select auth.uid()) or customer_id=(select auth.uid()));
grant select on public.agenda_waitlist to authenticated;

create table public.agenda_booking_events(
 id bigint generated always as identity primary key,
 appointment_id uuid not null references public.agenda_appointments(id),
 actor_id uuid,
 event_kind text not null check(event_kind in('created','status_changed','rescheduled')),
 previous_status text,
 next_status text,
 old_start timestamptz,
 new_start timestamptz,
 occurred_at timestamptz not null default now()
);
create index agenda_booking_events_book_idx on public.agenda_booking_events(appointment_id,occurred_at);
alter table public.agenda_booking_events enable row level security;
revoke all on public.agenda_booking_events from public,anon,authenticated;

-- Customer/owner can subscribe only with an authenticated, verified identity.
-- This does not promise automatic messages or reserve a slot.
create function public.agenda_join_waitlist(
 p_service_id uuid,p_staff_id uuid,p_day date,p_name text,p_phone text,p_consent boolean
) returns uuid language plpgsql security definer set search_path='pg_catalog' as $$
declare
 v_user uuid:=(select auth.uid());v_page uuid;v_owner uuid;v_id uuid;
 v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if v_user is null or not public.discovery_verified_account() or p_consent is distinct from true
 then raise exception 'AGENDA_LOGIN_REQUIRED' using errcode='42501';end if;
 if p_day is null or p_day<v_today or p_day>v_today+30
   or length(btrim(coalesce(p_name,''))) not between 2 and 90
   or coalesce(p_phone,'') !~ '^\+?[0-9 ()-]{8,25}$'
 then raise exception 'AGENDA_WAITLIST_INVALID' using errcode='22023';end if;
 select p.id,p.owner_id into v_page,v_owner
 from public.agenda_services s join public.agenda_pages p on p.id=s.page_id
 where s.id=p_service_id and s.active and p.published;
 if v_page is null or v_owner=v_user
 then raise exception 'AGENDA_SERVICE_UNAVAILABLE' using errcode='22023';end if;
 if p_staff_id is null and exists(select 1 from public.agenda_staff t
  where t.page_id=v_page and t.active)
 then raise exception 'AGENDA_STAFF_SELECTION_REQUIRED' using errcode='22023';end if;
 if p_staff_id is not null and not exists(select 1 from public.agenda_staff t
  where t.id=p_staff_id and t.page_id=v_page and t.active)
 then raise exception 'AGENDA_STAFF_UNAVAILABLE' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext(v_page::text||':'||p_day::text));
 select id into v_id from public.agenda_waitlist
 where customer_id=v_user and service_id=p_service_id
  and staff_id is not distinct from p_staff_id and day=p_day and status='waiting';
 if v_id is not null then return v_id;end if;
 if (select count(*) from public.agenda_waitlist
   where customer_id=v_user and status='waiting' and day>=v_today)>=5
 then raise exception 'AGENDA_WAITLIST_LIMIT' using errcode='22023';end if;
 if (select count(*) from public.agenda_waitlist
   where page_id=v_page and status='waiting' and day=p_day)>=50
 then raise exception 'AGENDA_WAITLIST_FULL' using errcode='22023';end if;
 insert into public.agenda_waitlist(
  page_id,owner_id,service_id,staff_id,customer_id,day,customer_name,customer_phone)
 values(v_page,v_owner,p_service_id,p_staff_id,v_user,p_day,btrim(p_name),btrim(p_phone))
 returning id into v_id;
 return v_id;
end $$;
revoke all on function public.agenda_join_waitlist(uuid,uuid,date,text,text,boolean) from public,anon,authenticated;
grant execute on function public.agenda_join_waitlist(uuid,uuid,date,text,text,boolean) to authenticated;

create function public.agenda_close_waitlist(p_wait_id uuid,p_contacted boolean)
returns boolean language plpgsql security definer set search_path='pg_catalog' as $$
declare v_user uuid:=(select auth.uid());v_owner uuid;v_customer uuid;v_status text;
begin
 if v_user is null or p_wait_id is null or p_contacted is null
 then raise exception 'AGENDA_LOGIN_REQUIRED' using errcode='42501';end if;
 select owner_id,customer_id,status into v_owner,v_customer,v_status
 from public.agenda_waitlist where id=p_wait_id for update;
 if not found or (p_contacted and v_user<>v_owner) or
 (not p_contacted and v_user not in(v_customer,v_owner))
 then raise exception 'AGENDA_WAITLIST_NOT_ALLOWED' using errcode='42501';end if;
 if v_status<>'waiting' then return true;end if;
 update public.agenda_waitlist
 set status=case when p_contacted then 'contacted' else 'withdrawn' end,
 closed_at=now(),customer_name=null,customer_phone=null where id=p_wait_id;
 return true;
end $$;
revoke all on function public.agenda_close_waitlist(uuid,boolean) from public,anon,authenticated;
grant execute on function public.agenda_close_waitlist(uuid,boolean) to authenticated;

-- Owner blocks either the whole shop (NULL) or exactly one collaborator.
-- Same lock as booking and remarcação (page + São Paulo local day).
create function public.agenda_add_staff_block(
 p_staff_id uuid,p_start timestamptz,p_end timestamptz
) returns uuid language plpgsql security definer set search_path='pg_catalog' as $$
declare
 v_owner uuid:=(select auth.uid());v_page uuid;v_id uuid;v_day date;
 v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if v_owner is null or not public.discovery_verified_account()
 then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 select id into v_page from public.agenda_pages where owner_id=v_owner;
 if v_page is null then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<=p_start
   or p_end>p_start+interval '12 hours'
   or (p_start at time zone 'America/Sao_Paulo')::date
    <>( (p_end-interval '1 microsecond') at time zone 'America/Sao_Paulo')::date
 then raise exception 'AGENDA_BLOCK_INVALID' using errcode='22023';end if;
 v_day:=(p_start at time zone 'America/Sao_Paulo')::date;
 if p_start<=now() or v_day>v_today+180
 then raise exception 'AGENDA_BLOCK_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext(v_page::text||':'||v_day::text));
 if p_staff_id is not null and not exists(
  select 1 from public.agenda_staff t where t.id=p_staff_id and t.page_id=v_page and t.active)
 then raise exception 'AGENDA_STAFF_UNAVAILABLE' using errcode='22023';end if;
 if exists(select 1 from public.agenda_appointments a
  where a.page_id=v_page and a.status='confirmed'
   and (p_staff_id is null or a.staff_id is null or a.staff_id=p_staff_id)
   and a.starts_at<p_end and a.ends_at>p_start)
 then raise exception 'AGENDA_BLOCK_HAS_BOOKINGS' using errcode='22023';end if;
 if exists(select 1 from public.agenda_staff_blocks b
  where b.page_id=v_page and b.staff_id is not distinct from p_staff_id
    and b.starts_at<=p_start and b.ends_at>=p_end)
 then
  return (select b.id from public.agenda_staff_blocks b
    where b.page_id=v_page and b.staff_id is not distinct from p_staff_id
     and b.starts_at<=p_start and b.ends_at>=p_end
    order by b.created_at limit 1);
 end if;
 insert into public.agenda_staff_blocks(page_id,owner_id,staff_id,starts_at,ends_at)
 values(v_page,v_owner,p_staff_id,p_start,p_end) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.agenda_add_staff_block(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.agenda_add_staff_block(uuid,timestamptz,timestamptz) to authenticated;

create function public.agenda_remove_staff_block(p_id uuid)
returns boolean language plpgsql security definer set search_path='pg_catalog' as $$
declare v_owner uuid:=(select auth.uid());v_block public.agenda_staff_blocks%rowtype;
begin
 if v_owner is null or p_id is null then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 select * into v_block from public.agenda_staff_blocks
 where id=p_id and owner_id=v_owner;
 if not found then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext(v_block.page_id::text||':'||
  (v_block.starts_at at time zone 'America/Sao_Paulo')::date::text));
 delete from public.agenda_staff_blocks where id=p_id and owner_id=v_owner;
 return true;
end $$;
revoke all on function public.agenda_remove_staff_block(uuid) from public,anon,authenticated;
grant execute on function public.agenda_remove_staff_block(uuid) to authenticated;

create function public.agenda_staff_block_booking_guard()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if new.status='confirmed' and exists(
   select 1 from public.agenda_staff_blocks b
   where b.page_id=new.page_id
     and (b.staff_id is null or new.staff_id is null or b.staff_id=new.staff_id)
     and b.starts_at<new.ends_at and b.ends_at>new.starts_at
 ) then raise exception 'AGENDA_STAFF_BLOCKED' using errcode='22023';end if;
 return new;
end $$;
revoke all on function public.agenda_staff_block_booking_guard() from public,anon,authenticated;
create trigger agenda_staff_block_booking_guard_trg
 before insert or update of starts_at,ends_at,staff_id,status
 on public.agenda_appointments for each row execute function public.agenda_staff_block_booking_guard();

-- Status final do atendimento: registrado somente pelo titular e após a hora.
alter table public.agenda_appointments drop constraint agenda_appointments_status_check;
alter table public.agenda_appointments add constraint agenda_appointments_status_check
 check(status in ('confirmed','cancelled','completed','no_show'));

create function public.agenda_mark_attendance(p_appointment_id uuid,p_result text)
returns boolean language plpgsql security definer set search_path='pg_catalog' as $$
declare v_owner uuid:=(select auth.uid());v_row public.agenda_appointments%rowtype;
begin
 if v_owner is null or not public.discovery_verified_account() or
  p_result is null or p_result not in('completed','no_show')
 then raise exception 'AGENDA_ATTENDANCE_NOT_ALLOWED' using errcode='42501';end if;
 select * into v_row from public.agenda_appointments where id=p_appointment_id for update;
 if not found or v_row.owner_id<>v_owner
 then raise exception 'AGENDA_ATTENDANCE_NOT_ALLOWED' using errcode='42501';end if;
 if v_row.status=p_result then return true;end if;
 if v_row.status<>'confirmed' or v_row.ends_at>now() or
   v_row.ends_at<now()-interval '90 days'
 then raise exception 'AGENDA_ATTENDANCE_INVALID' using errcode='22023';end if;
 update public.agenda_appointments set status=p_result where id=p_appointment_id;
 return true;
end $$;
revoke all on function public.agenda_mark_attendance(uuid,text) from public,anon,authenticated;
grant execute on function public.agenda_mark_attendance(uuid,text) to authenticated;

create or replace function public.agenda_cancel_booking(p_appointment_id uuid)
returns boolean language plpgsql security definer set search_path='pg_catalog' as $$
declare v_owner uuid;v_customer uuid;v_status text;v_end timestamptz;
 v_user uuid:=(select auth.uid());
begin
 if v_user is null then raise exception 'LOGIN_REQUIRED' using errcode='42501';end if;
 select owner_id,customer_id,status,ends_at into v_owner,v_customer,v_status,v_end
 from public.agenda_appointments where id=p_appointment_id for update;
 if not found or v_user not in(v_owner,v_customer)
 then raise exception 'AGENDA_NOT_ALLOWED' using errcode='42501';end if;
 if v_status='cancelled' then return true;end if;
 if v_status<>'confirmed' or v_end<=now()
 then raise exception 'AGENDA_CANCEL_FINALIZED' using errcode='22023';end if;
 update public.agenda_appointments
 set status='cancelled',cancelled_at=clock_timestamp()
 where id=p_appointment_id;
 return true;
end $$;
revoke all on function public.agenda_cancel_booking(uuid) from public,anon,authenticated;
grant execute on function public.agenda_cancel_booking(uuid) to authenticated;

create function public.agenda_booking_audit_trigger()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if tg_op='INSERT' then
  insert into public.agenda_booking_events(
   appointment_id,actor_id,event_kind,next_status,new_start)
  values(new.id,auth.uid(),'created',new.status,new.starts_at);
 elsif new.status is distinct from old.status then
  insert into public.agenda_booking_events(
   appointment_id,actor_id,event_kind,previous_status,next_status,old_start,new_start)
  values(new.id,auth.uid(),'status_changed',old.status,new.status,old.starts_at,new.starts_at);
 elsif new.starts_at is distinct from old.starts_at then
  insert into public.agenda_booking_events(
   appointment_id,actor_id,event_kind,previous_status,next_status,old_start,new_start)
  values(new.id,auth.uid(),'rescheduled',old.status,new.status,old.starts_at,new.starts_at);
 end if;
 return null;
end $$;
revoke all on function public.agenda_booking_audit_trigger() from public,anon,authenticated;
create trigger agenda_booking_audit_trg
 after insert or update on public.agenda_appointments
 for each row execute function public.agenda_booking_audit_trigger();

-- UI must see the same truth as inserts: do not offer a blocked hour.
create or replace function public.agenda_available_staff_slots(
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
  and not exists(select 1 from public.agenda_staff_blocks b
   where b.page_id=v_page
     and (b.staff_id is null or p_staff_id is null or b.staff_id=p_staff_id)
     and b.starts_at<slot.t+make_interval(mins=>v_duration) and b.ends_at>slot.t)
 order by slot.t limit 36;
end $$;
revoke all on function public.agenda_available_staff_slots(uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.agenda_available_staff_slots(uuid,date,uuid) to anon,authenticated;

-- Legacy endpoint still cannot advertise slots that new UI will refuse.
create or replace function public.agenda_available_slots(p_service_id uuid,p_day date)
returns table(starts_at timestamptz,label text)
language sql stable security definer set search_path='pg_catalog' as $$
 select q.starts_at,q.label from public.agenda_available_staff_slots(p_service_id,p_day,null) q
$$;
revoke all on function public.agenda_available_slots(uuid,date) from public,anon,authenticated;
grant execute on function public.agenda_available_slots(uuid,date) to anon,authenticated;
commit;
),
 consented_at timestamptz not null default now(),
 consent_version integer not null default 1 check(consent_version=1),
 status text not null default 'waiting' check(status in ('waiting','withdrawn','contacted')),
 constraint agenda_waitlist_active_contact check(status<>'waiting' or (customer_name is not null and customer_phone is not null)),
 created_at timestamptz not null default now(),
 closed_at timestamptz
);
create unique index agenda_waitlist_unique_active on public.agenda_waitlist(
 customer_id,service_id,coalesce(staff_id,'00000000-0000-0000-0000-000000000000'::uuid),day)
 where status='waiting';
create index agenda_waitlist_owner_idx on public.agenda_waitlist(owner_id,day,created_at)
 where status='waiting';
create index agenda_waitlist_customer_idx on public.agenda_waitlist(customer_id,day)
 where status='waiting';
alter table public.agenda_waitlist enable row level security;
revoke all on public.agenda_waitlist from public,anon,authenticated;
create policy agenda_waitlist_participants_read on public.agenda_waitlist
 for select to authenticated
 using(owner_id=(select auth.uid()) or customer_id=(select auth.uid()));
grant select on public.agenda_waitlist to authenticated;

create table public.agenda_booking_events(
 id bigint generated always as identity primary key,
 appointment_id uuid not null references public.agenda_appointments(id),
 actor_id uuid,
 event_kind text not null check(event_kind in('created','status_changed','rescheduled')),
 previous_status text,
 next_status text,
 old_start timestamptz,
 new_start timestamptz,
 occurred_at timestamptz not null default now()
);
create index agenda_booking_events_book_idx on public.agenda_booking_events(appointment_id,occurred_at);
alter table public.agenda_booking_events enable row level security;
revoke all on public.agenda_booking_events from public,anon,authenticated;

-- Customer/owner can subscribe only with an authenticated, verified identity.
-- This does not promise automatic messages or reserve a slot.
create function public.agenda_join_waitlist(
 p_service_id uuid,p_staff_id uuid,p_day date,p_name text,p_phone text,p_consent boolean
) returns uuid language plpgsql security definer set search_path='pg_catalog' as $$
declare
 v_user uuid:=(select auth.uid());v_page uuid;v_owner uuid;v_id uuid;
 v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if v_user is null or not public.discovery_verified_account() or p_consent is distinct from true
 then raise exception 'AGENDA_LOGIN_REQUIRED' using errcode='42501';end if;
 if p_day is null or p_day<v_today or p_day>v_today+30
   or length(btrim(coalesce(p_name,''))) not between 2 and 90
   or coalesce(p_phone,'') !~ '^\+?[0-9 ()-]{8,25}$'
 then raise exception 'AGENDA_WAITLIST_INVALID' using errcode='22023';end if;
 select p.id,p.owner_id into v_page,v_owner
 from public.agenda_services s join public.agenda_pages p on p.id=s.page_id
 where s.id=p_service_id and s.active and p.published;
 if v_page is null or v_owner=v_user
 then raise exception 'AGENDA_SERVICE_UNAVAILABLE' using errcode='22023';end if;
 if p_staff_id is null and exists(select 1 from public.agenda_staff t
  where t.page_id=v_page and t.active)
 then raise exception 'AGENDA_STAFF_SELECTION_REQUIRED' using errcode='22023';end if;
 if p_staff_id is not null and not exists(select 1 from public.agenda_staff t
  where t.id=p_staff_id and t.page_id=v_page and t.active)
 then raise exception 'AGENDA_STAFF_UNAVAILABLE' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext(v_page::text||':'||p_day::text));
 select id into v_id from public.agenda_waitlist
 where customer_id=v_user and service_id=p_service_id
  and staff_id is not distinct from p_staff_id and day=p_day and status='waiting';
 if v_id is not null then return v_id;end if;
 if (select count(*) from public.agenda_waitlist
   where customer_id=v_user and status='waiting' and day>=v_today)>=5
 then raise exception 'AGENDA_WAITLIST_LIMIT' using errcode='22023';end if;
 if (select count(*) from public.agenda_waitlist
   where page_id=v_page and status='waiting' and day=p_day)>=50
 then raise exception 'AGENDA_WAITLIST_FULL' using errcode='22023';end if;
 insert into public.agenda_waitlist(
  page_id,owner_id,service_id,staff_id,customer_id,day,customer_name,customer_phone)
 values(v_page,v_owner,p_service_id,p_staff_id,v_user,p_day,btrim(p_name),btrim(p_phone))
 returning id into v_id;
 return v_id;
end $$;
revoke all on function public.agenda_join_waitlist(uuid,uuid,date,text,text,boolean) from public,anon,authenticated;
grant execute on function public.agenda_join_waitlist(uuid,uuid,date,text,text,boolean) to authenticated;

create function public.agenda_close_waitlist(p_wait_id uuid,p_contacted boolean)
returns boolean language plpgsql security definer set search_path='pg_catalog' as $$
declare v_user uuid:=(select auth.uid());v_owner uuid;v_customer uuid;v_status text;
begin
 if v_user is null or p_wait_id is null or p_contacted is null
 then raise exception 'AGENDA_LOGIN_REQUIRED' using errcode='42501';end if;
 select owner_id,customer_id,status into v_owner,v_customer,v_status
 from public.agenda_waitlist where id=p_wait_id for update;
 if not found or (p_contacted and v_user<>v_owner) or
 (not p_contacted and v_user not in(v_customer,v_owner))
 then raise exception 'AGENDA_WAITLIST_NOT_ALLOWED' using errcode='42501';end if;
 if v_status<>'waiting' then return true;end if;
 update public.agenda_waitlist
 set status=case when p_contacted then 'contacted' else 'withdrawn' end,
 closed_at=now(),customer_name=null,customer_phone=null where id=p_wait_id;
 return true;
end $$;
revoke all on function public.agenda_close_waitlist(uuid,boolean) from public,anon,authenticated;
grant execute on function public.agenda_close_waitlist(uuid,boolean) to authenticated;

-- Owner blocks either the whole shop (NULL) or exactly one collaborator.
-- Same lock as booking and remarcação (page + São Paulo local day).
create function public.agenda_add_staff_block(
 p_staff_id uuid,p_start timestamptz,p_end timestamptz
) returns uuid language plpgsql security definer set search_path='pg_catalog' as $$
declare
 v_owner uuid:=(select auth.uid());v_page uuid;v_id uuid;v_day date;
 v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if v_owner is null or not public.discovery_verified_account()
 then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 select id into v_page from public.agenda_pages where owner_id=v_owner;
 if v_page is null then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<=p_start
   or p_end>p_start+interval '12 hours'
   or (p_start at time zone 'America/Sao_Paulo')::date
    <>( (p_end-interval '1 microsecond') at time zone 'America/Sao_Paulo')::date
 then raise exception 'AGENDA_BLOCK_INVALID' using errcode='22023';end if;
 v_day:=(p_start at time zone 'America/Sao_Paulo')::date;
 if p_start<=now() or v_day>v_today+180
 then raise exception 'AGENDA_BLOCK_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext(v_page::text||':'||v_day::text));
 if p_staff_id is not null and not exists(
  select 1 from public.agenda_staff t where t.id=p_staff_id and t.page_id=v_page and t.active)
 then raise exception 'AGENDA_STAFF_UNAVAILABLE' using errcode='22023';end if;
 if exists(select 1 from public.agenda_appointments a
  where a.page_id=v_page and a.status='confirmed'
   and (p_staff_id is null or a.staff_id is null or a.staff_id=p_staff_id)
   and a.starts_at<p_end and a.ends_at>p_start)
 then raise exception 'AGENDA_BLOCK_HAS_BOOKINGS' using errcode='22023';end if;
 if exists(select 1 from public.agenda_staff_blocks b
  where b.page_id=v_page and b.staff_id is not distinct from p_staff_id
    and b.starts_at<=p_start and b.ends_at>=p_end)
 then
  return (select b.id from public.agenda_staff_blocks b
    where b.page_id=v_page and b.staff_id is not distinct from p_staff_id
     and b.starts_at<=p_start and b.ends_at>=p_end
    order by b.created_at limit 1);
 end if;
 insert into public.agenda_staff_blocks(page_id,owner_id,staff_id,starts_at,ends_at)
 values(v_page,v_owner,p_staff_id,p_start,p_end) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.agenda_add_staff_block(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.agenda_add_staff_block(uuid,timestamptz,timestamptz) to authenticated;

create function public.agenda_remove_staff_block(p_id uuid)
returns boolean language plpgsql security definer set search_path='pg_catalog' as $$
declare v_owner uuid:=(select auth.uid());v_block public.agenda_staff_blocks%rowtype;
begin
 if v_owner is null or p_id is null then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 select * into v_block from public.agenda_staff_blocks
 where id=p_id and owner_id=v_owner;
 if not found then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext(v_block.page_id::text||':'||
  (v_block.starts_at at time zone 'America/Sao_Paulo')::date::text));
 delete from public.agenda_staff_blocks where id=p_id and owner_id=v_owner;
 return true;
end $$;
revoke all on function public.agenda_remove_staff_block(uuid) from public,anon,authenticated;
grant execute on function public.agenda_remove_staff_block(uuid) to authenticated;

create function public.agenda_staff_block_booking_guard()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if new.status='confirmed' and exists(
   select 1 from public.agenda_staff_blocks b
   where b.page_id=new.page_id
     and (b.staff_id is null or new.staff_id is null or b.staff_id=new.staff_id)
     and b.starts_at<new.ends_at and b.ends_at>new.starts_at
 ) then raise exception 'AGENDA_STAFF_BLOCKED' using errcode='22023';end if;
 return new;
end $$;
revoke all on function public.agenda_staff_block_booking_guard() from public,anon,authenticated;
create trigger agenda_staff_block_booking_guard_trg
 before insert or update of starts_at,ends_at,staff_id,status
 on public.agenda_appointments for each row execute function public.agenda_staff_block_booking_guard();

-- Status final do atendimento: registrado somente pelo titular e após a hora.
alter table public.agenda_appointments drop constraint agenda_appointments_status_check;
alter table public.agenda_appointments add constraint agenda_appointments_status_check
 check(status in ('confirmed','cancelled','completed','no_show'));

create function public.agenda_mark_attendance(p_appointment_id uuid,p_result text)
returns boolean language plpgsql security definer set search_path='pg_catalog' as $$
declare v_owner uuid:=(select auth.uid());v_row public.agenda_appointments%rowtype;
begin
 if v_owner is null or not public.discovery_verified_account() or
  p_result is null or p_result not in('completed','no_show')
 then raise exception 'AGENDA_ATTENDANCE_NOT_ALLOWED' using errcode='42501';end if;
 select * into v_row from public.agenda_appointments where id=p_appointment_id for update;
 if not found or v_row.owner_id<>v_owner
 then raise exception 'AGENDA_ATTENDANCE_NOT_ALLOWED' using errcode='42501';end if;
 if v_row.status=p_result then return true;end if;
 if v_row.status<>'confirmed' or v_row.ends_at>now() or
   v_row.ends_at<now()-interval '90 days'
 then raise exception 'AGENDA_ATTENDANCE_INVALID' using errcode='22023';end if;
 update public.agenda_appointments set status=p_result where id=p_appointment_id;
 return true;
end $$;
revoke all on function public.agenda_mark_attendance(uuid,text) from public,anon,authenticated;
grant execute on function public.agenda_mark_attendance(uuid,text) to authenticated;

create or replace function public.agenda_cancel_booking(p_appointment_id uuid)
returns boolean language plpgsql security definer set search_path='pg_catalog' as $$
declare v_owner uuid;v_customer uuid;v_status text;v_end timestamptz;
 v_user uuid:=(select auth.uid());
begin
 if v_user is null then raise exception 'LOGIN_REQUIRED' using errcode='42501';end if;
 select owner_id,customer_id,status,ends_at into v_owner,v_customer,v_status,v_end
 from public.agenda_appointments where id=p_appointment_id for update;
 if not found or v_user not in(v_owner,v_customer)
 then raise exception 'AGENDA_NOT_ALLOWED' using errcode='42501';end if;
 if v_status='cancelled' then return true;end if;
 if v_status<>'confirmed' or v_end<=now()
 then raise exception 'AGENDA_CANCEL_FINALIZED' using errcode='22023';end if;
 update public.agenda_appointments
 set status='cancelled',cancelled_at=clock_timestamp()
 where id=p_appointment_id;
 return true;
end $$;
revoke all on function public.agenda_cancel_booking(uuid) from public,anon,authenticated;
grant execute on function public.agenda_cancel_booking(uuid) to authenticated;

create function public.agenda_booking_audit_trigger()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if tg_op='INSERT' then
  insert into public.agenda_booking_events(
   appointment_id,actor_id,event_kind,next_status,new_start)
  values(new.id,auth.uid(),'created',new.status,new.starts_at);
 elsif new.status is distinct from old.status then
  insert into public.agenda_booking_events(
   appointment_id,actor_id,event_kind,previous_status,next_status,old_start,new_start)
  values(new.id,auth.uid(),'status_changed',old.status,new.status,old.starts_at,new.starts_at);
 elsif new.starts_at is distinct from old.starts_at then
  insert into public.agenda_booking_events(
   appointment_id,actor_id,event_kind,previous_status,next_status,old_start,new_start)
  values(new.id,auth.uid(),'rescheduled',old.status,new.status,old.starts_at,new.starts_at);
 end if;
 return null;
end $$;
revoke all on function public.agenda_booking_audit_trigger() from public,anon,authenticated;
create trigger agenda_booking_audit_trg
 after insert or update on public.agenda_appointments
 for each row execute function public.agenda_booking_audit_trigger();

-- UI must see the same truth as inserts: do not offer a blocked hour.
create or replace function public.agenda_available_staff_slots(
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
  and not exists(select 1 from public.agenda_staff_blocks b
   where b.page_id=v_page
     and (b.staff_id is null or p_staff_id is null or b.staff_id=p_staff_id)
     and b.starts_at<slot.t+make_interval(mins=>v_duration) and b.ends_at>slot.t)
 order by slot.t limit 36;
end $$;
revoke all on function public.agenda_available_staff_slots(uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.agenda_available_staff_slots(uuid,date,uuid) to anon,authenticated;

-- Legacy endpoint still cannot advertise slots that new UI will refuse.
create or replace function public.agenda_available_slots(p_service_id uuid,p_day date)
returns table(starts_at timestamptz,label text)
language sql stable security definer set search_path='pg_catalog' as $$
 select q.starts_at,q.label from public.agenda_available_staff_slots(p_service_id,p_day,null) q
$$;
revoke all on function public.agenda_available_slots(uuid,date) from public,anon,authenticated;
grant execute on function public.agenda_available_slots(uuid,date) to anon,authenticated;
commit;
