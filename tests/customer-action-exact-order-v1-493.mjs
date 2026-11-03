import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/customer-order-action.js');
const backend=read('js/backend.js'),customer=read('js/customer.js');
new vm.Script(source);
new vm.Script(backend);
new vm.Script(customer);
const OLD='11111111-1111-4111-8111-111111111111';
const NEW='22222222-2222-4222-8222-222222222222';
const actionToStatus={
 'cancel-before-accept':'CANCELLED',
 'cancel-before-dispatch':'CANCELLED',
 'accept-requote':'OFFERED_TO_MERCHANT'
};
let renderCount=0;
function fixture({action='cancel-before-accept',orderId=OLD,from='OFFERED_TO_MERCHANT',
 version=7, reply=null,readResult=null,throwAction=null,throwRead=null,
 pending=false,delayedAction=null,changeAccount=false}={}){
 const calls=[],messages=[],session={user:{id:'buyer-one'}};
 const rt={status:'ready',session,orderId,order:{orderId,status:from,version},
  actionPending:pending,error:null};
 const expected=actionToStatus[action];
 const serverReply=reply===null?{orderId,status:expected,version:version+1}:reply;
 let sequence=0;
 const dependencies={
  liveRuntime:rt,liveReady:()=>rt.status==='ready',
  liveIdempotency:prefix=>prefix+':test-key-'+(++sequence),
  retryAmbiguousOnce:async fn=>fn(),
  liveInvoke:async(name,payload,opt)=>{
   calls.push({name,payload,opt});
   if(delayedAction)await delayedAction;
   if(changeAccount){rt.session={user:{id:'buyer-two'}};rt.orderId=NEW;
    rt.order={orderId:NEW,status:'PREPARING',version:4};}
   if(throwAction)throw throwAction;
   return serverReply;
  },
  liveGetOrder:async id=>{
   calls.push({name:'get-order',id});
   if(throwRead)throw throwRead;
   const actual=readResult===null?{orderId:id,status:expected,version:version+1}:readResult;
   if(actual&&actual.orderId===rt.orderId)rt.order=actual;
   return actual;
  },
  render:()=>renderCount++,toast:x=>messages.push(x)
 };
 const ctx={console};ctx.globalThis=ctx;
 vm.runInNewContext(source,ctx,{filename:'customer-order-action.js'});
 const submit=(id=orderId)=>ctx.customerActionSubmit(action,id,dependencies);
 return {rt,calls,messages,submit,ctx,deps:dependencies};
}
for(const [action,from] of [
 ['cancel-before-accept','OFFERED_TO_MERCHANT'],
 ['cancel-before-accept','REQUOTE_REQUIRED'],
 ['cancel-before-dispatch','PREPARING'],
 ['cancel-before-dispatch','AT_RISK'],
 ['accept-requote','REQUOTE_REQUIRED']
]){
 const x=fixture({action,from});
 assert.equal(await x.submit(),true,action+' valid action confirmed');
 assert.equal(x.calls.length,2,action+' invokes mutation + readback');
 assert.equal(x.calls[0].payload.orderId,OLD);
 assert.equal(x.calls[0].payload.expectedVersion,7);
 assert.equal(x.calls[1].id,OLD);
 assert.equal(x.rt.actionPending,false);
 assert.equal(x.rt.error,null);
 assert.match(x.messages.join(' '),/confirmado|aceita e confirmada/);
}
// A DOM button from order OLD must never cancel or approve order NEW.
for(const action of Object.keys(actionToStatus)){
 const from=action==='accept-requote'?'REQUOTE_REQUIRED':
  action==='cancel-before-dispatch'?'PREPARING':'OFFERED_TO_MERCHANT';
 const x=fixture({action,orderId:NEW,from});
 assert.equal(await x.submit(OLD),false);
 assert.equal(x.calls.length,0,'stale DOM cannot mutate the new selected order');
 assert.match(x.rt.error,/pedido ou a etapa mudou/i);
}
// Unsupported phase or missing verified version -> no remote write.
for(const opts of [{from:'SETTLED'},{version:0},{version:'3'},{pending:true}]){
 const x=fixture(opts);
 assert.equal(await x.submit(),false);
 assert.equal(x.calls.length,0);
}
const anonymous=fixture();
anonymous.rt.session=null;
assert.equal(await anonymous.submit(),false);
assert.equal(anonymous.calls.length,0);
// A positive HTTP response for another order or without exactly the next
// version/status must never trigger a success toast or claim cancellation.
for(const reply of [
 {},{ok:true},{orderId:NEW,status:'CANCELLED',version:8},
 {orderId:OLD,status:'OFFERED_TO_MERCHANT',version:8},
 {orderId:OLD,status:'CANCELLED',version:7},
 {orderId:OLD,status:'CANCELLED',version:9},
 {orderId:OLD,status:'CANCELLED',version:8,ok:false}
]){
 const x=fixture({reply});
 assert.equal(await x.submit(),false);
 assert.equal(x.calls[0].name,'customer-action');
 assert.doesNotMatch(x.messages.join(' '),/Cancelamento confirmado no pedido/);
}
// The decision can have committed, but an unverified readback must not
// claim completion, encourage another mutation or overwrite the new order.
for(const args of [
 {readResult:{orderId:OLD,status:'OFFERED_TO_MERCHANT',version:7}},
 {readResult:{orderId:OLD,status:'OFFERED_TO_MERCHANT',version:8}},
 {readResult:{orderId:OLD,status:'CANCELLED',version:6}},
 {readResult:{orderId:NEW,status:'CANCELLED',version:8}},
 {throwRead:new Error('network lost after ACK')}
]){
 const x=fixture(args);
 assert.equal(await x.submit(),false);
 assert.equal(x.calls.filter(y=>y.name==='customer-action').length,1);
 assert.match(x.messages.join(' '),/não repita a ação/i);
 assert.doesNotMatch(x.messages.join(' '),/Cancelamento confirmado no pedido/);
}
// Version 9 with a subsequent valid advancement (not a stale version)
// permits acknowledgment of an action that was followed by another stage.
const progressed=fixture({action:'accept-requote',from:'REQUOTE_REQUIRED',
 readResult:{orderId:OLD,status:'MERCHANT_ACCEPTED',version:9}});
