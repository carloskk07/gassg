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


// Verify the live server-only contract on REAL PostgreSQL roles and grants.
// The Edge server accesses RPCs as service_role; web users must not call
// SECURITY DEFINER order/payment authorities through the Data API.
for(const fn of [
  'create_order_from_quote_v8',
  'merchant_order_action',
  'customer_order_action',
  'merchant_delivery_payment_allowed'
]){
  assert.equal(sql(`select exists(
    select 1 from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname='${fn}'
      and p.prosecdef
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')
  )`),'t',fn+' must remain server-only (both anonymous and signed-in users denied)');
}
const denied=source=>{
  let thrown=null;
  try{sql(source)}catch(error){thrown=error}
  assert.ok(thrown,'expected PostgreSQL to deny the privileged operation');
  const detail=String(thrown.stderr||thrown.message||'');
  assert.match(detail,/permission denied/i,
    'request must be denied by PostgreSQL permissions, not by missing tables');
};
denied("begin; set local role anon; select public.merchant_delivery_payment_allowed('00000000-0000-4000-8000-000000000001'::uuid,'pix'); rollback;");
denied("begin; set local role authenticated; select count(*) from public.orders; rollback;");

// Execute the *actual* order authority with a deliberately nonexistent
// customer and quote. Production must stay PRELAUNCH and reject before
// any quote lookup, payment capture or writes.
assert.equal(sql('select count(*) from public.platform_launch_control where commerce_enabled'),'0',
  'fresh local instance must start with commerce disabled');
const closedCall=[
 "begin;",
 "select public.create_order_from_quote_v8(",
 "'00000000-0000-4000-8000-000000000001'::uuid,",
 "'00000000-0000-4000-8000-000000000002'::uuid,",
 "'pix',false,'isolated-closed-test-001',",
 "'"+'a'.repeat(64)+"');",
 "rollback"
].join(' ');
let closedError=null;
try{sql(closedCall)}catch(error){closedError=error}
assert.ok(closedError,'disabled commerce must not accept any new order');
assert.match(String(closedError.stderr||closedError.message||''),/COMMERCE_NOT_ENABLED/,
  'actual create_order_from_quote_v8 must refuse commerce in PRELAUNCH');
assert.equal(sql('select count(*) from public.orders'),'0',
  'authorization probes must never create an order');
assert.equal(sql('select count(*) from public.action_requests'),'0',
  'rejected order must not retain an idempotency record');
assert.equal(sql('select count(*) from public.wallet_entries'),'0',
  'rejected checkout must never credit rewards');

console.log('PASS: isolated Postgres, migrations, RLS, real permission-denied probes and PRELAUNCH checkout block; no financial writes.');
