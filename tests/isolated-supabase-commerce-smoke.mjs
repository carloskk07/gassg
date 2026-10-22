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
  '--tuples-only','--no-align','--command='+source
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
  assert.equal(sql(`begin; set local role anon; select row_security_active('public.${table}'::regclass); rollback;`).split('\n')[0],'t',
    'RLS must be effective for anonymous users: '+table);
}

// API origin and keys are discovered exclusively from the local CLI.
// Secrets are never printed, passed in logs, or persisted as artifacts.
const raw=execFileSync('supabase',['status','-o','env'],{
  encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']
});
const entries=Object.fromEntries(raw.split('\n').map(line=>{
  const match=line.match(/^([A-Z_]+)=(.*)$/);
  return match?[match[1],match[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const api=entries.API_URL||entries.SUPABASE_URL;
const key=entries.ANON_KEY||entries.SUPABASE_ANON_KEY||entries.PUBLISHABLE_KEY;
assert.ok(/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/.test(api||''),
 'API must be the local ephemeral Supabase gateway');
assert.ok(key&&key.length>20,'local anonymous/publishable key required');

const health=await fetch(api+'/auth/v1/health',{signal:AbortSignal.timeout(15000)});
assert.ok(health.ok,'local Auth API must be reachable');

for(const edge of ['create-order','merchant-orders']){
  const response=await fetch(api+'/functions/v1/'+edge,{
    method:'POST',
    headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},
    body:JSON.stringify({quoteId:'00000000-0000-4000-8000-000000000001'}),
    signal:AbortSignal.timeout(30000)
  });
  assert.equal(response.status,401,
    edge+' must reject an anonymous order mutation; got HTTP '+response.status);
}

assert.equal(sql("select count(*) from public.orders"),'0',
 'blocked local requests must not write orders');
console.log('PASS: local migrations, RLS with anon role, real Auth/API and anonymous Edge rejection. No payments or production access.');
