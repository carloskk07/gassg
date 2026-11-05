import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261105033500_mobility_ride_receipt_v1_829.sql',import.meta.url),'utf8');
const isolated=fs.readFileSync(new URL('isolated-mobility-full-lifecycle-v1-493.mjs',import.meta.url),'utf8');
for(const requirement of [
 'mobility_ride_receipts_v1_829',
 'agreed_fare_cents',
 'discount_cents integer not null default 0',
 'direct_due_cents integer generated always',
 "payment_evidence text not null default 'not_verified'",
 'check(discount_cents=0)',
 'MOBILITY_RECEIPT_IMMUTABLE',
 'MOBILITY_RECEIPT_CONFLICT',
 'mobility_ride_receipt_finalize_v1_829',
 'mobility_ride_receipt_finalize_v1_829_trg',
 'alter table public.mobility_ride_receipts_v1_829 enable row level security',
 'revoke all on public.mobility_ride_receipts_v1_829 from public,anon,authenticated',
 'rider_accepted_at is not null'
])assert.ok(sql.includes(requirement),requirement);
for(const bad of ['insert into public.wallet_entries','merchant_fee_credit_ledger','merchant_billing_payment_events','pix','payment_verified=true'])
 assert.ok(!sql.toLowerCase().includes(bad.toLowerCase()),'recibo não pode simular pagamento/crédito: '+bad);
assert.match(isolated,/IMMUTABLE_MOBILITY_RECEIPT_INCORRECT/);
assert.match(isolated,/RIDER_READ_PRIVATE_RECEIPT_STORAGE/);
assert.match(isolated,/RECEIPT_MODIFICATION_ALLOWED/);
console.log('TAMÃO #829: recibo registra contrato, nunca quitação ou benefício inexistente.');
