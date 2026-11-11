import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Disposable PostgreSQL only');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=fs.readFileSync(new URL('./sql/welcome-first100-lifecycle-v1-948.sql',import.meta.url),'utf8');
assert.match(sql,/BEGIN;/i);
assert.match(sql,/ROLLBACK;/i);
const out=execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--file=tests/sql/welcome-first100-lifecycle-v1-948.sql'
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:120000,stdio:['pipe','pipe','pipe']});
assert.match(out,/WELCOME_100_CLAIMS_PASS/);
const check=q=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet','--command='+q
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:20000}).trim();
assert.equal(check("select count(*) from public.platform_welcome_grants_v1_815"),'0',
 'Rollback must remove all synthetic awards');
assert.equal(check("select count(*) from public.platform_admin_audit where action='welcome_campaign_control_v1_948'"),'0',
 'Rollback must remove administrative test events');
console.log('V1.948 PASS: unconfirmed/old/anonymous fail, 100 real SQL welcome grants, 101 denied, original ledger, admin ACL, pause/resume/end, replay and ROLLBACK.');
