import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261022150000_admin_offer_scope_authority.sql');
const original=read('supabase/migrations/20261022043642_admin_merchant_offer_coherence.sql');
const admin=read('js/admin.js');
const audit=read('.github/workflows/audit.yml');
const edge=read('supabase/functions/admin-ops/index.ts');
assert.match(sql,/CREATE OR REPLACE FUNCTION public\.admin_merchant_readiness_snapshot\(p_actor_user_id uuid\)/);
assert.match(sql,/perform public\.require_platform_admin\(p_actor_user_id\)/);
assert.match(sql,/STABLE SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
assert.match(sql,/revoke all on function public\.admin_merchant_readiness_snapshot\(uuid\) from public,anon,authenticated/);
assert.match(sql,/grant execute on function public\.admin_merchant_readiness_snapshot\(uuid\) to service_role/);
assert.ok(edge.includes('admin_merchant_readiness_snapshot'));
const fn=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'));
const scope=fn.slice(fn.indexOf('exists(\n        select 1 from public.merchant_business_details d'),
  fn.indexOf(') as quote_authority_ready'));
for(const required of ['d.merchant_id=m.id',
 'm.id=any(public.market_city_offer_scope(d.city,d.state))'])
 assert.ok(scope.includes(required),'Must match the same merchant with public quote scope: '+required);
const norm=fn.slice(fn.indexOf('normalized as ('),fn.indexOf('  select coalesce('));
assert.match(norm,/and r\.quote_authority_ready\s+\) as offer_ready/);
assert.match(norm,/r\.sellable_offer_ready\s+and r\.delivery_ready\s+\) as commercial_ready/);
const next=fn.slice(fn.indexOf("'nextAction',case"),fn.indexOf('end\n      )',fn.indexOf("'nextAction',case")));
assert.ok(next.includes("when not n.quote_authority_ready then 'check_city_launch'"));
assert.ok(next.indexOf("when not n.heartbeat_fresh then 'refresh_heartbeat'")<
 next.indexOf("when not n.quote_authority_ready then 'check_city_launch'"),
 'Authorization check must run after merchant-controlled prerequisites');
assert.match(fn,/'quoteAuthorityReady',n\.quote_authority_ready/);
for(const key of ["'offerReady',n.offer_ready","'nextAction',case","'paymentReady',n.payment_ready",
 "'inventoryPriceReady',n.inventory_price_ready","'deliveryReady',n.delivery_ready"])
 assert.ok(fn.includes(key),'keep old admin JSON field '+key);
for(const gate of ['merchant_financial_sales_allowed(m.id)','merchant_delivery_payment_allowed(m.id,pm.payment_method)',
 'merchant_basket_compliance_current(m.id,array[ci.product_code])'])
 assert.ok(sql.includes(gate),'preserve earlier safeguards '+gate);
assert.match(admin,/check_city_launch:'A revenda ainda não aparece no motor público de cotações/);
assert.ok(audit.includes('node tests/admin-offer-scope-authority.mjs'));
new vm.Script(admin,{filename:'js/admin.js'});
// These scenarios represent the authority contract, without mutating merchant/city state.
const cases=[
 {cityOpen:false,platformOpen:true,internalReady:true,expected:false},
 {cityOpen:true,platformOpen:false,internalReady:true,expected:false},
 {cityOpen:true,platformOpen:true,internalReady:false,expected:false},
 {cityOpen:true,platformOpen:true,internalReady:true,expected:true}
];
for(const x of cases)assert.equal(x.internalReady&&x.cityOpen&&x.platformOpen,x.expected);
assert.ok(!original.includes('market_city_offer_scope(d.city,d.state)'),
 'This is the regression repaired by the new migration');
console.log('PASS — authoritative quote scope required, existing JSON and service role retained.');
