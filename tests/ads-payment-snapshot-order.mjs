import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const planner=fs.readFileSync(new URL('../js/ads-planner.js',import.meta.url),'utf8');
const purchase=fs.readFileSync(new URL('../js/ads-independent-purchase.js',import.meta.url),'utf8');
const owner='11000000-0000-4000-8000-000000000001';
const campaign='22000000-0000-4000-8000-000000000002';
const other='33000000-0000-4000-8000-000000000003';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const row=(payment='checkout_ready',status='approved')=>({id:campaign,title:'Campanha local',
 city:'São Gabriel',state:'RS',budgetCents:1990,durationDays:7,status,effectiveStatus:status,
 fixedFeeStatus:payment,fixedFeePixPayable:payment==='checkout_ready',
 fixedFeePixCode:'original-owned-pix-code-'.repeat(3),
 fixedFeePixExpiresAt:new Date(Date.now()+3600000).toISOString()});
const ledger=(payment='checkout_ready',status='approved')=>({source:'ads_independent_mine_v1_884',
 noCharge:true,rows:[row(payment,status)],fixedFeeSalesEnabled:true});
function fixture(){
 const calls=[],reads=[],timers=new Map(),messages=[];let clock=0;
 const runtime={status:'ready',authGeneration:1,session:{user:{id:owner,
  is_anonymous:false,email_confirmed_at:'2026-11-15T00:00:00Z'}}};
 const context=vm.createContext({liveRuntime:runtime,liveReady:()=>runtime.status==='ready',
  route:()=> 'sponsors',esc:String,render:()=>{},toast:x=>messages.push(x),
  document:{visibilityState:'visible',getElementById:()=>({checked:true}),querySelector:()=>null},
  navigator:{clipboard:{writeText:async()=>assert.fail('no clipboard write in readback test')}},
  crypto:{randomUUID:()=>campaign},URL,Date,Number,String,Array,Object,Math,Map,Promise,
  setTimeout:(fn,ms)=>{timers.set(++clock,{fn,ms});return clock},clearTimeout:id=>timers.delete(id),
  liveInvoke:async(endpoint,payload)=>{
   calls.push({endpoint,...payload});
   if(endpoint==='ads-independent'&&payload.action==='mine'){
    const next=deferred();reads.push(next);return next.promise;
   }
   assert.equal(endpoint,'ads-independent-checkout');assert.equal(payload.action,'reconcile');
   return {source:'ads_independent_reconcile_v1_886',status:'payment_approved',paymentApproved:true};
  }});
 vm.runInContext(planner+'\n'+purchase+'\nthis.flow={refresh:tamaoAdsMyRefresh,'+
  'state:()=>tamaoAdsMyState,view:tamaoAdsCampaignForm,verify:tamaoAdsVerifyPayment,'+
  'auto:()=>tamaoAdsAutoPayment,stop:tamaoAdsAutoPaymentStop,'+
  'busy:()=>tamaoAdsPurchaseBusy};',context);
 return {context,runtime,calls,reads,timers,messages,flow:context.flow};
}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve()}

