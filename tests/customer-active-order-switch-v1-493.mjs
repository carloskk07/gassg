import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Actual browser functions, no replacement accounting or tracking algorithm.
// All data and API responses below are synthetic; no remote calls or credentials.
const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const between=(start,end)=>{
 const a=backend.indexOf(start),b=backend.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing browser source boundary: '+start);
 return backend.slice(a,b);
};
const source=[
 between('async function liveSyncFinancialProfile(','\nasync function liveUpgradeAccount('),
 between('async function liveGetOrder(','\nasync function liveStartMerchantPayment('),
 between('async function livePoll(','\n\nconst merchantRuntime=')
].join('\n');
new vm.Script(source,{filename:'customer-active-order-switch'});

const OLD='10000000-0000-4000-8000-000000000493';
const NEXT='20000000-0000-4000-8000-000000000493';
function setup(){
 const calls=[],saved=new Map(),renders=[];
 const runtime={
  requested:true,status:'ready',orderId:OLD,
  order:{orderId:OLD,status:'SETTLED',version:6},
  orderCheckedId:OLD,orderCheckedAt:new Date().toISOString(),
  error:null,actionPending:false,pollPending:false,
  orderRequestSeq:0,financialSyncSeq:0,
  lastFinancialSyncAttemptAt:0,lastFinancialSyncAt:0,
  marketStatus:{commerceEnabled:false},cityPriceSnapshot:null
 };
 saved.set('test-tracked-order',OLD);
 const state={user:{referralCode:'',cashback:0,cashbackDebt:0,
  commissionPending:0,commissionAvailable:0,purchases:0,
  reversedPurchases:0,cashEarningEligible:false,identityType:'anonymous'}};
 let summary={activeOrderId:null};
 let getOrder=async id=>({orderId:id,status:'PREPARING',version:1});
 const ctx=vm.createContext({
  liveRuntime:runtime,state,console:{warn:()=>{}},
  document:{visibilityState:'visible'},
  CUSTOMER_FINANCIAL_REFRESH_MS:0,
  CHAMA_BACKEND:{orderStorageKey:'test-tracked-order'},
  liveReady:()=>true,
  liveInvoke:async (name,payload)=>{
   calls.push({name,payload});
   if(name==='customer-summary')return summary;
   if(name==='get-order')return getOrder(payload.orderId);
   throw Error('Unexpected API route '+name);
  },
  localStorage:{setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
  liveSyncMarketStatus:async()=>runtime.marketStatus,
  liveRefreshCityPriceBoard:async()=>null,
  render:()=>renders.push({id:runtime.orderId,order:runtime.order?.orderId??null}),
  save:()=>{},Date,Math,JSON,Number,String
 });
 vm.runInContext(source+
  '\nthis.sync=liveSyncFinancialProfile;this.getOrder=liveGetOrder;this.poll=livePoll;',ctx);
 return {runtime,ctx,calls,saved,renders,
  setSummary:s=>summary=s,setGetOrder:f=>getOrder=f};
}

// Regression: a new active order from the server must replace the previous
// terminal snapshot, so the next poll fetches the correct active delivery.
const switched=setup();
switched.setSummary({activeOrderId:NEXT});
assert.equal(await switched.ctx.sync({force:true}),true);
assert.equal(switched.runtime.orderId,NEXT);
assert.equal(switched.runtime.order,null,'never display a settled old order for the new ID');
assert.equal(switched.runtime.orderCheckedId,null,'old proof belongs to another order');
assert.equal(switched.runtime.orderCheckedAt,null);
assert.equal(switched.saved.get('test-tracked-order'),NEXT);
await switched.ctx.poll();
assert.equal(switched.runtime.order?.orderId,NEXT);
assert.equal(switched.runtime.order?.status,'PREPARING');
assert.equal(switched.runtime.orderCheckedId,NEXT);
assert.deepEqual(switched.calls.filter(x=>x.name==='get-order').map(x=>x.payload.orderId),[NEXT]);

// No spurious change if the same active order is reaffirmed: verified proof
// and the active snapshot must not disappear on each financial refresh.
const stable=setup();
stable.runtime.orderId=NEXT;
stable.runtime.order={orderId:NEXT,status:'PREPARING',version:4};
stable.runtime.orderCheckedId=NEXT;
stable.setSummary({activeOrderId:NEXT});
await stable.ctx.sync({force:true});
assert.equal(stable.runtime.order?.version,4);
assert.equal(stable.runtime.orderCheckedId,NEXT);

// A completed order with no different active ID should keep the existing
// bounded polling policy (avoid unnecessary get-order or financial writes).
const done=setup();
done.setSummary({activeOrderId:null});
await done.ctx.poll();
assert.equal(done.calls.filter(x=>x.name==='get-order').length,0);
assert.equal(done.runtime.order?.orderId,OLD);

// A delayed success from the previous order cannot resurrect its stale
// delivery status/PIN after the authoritative summary chooses another ID.
const delayed=setup();
let finishOld;
delayed.setGetOrder(()=>new Promise(resolve=>{finishOld=resolve}));
const oldPending=delayed.ctx.getOrder(OLD,{silent:true});
assert.equal(typeof finishOld,'function');
delayed.setSummary({activeOrderId:NEXT});
await delayed.ctx.sync({force:true});
finishOld({orderId:OLD,status:'OUT_FOR_DELIVERY',deliveryPin:'OLD-PIN',version:9});
await oldPending;
assert.equal(delayed.runtime.orderId,NEXT);
assert.equal(delayed.runtime.order,null);
assert.equal(delayed.runtime.orderCheckedId,null);
assert.equal(delayed.saved.get('test-tracked-order'),NEXT);

// A late 404 belonging to the old order is not permission to erase
// the newer order discovered while the network request was in flight.
const late404=setup();
late404.runtime.order.status='PREPARING';
late404.setGetOrder(async()=>{
 late404.setSummary({activeOrderId:NEXT});
 await late404.ctx.sync({force:true});
 const error=new Error('old order no longer accessible');
 error.status=404;
 throw error;
});
await late404.ctx.poll();
assert.equal(late404.runtime.orderId,NEXT);
assert.equal(late404.saved.get('test-tracked-order'),NEXT);
assert.equal(late404.runtime.order,null);

// The browser route remains connected to the original shared 5-second
// scheduler: no extra polling loop, shadow order API or production writes.
const boot=fs.readFileSync(new URL('../js/bootstrap.js',import.meta.url),'utf8');
assert.match(boot,/livePoll\(\)\.catch/);
assert.ok(!source.includes('create-order'));
assert.ok(!source.includes('merchant-action'));
assert.ok(!source.includes('adminPerform'));
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
assert.ok(audit.includes('node tests/customer-active-order-switch-v1-493.mjs'));
console.log('PASS: real customer-summary active-order promotion, old snapshot removal, polling, delayed result and 404 recovery.');
