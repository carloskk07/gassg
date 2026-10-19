import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261019163000_regional_firewood_charcoal_ice_variants.sql');
const core=read('js/core.js');
const merchant=read('js/merchant.js');
const offers=read('supabase/functions/get-offers/index.ts');
new vm.Script(core,{filename:'js/core.js'});
const records=[...sql.matchAll(/\('([A-Z][A-Z0-9_]+)','([^']+)','(barbecue|ice)','household_general',false,true,true,true,(\d+)\)/g)]
  .map(m=>({code:m[1],name:m[2],category:m[3],order:Number(m[4])}));
assert.equal(records.length,15,'15 independent sellable variants');
assert.equal(new Set(records.map(r=>r.code)).size,records.length,'no duplicate SKU');
assert.equal(records.filter(r=>r.code.startsWith('WOOD_')).length,3,'saco cento milheiro');
assert.equal(records.filter(r=>r.code.startsWith('CHARCOAL')).length,5,'charcoal bag weights');
assert.equal(records.filter(r=>r.code.startsWith('ICE')).length,7,'ice cubes crushed and block');
for(const code of ['WOOD_SACK','WOOD_100','WOOD_1000','CHARCOAL2',
 'CHARCOAL3','CHARCOAL5','CHARCOAL8','CHARCOAL10','ICE2','ICE3','ICE10',
 'ICE_CRUSH5','ICE_BLOCK','ICE_BLOCK10','ICE_BLOCK20']){
 assert.ok(records.some(r=>r.code===code),'registered '+code);
 assert.match(core,new RegExp('\\b'+code+':\\{name:'),'client can name '+code);
}
assert.match(sql,/on conflict \(product_code\) do nothing/,
 'never overwrite active Admin-controlled products');
assert.doesNotMatch(sql,/insert into public\.catalog_items|price_cents|available_stock/i,
 'no sale, invented price, or stock created by regional registry');
assert.match(merchant,/merchantCatalogHistoryView/,
 'continue using one existing merchant catalog/workspace');
assert.match(offers,/.from\("catalog_items"\)/,
 'server offers still use merchant-specific confirmed SKU price');
assert.match(offers,/.gte\("price_confirmed_at", priceCutoff\)/,
 'new SKUs may not bypass 24-hour price gate');
console.log('PASS: 15 regional SKUs, exact units, original catalog preserved, no prices invented, server eligibility maintained.');
