\set ON_ERROR_STOP on
-- Disposable Supabase only. Full rollback; no external accounts or PSP.
begin;
do $test$
declare
 v_owner uuid:=gen_random_uuid();
 v_buyer uuid:=gen_random_uuid();
 v_second uuid:=gen_random_uuid();
 v_page uuid;
 v_service uuid;
 v_day date:=((now() at time zone 'America/Sao_Paulo')::date+2);
 v_at timestamptz;
 v_request uuid:=gen_random_uuid();
 v_first jsonb;
 v_again jsonb;
 v_second_booking jsonb;
 v_staff uuid;v_staff2 uuid;v_team_start timestamptz;v_team_new timestamptz;
 v_booking jsonb;v_parallel jsonb;v_rescheduled jsonb;
begin
 if has_table_privilege('anon','public.agenda_pages','select')
    or has_table_privilege('anon','public.agenda_appointments','select')
    or has_table_privilege('authenticated','public.agenda_appointments','insert')
    or has_table_privilege('authenticated','public.agenda_appointments','update')
    or has_table_privilege('anon','public.agenda_closed_days','select')
    or has_table_privilege('authenticated','public.agenda_closed_days','insert')
 then raise exception 'AGENDA_PRIVATE_TABLE_EXPOSED';end if;
 if has_function_privilege('anon','public.agenda_book_slot(uuid,timestamptz,text,text,uuid)','execute')
    or has_function_privilege('anon','public.agenda_cancel_booking(uuid)','execute')
    or has_function_privilege('anon','public.agenda_replace_hours(uuid,jsonb)','execute')
    or has_function_privilege('anon','public.agenda_set_closed_day(date,boolean)','execute')
    or has_function_privilege('anon','public.agenda_my_bookings()','execute')
 then raise exception 'AGENDA_WRITE_RPC_EXPOSED';end if;
 if not has_function_privilege('anon','public.agenda_available_slots(uuid,date)','execute')
 then raise exception 'AGENDA_PUBLIC_SLOTS_NOT_AVAILABLE';end if;

 insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
 values
  (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','agenda-owner-ci@example.org',now(),false,now(),now()),
  (v_buyer,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','agenda-buyer-ci@example.org',now(),false,now(),now()),
  (v_second,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','agenda-second-ci@example.org',now(),false,now(),now());
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 if not public.discovery_verified_account() then raise exception 'TEST_OWNER_UNVERIFIED';end if;
 insert into public.agenda_pages(owner_id,slug,title,about,city,published)
 values(v_owner,'barbearia-integracao-ci','Barbearia verificada CI',
  'Agenda descartável de integração','São Gabriel',true)
 returning id into v_page;
 insert into public.agenda_services(page_id,owner_id,title,duration_min,price_cents)
 values(v_page,v_owner,'Corte simples',45,6000) returning id into v_service;
 insert into public.agenda_hours(page_id,owner_id,weekday,opens_min,closes_min)
 values(v_page,v_owner,extract(dow from v_day)::int,540,1080);
 if public.agenda_public_page('barbearia-integracao-ci')->>'title'<>'Barbearia verificada CI'
 then raise exception 'AGENDA_PUBLIC_PAGE_NOT_VISIBLE';end if;
 select starts_at into v_at from public.agenda_available_slots(v_service,v_day)
  where label='10:00' limit 1;
 if v_at is null then raise exception 'AGENDA_TEST_SLOT_NOT_FOUND';end if;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 v_first:=public.agenda_book_slot(v_service,v_at,'Cliente Primeiro','+5555999999999',v_request);
 if v_first->>'status'<>'confirmed' then raise exception 'AGENDA_CONFIRM_FAILED';end if;
 v_again:=public.agenda_book_slot(v_service,v_at,'Cliente Primeiro','+5555999999999',v_request);
 if v_first->>'id'<>v_again->>'id' then raise exception 'AGENDA_IDEMPOTENCY_BROKEN';end if;
 if exists(select 1 from public.agenda_available_slots(v_service,v_day)
  where starts_at=v_at) then raise exception 'AGENDA_BOOKED_SLOT_STILL_SHOWN';end if;
 perform set_config('request.jwt.claim.sub',v_second::text,true);
 begin
  perform public.agenda_book_slot(v_service,v_at,'Cliente Segundo','+5555999999998',gen_random_uuid());
  raise exception 'AGENDA_DOUBLE_BOOKING_ACCEPTED';
 exception when unique_violation then
  if sqlerrm<>'AGENDA_SLOT_ALREADY_TAKEN' then raise;end if;
 end;
 if (select count(*) from public.agenda_appointments where page_id=v_page)<>1
 then raise exception 'AGENDA_DUPLICATE_ORPHAN';end if;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 if not public.agenda_cancel_booking((v_first->>'id')::uuid)
 then raise exception 'AGENDA_CANCEL_FAILED';end if;
 perform set_config('request.jwt.claim.sub',v_second::text,true);
 v_second_booking:=public.agenda_book_slot(v_service,v_at,'Cliente Segundo','+5555999999998',gen_random_uuid());
 if v_second_booking->>'status'<>'confirmed'
 then raise exception 'AGENDA_CANCEL_NOT_REOPENED';end if;
 if (select count(*) from public.agenda_appointments where page_id=v_page and status='confirmed')<>1
 then raise exception 'AGENDA_ACTIVE_SLOT_UNEXPECTED';end if;

 -- Closing a free day prevents new bookings in Postgres even if the UI is bypassed.
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 if not public.agenda_set_closed_day(v_day+7,true)
 then raise exception 'AGENDA_CLOSE_DAY_FAILED';end if;
 if not public.agenda_day_is_closed(v_service,v_day+7)
 then raise exception 'AGENDA_DAY_CLOSED_NOT_VISIBLE';end if;
 select starts_at into v_at from public.agenda_available_slots(v_service,v_day+7)
 where label='10:00' limit 1;
 if v_at is null then raise exception 'AGENDA_FUTURE_SLOT_UNAVAILABLE';end if;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 begin
  perform public.agenda_book_slot(v_service,v_at,'Cliente Primeiro','+5555999999999',gen_random_uuid());
  raise exception 'AGENDA_CLOSED_DAY_BOOKING_ACCEPTED';
 exception when invalid_parameter_value then
  if sqlerrm<>'AGENDA_DAY_CLOSED' then raise;end if;
 end;
 -- A customer can never block the professional's calendar.
 begin
  perform public.agenda_set_closed_day(v_day+7,false);
  raise exception 'AGENDA_UNAUTHORIZED_DAY_CHANGE_ACCEPTED';
 exception when insufficient_privilege then
  if sqlerrm<>'AGENDA_OWNER_REQUIRED' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 perform public.agenda_set_closed_day(v_day+7,false);
 if public.agenda_day_is_closed(v_service,v_day+7)
 then raise exception 'AGENDA_DAY_STILL_CLOSED';end if;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 v_first:=public.agenda_book_slot(v_service,v_at,'Cliente Primeiro','+5555999999999',gen_random_uuid());
 if v_first->>'status'<>'confirmed' then raise exception 'AGENDA_REOPENED_BOOKING_FAILED';end if;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 begin
  perform public.agenda_set_closed_day(v_day+7,true);
  raise exception 'AGENDA_EXISTING_BOOKING_WAS_BLOCKED';
 exception when invalid_parameter_value then
  if sqlerrm<>'AGENDA_DAY_HAS_BOOKINGS' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 if not exists(
  select 1 from public.agenda_my_bookings() mine
  where mine.id=(v_first->>'id')::uuid and mine.page_title='Barbearia verificada CI'
    and mine.service_title='Corte simples' and mine.slug='barbearia-integracao-ci'
 ) then raise exception 'AGENDA_CUSTOMER_DETAILS_MISSING';end if;
 perform set_config('request.jwt.claim.sub',v_second::text,true);
 if exists(select 1 from public.agenda_my_bookings() mine where mine.id=(v_first->>'id')::uuid)
 then raise exception 'AGENDA_CUSTOMER_DETAILS_CROSSED_ACCOUNTS';end if;

 -- Multi-seat mode: different staff can use same time; same staff cannot.
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 insert into public.agenda_staff(page_id,owner_id,name) values
  (v_page,v_owner,'Ana'),(v_page,v_owner,'Bruno');
 select id into v_staff from public.agenda_staff where page_id=v_page and name='Ana';
 select id into v_staff2 from public.agenda_staff where page_id=v_page and name='Bruno';
 if (public.agenda_public_page('barbearia-integracao-ci')->'staff'->0->>'name') is null
 then raise exception 'AGENDA_PUBLIC_TEAM_MISSING';end if;
 if exists(select 1 from public.agenda_available_staff_slots(v_service,v_day+3,null))
 then raise exception 'AGENDA_TEAM_BYPASS_LEGACY_SLOT';end if;
 select starts_at into v_team_start from public.agenda_available_staff_slots(v_service,v_day+3,v_staff)
 where label='10:00' limit 1;
 if v_team_start is null then raise exception 'AGENDA_STAFF_SLOT_MISSING';end if;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 v_booking:=public.agenda_book_staff_slot(v_service,v_team_start,'Cliente Primeiro',
  '+5555999999999',gen_random_uuid(),v_staff);
 if v_booking->>'status'<>'confirmed' then raise exception 'AGENDA_TEAM_BOOKING_FAILED';end if;
 perform set_config('request.jwt.claim.sub',v_second::text,true);
 v_parallel:=public.agenda_book_staff_slot(v_service,v_team_start,'Cliente Segundo',
  '+5555999999998',gen_random_uuid(),v_staff2);
 if v_parallel->>'status'<>'confirmed' then raise exception 'AGENDA_PARALLEL_STAFF_FAILED';end if;
 if exists(select 1 from public.agenda_available_staff_slots(v_service,v_day+3,v_staff)
  where starts_at=v_team_start)
 then raise exception 'AGENDA_STAFF_BOOKED_SLOT_STILL_VISIBLE';end if;
 begin
  perform public.agenda_book_staff_slot(v_service,v_team_start,'Outro Cliente',
   '+5555999999998',gen_random_uuid(),v_staff);
  raise exception 'AGENDA_SAME_STAFF_DOUBLE_BOOKED';
 exception when unique_violation then
  if sqlerrm<>'AGENDA_SLOT_ALREADY_TAKEN' then raise;end if;
 end;
 begin
  perform public.agenda_reschedule_booking((v_booking->>'id')::uuid,v_team_start,v_team_start+interval '60 minutes');
  raise exception 'AGENDA_FOREIGN_RESCHEDULE_ALLOWED';
 exception when insufficient_privilege then
  if sqlerrm<>'AGENDA_BOOKING_NOT_ALLOWED' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 select starts_at into v_team_new from public.agenda_available_staff_slots(v_service,v_day+3,v_staff)
 where label='12:00' limit 1;
 if v_team_new is null then raise exception 'AGENDA_STAFF_NEW_SLOT_MISSING';end if;
 v_rescheduled:=public.agenda_reschedule_booking((v_booking->>'id')::uuid,
  v_team_start,v_team_new);
 if v_rescheduled->>'status'<>'confirmed' or
  (v_rescheduled->>'starts_at')::timestamptz<>v_team_new
 then raise exception 'AGENDA_RESCHEDULE_FAILED';end if;
 if (select count(*) from public.agenda_appointments
   where id=(v_booking->>'id')::uuid)<>1
 then raise exception 'AGENDA_RESCHEDULE_CREATED_COPY';end if;
 if (select reschedule_count from public.agenda_appointments
   where id=(v_booking->>'id')::uuid)<>1
 then raise exception 'AGENDA_RESCHEDULE_COUNTER_WRONG';end if;
 if not exists(select 1 from public.agenda_available_staff_slots(v_service,v_day+3,v_staff)
   where starts_at=v_team_start)
 then raise exception 'AGENDA_OLD_SLOT_NOT_FREED';end if;
 v_rescheduled:=public.agenda_reschedule_booking((v_booking->>'id')::uuid,
  v_team_start,v_team_new);
 if (select reschedule_count from public.agenda_appointments
   where id=(v_booking->>'id')::uuid)<>1
 then raise exception 'AGENDA_RESCHEDULE_REPLAY_NOT_IDEMPOTENT';end if;
 begin
  perform public.agenda_reschedule_booking((v_booking->>'id')::uuid,
   v_team_start,v_team_new+interval '60 minutes');
  raise exception 'AGENDA_STALE_RESCHEDULE_ACCEPTED';
 exception when invalid_parameter_value then
  if sqlerrm<>'AGENDA_BOOKING_CHANGED' then raise;end if;
 end;
 if not exists(select 1 from public.agenda_my_bookings() b
  where b.id=(v_booking->>'id')::uuid and b.staff_title='Ana' and b.reschedule_count=1)
 then raise exception 'AGENDA_MINE_STAFF_MISSING';end if;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 begin
  update public.agenda_staff set active=false where id=v_staff;
  raise exception 'AGENDA_ACTIVE_STAFF_WITH_BOOKING_DISABLED';
 exception when invalid_parameter_value then
  if sqlerrm<>'AGENDA_STAFF_HAS_BOOKINGS' then raise;end if;
 end;
 if not public.agenda_set_closed_day(v_day+4,true)
 then raise exception 'AGENDA_TEAM_FOLGA_FAILED';end if;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 begin
  perform public.agenda_reschedule_booking((v_booking->>'id')::uuid,v_team_new,
   (v_day+4)::timestamp+interval '12 hours');
  raise exception 'AGENDA_RESCHEDULE_TO_CLOSED_DAY';
 exception when invalid_parameter_value then
  if sqlerrm<>'AGENDA_DAY_CLOSED' then raise;end if;
 end;
 if has_function_privilege('anon',
  'public.agenda_book_staff_slot(uuid,timestamptz,text,text,uuid,uuid)','execute')
  or has_function_privilege('anon',
  'public.agenda_reschedule_booking(uuid,timestamptz,timestamptz)','execute')
  or has_table_privilege('anon','public.agenda_staff','select')
 then raise exception 'AGENDA_TEAM_ACL_EXPOSED';end if;
end $test$;
rollback;
\echo 'PASS: Agenda equipe paralela, idempotência, remarcação, RLS, folgas e reservas atômicas.'
