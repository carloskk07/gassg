import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const names=['merchantRefreshAfterConfirmedMutation','merchantPerformAction','merchantAssignDeliveryLive','merchantCompleteDeliveryLive'];
function pick(name){
  const start=backend.indexOf('async function '+name+'(');
  const end=backend.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'missing implementation '+name);
  return backend.slice(start,end+2);
}
const functions=names.map(pick).join('\n');
new vm.Script(functions,{filename:'merchant-mutation-refresh-regression'});
const orderId='11111111-1111-4111-8111-111111111111';
const memberId='22222222-2222-4222-8222-222222222222';

function fixture({reply={ok:true},failMutation=false,failRefresh=false,noAccess=false,
                  staleRefresh=false,delayedMutation=null}={}){
  const calls=[], events=[];
  const initialOrder={orderId,version:9,status:'ARRIVING'};
  const runtime={
    status:'ready',orders:[initialOrder],merchant:{merchantId:'merchant-1'},
    actionPending:false,error:null
  };
  const ctx=vm.createContext({
    merchantRuntime:runtime,
    render:()=>events.push('render'),
    liveIdempotency:prefix=>prefix+':deterministic-test',
    retryAmbiguousOnce:fn=>fn(),
    merchantInvoke:async(name,body,options)=>{
      calls.push({name,body,options});
      if(delayedMutation)await delayedMutation;
      if(failMutation)throw new TypeError('Server acknowledgement lost');
      return reply;
    },
    merchantRefresh:async({silent})=>{
      assert.equal(silent,true);
      events.push('refresh');
      if(failRefresh){
        runtime.status='unavailable';
        throw new TypeError('Order list unavailable');
      }
      if(noAccess){
        runtime.status='no-access';
        return null;
      }
      const response={merchant:{merchantId:'merchant-1'},orders:[]};
      // Simulates merchantRefresh discarding an outdated concurrent response.
      if(!staleRefresh){
        runtime.merchant=response.merchant;
        runtime.orders=response.orders;
        runtime.status='ready';
      }
      return response;
    }
  });
  vm.runInContext(functions+'\nthis.perform=merchantPerformAction;this.assign=merchantAssignDeliveryLive;this.complete=merchantCompleteDeliveryLive;',ctx);
  return {runtime,calls,events,api:ctx};
}

// A successful merchant mutation must remain successful after its UI refresh fails.
for(const action of ['accept','reject','dispatch','arriving','cannot-fulfill']){
  const s=fixture({failRefresh:true});
  const reply=await s.api.perform(orderId,action);
  assert.equal(reply.ok,true,action);
  assert.equal(s.calls.length,1,action);
  assert.equal(s.calls[0].body.expectedVersion,9);
  assert.equal(s.runtime.status,'unavailable',action);
  assert.equal(s.runtime.orders.length,0,action);
  assert.match(s.runtime.error,/servidor respondeu à solicitação/i,action);
  assert.equal(s.runtime.actionPending,false,action);
}

// Delivery assignment must also never leave stale operation buttons.
const assigned=fixture({failRefresh:true});
assert.equal((await assigned.api.assign(orderId,memberId)).ok,true);
assert.equal(assigned.calls[0].body.deliveryUserId,memberId);
assert.equal(assigned.runtime.status,'unavailable');
assert.equal(assigned.runtime.orders.length,0);

// A confirmed PIN delivery and failed list read are not a failed delivery.
const delivered=fixture({failRefresh:true});
assert.equal((await delivered.api.complete(orderId,'1234',true)).ok,true);
assert.equal(delivered.calls.length,1);
assert.equal(delivered.runtime.status,'unavailable');
assert.equal(delivered.runtime.orders.length,0);
assert.equal(delivered.runtime.actionPending,false);

// Ambiguous HTTP response must remain an error, never a success toast.
const ambiguous=fixture({failMutation:true});
await assert.rejects(()=>ambiguous.api.complete(orderId,'1234',true),/acknowledgement lost/);
assert.equal(ambiguous.runtime.actionPending,false);
assert.doesNotMatch(String(ambiguous.runtime.error),/servidor respondeu à solicitação/i);

// Server rejects the PIN: must preserve the rejection and not fake success.
for(const errorCode of ['PIN_LOCKED','INVALID_PIN']){
  const invalid=fixture({reply:{ok:false,error:errorCode}});
  await assert.rejects(()=>invalid.api.complete(orderId,'1234',true),
    errorCode==='PIN_LOCKED'?/PIN bloqueado/:/PIN incorreto/);
  assert.equal(invalid.runtime.actionPending,false);
}

// Healthy read: retained normal workflow, no false outage.
const healthy=fixture();
assert.equal((await healthy.api.perform(orderId,'accept')).ok,true);
assert.equal(healthy.runtime.status,'ready');
assert.equal(healthy.runtime.error,null);

// No access after mutation: fail closed with no old order data.
const noAccessAfterAck=fixture({noAccess:true});
assert.equal((await noAccessAfterAck.api.perform(orderId,'dispatch')).ok,true);
assert.equal(noAccessAfterAck.runtime.status,'no-access');
assert.equal(noAccessAfterAck.runtime.orders.length,0);

// A stale response, discarded by concurrent refresh, cannot re-enable the buttons.
const stale=fixture({staleRefresh:true});
assert.equal((await stale.api.perform(orderId,'dispatch')).ok,true);
assert.equal(stale.runtime.status,'unavailable');
assert.equal(stale.runtime.orders.length,0);

// Double-click while a mutation is in flight must not dispatch another RPC.
let unblock;
const pending=new Promise(resolve=>unblock=resolve);
const duplicate=fixture({delayedMutation:pending});
const first=duplicate.api.perform(orderId,'dispatch');
assert.equal(await duplicate.api.perform(orderId,'dispatch'),undefined);
unblock();
await first;
assert.equal(duplicate.calls.length,1);
assert.equal(duplicate.runtime.actionPending,false);

console.log('V1.330 PASS: 5 merchant actions, assignment, delivery, failed refresh, stale result, PIN, concurrency and no-access.');
