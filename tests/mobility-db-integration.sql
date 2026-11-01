\set ON_ERROR_STOP on
\i supabase/migrations/20261021030000_mobility_live_tracking.sql
\i supabase/migrations/20261101213000_mobility_service_category_integrity_v1_493.sql
insert into public.discovery_vertical_cities(vertical,state_code,city_key,city_name,enabled)
values('professionals','RS','sao-gabriel','São Gabriel',true)
on conflict(vertical,state_code,city_key) do update set enabled=true;
insert into public.discovery_listings(id,owner_id,vertical,status,title,description,
 state_code,city_key,city_name,whatsapp_e164)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 '00000000-0000-0000-0000-000000000011','professionals','published',
 'Mototáxi de testes locais','Atendimento de moto na região com consulta ao motorista.',
 'RS','sao-gabriel','São Gabriel','+5555999999999');
insert into public.discovery_professional_details(listing_id,occupation,service_area)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Mototáxi','São Gabriel');
-- A second, actual car provider uses a separate moderated service category.
insert into public.discovery_listings(id,owner_id,vertical,status,title,description,
 state_code,city_key,city_name,whatsapp_e164)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 '00000000-0000-0000-0000-000000000011','professionals','published',
 'Motorista de carro de testes','Atendimento de carro para trajeto local de testes.',
 'RS','sao-gabriel','São Gabriel','+5555999999999');
insert into public.discovery_professional_details(listing_id,occupation,service_area)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Motorista de carro / táxi','São Gabriel');
set role anon;
do $t$ begin
 begin
  perform public.mobility_my_requests();
  raise exception 'ANON_WAS_ALLOWED';
 exception when insufficient_privilege then null;end;
end $t$;
reset role;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
-- Real RPC regression: the old "carro" regex matched the "táxi" inside
-- "Mototáxi", and would create a valid-looking car request for a motorbike.
do $service_mismatch$
declare v_count integer;
begin
 begin
  perform public.mobility_create_request(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd','carro','Centro','Vila Sul');
  raise exception 'MOTORBIKE_CROSSMODE_CAR_WAS_ACCEPTED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.mobility_create_request(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','moto','Centro','Vila Sul');
  raise exception 'CAR_CROSSMODE_MOTO_WAS_ACCEPTED';
 exception when insufficient_privilege then null;end;
 select count(*) into v_count from public.mobility_requests;
 if v_count<>0 then raise exception 'INVALID_CROSSMODE_REQUEST_PERSISTED';end if;
end $service_mismatch$;
-- The authoritative trigger must independently reject a malicious database
-- insert even if a future RPC accidentally bypasses the service match.
reset role;
do $direct_service_guard$
begin
 begin
  insert into public.mobility_requests(rider_id,driver_id,listing_id,
   service,origin_area,destination_area,expires_at)
  values('00000000-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-000000000011',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'carro','Centro','Vila Sul',statement_timestamp()+interval '10 minutes');
  raise exception 'DIRECT_CROSSMODE_INSERT_ALLOWED';
 exception when insufficient_privilege then null;end;
end $direct_service_guard$;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
select public.mobility_create_request('dddddddd-dddd-4ddd-8ddd-dddddddddddd','moto','Centro','Vila Sul') as id \gset
select set_config('tamao.mobility.id',:'id',false);
do $t$ begin
 begin
  perform public.mobility_publish_position(current_setting('tamao.mobility.id')::uuid,-30.34,-54.3,20);
  raise exception 'RIDER_GPS_WRITE_ALLOWED';
 exception when insufficient_privilege then null;end;
 begin
  insert into public.mobility_live_positions(request_id,latitude,longitude,accuracy_m)
  values(current_setting('tamao.mobility.id')::uuid,-30.34,-54.3,20);
  raise exception 'DIRECT_GPS_WRITE_ALLOWED';
 exception when insufficient_privilege then null;end;
end $t$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000033';
do $t$ begin
 if public.mobility_snapshot(current_setting('tamao.mobility.id')::uuid) is not null
 then raise exception 'UNINVOLVED_USER_VIEWED_REQUEST';end if;
 begin
  perform public.mobility_transition(current_setting('tamao.mobility.id')::uuid,'accept');
  raise exception 'UNINVOLVED_USER_ACCEPTED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.mobility_start_position(current_setting('tamao.mobility.id')::uuid);
  raise exception 'THIRD_PARTY_STARTED_GPS';
 exception when insufficient_privilege then null;end;
end $t$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $t$ begin
 if public.mobility_transition(current_setting('tamao.mobility.id')::uuid,'accept')<>'accepted'
 then raise exception 'ACCEPT_FAILED';end if;
 begin
  perform public.mobility_publish_position(current_setting('tamao.mobility.id')::uuid,-30.34,-54.3,20);
  raise exception 'GPS_BEFORE_DEPART';
 exception when insufficient_privilege then null;end;
 if public.mobility_transition(current_setting('tamao.mobility.id')::uuid,'depart')<>'en_route'
 then raise exception 'DEPART_FAILED';end if;
 begin
  perform public.mobility_publish_position(current_setting('tamao.mobility.id')::uuid,-30.34,-54.3,20);
  raise exception 'GPS_WITHOUT_DRIVER_OPT_IN';
 exception when insufficient_privilege then null;end;
 if not public.mobility_start_position(current_setting('tamao.mobility.id')::uuid)
 then raise exception 'DRIVER_START_FAILED';end if;
 if not public.mobility_publish_position(current_setting('tamao.mobility.id')::uuid,-30.34,-54.3,20)
 then raise exception 'GPS_WRITE_FAILED';end if;
