import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
// Only disposable localhost Postgres bootstrapped by the canonical migration
// chain. Never connect to the production Supabase project from CI.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=query=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+query],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
assert.equal(sql('select current_database()'),'postgres');
const tables=['mobility_push_subscriptions','mobility_push_outbox','mobility_push_deliveries','mobility_push_rollout'];
for(const table of tables){
 const info=JSON.parse(sql(`select jsonb_build_object(
  'rls',c.relrowsecurity,
  'anon',has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('anon',c.oid,'INSERT')
   or has_table_privilege('anon',c.oid,'UPDATE') or has_table_privilege('anon',c.oid,'DELETE'),
  'auth',has_table_privilege('authenticated',c.oid,'SELECT')
   or has_table_privilege('authenticated',c.oid,'INSERT')
   or has_table_privilege('authenticated',c.oid,'UPDATE')
   or has_table_privilege('authenticated',c.oid,'DELETE'),
  'service',has_table_privilege('service_role',c.oid,'SELECT'))
  from pg_class c where c.oid='public.${table}'::regclass`));
 assert.deepEqual(info,{rls:true,anon:false,auth:false,service:true},
  table+' browser isolation');
 for(const role of ['anon','authenticated']){
  const direct=Number(sql(`select count(*) from information_schema.column_privileges
   where table_schema='public' and table_name='${table}' and grantee='${role}'`));
  assert.equal(direct,0,'no direct column grants to '+role);
 }
}
for(const signature of [
 'mobility_push_claim_due(integer)',
 'mobility_push_resolve_delivery(bigint,uuid,text,integer,text)']){
 const rights=JSON.parse(sql(`select jsonb_build_object(
  'anon',has_function_privilege('anon','public.${signature}','EXECUTE'),
  'authenticated',has_function_privilege('authenticated','public.${signature}','EXECUTE'),
  'service',has_function_privilege('service_role','public.${signature}','EXECUTE'))
 `));
 assert.deepEqual(rights,{anon:false,authenticated:false,service:true},
  signature+' RPC grant boundary');
}
const trigger=sql(`select count(*) from pg_trigger where tgrelid='public.mobility_requests'::regclass
 and tgname='mobility_push_new_request' and tgenabled='O' and not tgisinternal`);
assert.equal(trigger,'1','private outbox trigger exists exactly once');
const state=JSON.parse(sql(`select jsonb_build_object(
 'subscriptions',(select count(*) from public.mobility_push_subscriptions),
 'outbox',(select count(*) from public.mobility_push_outbox),
 'deliveries',(select count(*) from public.mobility_push_deliveries))`));
assert.equal(sql("select enabled from public.mobility_push_rollout where id"),'f',
 'new mobility sender stays disabled until separate explicit approval');
assert.deepEqual(state,{subscriptions:0,outbox:0,deliveries:0},
 'migrations create no synthetic commercial or push records');
const col=sql("select is_nullable from information_schema.columns where table_schema='public' and table_name='mobility_push_subscriptions' and column_name='auth_session_id'");
assert.equal(col,'NO','driver push must be session-bound');
for(const signature of ['mobility_push_device_is_active(uuid,uuid,text)',
 'mobility_push_delivery_allowed(bigint,uuid)']){
 const rights=JSON.parse(sql(`select jsonb_build_object(
  'anon',has_function_privilege('anon','public.${signature}','EXECUTE'),
  'authenticated',has_function_privilege('authenticated','public.${signature}','EXECUTE'),
  'service',has_function_privilege('service_role','public.${signature}','EXECUTE'))`));
 assert.deepEqual(rights,{anon:false,authenticated:false,service:true});
}

