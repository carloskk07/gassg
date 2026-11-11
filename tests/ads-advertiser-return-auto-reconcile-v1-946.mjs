import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const planner=read('js/ads-planner.js');
new vm.Script(planner);
const id='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222';
let currentUser=owner,currentRoute='sponsors',provider='checkout_ready',
 ledger='checkout_ready',enabled=true,visible=true;
let calls=[],timers=new Map(),nextId=0,rendered=0;
const getRows=()=>[{id,title:'Campanha aprovada',status:'approved',
 fixedFeeStatus:ledger,budgetCents:1990,durationDays:7}];
const ctx=vm.createContext({
 liveRuntime:{status:'ready',session:{user:{
  id:owner,is_anonymous:false,email_confirmed_at:'2026-11-11T03:00:00Z'
 }}},
 liveReady:()=>true,
 route:()=>currentRoute,
 document:{visibilityState:'visible',getElementById:()=>null},
 async liveInvoke(endpoint,payload){
  calls.push({endpoint,action:payload.action});
  if(endpoint==='ads-independent'&&payload.action==='mine')
   return {source:'ads_independent_mine_v1_884',noCharge:true,rows:getRows(),
    fixedFeeSalesEnabled:true};
  assert.equal(endpoint,'ads-independent-checkout');
  assert.equal(payload.action,'reconcile');
  assert.equal(payload.campaignId,id);
  assert.notEqual(payload.action,'purchase');
  return {source:'ads_independent_reconcile_v1_886',
    status:provider,paymentApproved:provider==='payment_approved',
    autoPublished:false,netSettlementVerified:false};
 },
 setTimeout:(fn,ms)=>{const token=++nextId;timers.set(token,{fn,ms});return token},
 clearTimeout:token=>timers.delete(token),
 toast:()=>{},render:()=>{rendered++},
 URL,Date,String,Number,Array,Object,Math,Map,Promise,crypto:{randomUUID:()=>id}
});
vm.runInContext(planner+'\nthis.api={refresh:tamaoAdsMyRefresh,'+
 'getState:()=>tamaoAdsAutoPayment,stop:tamaoAdsAutoPaymentStop,'+
 'getMine:()=>tamaoAdsMyState};',ctx);
const {refresh,getState,getMine}=ctx.api;
const take=async ms=>{
 const found=[...timers.entries()].find(([id,t])=>t.ms===ms);
 assert.ok(found,'missing '+ms+'ms attempt');
 timers.delete(found[0]);await found[1].fn();
};
await refresh({quiet:true});
assert.equal(calls.length,1,'initial view performs only its ordinary owned mine');
assert.equal(calls[0].action,'mine');
assert.equal(getState().campaignId,id);
await take(1200);
assert.deepEqual(calls.map(x=>x.action),['mine','reconcile']);
assert.equal(getMine().rows[0].fixedFeeStatus,'checkout_ready');
assert.equal(getState().tries,1);
await refresh({quiet:true});
assert.equal(calls.filter(x=>x.action==='reconcile').length,1,
 're-render must not restart or duplicate automatic reconciliation');
assert.equal([...timers.values()].filter(t=>t.ms===180000).length,1);
provider='payment_approved';ledger='payment_approved';
await take(180000);
assert.deepEqual(calls.slice(-2).map(x=>x.action),['reconcile','mine'],
 'success needs a distinct owner-verified ledger readback');
assert.equal(getMine().rows[0].fixedFeeStatus,'payment_approved');
assert.equal(getState().timer,null);
assert.equal(getState().campaignId,null);
assert.ok(rendered>=2);
assert(!calls.some(x=>x.action==='purchase'),'automatic status must never create a checkout');
// Same user / new visit after approval does not check provider or create charges.
const count=calls.length;
await refresh({quiet:true});
assert.equal(calls.length,count+1);
assert.equal(calls.at(-1).action,'mine');
assert.equal([...timers.values()].filter(t=>t.ms===1200).length,0);
// New pending session, provider approval without matching owner ledger MUST NOT
// be advertised as paid. Reconciliation is PSP fact, not a browser badge.
ledger='checkout_ready';provider='payment_approved';
await refresh({quiet:true});
await take(1200);
assert.equal(getMine().rows[0].fixedFeeStatus,'checkout_ready');
assert.ok([...timers.values()].some(t=>t.ms===180000),
 'unverified ledger readback keeps bounded automatic follow-up');
// Switch account before next scheduled provider call.
ctx.liveRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
const before=calls.length;
await take(180000);
assert.equal(calls.length,before,'account switch must stop private provider checks');
assert.equal(getState().campaignId,null);
assert(!calls.some(x=>x.action==='purchase'));
console.log('V1.946 PASS: original advertiser checkout auto-checked on return, approved only after owner ledger, bounded retries, no duplicate purchase or cross-account leak.');
