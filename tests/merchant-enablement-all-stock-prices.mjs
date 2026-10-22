import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261022131211_merchant_enablement_all_stocked_prices.sql');
const old=read('supabase/migrations/20261010200000_merchant_guided_enablement_v1_158.sql');
const edge=read('supabase/functions/merchant-ops/index.ts');
assert.match(migration,/CREATE OR REPLACE FUNCTION public\.merchant_enablement_diagnostic_v1_158\(/);
assert.match(migration,/STABLE SECURITY DEFINER/);
assert.match(migration,/t\.id=any\(public\.market_city_offer_scope\(t.city,t.state\)\)/);
assert.match(migration,/mm\.merchant_id=m\.id and mm\.user_id=p_actor_user_id/);
assert.match(migration,/mm\.active and mm\.member_role in \('owner','manager'\)/);
assert.match(migration,/not exists \(\s*select 1 from public\.catalog_items stocked/);
const start=migration.indexOf('and not exists (');
const end=migration.indexOf(') as stock_price_ok,',start);
assert.ok(start>0&&end>start,'coherent stock freshness gate');
const gate=migration.slice(start,end);
for(const term of ['stocked.merchant_id=t.id','stocked.active and stocked.available_stock>0',
 'stocked.price_cents<=0','stocked.price_confirmed_at is null',
 "stocked.price_confirmed_at<statement_timestamp()-interval '24 hours'"]){
 assert.ok(gate.includes(term),'missing stale gate '+term);
}
assert.ok(migration.includes('public.merchant_basket_compliance_current(t.id,array[ci.product_code])'),
 'retain one lawful offer in addition to freshness of all stocked SKUs');
for(const term of ['merchant_representative_verification_current','merchant_financial_sales_allowed',
 'merchant_delivery_payment_allowed','merchant_allowed_in_operation_mode','market_city_offer_scope','c.authoritative_offer_ready']){
 assert.ok(migration.includes(term),'existing diagnostic gate removed '+term);
}
assert.ok(migration.includes("revoke all on function public.merchant_enablement_diagnostic_v1_158(uuid,uuid) from public, anon, authenticated"));
assert.ok(migration.includes("grant execute on function public.merchant_enablement_diagnostic_v1_158(uuid,uuid) to service_role"));
assert.match(edge,/if\(stale.length\)/);
assert.match(edge,/PRICE_CONFIRMATION_REQUIRED/);
const scenarios=[
 {desc:'Fresh eligible water but stale gas',items:[{active:true,stock:4,price:1000,fresh:true,compliant:true},{active:true,stock:1,price:10500,fresh:false,compliant:false}],expected:false},
 {desc:'Both stocked prices fresh, one eligible',items:[{active:true,stock:4,price:1000,fresh:true,compliant:true},{active:true,stock:1,price:10500,fresh:true,compliant:false}],expected:true},
 {desc:'Zero-stock stale SKU ignored',items:[{active:true,stock:4,price:1000,fresh:true,compliant:true},{active:true,stock:0,price:10500,fresh:false,compliant:false}],expected:true},
 {desc:'No lawful offer',items:[{active:true,stock:4,price:1000,fresh:true,compliant:false}],expected:false},
 {desc:'Missing price for in-stock SKU',items:[{active:true,stock:4,price:1000,fresh:true,compliant:true},{active:true,stock:3,price:0,fresh:true,compliant:false}],expected:false}
];
const current=items=>items.some(p=>p.active&&p.stock>0&&p.price>0&&p.fresh&&p.compliant)
 && !items.some(p=>p.active&&p.stock>0&&(!p.fresh||p.price<=0));
for(const s of scenarios)assert.equal(current(s.items),s.expected,s.desc);
assert.equal(old.includes('merchant_enablement_diagnostic_v1_158'),true);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/merchant-enablement-all-stock-prices.mjs'));
console.log('PASS owner-scoped enablement requires all stocked prices fresh, a lawful offer and existing admin/market safeguards.');