end $t$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $t$
declare s jsonb;
begin
 s:=public.mobility_snapshot(current_setting('tamao.mobility.id')::uuid);
 if (s->'position'->>'lat')::double precision<>-30.34
 then raise exception 'RIDER_GPS_NOT_VISIBLE';end if;
 -- Even a participant must use the permission-checked snapshot RPC.
 begin
  perform 1 from public.mobility_live_positions
   where request_id=current_setting('tamao.mobility.id')::uuid;
  raise exception 'DIRECT_RIDER_GPS_QUERY_ALLOWED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.mobility_stop_position(current_setting('tamao.mobility.id')::uuid);
  raise exception 'RIDER_STOPPED_DRIVER_GPS';
 exception when insufficient_privilege then null;end;
end $t$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
select public.mobility_stop_position(current_setting('tamao.mobility.id')::uuid);
do $t$ begin
 begin
  perform public.mobility_publish_position(current_setting('tamao.mobility.id')::uuid,-30.35,-54.31,30);
  raise exception 'DELAYED_GPS_REENABLED_AFTER_STOP';
 exception when insufficient_privilege then null;end;
end $t$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $t$
declare s jsonb;
begin
 s:=public.mobility_snapshot(current_setting('tamao.mobility.id')::uuid);
 if s->'position'<>'null'::jsonb then raise exception 'STOP_LEAKED_GPS';end if;
end $t$;
-- Revoking driver verification must prevent starting GPS on an otherwise
-- still-active journey, while STOP remains available for emergency revocation.
reset role;
update auth.users set is_anonymous=true,email_confirmed_at=null
 where id='00000000-0000-0000-0000-000000000011';
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $t$ begin
 begin
  perform public.mobility_start_position(current_setting('tamao.mobility.id')::uuid);
  raise exception 'UNVERIFIED_DRIVER_STARTED_GPS';
 exception when insufficient_privilege then null;end;
 begin
  perform public.mobility_publish_position(
   current_setting('tamao.mobility.id')::uuid,-30.36,-54.32,10);
  raise exception 'UNVERIFIED_DRIVER_PUBLISHED_GPS';
 exception when insufficient_privilege then null;end;
end $t$;
select public.mobility_stop_position(current_setting('tamao.mobility.id')::uuid);
reset role;
update auth.users set is_anonymous=false,email_confirmed_at=now()
 where id='00000000-0000-0000-0000-000000000011';
set role authenticated;
-- Admin suspending the service city must immediately revoke both RLS and
-- snapshot access to the last coordinate. Never expose it for the 45s TTL.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
select public.mobility_start_position(current_setting('tamao.mobility.id')::uuid);
select public.mobility_publish_position(current_setting('tamao.mobility.id')::uuid,-30.34,-54.3,20);
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $city_visibility$
begin
 if (public.mobility_snapshot(current_setting('tamao.mobility.id')::uuid)
     ->'position'->>'lat')::double precision<>-30.34
 then raise exception 'GPS_MISSING_BEFORE_CITY_SUSPENSION';end if;
end $city_visibility$;
reset role;
update public.discovery_vertical_cities set enabled=false
 where vertical='professionals' and state_code='RS' and city_key='sao-gabriel';
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $city_visibility$
declare p jsonb;
begin
 p:=public.mobility_snapshot(current_setting('tamao.mobility.id')::uuid);
 if p->'position'<>'null'::jsonb
 then raise exception 'CITY_SUSPENSION_LEAKED_SNAPSHOT_GPS';end if;
 begin
  perform 1 from public.mobility_live_positions
   where request_id=current_setting('tamao.mobility.id')::uuid;
  raise exception 'DIRECT_RIDER_GPS_QUERY_AFTER_CITY_SUSPENSION_ALLOWED';
 exception when insufficient_privilege then null;end;
end $city_visibility$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $city_driver$
begin
 begin
  perform public.mobility_publish_position(
   current_setting('tamao.mobility.id')::uuid,-30.35,-54.31,22);
  raise exception 'DRIVER_PUBLISHED_AFTER_CITY_SUSPENSION';
 exception when insufficient_privilege then null;end;
end $city_driver$;
reset role;
update public.discovery_vertical_cities set enabled=true
 where vertical='professionals' and state_code='RS' and city_key='sao-gabriel';
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
select public.mobility_transition(current_setting('tamao.mobility.id')::uuid,'cancel');
-- The legitimate car flow remains available after the moto flow is closed.
select public.mobility_create_request('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 'carro','Centro','Vila Sul') as valid_car_id \gset
select set_config('tamao.mobility.car_id',:'valid_car_id',false);
do $car_authoritative$
declare v_service text;
begin
 select service into v_service from public.mobility_requests
  where id=current_setting('tamao.mobility.car_id')::uuid;
 if v_service<>'carro' then raise exception 'VALID_CAR_REQUEST_NOT_INSERTED';end if;
end $car_authoritative$;
select public.mobility_transition(current_setting('tamao.mobility.car_id')::uuid,'cancel');
reset role;
select public.mobility_cleanup_expired();
select 'MOBILITY_PRIVATE_GPS_TEST_OK' as result;
