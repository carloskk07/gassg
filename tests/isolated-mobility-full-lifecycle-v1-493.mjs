import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Real PostgreSQL/RPC journey with five synthetic jobs; NEVER production.
// Supabase full schema is bootstrapped by the isolated CI workflow.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=query=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+query],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
assert.equal(sql('select current_database()'),'postgres');
assert.equal(sql("select inet_server_port()"),'5432');
for(const table of ['mobility_requests','mobility_live_positions','mobility_push_outbox']){
 assert.equal(sql("select to_regclass('public."+table+"') is not null"),'t');
}
const trip=String.raw`
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,is_sso_user,is_anonymous,email_confirmed_at)
VALUES
 ('aaaaaaaa-1000-4000-8000-000000000901','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,clock_timestamp()),
 ('aaaaaaaa-1000-4000-8000-000000000902','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,clock_timestamp()),
 ('aaaaaaaa-1000-4000-8000-000000000903','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,clock_timestamp());
INSERT INTO public.discovery_vertical_cities(vertical,state_code,city_key,city_name,enabled)
VALUES('professionals','RS','sao-gabriel','São Gabriel',true)
ON CONFLICT(vertical,state_code,city_key) DO UPDATE SET enabled=true;
INSERT INTO public.discovery_listings(id,owner_id,vertical,status,title,description,
 state_code,city_key,city_name,whatsapp_e164) VALUES
 ('dddddddd-1000-4000-8000-000000000901','aaaaaaaa-1000-4000-8000-000000000901',
 'professionals','published','Mototáxi isolado','Atendimento sintético em área restrita, exclusivo para verificar o funcionamento das solicitações de moto e carro em banco de dados descartável.',
 'RS','sao-gabriel','São Gabriel','+5555999999999'),
 ('dddddddd-1000-4000-8000-000000000902','aaaaaaaa-1000-4000-8000-000000000901',
 'professionals','published','Motorista de carro isolado','Atendimento sintético em área restrita, exclusivo para verificar o funcionamento das solicitações de moto e carro em banco de dados descartável.',
 'RS','sao-gabriel','São Gabriel','+5555999999999');
INSERT INTO public.discovery_professional_details(listing_id,occupation,service_area) VALUES
 ('dddddddd-1000-4000-8000-000000000901','Mototáxi','Centro'),
 ('dddddddd-1000-4000-8000-000000000902','Motorista de carro / táxi','Centro');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000902';
SELECT set_config('tamao.ci.moto_completed',
 public.mobility_create_request('dddddddd-1000-4000-8000-000000000901',
 'moto','Centro','Vila Sul')::text,true);
DO $probe$
declare row jsonb; inbox jsonb;
begin
 row:=public.mobility_snapshot(current_setting('tamao.ci.moto_completed')::uuid);
 if row->>'role'<>'rider' or row->>'status'<>'requested' or row->>'service'<>'moto'
 then raise exception 'RIDER_REQUEST_NOT_VISIBLE';end if;
 if row->'driver_whatsapp'<>'null'::jsonb
 then raise exception 'UNACCEPTED_DRIVER_PHONE_EXPOSED';end if;
 inbox:=public.mobility_my_requests();
 if jsonb_array_length(inbox)<>1 or inbox->0->>'status'<>'requested'
 then raise exception 'RIDER_INBOX_NOT_UPDATED';end if;
end $probe$;

SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000903';
DO $probe$
begin
 if public.mobility_snapshot(current_setting('tamao.ci.moto_completed')::uuid) is not null
 then raise exception 'STRANGER_READ_MOTO_SNAPSHOT';end if;
 if jsonb_array_length(public.mobility_my_requests())<>0
 then raise exception 'STRANGER_READ_MOTO_INBOX';end if;
 begin
  perform public.mobility_transition(current_setting('tamao.ci.moto_completed')::uuid,'accept');
  raise exception 'STRANGER_ACCEPTED_MOTO';
 exception when insufficient_privilege then null;end;
end $probe$;

SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000901';
DO $probe$
begin
 if public.mobility_snapshot(current_setting('tamao.ci.moto_completed')::uuid)->>'role'<>'driver'
 then raise exception 'DRIVER_REQUEST_NOT_VISIBLE';end if;
 if public.mobility_transition(current_setting('tamao.ci.moto_completed')::uuid,'accept')<>'accepted'
 then raise exception 'DRIVER_ACCEPT_FAILED';end if;
 if public.mobility_transition(current_setting('tamao.ci.moto_completed')::uuid,'depart')<>'en_route'
 then raise exception 'DRIVER_DEPART_FAILED';end if;
 if public.mobility_snapshot(current_setting('tamao.ci.moto_completed')::uuid)->'driver_whatsapp'<>'null'::jsonb
 then raise exception 'DRIVER_ROLE_RECEIVED_RIDER_CONTACT_FIELD';end if;
 begin
  perform public.mobility_publish_position(current_setting('tamao.ci.moto_completed')::uuid,-30.31,-54.31,18);
  raise exception 'GPS_WITHOUT_OPT_IN_ALLOWED';
 exception when insufficient_privilege then null;end;
 if not public.mobility_start_position(current_setting('tamao.ci.moto_completed')::uuid)
 then raise exception 'DRIVER_GPS_OPT_IN_FAILED';end if;
 if not public.mobility_publish_position(current_setting('tamao.ci.moto_completed')::uuid,-30.31,-54.31,18)
 then raise exception 'DRIVER_GPS_PUBLISH_FAILED';end if;
end $probe$;

SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000902';
DO $probe$
declare row jsonb;
begin
 row:=public.mobility_snapshot(current_setting('tamao.ci.moto_completed')::uuid);
 if row->>'status'<>'en_route' or (row->'position'->>'lat')::double precision<>-30.31
 then raise exception 'RIDER_MISSING_LIVE_DRIVER_POSITION';end if;
 if row->>'driver_whatsapp'<>'+5555999999999'
 then raise exception 'ACCEPTED_RIDER_MISSING_PUBLIC_DRIVER_WHATSAPP';end if;
 begin
  perform public.mobility_publish_position(current_setting('tamao.ci.moto_completed')::uuid,-30.32,-54.32,19);
  raise exception 'RIDER_FORGED_GPS';
 exception when insufficient_privilege then null;end;
end $probe$;

SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000901';
DO $probe$
begin
 if public.mobility_transition(current_setting('tamao.ci.moto_completed')::uuid,'arrive')<>'arrived'
 then raise exception 'DRIVER_ARRIVE_FAILED';end if;
 if public.mobility_transition(current_setting('tamao.ci.moto_completed')::uuid,'finish')<>'completed'
 then raise exception 'DRIVER_FINISH_FAILED';end if;
end $probe$;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000902';
DO $probe$
declare row jsonb;
begin
 row:=public.mobility_snapshot(current_setting('tamao.ci.moto_completed')::uuid);
 if row->>'status'<>'completed' or row->'position'<>'null'::jsonb
 then raise exception 'COMPLETED_RIDE_GPS_LEAK_OR_STATUS';end if;
 if row->'driver_whatsapp'<>'null'::jsonb
 then raise exception 'COMPLETED_RIDER_CONTACT_RETAINED';end if;
 -- Rider must NEVER gain direct read privileges to live GPS storage.
 -- The server-side snapshot is the only authorized way to see any point.
 begin
  perform 1 from public.mobility_live_positions
   where request_id=current_setting('tamao.ci.moto_completed')::uuid;
  raise exception 'RIDER_DIRECT_GPS_READ_ALLOWED';
 exception when insufficient_privilege then null;end;
end $probe$;

-- REJECT is a distinct terminal path: no GPS and no subsequent acceptance.
SELECT set_config('tamao.ci.moto_rejected',
 public.mobility_create_request('dddddddd-1000-4000-8000-000000000901',
 'moto','Centro','Vila Norte')::text,true);
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000901';
DO $probe$
begin
 if public.mobility_transition(current_setting('tamao.ci.moto_rejected')::uuid,'reject')<>'rejected'
 then raise exception 'DRIVER_REJECT_FAILED';end if;
 begin
  perform public.mobility_transition(current_setting('tamao.ci.moto_rejected')::uuid,'accept');
  raise exception 'REJECTED_TRIP_ACCEPTED_AGAIN';
 exception when invalid_parameter_value then null;end;
end $probe$;

-- CANCEL BEFORE ACCEPT: server rejects any late driver acceptance.
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000902';
SELECT set_config('tamao.ci.car_cancel_before',
 public.mobility_create_request('dddddddd-1000-4000-8000-000000000902',
 'carro','Centro','Vila Leste')::text,true);
DO $probe$
begin
 if public.mobility_transition(current_setting('tamao.ci.car_cancel_before')::uuid,'cancel')<>'cancelled'
 then raise exception 'RIDER_PRE_ACCEPT_CANCEL_FAILED';end if;
end $probe$;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000901';
DO $probe$
begin
 begin
  perform public.mobility_transition(current_setting('tamao.ci.car_cancel_before')::uuid,'accept');
  raise exception 'CANCELLED_CAR_ACCEPTED_LATE';
 exception when invalid_parameter_value then null;end;
end $probe$;

-- CANCEL AFTER ACCEPT: rider cancels while the driver is en-route.
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000902';
SELECT set_config('tamao.ci.car_cancel_enroute',
 public.mobility_create_request('dddddddd-1000-4000-8000-000000000902',
 'carro','Centro','Vila Nova')::text,true);
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000901';
DO $probe$
begin
 if public.mobility_transition(current_setting('tamao.ci.car_cancel_enroute')::uuid,'accept')<>'accepted'
  or public.mobility_transition(current_setting('tamao.ci.car_cancel_enroute')::uuid,'depart')<>'en_route'
 then raise exception 'CAR_ACCEPT_DEPART_FAILED';end if;
 if not public.mobility_start_position(current_setting('tamao.ci.car_cancel_enroute')::uuid)
 then raise exception 'CAR_GPS_START_FAILED';end if;
 if not public.mobility_publish_position(current_setting('tamao.ci.car_cancel_enroute')::uuid,-30.33,-54.33,20)
 then raise exception 'CAR_GPS_PUBLISH_FAILED';end if;
end $probe$;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000902';
DO $probe$
begin
 if public.mobility_transition(current_setting('tamao.ci.car_cancel_enroute')::uuid,'cancel')<>'cancelled'
 then raise exception 'RIDER_ENROUTE_CANCEL_FAILED';end if;
 if public.mobility_snapshot(current_setting('tamao.ci.car_cancel_enroute')::uuid)->'position'<>'null'::jsonb
 then raise exception 'CANCELLED_CAR_GPS_LEAKED';end if;
 if public.mobility_snapshot(current_setting('tamao.ci.car_cancel_enroute')::uuid)->'driver_whatsapp'<>'null'::jsonb
 then raise exception 'CANCELLED_CAR_CONTACT_RETAINED';end if;
end $probe$;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000901';
DO $probe$
begin
 begin
  perform public.mobility_publish_position(current_setting('tamao.ci.car_cancel_enroute')::uuid,-30.34,-54.34,20);
  raise exception 'DRIVER_GPS_AFTER_RIDER_CANCEL_ALLOWED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.mobility_transition(current_setting('tamao.ci.car_cancel_enroute')::uuid,'arrive');
  raise exception 'DRIVER_ARRIVED_AFTER_CANCEL';
 exception when invalid_parameter_value then null;end;
end $probe$;

-- Expires even without the driver returning to the page.
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000902';
SELECT set_config('tamao.ci.car_expired',
 public.mobility_create_request('dddddddd-1000-4000-8000-000000000902',
 'carro','Centro','Vila Oeste')::text,true);
RESET ROLE;
UPDATE public.mobility_requests SET expires_at=clock_timestamp()-interval '1 minute'
 WHERE id=current_setting('tamao.ci.car_expired')::uuid;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000901';
DO $probe$
begin
 if public.mobility_transition(current_setting('tamao.ci.car_expired')::uuid,'accept')<>'expired'
 then raise exception 'EXPIRED_RIDE_ACCEPTED';end if;
end $probe$;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-1000-4000-8000-000000000902';
DO $probe$
declare row jsonb;
begin
 row:=public.mobility_snapshot(current_setting('tamao.ci.car_expired')::uuid);
 if row->>'status'<>'expired' then raise exception 'RIDER_EXPIRED_STATE_NOT_VISIBLE';end if;
 if jsonb_array_length(public.mobility_my_requests())<>5
 then raise exception 'RIDER_LIST_MISSING_TERMINAL_EVENTS';end if;
end $probe$;
RESET ROLE;
DO $probe$
begin
 if (select count(*) from public.mobility_requests)<>5
 then raise exception 'WRONG_NUMBER_OF_SYNTHETIC_TRIPS';end if;
 if (select count(*) from public.mobility_live_positions)<>0
 then raise exception 'LOCATION_NOT_CLEANED';end if;
 if (select count(*) from public.mobility_push_outbox)<>5
 then raise exception 'MISSING_TRANSACTIONAL_OUTBOX_ROWS';end if;
 if (select count(*) from public.orders)<>0
 then raise exception 'MOBILITY_WROTE_COMMERCIAL_ORDER';end if;
end $probe$;
ROLLBACK;
`;
sql(trip);
for(const table of ['mobility_requests','mobility_live_positions','mobility_push_outbox','orders']){
 assert.equal(sql('select count(*) from public.'+table),'0',
  'synthetic E2E trip test must leave no '+table);
}
console.log('PASS: real PostgreSQL 5-ride lifecycle: moto full/GPS, reject, car cancel queued, car cancel in transit, expiry; rider/driver/stranger RLS; transactional outbox and rollback');
