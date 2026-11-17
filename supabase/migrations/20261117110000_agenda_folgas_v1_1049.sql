-- TAMÃO Agenda V1.1049: folgas integrais, sem pagamentos e sem impacto nas demais rotas.
-- Days cannot be closed with confirmed appointments. Booking RPC and day off RPC
-- share the page/day advisory lock. A trigger rejects stale bookings atomically.
begin;

create table public.agenda_closed_days (
 page_id uuid not null references public.agenda_pages(id) on delete cascade,
 owner_id uuid not null references auth.users(id),
 day date not null,
 created_at timestamptz not null default now(),
 primary key(page_id,day)
);
create index agenda_closed_days_owner_idx on public.agenda_closed_days(owner_id,day);
alter table public.agenda_closed_days enable row level security;
revoke all on public.agenda_closed_days from public,anon,authenticated;
create policy agenda_closed_days_owner_select on public.agenda_closed_days
 for select to authenticated using(owner_id=(select auth.uid()));
grant select on public.agenda_closed_days to authenticated;

create function public.agenda_set_closed_day(p_day date,p_closed boolean)
returns boolean language plpgsql security definer set search_path='pg_catalog'
as $$
declare v_owner uuid:=(select auth.uid());v_page uuid;
 v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if v_owner is null or not public.discovery_verified_account()
 then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 select id into v_page from public.agenda_pages
 where owner_id=v_owner for update;
 if v_page is null then raise exception 'AGENDA_OWNER_REQUIRED' using errcode='42501';end if;
 if p_day is null or p_closed is null or p_day<v_today or p_day>v_today+180
 then raise exception 'AGENDA_DAY_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext(v_page::text||':'||p_day::text));
 if p_closed then
  if exists(select 1 from public.agenda_appointments a
    where a.page_id=v_page and a.status='confirmed'
      and (a.starts_at at time zone 'America/Sao_Paulo')::date=p_day)
  then raise exception 'AGENDA_DAY_HAS_BOOKINGS' using errcode='22023';end if;
  insert into public.agenda_closed_days(page_id,owner_id,day)
  values(v_page,v_owner,p_day) on conflict(page_id,day) do nothing;
 else
  delete from public.agenda_closed_days
  where page_id=v_page and owner_id=v_owner and day=p_day;
 end if;
 return true;
end $$;
revoke all on function public.agenda_set_closed_day(date,boolean) from public,anon,authenticated;
grant execute on function public.agenda_set_closed_day(date,boolean) to authenticated;

-- Public response reveals only an availability yes/no for a published service,
-- never the professional's private time-off records.
create function public.agenda_day_is_closed(p_service_id uuid,p_day date)
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select exists(
  select 1 from public.agenda_services s
  join public.agenda_pages p on p.id=s.page_id and p.published
  join public.agenda_closed_days d on d.page_id=p.id and d.day=p_day
  where s.id=p_service_id and s.active
 )
$$;
revoke all on function public.agenda_day_is_closed(uuid,date) from public,anon,authenticated;
grant execute on function public.agenda_day_is_closed(uuid,date) to anon,authenticated;

-- Booking on a closed day is blocked inside Postgres, not just filtered in UI.
-- The existing booking RPC has already acquired the same page/day lock.
create function public.agenda_closed_day_booking_guard()
returns trigger language plpgsql security definer set search_path='pg_catalog'
as $$
begin
 if new.status='confirmed' and exists(
  select 1 from public.agenda_closed_days
  where page_id=new.page_id
    and day=(new.starts_at at time zone 'America/Sao_Paulo')::date
 )
 then raise exception 'AGENDA_DAY_CLOSED' using errcode='22023';end if;
 return new;
end $$;
revoke all on function public.agenda_closed_day_booking_guard() from public,anon,authenticated;
create trigger agenda_bookings_closed_day_guard
 before insert or update of starts_at,status on public.agenda_appointments
 for each row execute function public.agenda_closed_day_booking_guard();

commit;
