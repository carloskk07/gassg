import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const merchant=read('js/merchant.js');
const audit=read('.github/workflows/audit.yml');
new vm.Script(merchant,{filename:'merchant.js'});
function take(name){
  const start=merchant.indexOf('function '+name+'(');
  const end=merchant.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'missing '+name);
  return merchant.slice(start,end+2);
}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const time=seconds=>new Date(Date.now()+seconds*1000).toISOString();
const offer={orderId:id(1),status:'OFFERED_TO_MERCHANT',offerExpiresAt:time(200)};
const delivery={orderId:id(2),status:'OUT_FOR_DELIVERY'};
const arriving={orderId:id(3),status:'ARRIVING'};
const risk={orderId:id(4),status:'AT_RISK'};
const support={orderId:id(5),status:'PREPARING',supportCases:[{category:'late',status:'open'}]};
const noIssue={orderId:id(6),status:'PREPARING'};
const rt={
 status:'ready',error:null,actionPending:false,
 merchant:{merchantId:id(90),memberRole:'owner'},
 selectedMerchantId:id(90),lastSyncAt:new Date().toISOString(),
 supportSummary:{version:1,scope:'merchant-active-orders'},orders:[offer,delivery,arriving,risk,support,noIssue]
};
const focus=[];
const ctx=vm.createContext({
 Date,globalThis:{merchantRuntime:rt},
 merchantFocusLiveOrder:x=>{focus.push(['review',x]);return true},
 merchantFocusOrderNextStep:x=>{focus.push(['field',x]);return true},
 merchantSupportCasesForOrder:o=>Array.isArray(o.supportCases)?o.supportCases:[]
});
vm.runInContext(take('merchantOrderListEvidence')+'\n'+take('merchantUnifiedFocusOrder')+
 '\nthis.go=merchantUnifiedFocusOrder;',ctx);
const run=(x,lane)=>{focus.length=0;const result=ctx.go(x,lane);return {result,focus:[...focus]}};
let x=run(id(1),'offers');
assert.equal(x.result,true);
assert.deepEqual(x.focus,[['field',id(1)]],'offer should focus the accept control');
assert.deepEqual(run(id(2),'delivery').focus,[['field',id(2)]]);
assert.deepEqual(run(id(3),'delivery').focus,[['field',id(3)]]);
assert.deepEqual(run(id(4),'issues').focus,[['review',id(4)]]);
assert.deepEqual(run(id(5),'issues').focus,[['review',id(5)]]);
for(const [item,lane] of [[id(2),'offers'],[id(1),'delivery'],[id(6),'issues'],
 [id(1),'risk'],[id(99),'offers'],["');alert(1)//",'offers']]){
 x=run(item,lane);assert.equal(x.result,false, 'must reject wrong lane or order '+item);
 assert.equal(x.focus.length,0);
}
offer.offerExpiresAt=time(-12);
assert.equal(run(id(1),'offers').result,false,'expired offer should never focus accept');
offer.offerExpiresAt=null;
assert.equal(run(id(1),'offers').result,false);
offer.offerExpiresAt='2035-99-99T12:00:00Z';
assert.equal(run(id(1),'offers').result,false);
offer.offerExpiresAt=time(200);
rt.actionPending=true;assert.equal(run(id(1),'offers').result,false);
rt.actionPending=false;
rt.lastSyncAt=new Date(Date.now()-150000).toISOString();
assert.equal(run(id(1),'offers').result,false,'outdated snapshot must block context action');
rt.lastSyncAt=new Date().toISOString();
rt.selectedMerchantId=id(91);
assert.equal(run(id(1),'offers').result,false,'wrong selected merchant must block');
rt.selectedMerchantId=id(90);
rt.status='no-access';assert.equal(run(id(1),'offers').result,false);
rt.status='ready';rt.error='network unavailable';assert.equal(run(id(1),'offers').result,false);
rt.error=null;
for(const role of ['driver','guest','finance']){
 rt.merchant.memberRole=role;
 assert.equal(run(id(1),'offers').result,false);
}
rt.merchant.memberRole='operator';
assert.equal(run(id(1),'offers').result,true,'operator allowed when order authorized');
rt.merchant.memberRole='owner';
rt.orders=[offer];
assert.equal(run(id(5),'issues').result,false,'no old-session order can be focused');
const guard=take('merchantUnifiedFocusOrder');
assert.doesNotMatch(guard,/\.(click|submit)\(|merchantLiveAction\(|merchantLiveDeliver\(|merchantPerformAction\(|adminSetSupportStatus|fetch\(/);
assert.match(guard,/merchantOrderListEvidence\(rt\)\.fresh/);
assert.match(guard,/merchantFocusOrderNextStep\(id\)/);
assert.match(guard,/merchantFocusLiveOrder\(id\)/);
const board=take('merchantUnifiedOpsBoard');
assert.match(board,/merchantUnifiedFocusOrder/);
assert.doesNotMatch(board,/merchantLiveAction\(|merchantCompleteDeliveryLive\(/);
assert.ok(audit.includes('node tests/merchant-contextual-shortcuts-v1-392.mjs'));
console.log('TAMÃO V1.392 PASS — focus verified next steps only, no automatic order actions, stale/role/merchant isolation preserved.');
