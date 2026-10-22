import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// This is a REAL local Supabase/PostgreSQL integration smoke, not a purchase
// simulator or a test against the TAMÃO production project.
assert.equal(process.env.CI,'true','Only run with ephemeral CI infrastructure');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','',
  'Never accept hosted-project credentials in isolated tests');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','',
  'Never accept a hosted database password in isolated tests');
const sql=source=>execFileSync('psql',[
  '--host=127.0.0.1','--port=54322','--username=postgres',
  '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
  '--tuples-only','--no-align','--quiet','--command='+source
],{
  encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
  timeout:60000,stdio:['ignore','pipe','pipe']
}).trim();

assert.equal(sql("select current_database()"),'postgres');
assert.equal(sql("select inet_server_port()"),'5432');
for(const table of ['orders','order_items','merchants','order_reward_grants']){
  assert.equal(sql(`select to_regclass('public.${table}') is not null`),'t',
    table+' must be created by the SAME project migrations');
  assert.equal(sql(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`),'t',
    table+' must have RLS enabled');
}
for(const fn of ['create_order_from_quote_v8','merchant_delivery_payment_allowed']){
  assert.equal(sql(`select exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${fn}')`),'t',
    fn+' must exist in a clean local database');
}
assert.equal(sql("select count(*) from public.orders"),'0',
  'a fresh local launch must not contain real orders');
assert.equal(sql("select public.merchant_delivery_payment_allowed('00000000-0000-4000-8000-000000000001'::uuid,'pix')"),'f',
  'missing merchant must never be eligible for payment on delivery');
for(const table of ['orders','order_items','merchants']){
  assert.ok(sql(`begin; set local role anon; select row_security_active('public.${table}'::regclass); rollback;`).split('\n').includes('t'),
    'RLS must be effective for anonymous users: '+table);
}


console.log('PASS: Postgres local, migrações canônicas, RLS sob anon, RPC financeira sem revenda e banco limpo. Auth/Edge requerem etapa posterior.');
