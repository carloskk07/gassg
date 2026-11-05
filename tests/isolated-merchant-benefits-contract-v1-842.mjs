import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Disposable PostgreSQL only');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=q=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+q
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:90000}).trim();
for(const table of ['merchant_benefit_participations_v1_842','merchant_benefit_events_v1_842']){
 assert.equal(sql('select count(*) from public.'+table),'0',table+' must start empty');
 assert.equal(sql("select has_table_privilege('authenticated','public."+table+"','SELECT')"),'f');
}
assert.equal(sql("select has_function_privilege('authenticated','public.merchant_benefits_contract_v1_842(uuid,uuid,text,integer,integer,uuid,boolean)','EXECUTE')"),'f');
assert.equal(sql("select has_function_privilege('service_role','public.merchant_benefits_contract_v1_842(uuid,uuid,text,integer,integer,uuid,boolean)','EXECUTE')"),'t');
const fixture=fs.readFileSync(new URL('./fixtures/merchant-benefits-contract-v1-842.sql',import.meta.url),'utf8');
assert.ok(fixture.endsWith('ROLLBACK;\n'),'fixture must be rollback-only');
sql(fixture);
for(const table of ['merchant_benefit_participations_v1_842','merchant_benefit_events_v1_842']){
 assert.equal(sql('select count(*) from public.'+table),'0','No synthetic contract data persisted: '+table);
}
console.log('TAMÃO #842: merchant benefits owner consent, version race, replay, revocation, ACL and no financial mutation.');
