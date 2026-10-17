import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const backend=read('js/backend.js'),merchant=read('js/merchant.js');
const audit=read('.github/workflows/audit.yml');
new vm.Script(backend,{filename:'backend.js'});
const cut=(name,async=false)=>{
  const before=(async?'async ':'')+'function '+name+'(';
  const start=backend.indexOf(before),end=backend.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'Missing '+name);
  return backend.slice(start,end+2);
};
const module=[
 cut('merchantVerifiedActionOrder'),cut('merchantPerformAction',true),
 cut('merchantAssignDeliveryLive',true),cut('merchantCompleteDeliveryLive',true)
].join('\n');
const id='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const now=Date.now();
const iso=ms=>new Date(now+ms).toISOString();
const order={orderId:id,status:'OFFERED_TO_MERCHANT',
  version:11,offerExpiresAt:iso(5*60000)};
const rt={status:'ready',merchant:{merchantId:'M-1'},
  selectedMerchantId:'M-1',lastSyncAt:iso(-60000),
  actionPending:false,error:null,orders:[order]};
const calls=[],renders=[];
const ctx=vm.createContext({
  merchantRuntime:rt,Date,Math,Number,
  render:()=>renders.push('render'),
  liveIdempotency:name=>'test:'+name,
  retryAmbiguousOnce:fn=>fn(),
  merchantInvoke:async(name,payload,options)=>{
    calls.push({name,payload,options});return {ok:true};
  },
  merchantRefreshAfterConfirmedMutation:async()=>true,
  merchantRefresh:async()=>null
});
vm.runInContext(module+'\nthis.check=merchantVerifiedActionOrder;'+
 'this.perform=merchantPerformAction;this.assign=merchantAssignDeliveryLive;'+
 'this.complete=merchantCompleteDeliveryLive;',ctx);
const check=(changes={},action='accept',when=now)=>{
 const initial={...rt},oldOrder={...order};
 Object.assign(rt,changes);
 let result;
 try{result=ctx.check(id,{action,now:when});}
 finally{Object.assign(rt,initial);Object.assign(order,oldOrder);}
 return result;
};
assert.equal(check().orderId,id);
assert.equal(check({lastSyncAt:iso(-120000)}).orderId,id);
assert.throws(()=>check({lastSyncAt:iso(-120001)}),/atualizada/);
assert.throws(()=>check({lastSyncAt:iso(61000)}),/atualizada/);
assert.throws(()=>check({lastSyncAt:null}),/atualizada/);
assert.throws(()=>check({lastSyncAt:'bad-date'}),/atualizada/);
assert.throws(()=>check({status:'unavailable'}),/operação/);
assert.throws(()=>check({merchant:null}),/operação/);
assert.throws(()=>check({selectedMerchantId:'M-2'}),/revenda selecionada/);
assert.throws(()=>ctx.check('other-order',{action:'dispatch',now}),/não encontrado/);
const before=order.offerExpiresAt;
order.offerExpiresAt=iso(-1000);
assert.throws(()=>ctx.check(id,{action:'accept',now}),/prazo de resposta/i);
assert.throws(()=>ctx.check(id,{action:'reject',now}),/prazo de resposta/i);
order.offerExpiresAt=iso(1000);
assert.throws(()=>ctx.check(id,{action:'accept',now}),/prazo de resposta/i);
order.offerExpiresAt='bad';
assert.throws(()=>ctx.check(id,{action:'accept',now}),/prazo de resposta/i);
order.offerExpiresAt=before;
order.status='PREPARING';
assert.throws(()=>ctx.check(id,{action:'accept',now}),/prazo de resposta/i);
order.status='OFFERED_TO_MERCHANT';

// A click in a tab that has been open too long must never reach merchant-action.
const callsBefore=calls.length;
rt.lastSyncAt=iso(-3*60000);
await assert.rejects(()=>ctx.perform(id,'accept'),/atualizada/);
await assert.rejects(()=>ctx.perform(id,'dispatch'),/atualizada/);
await assert.rejects(()=>ctx.assign(id,userId),/atualizada/);
await assert.rejects(()=>ctx.complete(id,'1234',true),/atualizada/);
assert.equal(calls.length,callsBefore,'stale snapshot blocked before RPC');
assert.equal(rt.actionPending,false,'blocked action never enters mutation state');

rt.lastSyncAt=new Date().toISOString();
rt.selectedMerchantId='M-2';
await assert.rejects(()=>ctx.perform(id,'accept'),/revenda selecionada/);
assert.equal(calls.length,callsBefore);
rt.selectedMerchantId='M-1';
order.offerExpiresAt=new Date(Date.now()-1000).toISOString();
await assert.rejects(()=>ctx.perform(id,'accept'),/prazo de resposta/i);
await assert.rejects(()=>ctx.perform(id,'reject'),/prazo de resposta/i);
assert.equal(calls.length,callsBefore);
order.offerExpiresAt=new Date(Date.now()+300000).toISOString();
const reply=await ctx.perform(id,'accept');
assert.equal(reply.ok,true);
assert.equal(calls.length,callsBefore+1);
assert.equal(calls.at(-1).payload.expectedVersion,11);
assert.equal(calls.at(-1).payload.action,'accept');
assert.equal(rt.actionPending,false);
order.status='PREPARING';
await ctx.assign(id,userId);
assert.equal(calls.at(-1).payload.action,'assign-delivery');
assert.equal(calls.at(-1).payload.expectedVersion,11);
order.status='ARRIVING';
await ctx.complete(id,'1234',true);
assert.equal(calls.at(-1).name,'complete-delivery');
assert.equal(calls.at(-1).payload.paymentConfirmed,true);
assert.equal(calls.at(-1).payload.expectedVersion,11);
assert.ok(merchant.includes('function merchantOrderListEvidence(rt,now=Date.now())'),
  'existing visual evidence still required');
assert.ok(audit.includes('node tests/merchant-action-proof-v1-355.mjs'),
  'new action-time guard must be audited');
console.log('TAMÃO V1.355 PASS — action-time snapshot proof, merchant identity, expiry, no stale PIN/assignment RPC, version check.');
