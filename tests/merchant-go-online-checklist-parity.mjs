import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/merchant.js');
const ops=read('supabase/functions/merchant-ops/index.ts');
const audit=read('.github/workflows/audit.yml');
new vm.Script(js,{filename:'js/merchant.js'});
const take=name=>{
 const i=js.indexOf('function '+name+'('),j=js.indexOf('\n}',i);
 assert.ok(i>=0&&j>i,'missing production function '+name);
 return js.slice(i,j+2);
};
const now=new Date().toISOString(),old='2020-01-01T12:00:00Z';
const active=(code,confirmedAt=now,stock=3)=>({
 productCode:code,active:true,availableStock:stock,priceCents:1500,priceConfirmedAt:confirmedAt
});
const m={merchantId:'m1',memberRole:'owner',status:'active',online:false,
 acceptsCitywide:true,deliveryFeeConfirmedAt:now,
 paymentMethods:{pix:true,card:false,cash:false}};
const rt={status:'ready',merchant:m,catalog:[active('WATER20'),active('WOOD',old)],
 paymentRoutes:[{paymentMethod:'pix',active:true}]};
const sandbox=vm.createContext({globalThis:{merchantRuntime:rt},Date,Number,Array,String,Boolean});
vm.runInContext(take('merchantTimestampFresh')+'\n'+take('merchantLiveFreshness')+
 '\n'+take('merchantSetupSnapshot')+
 '\nthis.snapshot=merchantSetupSnapshot;this.freshness=merchantLiveFreshness;',sandbox);
let steps=Array.from(sandbox.snapshot(rt));
assert.equal(steps[0].done,false,'one fresh SKU cannot certify all active stocked SKUs');
assert.match(steps[0].detail,/1 de 2 produto\(s\)/);
assert.equal(sandbox.freshness().allFresh,false,'existing backend-aligned preflight blocks activation');
rt.catalog[1].priceConfirmedAt=now;
steps=Array.from(sandbox.snapshot(rt));
assert.equal(steps[0].done,true,'every stocked SKU has fresh price');
assert.match(steps[0].detail,/2 de 2 produto\(s\)/);
rt.catalog[1].priceConfirmedAt=old;
rt.catalog[1].availableStock=0;
steps=Array.from(sandbox.snapshot(rt));
assert.equal(steps[0].done,true,'zero-stock stale item does not block availability');
rt.catalog[1].availableStock=3;rt.catalog[1].active=false;
assert.equal(sandbox.snapshot(rt)[0].done,true,'inactive products are not offered');
rt.catalog=[active('DISABLED',old,0)];
assert.equal(sandbox.snapshot(rt)[0].done,false,'cannot mark products ready without stock');
rt.catalog=[active('WATER20')];
assert.equal(sandbox.snapshot(rt)[0].done,true);
rt.paymentRoutes=[];
assert.equal(sandbox.snapshot(rt)[2].done,false,'no valid payment route');
rt.paymentRoutes=[{paymentMethod:'pix',active:false}];
assert.equal(sandbox.snapshot(rt)[2].done,false,'inactive payment route cannot count');
rt.paymentRoutes=[{paymentMethod:'pix',active:true}];
assert.equal(sandbox.snapshot(rt)[2].done,true,'active matching route counts');
m.paymentMethods={pix:false,card:true,cash:false};
rt.paymentRoutes=[{paymentMethod:'card_debit',active:true}];
assert.equal(sandbox.snapshot(rt)[2].done,true,'card and card-debit route compatibility remains');
m.paymentMethods={pix:true,card:false,cash:false};
rt.paymentRoutes=[{paymentMethod:'pix',active:true}];

const page=js.slice(js.indexOf('function merchantLivePage(){'),
 js.indexOf('\nfunction merchantScheduledDispatchState(',js.indexOf('function merchantLivePage(){')));
const paymentStart=page.indexOf('  const paymentReady=merchantSetupSnapshot(rt)');
const paymentEnd=page.indexOf('  const freshnessNotice=',paymentStart);
const canGoOnline=page.match(/const canGoOnline=m\.status==='active'&&complianceReady&&commercialReady&&!financialHold;/)?.[0];
assert.ok(paymentStart>=0&&paymentEnd>paymentStart&&canGoOnline,
 'production availability decisions must reuse the same payment-route checklist');
const jsCalc=page.slice(paymentStart,paymentEnd)+'\n  '+canGoOnline+'\n  return {paymentReady,commercialReady,canGoOnline};';
const decide=(status='active',complianceReady=true,financialHold=false)=>{
 m.status=status;const freshness=sandbox.freshness();
 const ctx=vm.createContext({rt,m,freshness,complianceReady,financialHold,
 merchantSetupSnapshot:sandbox.snapshot,freshnessProblems:[]});
 return vm.runInContext('(function(){'+jsCalc+'})()',ctx);
};
assert.equal(decide().canGoOnline,true,'valid merchant, current products, city and route');
rt.paymentRoutes=[];
assert.equal(decide().canGoOnline,false,'online toggle must not promise readiness without route');
rt.paymentRoutes=[{paymentMethod:'pix',active:true}];
m.acceptsCitywide=undefined;
assert.equal(decide().canGoOnline,false,'unknown delivery coverage must not authorize online');
m.acceptsCitywide=true;
assert.equal(decide('pending').canGoOnline,false,'admin must activate merchant');
assert.equal(decide('active',false).canGoOnline,false,'CNPJ/ANP compliance is required');
assert.equal(decide('active',true,true).canGoOnline,false,'financial hold blocks activation');
rt.catalog=[active('WATER20'),active('WOOD',old)];
assert.equal(decide().canGoOnline,false,'stale second active SKU blocks activation');
assert.ok(ops.includes('if(stale.length)')&&ops.includes('PRICE_CONFIRMATION_REQUIRED'),
 'merchant-ops still rejects stale active stocked products');
assert.ok(ops.includes('PAYMENT_METHOD_REQUIRED'),
 'merchant-ops still requires active receiving routes');
assert.ok(audit.includes('node tests/merchant-go-online-checklist-parity.mjs'));
console.log('PASS — setup and go-online use every active stocked SKU, active receiving route, explicit area and server gates.');
