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

// Actual merchant-ops availability gate, extracted from production code,
// must use the canonical SQL payment authority rather than count any route.
const setOnline=ops.indexOf('if(action==="set-online")');
const paymentBegin=ops.indexOf('        const paymentEligibility=await Promise.all(',setOnline);
const paymentGateEnd=ops.indexOf('        const {data:available,error:availableError}',paymentBegin);
assert.ok(paymentBegin>setOnline&&paymentGateEnd>paymentBegin,
 'merchant online must check delivery payment authorization before inventory');
const paymentGate=ops.slice(paymentBegin,paymentGateEnd);
assert.match(paymentGate,/merchant_delivery_payment_allowed/);
assert.doesNotMatch(paymentGate,/paymentRouteCount|merchant_payment_routes.+count/,
 'mere route existence cannot authorize operation');
const gates=['cash','pix','card'];
assert.ok(gates.every(key=>paymentGate.includes('"'+key+'"')));
const evaluated=async ({allowed={},errors={}}={})=>{
 const called=[];
 class TestDomainError extends Error {
  constructor(code,message,status){super(message);this.code=code;this.status=status}
 }
 const merchantId='b384e055-f469-4635-9b3b-4a80af1c814b';
 const ctx=vm.createContext({
  merchantId,Promise,Boolean,DomainError:TestDomainError,
  admin:{rpc:async (name,params)=>{
   called.push({name,params});
   const method=params.p_payment_method;
   return {data:allowed[method]??false,error:errors[method]??null};
  }}
 });
 try{
  await vm.runInContext('(async()=>{'+paymentGate+'return true;})()',ctx);
  return {accepted:true,called};
 }catch(error){
  return {accepted:false,called,error};
 }
};
const validPix=await evaluated({allowed:{pix:true}});
assert.equal(validPix.accepted,true,'Pix with server authorization can be offered');
assert.equal(validPix.called.length,3,'check every delivery method');
assert.ok(validPix.called.every(call=>call.name==='merchant_delivery_payment_allowed'));
assert.ok(validPix.called.every(call=>call.params.p_merchant_id==='b384e055-f469-4635-9b3b-4a80af1c814b'));
const validCard=await evaluated({allowed:{card:true}});
assert.equal(validCard.accepted,true,'SQL authority can validate card_credit/card_debit behind card');
const noDelivery=await evaluated({allowed:{}});
assert.equal(noDelivery.accepted,false,'active online-only route cannot authorize delivery');
assert.equal(noDelivery.error.code,'PAYMENT_METHOD_REQUIRED');
assert.equal(noDelivery.error.status,409);
const noActiveMethod=await evaluated({allowed:{pix:'true'}});
assert.equal(noActiveMethod.accepted,false,'truthy non-boolean must fail closed');
const permissionFailure=await evaluated({errors:{pix:new Error('DB_UNAVAILABLE')},allowed:{card:true}});
assert.equal(permissionFailure.accepted,false,'SQL failure cannot become online permission');
assert.match(permissionFailure.error.message,/DB_UNAVAILABLE/);
const unrelatedMethod=await evaluated({allowed:{card_debit:true}});
assert.equal(unrelatedMethod.accepted,false,'only canonical method names are eligible');


// Exercise the ACTUAL final update block with mutable in-memory DB state.
// These scenarios model a concurrent Admin suspension or delivery edit after
// preflight but before the online=true write. No live merchant is mutated.
const finalStart=ops.indexOf('      let onlineUpdate=admin',setOnline);
const finalEnd=ops.indexOf('      return json({ok:true,...data},200,origin);',finalStart)+
  '      return json({ok:true,...data},200,origin);'.length;
assert.ok(finalStart>setOnline&&finalEnd>finalStart);
const finalBlock=ops.slice(finalStart,finalEnd);
assert.match(finalBlock,/\.eq\("status","active"\)/,
 'online write must conditionally match an active merchant');
assert.match(finalBlock,/\.gte\("delivery_fee_confirmed_at",feeCutoff\)/,
 'delivery fee must remain fresh at the moment of writing');
assert.match(finalBlock,/MERCHANT_READINESS_CHANGED/);
const applyFinalUpdate=async ({online,row}={})=>{
 const filters=[],original={...row};
 const query={
  eq:(column,value)=>{filters.push({column,op:'eq',value});return query;},
  gte:(column,value)=>{filters.push({column,op:'gte',value});return query;},
  select:()=>query,
  maybeSingle:async ()=>{
   const matches=filters.every(f=>f.op==='eq'
    ?row[f.column]===f.value
    :String(row[f.column]??'')>=String(f.value));
   if(matches){
    row.online=online;
    row.last_seen_at='2026-10-22T21:00:00Z';
   }
   return {data:matches?{online:row.online,last_seen_at:row.last_seen_at}:null,error:null};
  }
 };
 class DomainFault extends Error {
  constructor(code,message,status){super(message);this.code=code;this.status=status}
 }
 const sandbox=vm.createContext({
  admin:{from:name=>{assert.equal(name,'merchants');return {update:data=>{
    assert.equal(data.online,online);return query;
  }};}},merchantId:'merchant-a',online,now:'2026-10-22T21:00:00Z',
  Date,DomainError:DomainFault,json:(body,status)=>({body,status})
 });
 let result=null,error=null;
 try {
  result=await vm.runInContext('(async()=>{'+finalBlock+'})()',sandbox);
 }catch(e){error=e}
 return {row,original,filters,result,error};
};
const freshTime=new Date().toISOString();
const baseline=()=>({id:'merchant-a',status:'active',online:false,accepts_citywide:true,
 delivery_fee_confirmed_at:freshTime,last_seen_at:'2026-10-22T20:00:00Z'});
const clean=await applyFinalUpdate({online:true,row:baseline()});
assert.equal(clean.error,null);
assert.equal(clean.result.status,200);
assert.equal(clean.row.online,true);
assert.ok(clean.filters.some(f=>f.column==='status'&&f.value==='active'));
assert.ok(clean.filters.some(f=>f.column==='delivery_fee_confirmed_at'&&f.op==='gte'));
const adminSuspended=await applyFinalUpdate({online:true,row:{...baseline(),status:'suspended'}});
assert.equal(adminSuspended.row.online,false,'a concurrent suspension must not be resurrected');
assert.equal(adminSuspended.error?.code,'MERCHANT_READINESS_CHANGED');
assert.equal(adminSuspended.error?.status,409);
const movedOutsideArea=await applyFinalUpdate({online:true,row:{...baseline(),accepts_citywide:false}});
assert.equal(movedOutsideArea.row.online,false);
assert.equal(movedOutsideArea.error?.code,'MERCHANT_READINESS_CHANGED');
const staleDelivery=await applyFinalUpdate({online:true,row:{...baseline(),
 delivery_fee_confirmed_at:'2020-01-01T00:00:00Z'}});
assert.equal(staleDelivery.row.online,false);
assert.equal(staleDelivery.error?.code,'MERCHANT_READINESS_CHANGED');
const switchOff=await applyFinalUpdate({online:false,row:{...baseline(),
 status:'suspended',online:true,accepts_citywide:false,
 delivery_fee_confirmed_at:'2020-01-01T00:00:00Z'}});
assert.equal(switchOff.error,null);
assert.equal(switchOff.row.online,false,
 'a suspended merchant must always be able to switch availability OFF');
assert.equal(switchOff.filters.length,1,
 'do not add activation preconditions to the emergency OFF action');

console.log('PASS — setup parity plus canonical merchant_delivery_payment_allowed RPC; route and concurrent-activation checks verified.');
