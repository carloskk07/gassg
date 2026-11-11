import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// V1.953: only disposable GitHub PostgreSQL, no production env or PSP.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');

const args=['--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet'];
const env={...process.env,PGPASSWORD:'postgres'};
const psql=(extra)=>execFileSync('psql',[...args,...extra],{
 encoding:'utf8',env,timeout:90000,stdio:['ignore','pipe','pipe']
}).trim();
const count=t=>psql(['--command=select count(*) from public.'+t]);
const tables=['merchant_fee_credit_ledger','merchant_billing_payment_requests',
 'merchant_billing_payment_events','merchant_billing_plan_history'];
const before=tables.map(count);
assert.equal(before[0],'0','disposable merchant ledger must start empty');
assert.equal(before[1],'0','disposable requests must start empty');
const fixture=fileURLToPath(new URL('./fixtures/merchant-prepaid-lifecycle-v1-953.sql',import.meta.url));
psql(['--file='+fixture]);
const after=tables.map(count);
assert.deepEqual(after,before,'ROLLBACK must remove every synthetic request, credit and PSP artifact');
assert.equal(psql(['--command=select count(*) from public.merchant_billing_accounts where credit_balance_cents<>0 or credit_reserved_cents<>0']),'0');
console.log('V1.953 PASS: 4 prepay packages, exact snapshots, replay, cancellation, synthetic admin and ledger, downgrade denied, ROLLBACK.');
