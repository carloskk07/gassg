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
 v_pause_id uuid;v_wait_id uuid;v_wait_again uuid;v_history_id uuid;
 v_pause_start timestamptz;v_pause_end timestamptz;
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
 select starts_at into v_at from public.agenda_available_slots(v_service,v_day+7)
 where label='10:00' limit 1;
 if v_at is null then raise exception 'AGENDA_FUTURE_SLOT_UNAVAILABLE';end if;
 if not public.agenda_set_closed_day(v_day+7,true)
 then raise exception 'AGENDA_CLOSE_DAY_FAILED';end if;
 if not public.agenda_day_is_closed(v_service,v_day+7)
 then raise exception 'AGENDA_DAY_CLOSED_NOT_VISIBLE';end if;
 if exists(select 1 from public.agenda_available_slots(v_service,v_day+7))
 then raise exception 'AGENDA_CLOSED_DAY_SLOTS_ADVERTISED';end if;
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
 insert into public.agenda_hours(page_id,owner_id,weekday,opens_min,closes_min)
 values(v_page,v_owner,extract(dow from v_day+3)::int,540,1080),
       (v_page,v_owner,extract(dow from v_day+4)::int,540,1080)
 on conflict(page_id,weekday) do nothing;
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

 -- V1.1051: owner may stop a single collaborator without stopping another.
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 insert into public.agenda_hours(page_id,owner_id,weekday,opens_min,closes_min)
 values(v_page,v_owner,extract(dow from v_day+8)::int,540,1080)
 on conflict(page_id,weekday) do nothing;
 v_pause_start:=((v_day+8)::timestamp+interval '13 hours') at time zone 'America/Sao_Paulo';
 v_pause_end:=v_pause_start+interval '60 minutes';
 v_pause_id:=public.agenda_add_staff_block(v_staff,v_pause_start,v_pause_end);
 if v_pause_id is null then raise exception 'AGENDA_PAUSE_CREATE_FAILED';end if;
 if exists(select 1 from public.agenda_available_staff_slots(v_service,v_day+8,v_staff)
  where starts_at=v_pause_start)
 then raise exception 'AGENDA_PAUSE_STAFF_SLOT_VISIBLE';end if;
 if not exists(select 1 from public.agenda_available_staff_slots(v_service,v_day+8,v_staff2)
  where starts_at=v_pause_start)
 then raise exception 'AGENDA_PAUSE_BLOCKED_OTHER_STAFF';end if;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 begin
  perform public.agenda_book_staff_slot(v_service,v_pause_start,'Cliente Primeiro',
   '+5555999999999',gen_random_uuid(),v_staff);
  raise exception 'AGENDA_PAUSE_BOOKING_ACCEPTED';
 exception when invalid_parameter_value then
  if sqlerrm<>'AGENDA_STAFF_BLOCKED' then raise;end if;
 end;
 begin
  perform public.agenda_remove_staff_block(v_pause_id);
  raise exception 'AGENDA_PAUSE_REMOVED_BY_CUSTOMER';
 exception when insufficient_privilege then
  if sqlerrm<>'AGENDA_OWNER_REQUIRED' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 begin
  perform public.agenda_add_staff_block(v_staff,v_team_new,v_team_new+interval '30 minutes');
  raise exception 'AGENDA_BLOCK_EXISTING_BOOKING';
 exception when invalid_parameter_value then
  if sqlerrm<>'AGENDA_BLOCK_HAS_BOOKINGS' then raise;end if;
 end;
 if not public.agenda_remove_staff_block(v_pause_id)
 then raise exception 'AGENDA_REMOVE_BLOCK_FAILED';end if;
 if not exists(select 1 from public.agenda_available_staff_slots(v_service,v_day+8,v_staff)
  where starts_at=v_pause_start)
 then raise exception 'AGENDA_REMOVED_BLOCK_STILL_HELD';end if;

 -- Waitlist is deliberately *not* a confirmed appointment.
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 v_wait_id:=public.agenda_join_waitlist(
  v_service,v_staff,v_day+9,'Cliente Primeiro','+5555999999999',true);
 v_wait_again:=public.agenda_join_waitlist(
  v_service,v_staff,v_day+9,'Cliente Primeiro','+5555999999999',true);
 if v_wait_id is null or v_wait_id<>v_wait_again
 then raise exception 'AGENDA_WAITLIST_NOT_IDEMPOTENT';end if;
 if not exists(select 1 from public.agenda_waitlist w
  where w.id=v_wait_id and w.customer_id=v_buyer and w.status='waiting')
 then raise exception 'AGENDA_WAITLIST_NOT_STORED';end if;
 if (select count(*) from public.agenda_appointments a where a.page_id=v_page and
    (a.starts_at at time zone 'America/Sao_Paulo')::date=v_day+9)>0
 then raise exception 'AGENDA_WAITLIST_FABRICATED_BOOKING';end if;
 begin
  perform public.agenda_close_waitlist(v_wait_id,true);
  raise exception 'AGENDA_CUSTOMER_CLAIMED_CONTACT';
 exception when insufficient_privilege then
  if sqlerrm<>'AGENDA_WAITLIST_NOT_ALLOWED' then raise;end if;
 end;
 begin
  perform public.agenda_close_waitlist(v_wait_id,null);
  raise exception 'AGENDA_WAITLIST_NULL_BYPASS';
 exception when insufficient_privilege then
  if sqlerrm<>'AGENDA_LOGIN_REQUIRED' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',v_second::text,true);
 begin
  perform public.agenda_close_waitlist(v_wait_id,false);
  raise exception 'AGENDA_WAITLIST_CROSS_ACCOUNT';
 exception when insufficient_privilege then
  if sqlerrm<>'AGENDA_WAITLIST_NOT_ALLOWED' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 if not public.agenda_close_waitlist(v_wait_id,true)
 then raise exception 'AGENDA_WAITLIST_CONTACTED_FAILED';end if;
 if (select status from public.agenda_waitlist where id=v_wait_id)<>'contacted'
 then raise exception 'AGENDA_WAITLIST_CONTACT_STATUS';end if;
 if exists(select 1 from public.agenda_waitlist where id=v_wait_id and (customer_name is not null or customer_phone is not null))
 then raise exception 'AGENDA_CONTACT_NOT_SCRUBBED';end if;

 -- Attendance can be finalized only after the appointment and only by owner.
 -- A synthetic *past* booking is inserted directly in disposable PostgreSQL.
 insert into public.agenda_appointments(
  page_id,owner_id,customer_id,service_id,staff_id,request_id,
  customer_name,customer_phone,starts_at,ends_at)
 values(v_page,v_owner,v_buyer,v_service,v_staff,gen_random_uuid(),
  'Cliente Primeiro','+5555999999999',now()-interval '2 days',now()-interval '2 days'+interval '45 minutes')
 returning id into v_history_id;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 begin
  perform public.agenda_mark_attendance(v_history_id,'completed');
  raise exception 'AGENDA_CUSTOMER_MARKED_ATTENDANCE';
 exception when insufficient_privilege then
  if sqlerrm<>'AGENDA_ATTENDANCE_NOT_ALLOWED' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 if not public.agenda_mark_attendance(v_history_id,'completed')
 then raise exception 'AGENDA_ATTENDANCE_FAILED';end if;
 if (select status from public.agenda_appointments where id=v_history_id)<>'completed'
 then raise exception 'AGENDA_ATTENDANCE_NOT_WRITTEN';end if;
 if (select count(*) from public.agenda_booking_events
   where appointment_id=v_history_id and event_kind in('created','status_changed'))<>2
 then raise exception 'AGENDA_EVENT_LOG_INCOMPLETE';end if;
 perform set_config('request.jwt.claim.sub',v_buyer::text,true);
 begin
  perform public.agenda_cancel_booking(v_history_id);
  raise exception 'AGENDA_COMPLETED_CANCELLED';
 exception when invalid_parameter_value then
  if sqlerrm<>'AGENDA_CANCEL_FINALIZED' then raise;end if;
 end;
 if has_table_privilege('anon','public.agenda_waitlist','SELECT')
  or has_table_privilege('anon','public.agenda_staff_blocks','SELECT')
  or has_table_privilege('authenticated','public.agenda_waitlist','INSERT')
  or has_table_privilege('authenticated','public.agenda_booking_events','SELECT')
  or has_function_privilege('anon','public.agenda_join_waitlist(uuid,uuid,date,text,text,boolean)','EXECUTE')
  or has_function_privilege('anon','public.agenda_mark_attendance(uuid,text)','EXECUTE')
 then raise exception 'AGENDA_V1051_PRIVILEGES_EXPOSED';end if;
end $test$;
rollback;
\echo 'PASS: Agenda equipe, pausas por pessoa, lista opt-in, presença, imutabilidade, auditoria e RLS.'
