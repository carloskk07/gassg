import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261105235000_partner_coupon_discounted_sale_net_separation_v1_848.sql');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const test846=read('tests/isolated-partner-coupon-financial-conservation-v1-846.mjs');
const test847=read('tests/isolated-partner-coupon-cancel-reissue-v1-847.mjs');
assert.ok(sql.length>17000);
assert.match(sql,/DROP CONSTRAINT coupon_sale_requires_verification/);
assert.match(sql,/ADD CONSTRAINT coupon_sale_requires_verification CHECK/);
assert.match(sql,/sale_price_cents::bigint>=coupon_face_cents::bigint\*coupons_per_pack::bigint/);
assert.match(sql,/left\(package_key,8\)='partner_'/);
assert.match(sql,/AND min_order_cents>=1000/);
for(const item of [
 'clube_partner_coupon_purchase_source_v1_848',
 "funding_mode_v1_846='partner_funded'",
 "funding_terms_version_v1_846='clube_partner_coupon_terms_v1_846'",
 "left(i.package_key,8)='partner_'",
 'i.sponsor_covered_cents=0',
 'i.sale_price_cents BETWEEN 100 AND 100000',
 'i.coupon_face_cents BETWEEN 100 AND 500',
 'i.min_order_cents>=1000',
 "i.status='paid'",
 'i.provider_payment_id IS NOT NULL',
 'i.provider_order_id IS NOT NULL'
])assert.ok(sql.includes(item),'Missing safe discounted-sale provenance '+item);
const occurrences=(sql.match(/and not public\.clube_partner_coupon_purchase_source_v1_848\(/g)||[]).length;
assert.equal(occurrences,4,'Must defend net registration + both quote checks + atomic checkout');
assert.ok(sql.includes('public.clube_coupon_sponsor_covered_v1_807'),
 'Old sponsored coupons keep their independent financial backing');
assert.match(sql,/REVOKE ALL ON FUNCTION public\.clube_partner_coupon_purchase_source_v1_848/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.clube_coupon_paid_quote_reserve/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.clube_coupon_paid_create_order/);
assert.doesNotMatch(sql,/UPDATE public\.clube_coupon_paid_invoices\s+SET funding_mode/i);
assert.doesNotMatch(sql,/UPDATE public\.clube_partner_coupon_launch_v1_846\s+SET enabled=true/i);
for(const phrase of [
 'partnerNetCovered','legacyNetCovered||sponsor===faceTotal||partnerNetCovered',
 'terms_version==="clube_partner_coupon_terms_v1_846"',
 "String(row?.package_key??\"\").startsWith(\"partner_\")",
 'Number(row?.sponsor_covered_cents)===0',
 'funding_mode_v1_846,funding_terms_version_v1_846,terms_version,terms_accepted_at'
])assert.ok(edge.includes(phrase),'Buyer readback must match funding proof: '+phrase);
for(const fixture of [test846,test847]){
 assert.ok(fixture.includes('890,500,3,90,1000')||
   fixture.includes('gen_random_uuid(),890,500,3,90,1000'));
 assert.ok(fixture.includes('820,'),
   'Test actual PIX net below face total, not fake full backing');
 assert.ok(!fixture.includes('1500'),'Use real discounted package economics');
}
console.log('PASS #848: merchant-paid R$15 discounts can be backed by real R$8.20 PSP net from R$8.90 coupon sale, but no legacy debt/owner budget is converted.');
