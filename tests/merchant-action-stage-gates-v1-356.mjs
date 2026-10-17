import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const backend=read('js/backend.js'),audit=read('.github/workflows/audit.yml');
new vm.Script(backend,{filename:'backend.js'});
const cut=(name,async=false)=>{
 const at=backend.indexOf((async?'async ':'')+'function '+name+'('),end=backend.indexOf('\n}',at);
 assert.ok(at>=0&&end>at,'missing '+name);
 return backend.slice(at,end+2);
};
const source=['merchantVerifiedActionOrder','merchantPerformAction','merchantAssignDeliveryLive','merchantCompleteDeliveryLive']
 .map((name,i)=>cut(name,i!==0)).join('\n');
const uuid='11111111-1111-4111-8111-111111111111';
const deliveryId='22222222-2222-4222-8222-222222222222';
const now=Date.now();
const rt={
 status:'ready',merchant:{merchantId:'merchant-one',memberRole:'manager'},selectedMerchantId:'merchant-one',
 lastSyncAt:new Date(now-5000).toISOString(),actionPending:false,error:null,
 orders:[{orderId:uuid,status:'PREPARING',version:5,offerExpiresAt:new Date(now+300000).toISOString()}]
};
const calls=[];
const ctx=vm.createContext({
 merchantRuntime:rt,Date,Number,Math,String,Object,
 render:()=>{},liveIdempotency:k=>'idempotent:'+k,
 merchantInvoke:async(name,payload)=>{calls.push({name,payload});return {ok:true};},
 retryAmbiguousOnce:f=>f(),merchantRefreshAfterConfirmedMutation:async()=>true,
 merchantRefresh:async()=>true
});
vm.runInContext(source+'\nthis.check=merchantVerifiedActionOrder;this.perform=merchantPerformAction;this.assign=merchantAssignDeliveryLive;this.complete=merchantCompleteDeliveryLive;',ctx);
const order=rt.orders[0];
const expectedStates={
 accept:['OFFERED_TO_MERCHANT'],reject:['OFFERED_TO_MERCHANT'],
 dispatch:['PREPARING','AT_RISK'],arriving:['OUT_FOR_DELIVERY'],
 'cannot-fulfill':['PREPARING','AT_RISK'],
 'assign-delivery':['PREPARING','AT_RISK'],
 'complete-delivery':['ARRIVING']
};
const statuses=['OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','AT_RISK',
 'OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED','CANCELLED','OTHER'];
for(const [action,allowed] of Object.entries(expectedStates)){
 for(const status of statuses){
  order.status=status;
  if(allowed.includes(status)){
   assert.equal(ctx.check(uuid,{action,now}),order,'valid '+action+' at '+status);
  }else{
   assert.throws(()=>ctx.check(uuid,{action,now}),/etapa|prazo de resposta/,
    'invalid '+action+' at '+status+' must fail locally');
  }
 }
}
const invalid=['',null,0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'8'];
for(const version of invalid){
 order.status='PREPARING';order.version=version;
 assert.throws(()=>ctx.check(uuid,{action:'dispatch',now}),/versão do pedido/);
}
order.version=5;
for(const [name,status,invoke] of [
 ['dispatch','OFFERED_TO_MERCHANT',()=>ctx.perform(uuid,'dispatch')],
 ['arriving','PREPARING',()=>ctx.perform(uuid,'arriving')],
 ['cannot-fulfill','ARRIVING',()=>ctx.perform(uuid,'cannot-fulfill')],
 ['assign-delivery','OUT_FOR_DELIVERY',()=>ctx.assign(uuid,deliveryId)],
 ['complete-delivery','PREPARING',()=>ctx.complete(uuid,'1234',true)]
]){
 order.status=status;
 const prior=calls.length;
 await assert.rejects(invoke,/etapa/,name);
 assert.equal(calls.length,prior,name+' must not invoke server');
 assert.equal(rt.actionPending,false);
}
order.status='PREPARING';order.version=null;
await assert.rejects(()=>ctx.perform(uuid,'dispatch'),/versão do pedido/);
assert.equal(calls.length,0);
order.version=5;
for(const [action,status] of [
 ['dispatch','PREPARING'],['cannot-fulfill','AT_RISK'],['arriving','OUT_FOR_DELIVERY']
]){
 order.status=status;
 const result=await ctx.perform(uuid,action);
 assert.equal(result.ok,true,action);
 assert.equal(calls.at(-1).payload.expectedVersion,5);
 assert.equal(calls.at(-1).payload.action,action);
}
order.status='PREPARING';
assert.equal((await ctx.assign(uuid,deliveryId)).ok,true);
assert.equal(calls.at(-1).payload.deliveryUserId,deliveryId);
assert.equal(calls.at(-1).payload.expectedVersion,5);
order.status='ARRIVING';
assert.equal((await ctx.complete(uuid,'1234',true)).ok,true);
assert.equal(calls.at(-1).name,'complete-delivery');
assert.equal(calls.at(-1).payload.expectedVersion,5);
order.status='OFFERED_TO_MERCHANT';
assert.equal((await ctx.perform(uuid,'accept')).ok,true);
assert.equal((await ctx.perform(uuid,'reject')).ok,true);
assert.ok(calls.every(call=>call.payload.expectedVersion===5));
assert.ok(backend.includes("merchantVerifiedActionOrder(orderId,{action:'assign-delivery'})"));
assert.ok(backend.includes("merchantVerifiedActionOrder(orderId,{action:'complete-delivery'})"));
assert.ok(audit.includes('node tests/merchant-action-stage-gates-v1-356.mjs'));
console.log('TAMÃO V1.356 PASS — every merchant mutation gated by valid stage/version before RPC, legitimate flows unchanged.');
