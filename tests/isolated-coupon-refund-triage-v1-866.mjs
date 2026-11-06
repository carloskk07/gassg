import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Disposable database CI only');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const env={...process.env,PGPASSWORD:'postgres'};
const out=execFileSync('psql',[
  '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
  '--no-psqlrc','--set=ON_ERROR_STOP=1',
  '--file=tests/fixtures/coupon-refund-triage-v1-866.sql'
],{env,encoding:'utf8',timeout:90000});
assert.match(out,/ROLLBACK/);
console.log('PASS #866 — finance-only immutable triage, historical liability, replay, no double decision, unchanged funds.');
