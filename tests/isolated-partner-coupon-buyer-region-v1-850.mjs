import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Only disposable Supabase CI database');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const args=['--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1'];
const env={...process.env,PGPASSWORD:'postgres'};
const query=q=>execFileSync('psql',[...args,'--tuples-only','--no-align','--quiet','--command='+q],{
 encoding:'utf8',env,timeout:90000}).trim();
const before=Number(query('select count(*) from public.clube_coupon_paid_invoices'));
const existing=Number(query('select count(*) from public.clube_coupon_paid_order_applications'));
assert.equal(query("SELECT (public.clube_partner_coupon_sale_readiness_v1_849('partner_general_3x5_849')->>'ready')"),'false',
 'Seller switch must still be sealed');
const output=execFileSync('psql',[...args,'--file=tests/fixtures/partner-coupon-buyer-region-v1-850.sql'],{
 encoding:'utf8',env,timeout:90000});
assert.match(output,/ROLLBACK/);
assert.equal(Number(query('select count(*) from public.clube_coupon_paid_invoices')),before);
assert.equal(Number(query('select count(*) from public.clube_coupon_paid_order_applications')),existing);
assert.equal(query("SELECT (public.clube_partner_coupon_postal_supply_v1_850('00000000')->>'ready')"),'false');
assert.equal(query("SELECT has_function_privilege('authenticated','public.clube_partner_coupon_postal_supply_v1_850(text)','EXECUTE')"),'f');
assert.equal(query("SELECT has_function_privilege('service_role','public.clube_partner_coupon_postal_supply_v1_850(text)','EXECUTE')"),'t');
assert.equal(query("SELECT commerce_enabled::text FROM public.platform_launch_control WHERE singleton"),'true',
 'Only isolated CI should be in synthetic commerce state, not production');
console.log('PASS #850: real Postgres market-city stock, compliance, coupon consent and verified customer CEP; stale/missing/blocked ZIP denied, historical funds untouched.');
