import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Only disposable Supabase CI database');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const psql=['--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1'];
const env={...process.env,PGPASSWORD:'postgres'};
const query=q=>execFileSync('psql',[...psql,'--tuples-only','--no-align','--quiet',
 '--command='+q],{env,encoding:'utf8',timeout:90000}).trim();
const before=JSON.parse(query("select json_build_object('invoices',count(*),'holds',count(*) filter (where status='review_required'))::text from public.clube_coupon_paid_invoices"));
const output=execFileSync('psql',[...psql,'--file=tests/fixtures/coupon-late-pix-settlement-v1-853.sql'],{
 env,encoding:'utf8',timeout:90000});
assert.match(output,/ROLLBACK/);
const after=JSON.parse(query("select json_build_object('invoices',count(*),'holds',count(*) filter (where status='review_required'))::text from public.clube_coupon_paid_invoices"));
assert.deepEqual(after,before,'full #853 test must roll back all fabricated financial data');
assert.equal(query("select count(*) from public.clube_coupon_paid_invoices where provider_order_id like 'CI-853-%'"),'0');
assert.equal(query("select has_function_privilege('authenticated','public.clube_coupon_paid_payment_verify(uuid,text,text,integer)','EXECUTE')"),'f');
assert.equal(query("select has_function_privilege('service_role','public.clube_coupon_paid_payment_verify(uuid,text,text,integer)','EXECUTE')"),'t');
console.log('PASS #853: PostgreSQL quarantines late paid partner Pix and pre-payment cancellation, preserves ledger, old coupon issuance and idempotency.');
