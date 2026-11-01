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
console.log('PASS: real isolated PostgreSQL driver push RLS, RPC grants, trigger and empty outbox');
