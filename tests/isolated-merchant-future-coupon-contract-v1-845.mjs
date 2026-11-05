import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Disposable PostgreSQL runner only');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=q=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+q
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:90000}).trim();
for(const t of ['merchant_coupon_consents_v1_845','merchant_coupon_consent_events_v1_845']){
 assert.equal(sql('select count(*) from public.'+t),'0','No existing synthetic coupon consent');
 assert.equal(sql("select has_table_privilege('authenticated','public."+t+"','SELECT')"),'f');
}
assert.equal(sql("select has_function_privilege('authenticated','public.merchant_coupon_contract_v1_845(uuid,uuid,text,integer,integer,uuid,boolean)','EXECUTE')"),'f');
assert.equal(sql("select has_function_privilege('service_role','public.merchant_coupon_contract_v1_845(uuid,uuid,text,integer,integer,uuid,boolean)','EXECUTE')"),'t');
const fixture=fs.readFileSync(new URL('./fixtures/merchant-future-coupon-contract-v1-845.sql',import.meta.url),'utf8');
assert.ok(fixture.endsWith('ROLLBACK;\n'),'No test data may persist');
sql(fixture);
for(const t of ['merchant_coupon_consents_v1_845','merchant_coupon_consent_events_v1_845'])
 assert.equal(sql('select count(*) from public.'+t),'0','ROLLBACK preserved for '+t);
console.log('PASS #845: PostgreSQL owner consent, RLS, version conflicts, immutable events and prior coupon rights.');