// The first HTTP response was captured before payment. It must not overwrite
// the newer readback and make an already-paid Pix visible again.
{
 const f=fixture(),old=f.flow.refresh({quiet:true,autoReconcile:false}),
  fresh=f.flow.refresh({quiet:true,autoReconcile:false});
 f.reads[1].resolve(ledger('payment_approved','active'));assert.equal(await fresh,true);
 f.reads[0].resolve(ledger());assert.equal(await old,false);
 assert.equal(f.flow.state().rows[0].fixedFeeStatus,'payment_approved');
 assert.doesNotMatch(f.flow.view(),/Pix copia e cola|Pagamento ainda não confirmado/);
 assert.match(f.flow.view(),/campanha ativa/i);
 assert.doesNotMatch(f.flow.view(),/aguarda publicação/i);
}
// Same account after logout/login is a different session generation.
{
 const f=fixture(),old=f.flow.refresh({quiet:true,autoReconcile:false});
 f.runtime.authGeneration++;
 f.reads[0].resolve(ledger());assert.equal(await old,false);
 assert.equal(f.flow.state().rows.length,0);
}
// Switching accounts triggers the new owner's history automatically and
// never displays the previous owner's private campaigns.
{
 const f=fixture(),first=f.flow.refresh({quiet:true,autoReconcile:false});
 f.reads[0].resolve(ledger('payment_approved','active'));await first;
 f.runtime.session.user.id=other;f.runtime.authGeneration++;
 assert.doesNotMatch(f.flow.view(),/Campanha local|original-owned-pix/);
 const scheduled=[...f.timers.values()].find(t=>t.ms===0);assert.ok(scheduled);
 scheduled.fn();await flush();assert.equal(f.reads.length,2);
 f.reads[1].resolve({...ledger(),rows:[]});await flush();
 assert.equal(f.flow.state().userId,other);assert.equal(f.flow.state().rows.length,0);
}
// Automatic provider reconciliation must share the same sequence guard as
// ordinary screen reads; a prior pending response cannot resurrect its Pix.
{
 const f=fixture(),start=f.flow.refresh({quiet:true});
 f.reads[0].resolve(ledger());await start;
 const old=f.flow.refresh({quiet:true,autoReconcile:false});
 const scheduled=[...f.timers.values()].find(t=>t.ms===1200);assert.ok(scheduled);
 const poll=scheduled.fn();await flush();assert.equal(f.reads.length,3);
 f.reads[2].resolve(ledger('payment_approved','active'));await poll;
 f.reads[1].resolve(ledger());assert.equal(await old,false);
 assert.equal(f.flow.state().rows[0].fixedFeeStatus,'payment_approved');
 assert.match(f.messages.at(-1),/campanha ativa/i);
}
// An old automatic cycle cannot stop or unlock the new account's cycle.
{
 const f=fixture(),start=f.flow.refresh({quiet:true});f.reads[0].resolve(ledger());await start;
 const scheduled=[...f.timers.values()].find(t=>t.ms===1200);
 const oldPoll=scheduled.fn();await flush();
 f.runtime.session.user.id=other;f.runtime.authGeneration++;
 const fresh=f.flow.refresh({quiet:true});f.reads.at(-1).resolve(ledger());await fresh;
 const nextCycle=f.flow.auto().epoch;
 f.reads[1].resolve(ledger('payment_approved'));await oldPoll;
 assert.equal(f.flow.auto().userId,other);assert.equal(f.flow.auto().epoch,nextCycle);
 assert.equal(f.flow.auto().campaignId,campaign);
 assert.equal(f.messages.length,0);
}
// Manual checking does not announce approval until a separate owned ledger
// agrees, and a delayed provider response after logout makes no claim.
{
 const f=fixture(),check=f.flow.verify(campaign);await flush();
 assert.equal(f.messages.length,0,'provider ACK alone must not announce a payment');
 f.reads[0].resolve(ledger());await check;
 assert(!f.messages.some(x=>/confirmou o pagamento|campanha ativa/i.test(x)));
}
{
 const f=fixture(),provider=deferred();
 f.context.liveInvoke=async()=>provider.promise;
 const old=f.flow.verify(campaign);await flush();f.runtime.authGeneration++;
 provider.resolve({source:'ads_independent_reconcile_v1_886',status:'payment_approved',paymentApproved:true});
 await old;assert.equal(f.reads.length,0);assert.equal(f.messages.length,0);
}
// A late completion from the previous account cannot unlock the current
// account's manual check; its buttons remain busy until its own readback.
{
 const f=fixture(),providers=[];
 f.context.liveInvoke=async(endpoint,payload)=>{
  f.calls.push({endpoint,...payload});const next=deferred();
  if(endpoint==='ads-independent-checkout')providers.push(next);else f.reads.push(next);
  return next.promise;
 };
 const old=f.flow.verify(campaign);await flush();
 f.runtime.session.user.id=other;f.runtime.authGeneration++;
 f.flow.view();assert.equal(f.flow.busy(),false);
 const fresh=f.flow.verify(campaign);await flush();assert.equal(f.flow.busy(),true);
 providers[0].resolve({source:'ads_independent_reconcile_v1_886',status:'payment_approved',paymentApproved:true});
 await old;assert.equal(f.flow.busy(),true);assert.equal(f.messages.length,0);
 providers[1].resolve({source:'ads_independent_reconcile_v1_886',status:'payment_approved',paymentApproved:true});
 await flush();f.reads[0].resolve(ledger('payment_approved','paused'));await fresh;
 assert.equal(f.flow.busy(),false);assert.match(f.messages.at(-1),/campanha pausada/i);
}
// Payment and publication have separate states; showing payment does not
// resume, publish or extend any campaign.
for(const [status,label] of [['active','campanha ativa'],['paused','campanha pausada'],
 ['ended','veiculação encerrada'],['expired','veiculação encerrada'],['approved','aguarda publicação']]){
 const f=fixture(),read=f.flow.refresh({quiet:true,autoReconcile:false});
 f.reads[0].resolve(ledger('payment_approved',status));await read;
 assert(f.flow.view().includes(label));
 assert.deepEqual(f.calls.map(x=>x.action),['mine']);
}
assert(!fixture().calls.some(x=>x.action==='purchase'));
console.log('PASS: latest owned Ads snapshot wins, no paid Pix resurrection, auth-generation isolation, fresh account loading and matching provider/ledger receipt.');
