import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('js/backend.js');
const merchant=read('js/merchant.js');
const audit=read('.github/workflows/audit.yml');
new vm.Script(backend,{filename:'backend.js'});
const pick=name=>{
  const key=(name==='merchantVerifiedActionOrder'?'function ':'async function ')+name+'(';
  const start=backend.indexOf(key),end=backend.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'missing function '+name);
  return backend.slice(start,end+2);
};
const names=['merchantVerifiedActionOrder','merchantRefreshAfterConfirmedMutation',
  'merchantPerformAction','merchantAssignDeliveryLive','merchantCompleteDeliveryLive'];
const block=names.map(pick).join('\n');
const orderId='11111111-1111-4111-8111-111111111111';
const deliveryUserId='22222222-2222-4222-8222-222222222222';

function fixture({reply={ok:true},status='OFFERED_TO_MERCHANT',failRefresh=false}={}){
  const calls=[];
  let refreshes=0;
  const original={orderId,version:12,status,
    offerExpiresAt:new Date(Date.now()+90000).toISOString()};
  const rt={status:'ready',merchant:{merchantId:'M-1'},selectedMerchantId:'M-1',
    lastSyncAt:new Date().toISOString(),orders:[original],error:null,actionPending:false};
  const ctx=vm.createContext({
    Date,Math,Number,merchantRuntime:rt,render:()=>{},
    liveIdempotency:kind=>'idemp:'+kind,
    retryAmbiguousOnce:fn=>fn(),
    merchantInvoke:async(endpoint,payload)=>{
      calls.push({endpoint,payload});
      return reply;
    },
    merchantRefresh:async()=>{
      refreshes++;
      if(failRefresh){
        rt.status='unavailable';
        throw new Error('No connection');
      }
      const newSnapshot={merchant:{merchantId:'M-1'},orders:[]};
      rt.merchant=newSnapshot.merchant;
      rt.orders=newSnapshot.orders;
      rt.status='ready';
      rt.error=null;
      return newSnapshot;
    }
  });
  vm.runInContext(block+'\nthis.perform=merchantPerformAction;this.assign=merchantAssignDeliveryLive;'+
    'this.deliver=merchantCompleteDeliveryLive;this.reconcile=merchantRefreshAfterConfirmedMutation;',ctx);
  return {ctx,rt,calls,get refreshes(){return refreshes}};
}

// Failed/ambiguous RPC data cannot be a success merely because HTTP returned 200.
for(const reply of [null,false,{ok:false},{success:false},
                     {error:'BACKEND_REJECTED'}, {ok:false,error:'DENIED'}]){
  const test=fixture({reply});
  await assert.rejects(()=>test.ctx.perform(orderId,'accept'),
    /não confirmou esta ação/i,JSON.stringify(reply));
  assert.equal(test.calls.length,1,'only one mutating request');
  assert.equal(test.refreshes,1,'failure recovery may read but cannot count as acknowledgement');
  assert.equal(test.rt.actionPending,false);
}
for(const reply of [null,false,{ok:false},{success:false},{error:'DENIED'}]){
  const assigned=fixture({reply,status:'PREPARING'});
  await assert.rejects(()=>assigned.ctx.assign(orderId,deliveryUserId),
    /não confirmou esta ação/i,'assignment cannot assert success');
  assert.equal(assigned.calls.length,1);
  assert.equal(assigned.calls[0].payload.action,'assign-delivery');
  assert.equal(assigned.rt.actionPending,false);
}
for(const reply of [null,false,{success:false},{error:'DENIED'}]){
  const delivered=fixture({reply,status:'ARRIVING'});
  await assert.rejects(()=>delivered.ctx.deliver(orderId,'1234',true),
    /não confirmou esta ação/i,'PIN + payment checkbox are not an acknowledgement');
  assert.equal(delivered.calls[0].payload.paymentConfirmed,true);
  assert.equal(delivered.rt.actionPending,false);
}
// Preserve the existing specialized PIN error behavior.
const badPin=fixture({reply:{ok:false,error:'PIN_LOCKED'},status:'ARRIVING'});
await assert.rejects(()=>badPin.ctx.deliver(orderId,'1234',true),/PIN bloqueado/i);

// A positive server response is still delivered if the later queue read fails.
const verified=fixture();
assert.equal((await verified.ctx.perform(orderId,'accept')).ok,true);
assert.equal(verified.refreshes,1);
assert.equal(verified.rt.status,'ready');
const refreshFail=fixture({failRefresh:true});
assert.equal((await refreshFail.ctx.perform(orderId,'accept')).ok,true);
assert.equal(refreshFail.rt.status,'unavailable');
assert.deepEqual(refreshFail.rt.orders,[]);
assert.match(refreshFail.rt.error,/não conseguimos atualizar os pedidos/i);
const autoRescue=fixture({reply:{autoRescued:true,rescueReason:'offer_expired'}});
assert.equal((await autoRescue.ctx.perform(orderId,'accept')).autoRescued,true,
  'server-confirmed auto-reassignment is not misread as a failed response');

// No action should omit the server reply when requesting post-mutation reconciliation.
for(const method of ['merchantPerformAction','merchantAssignDeliveryLive','merchantCompleteDeliveryLive']){
 const source=pick(method);
 assert.match(source,/merchantRefreshAfterConfirmedMutation\(result\)/,method);
 assert.doesNotMatch(source,/merchantRefreshAfterConfirmedMutation\(\)/,method);
}
assert.match(pick('merchantRefreshAfterConfirmedMutation'),/reply\.ok===false/);
assert.match(pick('merchantRefreshAfterConfirmedMutation'),/reply\.success===false/);
assert.match(pick('merchantRefreshAfterConfirmedMutation'),/reply\.error/);
assert.doesNotMatch(pick('merchantRefreshAfterConfirmedMutation'),/merchantInvoke\(/,
 'reply checker itself must not perform another business operation');
assert.match(merchant,/function merchantPostActionConfirmation\(/);
assert.match(audit,/node tests\/merchant-acknowledgement-integrity-v1-358\.mjs/);
console.log('V1.358 PASS — empty/rejected mutation replies fail closed; live ack, auto-rescue, PIN, queue refresh and concurrency retained.');
