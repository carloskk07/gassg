import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Disposable PostgreSQL CI only');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=q=>execFileSync('psql',['--host=127.0.0.1','--port=54322',
 '--username=postgres','--dbname=postgres','--no-psqlrc',
 '--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+q],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:90000,stdio:['ignore','pipe','pipe']}).trim();
const old=fs.readFileSync(new URL('./isolated-mobility-fee-accrual-v1-835.mjs',import.meta.url),'utf8');
const m=old.match(/const probe=("(?:\\.|[^"\\])*");/);
assert.ok(m,'Use full completion/driver/rider fixtures from #835');
const before=JSON.parse(m[1]);
assert.ok(before.endsWith('ROLLBACK;'));
const tail=fs.readFileSync(new URL('./fixtures/mobility-fee-pix-v1-837.sql',import.meta.url),'utf8');
sql(before.slice(0,-'ROLLBACK;'.length)+tail+'\nROLLBACK;');
for(const table of ['mobility_fee_pix_invoices_v1_837','mobility_fee_pix_evidence_v1_837',
 'mobility_fee_pix_invoice_lines_v1_837','mobility_platform_fee_accruals_v1_835']){
 assert.equal(sql('select count(*) from public.'+table),'0',table+' rolled back');
}
console.log('TAMÃO #837: cobrança Pix isolada, idempotência, recuperação, refund e segurança.');
