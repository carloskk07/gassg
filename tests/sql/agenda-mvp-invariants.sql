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
begin
 if has_table_privilege('anon','public.agenda_pages','select')
    or has_table_privilege('anon','public.agenda_appointments','select')
    or has_table_privilege('authenticated','public.agenda_appointments','insert')
    or has_table_privilege('authenticated','public.agenda_appointments','update')
 then raise exception 'AGENDA_PRIVATE_TABLE_EXPOSED';end if;
 if has_function_privilege('anon','public.agenda_book_slot(uuid,timestamptz,text,text,uuid)','execute')
    or has_function_privilege('anon','public.agenda_cancel_booking(uuid)','execute')
    or has_function_privilege('anon','public.agenda_replace_hours(uuid,jsonb)','execute')
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
end $test$;
rollback;
\echo 'PASS: Agenda private ACL, verified owner, public projection, idempotency, collision, cancellation, rebooking.'