assert.equal(await progressed.submit(),true);
assert.equal(progressed.rt.error,null);
// Interrupted network response is not positive evidence: refresh, but no
// second submission under another idempotency key.
const ambiguous=fixture({throwAction:new TypeError('ACK lost')});
assert.equal(await ambiguous.submit(),false);
assert.equal(ambiguous.calls.filter(c=>c.name==='customer-action').length,1);
assert.match(ambiguous.messages.join(' '),/ACK lost/);
// Switching account/order during server response must never report success
// or issue a readback in the new account for the old order.
const switched=fixture({changeAccount:true});
assert.equal(await switched.submit(),false);
assert.equal(switched.calls.length,1);
assert.equal(switched.rt.orderId,NEW);
assert.equal(switched.rt.order.orderId,NEW);
assert.equal(switched.messages.length,0);
// The visible UI must forward the actual rendered order id from each
// cancel/requote action, not silently use whichever order is selected later.
for(const expected of [
 /onclick="cancelPending\('\$\{esc\(o\.orderId\)\}'\)"/,
 /onclick="cancelBeforeDispatch\('\$\{esc\(o\.orderId\)\}'\)"/,
 /onclick="confirmRequote\(\\''\+actionId\+'\\'\)"/,
 /await liveCustomerAction\('accept-requote',id\)/,
 /await liveCustomerAction\('cancel-before-dispatch',id\)/,
 /await liveCustomerAction\('cancel-before-accept',id\)/
])assert.match(customer,expected,'UI callback must retain order identity');
assert.ok(backend.includes("liveCustomerScript('customer-order-action')"));
assert.match(backend,/customerActionSubmit\(action,orderId,/);
assert.match(read('.github/workflows/audit.yml'),/node tests\/customer-action-exact-order-v1-493\.mjs/);
console.log('PASS #493 customer action: exact order/phase/version, confirmed response + readback, stale DOM denial, ambiguous ACK and account switch.');
