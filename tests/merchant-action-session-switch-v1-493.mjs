import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const names=['merchantOrderActionScope','merchantOrderActionScopeMatches','merchantOrderActionScopeLost',
 'merchantVerifiedActionOrder','merchantRefreshAfterConfirmedMutation','merchantPerformAction',
 'merchantAssignDeliveryLive','merchantCompleteDeliveryLive','merchantSelectLive','merchantSignOut'];
function pick(name){
 const plain=!['merchantRefreshAfterConfirmedMutation','merchantPerformAction',
 'merchantAssignDeliveryLive','merchantCompleteDeliveryLive','merchantSelectLive','merchantSignOut'].includes(name);
 const head=(plain?'function ':'async function ')+name+'(';
 const start=backend.indexOf(head),end=backend.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'missing production function '+name);
 return backend.slice(start,end+2);
}
const production=names.map(pick).join('\n');
new vm.Script(production);
const ORDER='11111111-1111-4111-8111-111111111111';
const MEMBER='22222222-2222-4222-8222-222222222222';
const M1='merchant-A',M2='merchant-B',U1='user-A',U2='user-B';
const statuses={accept:'OFFERED_TO_MERCHANT',reject:'OFFERED_TO_MERCHANT',
 dispatch:'PREPARING',arriving:'OUT_FOR_DELIVERY',
 'cannot-fulfill':'AT_RISK','assign-delivery':'PREPARING',
 'complete-delivery':'ARRIVING'};
