import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Disposable PostgreSQL required');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=q=>execFileSync('psql',['--host=127.0.0.1','--port=54322',
 '--username=postgres','--dbname=postgres','--no-psqlrc',
 '--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+q],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:90000,stdio:['ignore','pipe','pipe']}).trim();
const original=fs.readFileSync(new URL('./isolated-mobility-fee-accrual-v1-835.mjs',import.meta.url),'utf8');
const match=original.match(/const probe=("(?:\\.|[^"\\])*");/);
assert.ok(match,'Original ride / fare fixture');
const before=JSON.parse(match[1]);
assert.ok(before.endsWith('ROLLBACK;'));
const extra=fs.readFileSync(new URL('./fixtures/mobility-prepaid-credit-v1-838.sql',import.meta.url),'utf8');
for(const table of ['mobility_fee_prepaid_lots_v1_838','mobility_fee_prepaid_uses_v1_838']){
 assert.equal(sql('select count(*) from public.'+table),'0','No synthetic balances in commercial DB');
 assert.equal(sql("select has_table_privilege('authenticated','public."+table+"','SELECT')"),'f');
}
for(const signature of [
 'public.mobility_fee_pix_prepare_credit_v1_838(uuid,text)',
 'public.mobility_fee_prepaid_reserve_v1_838(uuid,uuid,integer)']){
 assert.equal(sql("select has_function_privilege('authenticated','"+signature+"','EXECUTE')"),'f');
}
sql(before.slice(0,-'ROLLBACK;'.length)+extra+'\nROLLBACK;');
for(const table of ['mobility_fee_prepaid_lots_v1_838','mobility_fee_prepaid_uses_v1_838',
 'mobility_fee_pix_invoices_v1_837','mobility_platform_fee_accruals_v1_835']){
 assert.equal(sql('select count(*) from public.'+table),'0','No fixture persisted: '+table);
}
console.log('TAMÃO #838: payment-proofed prepaid plan, no double grant, cancellation refund, completion, insufficient credit fallback and reversal freeze.');