// Transactional real-Postgres regression: no external Web Push or production
// users. This changes only disposable CI records and always rolls them back.
const revokedSessionProbe=String.raw`
BEGIN;
INSERT INTO auth.users (id,instance_id,aud,role,is_sso_user,is_anonymous)
VALUES
 ('bbbbbbbb-0000-4000-8000-000000000551','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false),
 ('bbbbbbbb-0000-4000-8000-000000000552','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false);
INSERT INTO auth.sessions(id,user_id) values
 ('cccccccc-0000-4000-8000-000000000551','bbbbbbbb-0000-4000-8000-000000000551');
INSERT INTO public.discovery_vertical_cities(vertical,state_code,city_key,city_name,enabled)
values('professionals','RS','sao-gabriel','São Gabriel',true)
on conflict(vertical,state_code,city_key) do update set enabled=true;
INSERT INTO public.discovery_listings(id,owner_id,vertical,status,title,description,
 state_code,city_key,city_name,whatsapp_e164)
values('dddddddd-0000-4000-8000-000000000551',
 'bbbbbbbb-0000-4000-8000-000000000551','professionals','published',
 'Motorista de teste descartável','Atendimento para regressão isolada',
 'RS','sao-gabriel','São Gabriel','+5555999999999');
INSERT INTO public.discovery_professional_details(listing_id,occupation,service_area)
values('dddddddd-0000-4000-8000-000000000551','Mototáxi','São Gabriel');
INSERT INTO public.mobility_push_subscriptions(driver_id,auth_session_id,
 endpoint_hash,endpoint_url,p256dh,auth_secret,registered_at)
values('bbbbbbbb-0000-4000-8000-000000000551',
 'cccccccc-0000-4000-8000-000000000551',repeat('f',64),
 'https://fcm.googleapis.com/fcm/send/isolated-device-only',
 repeat('A',87),repeat('A',22),clock_timestamp()-interval '2 minutes');
INSERT INTO public.mobility_requests(rider_id,driver_id,listing_id,service,
 origin_area,destination_area,expires_at)
values('bbbbbbbb-0000-4000-8000-000000000552',
 'bbbbbbbb-0000-4000-8000-000000000551',
 'dddddddd-0000-4000-8000-000000000551','moto',
 'Região de teste','Região de teste',clock_timestamp()+interval '10 minutes');
DO $test$
declare v_total integer;
begin
 if not public.mobility_push_device_is_active(
  'bbbbbbbb-0000-4000-8000-000000000551',
  'cccccccc-0000-4000-8000-000000000551',repeat('f',64))
 then raise exception 'CONSENTED_SESSION_NOT_RECOGNIZED';end if;
 select count(*) into v_total from public.mobility_push_claim_due(4);
 if v_total<>1 then raise exception 'ACTIVE_SESSION_NOT_CLAIMED_%',v_total;end if;
 if not (select public.mobility_push_delivery_allowed(id,lease_token)
  from public.mobility_push_deliveries where state='leased' limit 1)
 then raise exception 'ACTIVE_SESSION_NOT_AUTHORIZED_PRE_SEND';end if;
end $test$;
-- Simulate another browser tab or the Auth server revoking this login.
DELETE FROM auth.sessions WHERE id='cccccccc-0000-4000-8000-000000000551';
DO $test$
begin
 if (select public.mobility_push_delivery_allowed(id,lease_token)
     from public.mobility_push_deliveries where state='leased' limit 1)
 then raise exception 'REVOKED_SESSION_WOULD_SEND_AFTER_LEASE';end if;
end $test$;
UPDATE public.mobility_push_deliveries set state='retry',
 next_attempt_at=clock_timestamp()-interval '1 minute',
 leased_until=null,lease_token=null;
DO $test$
declare v_total integer;
begin
 if public.mobility_push_device_is_active(
  'bbbbbbbb-0000-4000-8000-000000000551',
  'cccccccc-0000-4000-8000-000000000551',repeat('f',64))
 then raise exception 'REVOKED_SESSION_STILL_ACTIVE';end if;
 select count(*) into v_total from public.mobility_push_claim_due(4);
 if v_total<>0 then raise exception 'REVOKED_SESSION_RECEIVED_PUSH_%',v_total;end if;
end $test$;
ROLLBACK;
`;
sql(revokedSessionProbe);
assert.equal(sql('select count(*) from public.mobility_push_subscriptions'),'0',
 'test must roll back synthetic subscriptions');

console.log('PASS: driver push session isolation, revoked session never claimed, RLS, RPC grants and zero persisted fixtures');
