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


// First POSITIVE, persisted SQL journey against actual TAMÃO business code.
// Only synthetic actors and an already-offered *local* cash order are inserted.
// It never passes through checkout or a PSP, and every write is ROLLED BACK.
const cancellationTransaction = String.raw`
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, is_sso_user, is_anonymous)
VALUES
('00000000-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, false),
('00000000-0000-4000-8000-000000000024', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, false);

-- Only this local transaction may flip the synthetic launch flag. All
-- required governance columns are filled with an in-transaction fixture
-- identity; ROLLBACK restores PRELAUNCH and removes the actor.
UPDATE public.platform_launch_control
SET commerce_enabled=true,
    operation_mode='LIVE',
    enabled_at=clock_timestamp(),
    enabled_by='00000000-0000-4000-8000-000000000021'::uuid,
    portals_source_sha=repeat('f',40),
    mode_source_sha=repeat('f',40),
    customer_portal_ok=true,merchant_portal_ok=true,admin_portal_ok=true
WHERE singleton=true;

INSERT INTO public.merchants(id,name,cnpj,status,online)
VALUES (
 '00000000-0000-4000-8000-000000000022',
 'Revenda Ficticia CI',
 '00000000000001',
 'pending',
 false
);

-- A real order INSERT is protected by guard_new_order_delivery_payment.
-- The fixture must satisfy that guard; bypassing it would invalidate the test.
INSERT INTO public.merchant_payment_methods(merchant_id,payment_method,active)
VALUES('00000000-0000-4000-8000-000000000022','cash',true);
INSERT INTO public.merchant_payment_routes(
 merchant_id,payment_method,provider,channel,verification_mode,active
) VALUES(
 '00000000-0000-4000-8000-000000000022',
 'cash','manual','delivery','merchant_confirmed',true
);

INSERT INTO public.orders(
 id,public_code,customer_id,merchant_id,status,address_text,
 payment_method,gross_total_cents,total_cents,attempted_merchant_ids,
 offer_expires_at
) VALUES(
 '00000000-0000-4000-8000-000000000023',
 'SIMULADO-CANCEL-CI',
 '00000000-0000-4000-8000-000000000021',
 '00000000-0000-4000-8000-000000000022',
 'OFFERED_TO_MERCHANT',
 'Endereco ficticio de teste local',
 'cash',2500,2500,
 ARRAY['00000000-0000-4000-8000-000000000022'::uuid],
 clock_timestamp()+interval '3 minutes'
);

DO $check$
DECLARE
 first_result jsonb;
 replay_result jsonb;
BEGIN
 first_result := public.customer_order_action(
   '00000000-0000-4000-8000-000000000021'::uuid,
   '00000000-0000-4000-8000-000000000023'::uuid,
   'cancel-before-accept',
   1,'isolated-cancel-before-accept-001',repeat('a',64)
 );
 IF first_result->>'status' IS DISTINCT FROM 'CANCELLED'
    OR (first_result->>'version')::int IS DISTINCT FROM 2 THEN
   RAISE EXCEPTION 'CANCEL_RESULT_INVALID';
 END IF;
 IF (SELECT status<>'CANCELLED' OR version<>2 FROM public.orders
       WHERE id='00000000-0000-4000-8000-000000000023') THEN
   RAISE EXCEPTION 'CANCEL_DB_TRANSITION_INVALID';
 END IF;
 IF (SELECT count(*) FROM public.order_events
       WHERE order_id='00000000-0000-4000-8000-000000000023'
       AND event_type='CANCELLED')<>1 THEN
   RAISE EXCEPTION 'CANCEL_EVENT_COUNT_INVALID';
 END IF;
 replay_result := public.customer_order_action(
   '00000000-0000-4000-8000-000000000021'::uuid,
   '00000000-0000-4000-8000-000000000023'::uuid,
   'cancel-before-accept',
   1,'isolated-cancel-before-accept-001',repeat('a',64)
 );
 IF replay_result IS DISTINCT FROM first_result THEN
   RAISE EXCEPTION 'CANCEL_IDEMPOTENCY_INVALID';
 END IF;
 IF (SELECT count(*) FROM public.order_events
       WHERE order_id='00000000-0000-4000-8000-000000000023'
       AND event_type='CANCELLED')<>1 THEN
   RAISE EXCEPTION 'CANCEL_DUPLICATED_EVENT';
 END IF;
 IF (SELECT count(*) FROM public.wallet_entries)>0
    OR (SELECT count(*) FROM public.order_reward_grants)>0 THEN
   RAISE EXCEPTION 'CANCEL_CREATED_REWARDS_WITHOUT_PAYMENT';
 END IF;
END $check$;
SELECT (SELECT status='CANCELLED' AND version=2 FROM public.orders
        WHERE id='00000000-0000-4000-8000-000000000023');
ROLLBACK;
`;
const cancellationOutput=sql(cancellationTransaction);
assert.ok(cancellationOutput.split('\n').includes('t'),
  'real local customer cancellation must mutate and expose status CANCELLED');
assert.equal(sql('select count(*) from public.orders'),'0',
  'positive transaction must be rolled back');
assert.equal(sql('select count(*) from public.merchants'),'0',
  'fake merchant must never persist');
assert.equal(sql("select count(*) from public.platform_launch_control where commerce_enabled"),'0',
  'local LIVE flag must be rolled back to PRELAUNCH');
assert.equal(sql("select count(*) from auth.users where id='00000000-0000-4000-8000-000000000021'"),'0',
  'fake customer must never persist');
assert.equal(sql('select count(*) from public.order_events'),'0',
  'cancellation history must be rolled back');
assert.equal(sql('select count(*) from public.wallet_entries'),'0',
  'no ledger entry survives isolated test');

console.log('PASS: isolated SQL permissions, PRELAUNCH refusal, real customer cancellation/idempotency, transaction rollback; no PSP.');
