import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const module=fs.readFileSync(new URL('../js/customer-order-action.js',import.meta.url),'utf8');
new vm.Script(backend);new vm.Script(module);
const start=backend.indexOf('async function liveGetOrder(');
const end=backend.indexOf('\n}',start);
assert.ok(start>=0&&end>start,'real order loader present');
const getOrderCode=backend.slice(start,end+2);
const OLD='11111111-1111-4111-8111-111111111111';
const NEW='22222222-2222-4222-8222-222222222222';

function fixture({response,delayed=null}={}){
 const events=[],stored=new Map(),session={user:{id:'buyer-one'}};
 const rt={requested:true,status:'ready',session,orderId:OLD,
  order:{orderId:OLD,status:'PREPARING',version:7},
  orderRequestSeq:0,customerDecisionToken:{tag:'old'},actionPending:true,
  orderCheckedAt:'2020-01-01T00:00:00.000Z',orderCheckedId:OLD,error:null};
 const ctx=vm.createContext({
  liveRuntime:rt,liveReady:()=>rt.status==='ready',
  liveInvoke:async (name,body)=>{
   events.push({name,body});
   if(delayed)await delayed.promise;
   return response||{orderId:OLD,status:'CANCELLED',version:8};
  },
  liveSyncFinancialProfile:async()=>{},
  localStorage:{setItem:(k,v)=>stored.set(k,v)},
  CHAMA_BACKEND:{orderStorageKey:'order'},
  render:()=>events.push('render')
 });
 vm.runInContext(getOrderCode+'\nthis.get=liveGetOrder;',ctx);
 return {rt,ctx,events,stored};
}
// A successful HTTP response describing a foreign order is never installed,
// persisted to local storage or used as cancellation/requote proof.
{
 const x=fixture({response:{orderId:NEW,status:'CANCELLED',version:8}});
 await assert.rejects(()=>x.ctx.get(OLD,{silent:true}),/outro pedido/i);
 assert.equal(x.rt.orderId,OLD);
 assert.equal(x.rt.order.version,7);
 assert.equal(x.rt.actionPending,true);
 assert.equal(x.rt.orderCheckedAt,'2020-01-01T00:00:00.000Z');
 assert.equal(x.stored.size,0);
}
// An authenticated same-order result updates the exact-order proof. A
// terminal order may trigger profile syncing but never changes the owner.
{
 const x=fixture();
 const value=await x.ctx.get(OLD,{silent:true});
 assert.equal(value.status,'CANCELLED');
 assert.equal(x.rt.order,value);
 assert.equal(x.rt.orderCheckedId,OLD);
 assert.ok(Date.parse(x.rt.orderCheckedAt)>Date.parse('2025-01-01'));
 assert.equal(x.rt.actionPending,true,'same-order read does not unlock the decision');
 assert.equal(x.stored.get('order'),OLD);
}
// A newer order selected by the buyer invalidates a previous cancellation
// lock, allowing the current order to be acted on independently.
{
 const x=fixture({response:{orderId:NEW,status:'PREPARING',version:3}});
 const value=await x.ctx.get(NEW,{silent:true});
 assert.equal(value.orderId,NEW);
 assert.equal(x.rt.orderId,NEW);
 assert.equal(x.rt.actionPending,false);
 assert.equal(x.rt.customerDecisionToken,null);
 assert.equal(x.rt.orderCheckedId,NEW);
 assert.equal(x.stored.get('order'),NEW);
}
// If the authenticated actor changes while the API read is pending, its
// response cannot be installed in the new account's order tracking.
{
 let release;
 const wait={promise:new Promise(r=>release=r)};
 const x=fixture({delayed:wait});
 const first=x.ctx.get(OLD,{silent:true});
 x.rt.session={user:{id:'buyer-two'}};
 x.rt.orderId=NEW;
 x.rt.order={orderId:NEW,status:'PREPARING',version:4};
 release();
 assert.equal(await first,null);
 assert.equal(x.rt.orderId,NEW);
 assert.equal(x.rt.order.version,4);
 assert.equal(x.stored.size,0);
}
// The current source invalidates an old decision token upon logout and when
// a financial-profile refresh selects another active order.
assert.match(backend,/function liveForgetAccount\(\)\{[\s\S]*?liveRuntime\.customerDecisionToken=null;\s*liveRuntime\.actionPending=false;/);
assert.match(backend,/if\(activeOrderChanged&&liveRuntime\.customerDecisionToken\)/);
assert.match(module,/if\(rt\.customerDecisionToken===token&&sameOrder\(\)\)/);
assert.match(module,/rt\.order===data/);
assert.match(module,/Date\.parse\(rt\.orderCheckedAt\)>=startedAt/);
assert.ok(fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8').includes('node tests/customer-decision-readback-auth-v1-493.mjs'));
console.log('PASS #493 buyer decisions: exact-order get-order, applied readback, account isolation, old action invalidation and terminal confirmation.');
