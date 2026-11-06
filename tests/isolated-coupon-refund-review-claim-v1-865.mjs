import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','CI disposable Supabase only');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const args=['--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1'];
const env={...process.env,PGPASSWORD:'postgres'};
const output=execFileSync('psql',[...args,'--file=tests/fixtures/coupon-refund-review-claim-v1-865.sql'],
 {env,encoding:'utf8',timeout:90000});
assert.match(output,/ROLLBACK/);
console.log('PASS #865: atomic review claim, financial role, idempotent retry, no second claimant, rollback and unchanged money.');
