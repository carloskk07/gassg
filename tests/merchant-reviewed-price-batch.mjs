import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const merchant=read('js/merchant.js'),source=read('js/merchant-price-batch.js'),ci=read('.github/workflows/audit.yml');
new vm.Script(merchant,{filename:'js/merchant.js'});
new vm.Script(source,{filename:'js/merchant-price-batch.js'});
const start=source.indexOf('let merchantBulkPriceBusy=false;');
const end=source.indexOf('\nasync function merchantLiveSaveProduct(',start);
assert.ok(start>0&&end>start,'batch uses the existing catalog update API');
const functionSource=source.slice(start,end);
assert.doesNotMatch(functionSource,/merchantInvoke\s*\(|\.rpc\s*\(|fetch\s*\(/,
 'no new server call or unaudited mutation');
assert.match(functionSource,/await merchantUpdateProductLive\(/,
 'commit each reviewed SKU through the existing protected path');
assert.match(merchant,/\$\{batchReview\}/,'catalog renders the explicit review controls');
assert.match(merchant,/id="merchant-review-price-/,'each selected SKU has its own checkbox');
assert.match(merchant,/function merchantCatalogMarkEdited\(/,
 'unsaved edits remain visible and independently saved');
assert.match(merchant,/typeof merchantBulkPriceBusy!=='undefined'/,
 'per-item save is suspended while a reviewed batch runs');
assert.match(ci,/node tests\/merchant-reviewed-price-batch\.mjs/);


assert.match(merchant,/function merchantPriceBatchStart\(/,'deferred handler present');
assert.match(merchant,/merchant-price-batch\.js/,'load only after the user clicks');
assert.match(merchant,/merchantPriceBatchStart\(\)/,'button uses the deferred handler');
assert.doesNotMatch(merchant,/async function merchantLiveConfirmReviewedPrices\(/,
 'bulk mutation logic must not inflate Admin initial script');
const old='2026-10-10T12:00:00.000Z';
const item=(code,{range=false}={})=>({
 productCode:code,productName:code,active:true,availableStock:5,
 priceCents:range?12000:1800,
 pricingMode:range?'range':'fixed',pricingStrategy:'balanced',
 minPriceCents:range?11500:1800,maxPriceCents:range?13500:1800,
 priceConfirmedAt:old,updatedAt:old
});
const rt={status:'ready',merchant:{merchantId:'merchant-1',memberRole:'owner'},
 actionPending:false,catalog:[item('P13',{range:true}),item('WATER20')]};
const inputs={};const notifications=[],writes=[];
let allow=true,drafts=false,failAt=null,changeNext=false;
const loadInputs=()=>{
 for(const p of rt.catalog){
  const c=p.productCode;
  inputs['merchant-review-price-'+c]={checked:false};
  inputs['live-price-'+c]={value:(p.priceCents/100).toFixed(2)};
  inputs['live-stock-'+c]={value:String(p.availableStock)};
  inputs['live-active-'+c]={checked:p.active};
  inputs['live-pricing-mode-'+c]={value:p.pricingMode};
  inputs['live-pricing-strategy-'+c]={value:p.pricingStrategy};
  inputs['live-min-price-'+c]={value:(p.minPriceCents/100).toFixed(2)};
  inputs['live-max-price-'+c]={value:(p.maxPriceCents/100).toFixed(2)};
 }
};
loadInputs();
const context=vm.createContext({
 globalThis:{merchantRuntime:rt},document:{getElementById:id=>inputs[id]||null},
 merchantTimestampFresh:date=>Number.isFinite(Date.parse(date))&&Date.now()-Date.parse(date)<=86400000,
 merchantQuickHasDrafts:()=>drafts,
 merchantUpdateProductLive:async(code,price,stock,active)=>{
  writes.push({code,price,stock,active});
  if(failAt===code)throw new Error('CATALOG_VERSION_CONFLICT');
  const found=rt.catalog.find(p=>p.productCode===code);
  found.priceConfirmedAt=new Date().toISOString();
  found.updatedAt=new Date().toISOString();
  if(changeNext){
   const next=rt.catalog.find(p=>p.productCode==='WATER20');
   next.updatedAt=new Date().toISOString();
  }
 },
 toast:message=>notifications.push(String(message)),
 confirm:()=>allow,
 Date,Number,String,Array,Math
});
vm.runInContext(functionSource+'\nthis.run=merchantLiveConfirmReviewedPrices;',context);
await context.run();
assert.equal(writes.length,0,'no selection must never auto-confirm');
assert.match(notifications.at(-1),/Marque os preços/);
inputs['merchant-review-price-P13'].checked=true;
inputs['live-stock-P13'].value='6';
await context.run();
assert.equal(writes.length,0,'unsaved form edits are not overwritten');
assert.match(notifications.at(-1),/alterações ainda não salvas/);
inputs['live-stock-P13'].value='5';
drafts=true;
await context.run();
assert.equal(writes.length,0,'quick edit draft blocks bulk price confirmation');
drafts=false;allow=false;
await context.run();
assert.equal(writes.length,0,'cancel means no writes');
allow=true;
rt.merchant.memberRole='driver';
await context.run();
assert.equal(writes.length,0,'driver may not confirm prices');
rt.merchant.memberRole='owner';
failAt='P13';
await context.run();
assert.equal(writes.length,1,'one guarded operation attempted');
assert.match(notifications.at(-1),/0 de 1 preço\(s\).*CATALOG_VERSION_CONFLICT/);
failAt=null;
await context.run();
assert.equal(writes.length,2,'retry uses a new mutation after a failed attempt');
assert.match(notifications.at(-1),/1 preço\(s\) reconfirmado/);
assert.ok(Date.now()-Date.parse(rt.catalog[0].priceConfirmedAt)<5000);
assert.equal(writes.at(-1).price,12000,'never changes current saved price');
assert.equal(writes.at(-1).stock,5,'never changes current stock');
assert.equal(writes.at(-1).active,true);
loadInputs();inputs['merchant-review-price-WATER20'].checked=true;
inputs['merchant-review-price-P13'].checked=false;
await context.run();
assert.equal(writes.at(-1).code,'WATER20');
assert.match(notifications.at(-1),/1 preço\(s\) reconfirmado/);

// A different session can change the 2nd SKU during the 1st server write.
// Check the snapshot again and fail closed; do not silently approve the 2nd.
rt.catalog=[item('P13',{range:true}),item('WATER20')];
loadInputs();inputs['merchant-review-price-P13'].checked=true;
inputs['merchant-review-price-WATER20'].checked=true;
changeNext=true;const countBefore=writes.length;
await context.run();
assert.equal(writes.length,countBefore+1,'never write 2nd SKU when its version changed');
assert.match(notifications.at(-1),/1 de 2 preço\(s\) reconfirmado\(s\)/);
assert.match(notifications.at(-1),/cadastro mudou/);
rt.merchant.memberRole='manager';
rt.status='unauthenticated';
const noAuth=writes.length;
await context.run();
assert.equal(writes.length,noAuth,'logout blocks batch');
console.log('PASS: checked-only batch, draft conflicts, role scope, version re-check, partial failure and server confirmation.');
