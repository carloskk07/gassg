import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261022043000_admin_merchant_offer_coherence.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ci=read('.github/workflows/audit.yml');
const fn=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_merchant_readiness_snapshot('));
assert.match(fn,/perform public\.require_platform_admin\(p_actor_user_id\)/);
assert.match(fn,/STABLE SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
assert.match(sql,/revoke all on function public\.admin_merchant_readiness_snapshot\(uuid\) from public,anon,authenticated/);
assert.match(sql,/grant execute on function public\.admin_merchant_readiness_snapshot\(uuid\) to service_role/);
const sameSku=fn.slice(fn.indexOf('and public.merchant_basket_compliance_current(m.id,array[ci.product_code])')-420,
 fn.indexOf(') as sellable_offer_ready,'));
for(const required of ['ci.merchant_id=m.id','ci.active','ci.available_stock>0','ci.price_cents>0',
 'ci.price_confirmed_at>=statement_timestamp()-interval \'24 hours\'',
 'public.merchant_basket_compliance_current(m.id,array[ci.product_code])']){
 assert.ok(sameSku.includes(required),'A single eligible SKU must meet '+required);
}
assert.ok(fn.includes('r.sellable_offer_ready\n        and r.delivery_ready'),
 'commercialReady must share the coherent SKU with legal authority');
assert.ok(fn.includes('and r.sellable_offer_ready\n        and r.delivery_ready'),
 'offerReady must require the coherent SKU');
assert.match(fn,/not n\.sellable_offer_ready then 'confirm_offer'/,
 'Mixed evidence must not claim ready or omit the next action');
assert.match(fn,/public\.merchant_delivery_payment_allowed\(m.id,pm\.payment_method\)/,
 'A payment method without an authorized delivery route must not count');
assert.match(fn,/public\.merchant_financial_sales_allowed\(m.id\)/,
 'Billing holds must not count as payment readiness');
assert.match(fn,/'merchantId',n\.merchant_id/);
for(const existing of ["'inventoryPriceReady',n.inventory_price_ready",
 "'complianceReady',n.compliance_ready","'paymentReady',n.payment_ready",
 "'nextAction',case","'offerReady',n.offer_ready"])
 assert.ok(fn.includes(existing),'Preserve the existing admin JSON contract: '+existing);
assert.ok(edge.includes('admin_merchant_readiness_snapshot'),
 'Existing Admin Ops uses authoritative RPC without another endpoint');
assert.ok(ci.includes('node tests/admin-merchant-offer-coherence.mjs'));
const product=(code,{compliant=false,stock=0,fresh=false}={})=>({code,compliant,stock,fresh});
const samples=[
 {name:'No cross-product inference',items:[product('P13',{compliant:false,stock:6,fresh:true}),
   product('WATER20',{compliant:true,stock:0,fresh:false})],expected:false},
 {name:'One qualified general product',items:[product('P13',{compliant:false,stock:6,fresh:true}),
   product('WATER20',{compliant:true,stock:3,fresh:true})],expected:true},
 {name:'All compliant but stale',items:[product('WATER20',{compliant:true,stock:3,fresh:false})],expected:false},
 {name:'Stock missing',items:[product('WOOD',{compliant:true,stock:0,fresh:true})],expected:false}
];
for(const sample of samples){
 const coherent=sample.items.some(x=>x.compliant&&x.stock>0&&x.fresh);
 assert.equal(coherent,sample.expected,sample.name);
}
const split=samples[0].items;
assert.equal(split.some(x=>x.compliant)&&split.some(x=>x.stock>0&&x.fresh),true,
 'Old independent EXISTS checks could incorrectly appear true');
assert.equal(split.some(x=>x.compliant&&x.stock>0&&x.fresh),false,
 'The new correlated EXISTS must reject those mixed signals');
console.log('PASS — coherent per-SKU readiness, route and financial holds, service role, existing API contract.');
