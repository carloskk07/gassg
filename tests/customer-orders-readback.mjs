import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const customer=fs.readFileSync(new URL('../js/customer.js',import.meta.url),'utf8');
const between=(text,start,end)=>{
 const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,start);return text.slice(a,b);
};
const source=between(backend,'async function liveSyncFinancialProfile(','\nasync function liveUpgradeAccount(')+
 between(backend,'async function liveGetOrder(','\nasync function liveStartMerchantPayment(')+
 between(backend,'async function livePoll(','\n\nconst merchantRuntime=')+
 between(customer,'async function customerRefreshOrders(','\nfunction tracking(){');
const ORDER='20000000-0000-4000-8000-000000000493';
function setup(){
 const rt={requested:true,status:'ready',session:{user:{id:'buyer'}},
  order:null,orderId:null,financialSyncSeq:0,orderRequestSeq:0,
  lastFinancialSyncAt:0,lastFinancialSyncAttemptAt:0,customerSummaryState:'unverified'};
 let response=async()=>({activeOrderId:null}),renders=0;
 const calls=[],storage=new Map();
 const ctx=vm.createContext({
  liveRuntime:rt,state:{user:{}},liveReady:()=>rt.status==='ready',
  CUSTOMER_FINANCIAL_REFRESH_MS:0,CHAMA_BACKEND:{orderStorageKey:'order'},
  liveInvoke:async(name,payload)=>{
   calls.push({name,payload});
   if(name==='customer-summary')return response();
   if(name==='get-order')return {orderId:payload.orderId,status:'PREPARING',version:1};
   throw Error(name);
  },localStorage:{setItem:(k,v)=>storage.set(k,v)},save(){},
  render:()=>renders++,toast(){},shell:html=>html,esc:String,
  console:{warn(){}},document:{visibilityState:'visible'},
  liveSyncMarketStatus:async()=>null,liveRefreshCityPriceBoard:async()=>null,
  backendInit:async()=>{rt.status='ready';return true;}
 });
 vm.runInContext(source+'\nthis.api={sync:liveSyncFinancialProfile,retry:customerRefreshOrders,view:liveTracking,poll:livePoll};',ctx);
 return {rt,ctx,calls,storage,get renders(){return renders},setResponse:f=>response=f};
}

// A failed or incomplete read is never evidence that the account has no orders.
for(const response of [async()=>{throw Error('network')},async()=>null,async()=>({})]){
 const s=setup();s.setResponse(response);
 assert.equal(await s.ctx.api.sync({force:true}),false);
 assert.equal(s.rt.customerSummaryState,'error');
 assert.match(s.ctx.api.view(),/consulta dos seus pedidos ainda não foi confirmada/);
 assert.doesNotMatch(s.ctx.api.view(),/Nenhum pedido em andamento encontrado/);
 assert.match(s.ctx.api.view(),/customerRefreshOrders\(\)/);
}
{
 const s=setup();
 assert.match(s.ctx.api.view(),/ainda não foi confirmada/);
 await s.ctx.api.sync({force:true});
 assert.equal(s.rt.customerSummaryState,'ready');
 assert.match(s.ctx.api.view(),/Nenhum pedido em andamento encontrado nesta consulta/);
 assert.doesNotMatch(s.ctx.api.view(),/Você ainda não tem/);
 s.setResponse(async()=>{throw Error('offline')});
 await s.ctx.api.poll();
 assert.equal(s.rt.customerSummaryState,'error');
 assert.ok(s.renders>0,'poll renders changed verification state even without an order ID');
}
// A manual retry restores the canonical ID with no local order reference;
// concurrent clicks cannot start duplicate summary or get-order requests.
{
 const s=setup();let resolve;
 s.setResponse(()=>new Promise(r=>{resolve=r}));
 const pending=s.ctx.api.retry();
 assert.match(s.ctx.api.view(),/disabled aria-busy="true"/);
 await s.ctx.api.retry();
 assert.equal(s.calls.length,1);
 resolve({activeOrderId:ORDER});await pending;
 assert.equal(s.rt.orderId,ORDER);assert.equal(s.rt.order.orderId,ORDER);
 assert.equal(s.rt.orderCheckedId,ORDER);assert.equal(s.storage.get('order'),ORDER);
 assert.deepEqual(s.calls.map(c=>c.name),['customer-summary','get-order']);
}
// Late failures from a previous account cannot poison the new account's proof.
{
 const s=setup();let reject;
 s.setResponse(()=>new Promise((_,r)=>{reject=r}));
 const pending=s.ctx.api.retry();
 s.rt.session={user:{id:'another-buyer'}};s.rt.customerSummaryState='ready';
 reject(Error('old request failed'));await pending;
 assert.equal(s.rt.customerSummaryState,'ready');
 assert.equal(s.calls.filter(c=>c.name==='get-order').length,0);
 assert.equal(s.rt.error,undefined);
}
console.log('PASS: verified empty orders, truthful failed reads, single retry, server recovery and account isolation.');