function deferred(){
 let resolve;
 const promise=new Promise(r=>resolve=r);
 return {promise,resolve};
}
function fixture({action='dispatch',blockMutation=null,blockRefresh=null,readFails=false}={}){
 const calls=[],toasts=[],renders=[],stored=new Map();
 const original={orderId:ORDER,version:7,status:statuses[action],
   offerExpiresAt:new Date(Date.now()+120000).toISOString()};
 const runtime={status:'ready',merchant:{merchantId:M1,memberRole:'manager'},
   selectedMerchantId:M1,session:{user:{id:U1}},accessEpoch:3,refreshSeq:2,
   orders:[original],lastSyncAt:new Date().toISOString(),client:{auth:{signOut:async()=>{calls.push('signed-out');}}},
   actionPending:false,error:null};
 const replyStatus={accept:'MERCHANT_ACCEPTED',reject:'REASSIGNING',
  dispatch:'OUT_FOR_DELIVERY',arriving:'ARRIVING',
  'cannot-fulfill':'REASSIGNING',
  'assign-delivery':'PREPARING','complete-delivery':'DELIVERED'}[action];
 let refreshCount=0;
 const refresh=async({silent=true}={})=>{
  refreshCount++;
  calls.push('refresh');
  if(blockRefresh)await blockRefresh.promise;
  if(readFails){runtime.status='unavailable';throw Error('no connection');}
  const mid=runtime.selectedMerchantId||M1;
  const data={merchant:{merchantId:mid,memberRole:'manager'},
    orders:[{...original,status:mid===M1?replyStatus:'PREPARING',version:8}]};
  runtime.merchant=data.merchant;runtime.orders=data.orders;runtime.status='ready';
  return data;
 };
 const context=vm.createContext({
  merchantRuntime:runtime,merchantPushRuntime:{subscribed:false},
  merchantOfflineGuard:()=>{},merchantClearProtectedSnapshot:()=>{
   runtime.accessEpoch++;runtime.merchant=null;runtime.orders=[];
   runtime.actionPending=false;runtime.lastSyncAt=null;
  },localStorage:{setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
  merchantRefresh:refresh,render:()=>renders.push(runtime.status),
  merchantPushDisableLive:async()=>true,
  liveIdempotency:p=>p+':fixed-fixture-key',retryAmbiguousOnce:async fn=>fn(),
  merchantInvoke:async (name,body,headers)=>{
   calls.push({name,body,headers});
   if(blockMutation)await blockMutation.promise;
   return {ok:true,orderId:ORDER,status:replyStatus,version:8};
  },Date,Number,Boolean,String
 });
 vm.runInContext(production+'\nthis.methods={perform:merchantPerformAction,assign:merchantAssignDeliveryLive,complete:merchantCompleteDeliveryLive,select:merchantSelectLive,signout:merchantSignOut};',context);
 const execute=()=>action==='complete-delivery'?
   context.methods.complete(ORDER,'1234',true):
   action==='assign-delivery'?context.methods.assign(ORDER,MEMBER):
   context.methods.perform(ORDER,action);
 return {runtime,calls,renders,stored,execute,methods:context.methods,
  get refreshCount(){return refreshCount},
  swapToB({newPending=false}={}){
   runtime.accessEpoch++;runtime.session={user:{id:U2}};
   runtime.selectedMerchantId=M2;runtime.merchant={merchantId:M2,memberRole:'manager'};
   runtime.orders=[{orderId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',status:'PREPARING',version:4}];
   runtime.status='ready';runtime.actionPending=newPending;
  }};
}

// All seven canonical steps still confirm normally and return the actual RPC ACK.
for(const action of Object.keys(statuses)){
 const x=fixture({action});
 const reply=await x.execute();
 assert.equal(reply.orderId,ORDER,action);
 assert.equal(x.refreshCount,1,action+' fresh readback');
 assert.equal(x.runtime.actionPending,false);
 assert.equal(x.runtime.status,'ready');
 assert.equal(x.runtime.error,null);
}
// A delayed ACCEPT/dispatch/arrival/assignment/driver PIN ACK cannot be
// reported as an action in a different merchant or account.
for(const action of Object.keys(statuses)){
 const pending=deferred(),x=fixture({action,blockMutation:pending});
 const first=x.execute();
 assert.equal(x.calls.filter(c=>typeof c==='object').length,1);
 x.swapToB({newPending:true});
 pending.resolve();
 await assert.rejects(first,/conta ou a revenda mudou/i,action);
 assert.equal(x.refreshCount,0,'never poll the new merchant on behalf of the old action');
 assert.equal(x.runtime.selectedMerchantId,M2);
 assert.equal(x.runtime.orders[0].status,'PREPARING');
 assert.equal(x.runtime.actionPending,true,'old mutation cannot release new merchant lock');
 assert.equal(x.runtime.error,null,'old error cannot overwrite new merchant');
}
// If an in-flight authenticated read is replaced by a new merchant selection,
// never erase the new merchant's orders via the failed-ACK cleanup branch.
{
 const pending=deferred(),x=fixture({action:'dispatch',blockRefresh:pending});
 const first=x.execute();
 assert.equal(x.refreshCount,1);
 x.swapToB({newPending:true});
 pending.resolve();
 await assert.rejects(first,/conta ou a revenda mudou/);
 assert.equal(x.runtime.orders[0].status,'PREPARING');
 assert.equal(x.runtime.actionPending,true);
 assert.equal(x.runtime.error,null);
}
// Real merchant switch invalidates old outstanding mutation IMMEDIATELY,
// including while a push unsubscribe could be waiting.
{
 const pending=deferred(),x=fixture({action:'dispatch',blockMutation:pending});
 const first=x.execute();
 await x.methods.select(M2);
 assert.equal(x.runtime.selectedMerchantId,M2);
 assert.equal(x.runtime.accessEpoch>3,true);
 assert.equal(x.runtime.actionPending,false);
 pending.resolve();
 await assert.rejects(first,/conta ou a revenda mudou/);
 assert.equal(x.runtime.orders.length,1);
 assert.equal(x.runtime.merchant.merchantId,M2);
}
// Sign-out invalidates a delayed PIN acknowledgement without showing delivery
// or using the signed-out account to recover/refresh.
{
 const pending=deferred(),x=fixture({action:'complete-delivery',blockMutation:pending});
 const first=x.execute();
 await x.methods.signout();
 assert.equal(x.runtime.status,'unauthenticated');
 assert.equal(x.runtime.session,null);
 pending.resolve();
 await assert.rejects(first,/conta ou a revenda mudou/);
 assert.equal(x.runtime.actionPending,false);
 assert.equal(x.runtime.orders.length,0);
 assert.equal(x.refreshCount,0);
}
// Failure to retrieve a new snapshot in the SAME merchant still retains
// the conservative unavailable/stale-buttons-disabled behavior.
{
 const x=fixture({action:'dispatch',readFails:true});
 const reply=await x.execute();
 assert.equal(reply.orderId,ORDER);
 assert.equal(x.runtime.status,'unavailable');
 assert.equal(x.runtime.orders.length,0);
 assert.equal(x.runtime.actionPending,false);
 assert.match(x.runtime.error,/servidor respondeu à solicitação/i);
}
assert.match(backend,/merchantRuntime\.accessEpoch=\(merchantRuntime\.accessEpoch\|\|0\)\+1;/);
assert.ok(fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8')
 .includes('node tests/merchant-action-session-switch-v1-493.mjs'));
console.log('PASS #493 merchant full order lifecycle: accept, reject, dispatch, arrive, assign, cannot fulfill, PIN delivery; stale ACK/session change denied.');
