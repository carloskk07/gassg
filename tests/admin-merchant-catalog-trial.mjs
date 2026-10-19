import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/admin.js');
new vm.Script(source,{filename:'js/admin.js'});
const start=source.indexOf('// Read-only simulator for a merchant');
const end=source.indexOf('function adminDetailView(){',start);
assert.ok(start>=0&&end>start,'internal merchant calculator must live inside Admin 360');
const helper=source.slice(start,end);
assert.doesNotMatch(helper,/adminInvoke\s*\(|\.rpc\s*\(|adminSetMerchantStatus\s*\(|liveCreateOrder\s*\(|chamaFetch\s*\(/,
 'calculator must make no network/transaction/activation calls');
assert.match(source,/\$\{adminMerchantTrialView\(d\)\}/,
 'Admin merchant drawer includes the simulator');
assert.match(source,/adminRuntime\.merchantTrial=null/,
 'session logout must clear historic simulated values');

let roleAllowed=true,loggedIn=true,rendered=0;
let user='11111111-1111-4111-8111-111111111111';
const merchantId='b384e055-f469-4635-9b3b-4a80af1c814b';
const merchant={id:merchantId,name:'Carlos Santos',status:'pending',online:false,
 delivery_fee_cents:0};
const detail={type:'merchant',merchant,catalog:[
 {product_code:'P13',product_name:'Gás P13',price_cents:11590,
  min_price_cents:11470,max_price_cents:12790,
  pricing_mode:'range',available_stock:10,active:true,
  price_confirmed_at:'2026-10-15T17:51:14Z'},
 {product_code:'WATER20',product_name:'Água 20 L',price_cents:1590,
  pricing_mode:'fixed',available_stock:10,active:true,
  price_confirmed_at:'2026-10-15T17:52:23Z'},
 {product_code:'WOOD',product_name:'Lenha',price_cents:2500,
  pricing_mode:'fixed',available_stock:10,active:true,
  price_confirmed_at:'2026-10-15T17:53:18Z'}
]};
const runtime={status:'ready',detail,merchantTrial:null,session:{user:{id:user}}};
const input={
 'admin-merchant-trial-sku':'WATER20',
 'admin-merchant-trial-qty':'2',
 'admin-merchant-trial-benefit':'5,00'
};
const ctx=vm.createContext({
 adminRuntime:runtime,
 adminReady:()=>loggedIn,
 adminRoleCanSection:()=>roleAllowed,
 adminFinanceLabCents:raw=>{
   const value=String(raw||'').replace(',','.');
   return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)
     ?Math.round(Number(value)*100):null;
 },
 adminMoney:c=>'R$ '+(c/100).toFixed(2),
 esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
 formatDateTime:iso=>String(iso),
 document:{getElementById:id=>({value:input[id]})},
 render:()=>{rendered++},
 Date,Number,String,Array,Object
});
vm.runInContext(helper+
 ';this.calc=adminMerchantTrialEstimate;this.view=adminMerchantTrialView;'+
 'this.calculate=adminMerchantTrialCalculate;',ctx);

let result=ctx.calc(detail,'WATER20',2,500);
assert.equal(result.ok,true);
assert.equal(result.subtotalCents,3180);
assert.equal(result.originalTotalCents,3180);
assert.equal(result.simulatedTotalCents,2680);
assert.equal(result.orderCreated,false);
assert.equal(result.paymentCreated,false);
assert.equal(result.publicQuote,false);
assert.equal(result.merchantActivated,false);
assert.equal(result.complianceVerified,false);
const gas=ctx.calc(detail,'P13',1,0);
assert.equal(gas.ok,true);
assert.equal(gas.hasPriceRange,true);
assert.equal(gas.minUnitPriceCents,11470);
assert.equal(gas.maxUnitPriceCents,12790);
assert.equal(gas.unitPriceCents,11590);
assert.match(ctx.view(detail),/Revenda não disponível para pedidos reais/);
assert.match(ctx.view(detail),/Preço sem reconfirmação/);
ctx.calculate();
assert.ok(rendered>0);
assert.equal(runtime.merchantTrial.merchantId,merchantId);
assert.equal(runtime.merchantTrial.adminUserId,user);
assert.match(ctx.view(detail),/R\$ 31\.80/);
assert.match(ctx.view(detail),/R\$ 26\.80/);
assert.match(ctx.view(detail),/Taxa de entrega cadastrada \(não verificada\)/);
assert.match(ctx.view(detail),/Nenhum valor foi cobrado nem creditado/);
assert.equal(ctx.calc(detail,'P13',11,0).ok,false,'stock limit');
assert.equal(ctx.calc(detail,'P13',21,0).ok,false,'max qty');
assert.equal(ctx.calc(detail,'P13',1,20000).ok,false,'benefit cannot exceed gross');
assert.equal(ctx.calc(detail,'UNKNOWN',1,0).ok,false,'unlisted product');
assert.equal(ctx.calc(detail,'WATER20',0,0).ok,false,'zero quantity');
assert.equal(ctx.calc(detail,'WATER20',1,NaN).ok,false,'invalid hypothetical benefit');
detail.catalog[1].active=false;
assert.equal(ctx.calc(detail,'WATER20',1,0).ok,false,'paused SKU');
detail.catalog[1].active=true;
input['admin-merchant-trial-qty']='0';
ctx.calculate();
assert.match(ctx.view(detail),/Quantidade, preço, estoque ou benefício inválidos/);
input['admin-merchant-trial-qty']='2';
runtime.session.user.id='22222222-2222-4222-8222-222222222222';
assert.doesNotMatch(ctx.view(detail),/R\$ 26\.80/,'no leakage across admins');
roleAllowed=false;
assert.equal(ctx.view(detail),'');
loggedIn=false;
input['admin-merchant-trial-qty']='2';
const before=rendered;
ctx.calculate();
assert.equal(rendered,before,'logged out user cannot calculate');
console.log('PASS: Admin 360 saved merchant catalogue, quantity, hypothetical discount, stale price, no order/PIX, cross-admin isolation.');
