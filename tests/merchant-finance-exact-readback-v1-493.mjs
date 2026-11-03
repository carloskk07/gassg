import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('js/backend.js');
const moduleSource=read('js/merchant-billing-flow.js');
const orders=read('supabase/functions/merchant-orders/index.ts');
const billing=read('supabase/functions/merchant-ops/index.ts');
const pixHandler=read('supabase/functions/merchant-billing-pix/index.ts');
const start=moduleSource.indexOf('function merchantBillingSameActor(');
const end=moduleSource.indexOf('globalThis.merchantBillingSameActor=',start);
assert.ok(start>0&&end>start);
const source=moduleSource.slice(start,end);
new vm.Script(source);
const M='11111111-1111-4111-8111-111111111111';
const REQUEST='22222222-2222-4222-8222-222222222222';
const STATEMENT='33333333-3333-4333-8333-333333333333';
const RECOVERY='44444444-4444-4444-8444-444444444444';
const CHARGE='55555555-5555-4555-8555-555555555555';
const CORRELATION='66666666-6666-4666-8666-666666666666';
const base={ok:true,merchantId:M,paymentRequestId:REQUEST,status:'pending',
 requestKind:'package_purchase',planKey:'credit_300',statementId:null,
 refundRecoveryId:null,expectedAmountCents:30000};
const baseRow={id:REQUEST,requestKind:'package_purchase',planKey:'credit_300',
 statementId:null,refundRecoveryId:null,expectedAmountCents:30000,
 merchantReference:'EndToEnd-TEST-1234567',status:'pending'};
const code='000201'+('X'.repeat(50));
const pix={ok:true,paymentRequestId:REQUEST,provider:'mercadopago',charge:{
 id:CHARGE,paymentRequestId:REQUEST,provider:'mercadopago',
 correlationId:CORRELATION,amountCents:30000,status:'active',brCode:code,
 expiresAt:new Date(Date.now()+86400000).toISOString()
}};
const pixRow=()=>({...baseRow,pixCharge:{
 id:CHARGE,provider:'mercadopago',correlationId:CORRELATION,
 amountCents:30000,status:'active',expiresAt:pix.charge.expiresAt
}});
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:r=>resolve(r)}};
function setup({response=base,row={...baseRow},posted,refresh,epoch=1}={}){
 const calls=[],renders=[],toasts=[];
 const rt={
  requested:true,status:'ready',accessEpoch:epoch,actionPending:false,error:null,
  session:{user:{id:'actor-A'}},merchant:{merchantId:M,memberRole:'owner'},
  selectedMerchantId:M,lastSyncAt:null,
  billing:{paymentRequests:[row]}
 };
 let reply=response;
 let doPost=posted|| (async ()=>reply);
 let doRefresh=refresh|| (async()=>({
   merchant:{merchantId:M,memberRole:'owner'},
   billing:{paymentRequests:[{...row}]}
 }));
 const deps={
  merchantRuntime:rt,merchantReady:()=>rt.status==='ready',
  liveIdempotency:()=> 'billing-fixture-unique-123456789012',
  retryAmbiguousOnce:async fn=>fn(),
  merchantInvoke:async(name,body,opts)=>{
   calls.push({name,body,opts});return doPost(name,body,opts);
  },
  merchantRefresh:async({silent})=>{
   assert.equal(silent,true);
   const data=await doRefresh();
   if(data&&data.discarded!==true){
     rt.merchant=data.merchant;
     rt.billing=data.billing;
     rt.lastSyncAt=new Date().toISOString();
   }
   return data;
  },
  render:()=>renders.push(rt.actionPending),
  Date,String,Number,Array,Error
 };
 const ctx=vm.createContext({globalThis:{},...deps});
 ctx.globalThis.merchantAcceptVerifiedBillingPix=()=>{
   // Real merchant.js separately requires charge + request identity.
   const row=rt.billing.paymentRequests.find(x=>x.id===REQUEST);
   if(!row||row.pixCharge?.id!==CHARGE)return false;
   row.pixCharge.providerVerified=true;
   row.pixCharge.brCode=code;
   return true;
 };
 vm.runInContext(source+
  '\nthis.ops={request:merchantBillingRequestImpl,pix:merchantCreateBillingPixImpl,scope:merchantBillingSameActor};',ctx);
 return {rt,ctx,calls,renders,toasts,
  setPost:fn=>doPost=fn,setRefresh:fn=>doRefresh=fn,
  request:(act='request-billing-package',payload={planKey:'credit_300',
   reference:'EndToEnd-TEST-1234567'})=>ctx.ops.request(act,payload),
  createPix:()=>ctx.ops.pix({planKey:'credit_300'})
 };
}
const expectUnconfirmed=async(fn,match=/não foi confirmad|não confirmou|não corresponde|não foi aplicada|consulta do Pix|A cobrança mudou|alterado/i)=>{
 await assert.rejects(fn,err=>match.test(String(err.message)));
};
{
 const x=setup();const r=await x.request();
 assert.equal(r.paymentRequestId,REQUEST);
 assert.deepEqual(x.calls.map(v=>v.name),['merchant-ops']);
 assert.equal(x.calls[0].body.merchantId,M);
 assert.equal(x.calls[0].body.action,'request-billing-package');
 assert.equal(x.calls[0].opts.idempotencyKey,'billing-fixture-unique-123456789012');
 assert.equal(x.rt.actionPending,false);
 assert.equal(x.rt.billing.paymentRequests[0].id,REQUEST);
}
for(const entry of [
 {action:'notify-billing-payment',payload:{statementId:STATEMENT,reference:'EndToEnd-TEST-1234567'},
  kind:'statement_payment'},
 {action:'notify-refund-recovery-payment',payload:{refundRecoveryId:RECOVERY,reference:'EndToEnd-TEST-1234567'},
  kind:'refund_recovery'}
]){
 const r={...base,requestKind:entry.kind,planKey:null,
  statementId:entry.payload.statementId??null,
  refundRecoveryId:entry.payload.refundRecoveryId??null};
 const row={...baseRow,requestKind:entry.kind,planKey:null,
  statementId:r.statementId,refundRecoveryId:r.refundRecoveryId};
 const x=setup({response:r,row});
 assert.equal((await x.request(entry.action,entry.payload)).paymentRequestId,REQUEST);
}
{
 const x=setup({response:{...base,status:'cancelled'},
   row:{...baseRow,status:'cancelled'}});
 const r=await x.request('cancel-billing-request',{paymentRequestId:REQUEST});
 assert.equal(r.status,'cancelled');
 assert.equal(x.calls[0].body.paymentRequestId,REQUEST);
}
{
 const x=setup({response:{...base,status:'cancelled'},
   row:{...baseRow,status:'pending'}});
 await expectUnconfirmed(()=>x.request('cancel-billing-request',
  {paymentRequestId:REQUEST}),/não confirmou/);
}
{
 const x=setup();
 x.setRefresh(async()=>({discarded:true,
  merchant:{merchantId:M,memberRole:'owner'},
  billing:{paymentRequests:[{...baseRow}]}}));
 await expectUnconfirmed(()=>x.request(),/não foi confirmada/);
}
for(const patch of [
 {id:'OTHER'}, {expectedAmountCents:29900}, {requestKind:'refund_recovery'},
 {merchantReference:'FOREIGN-REFERENCE'}, {status:'rejected'},
 {planKey:'credit_other'}
]){
 const x=setup({row:{...baseRow,...patch}});
 await expectUnconfirmed(()=>x.request());
}
{
 const x=setup({row:{...baseRow,status:'approved'}});
 assert.equal((await x.request()).ok,true,'may be approved by webhook between ACK and read');
}
{
 const x=setup();x.setPost(async()=>{throw Error('HTTP ACK lost')});
 await assert.rejects(()=>x.request(),/HTTP ACK lost/);
 assert.equal(x.calls.length,1,'no extra financial write');
 assert.equal(x.rt.actionPending,false);
}
{
 const x=setup(),wait=gate();
 x.setPost(()=>wait.promise);
 const pending=x.request();
 assert.equal(x.calls.length,1);
 x.rt.actionPending=true;
 await assert.rejects(()=>x.request(),/operação financeira em andamento/);
 x.rt.accessEpoch++;
 x.rt.session={user:{id:'actor-B'}};
 x.rt.billing={paymentRequests:[]};
 wait.resolve(base);
 await assert.rejects(pending,/sessão mudou durante a ação financeira/i);
 assert.equal(x.rt.billing.paymentRequests.length,0);
 assert.equal(x.rt.actionPending,true,'old callback cannot clear new actor pending action');
}
{
 const x=setup();
 x.rt.merchant.memberRole='driver';
 await assert.rejects(()=>x.request(),/acesso da revenda/i);
 assert.equal(x.calls.length,0,'driver cannot start financial RPC');
}
{
 const x=setup({response:pix,row:pixRow()});
 assert.equal((await x.createPix()).paymentRequestId,REQUEST);
 assert.equal(x.rt.billing.paymentRequests[0].pixCharge.providerVerified,true);
 assert.equal(x.rt.billing.paymentRequests[0].pixCharge.brCode,code);
 assert.equal(x.calls[0].name,'merchant-billing-pix');
}
{
 const x=setup({response:{...pix,charge:{...pix.charge,status:'completed',brCode:null,
 paidAmountCents:30000}},row:{...pixRow(),pixCharge:{
 ...pixRow().pixCharge,status:'completed',paidAmountCents:30000
 }}});
 const result=await x.createPix();
 assert.equal(result.alreadyReceived,true);
 assert.equal(x.rt.billing.paymentRequests[0].pixCharge.brCode,undefined,
  'completed payment never releases a reusable QR');
}
{
 const x=setup({response:pix,row:{...pixRow(),
  pixCharge:{...pixRow().pixCharge,correlationId:'OTHER'}}});
 await expectUnconfirmed(()=>x.createPix(),/cobrança mudou/);
}
{
 const x=setup({response:pix,row:pixRow()});
 x.setRefresh(async()=>({discarded:true,merchant:{merchantId:M},
  billing:{paymentRequests:[pixRow()]}}));
 await expectUnconfirmed(()=>x.createPix(),/consulta do Pix não foi aplicada/);
 assert.equal(x.rt.billing.paymentRequests[0].pixCharge.providerVerified,undefined);
}
{
 const x=setup({response:pix,row:pixRow()}),wait=gate();
 x.setPost(()=>wait.promise);
 const pending=x.createPix();
 x.rt.session={user:{id:'actor-B'}};
 x.rt.accessEpoch++;
 wait.resolve(pix);
 await assert.rejects(pending,/sessão mudou/);
 assert.equal(x.rt.billing.paymentRequests[0].pixCharge.providerVerified,undefined);
}
{
 const x=setup({response:pix,row:pixRow()}),wait=gate();
 let readStarted=false;
 x.setRefresh(()=>{readStarted=true;return wait.promise;});
 const pending=x.createPix();
 // Switch after the authenticated GET starts, not before PSP creation resolves.
 for(let k=0;k<40&&!readStarted;k++)await Promise.resolve();
 assert.equal(readStarted,true,'revalidation GET must begin');
 x.rt.session={user:{id:'actor-B'}};
 x.rt.accessEpoch++;
 wait.resolve({merchant:{merchantId:M},billing:{paymentRequests:[pixRow()]}});
 await assert.rejects(pending,/acesso à revenda mudou/);
}
assert.match(orders,/\.limit\(30\)/,'finance sample bounded; absent rows are not proof');
assert.match(billing,/merchant_billing_request_action/,'existing idempotent RPC remains authority');
assert.match(pixHandler,/merchant_billing_pix_charge_prepare_provider/);

// The first financial click loads the module only in the partner portal.
// Changing operator while the JS is in flight must not execute the old click
// under another user's credentials, even if both belong to the same merchant.
const loaderStart=backend.indexOf('let merchantBillingFlowLoader=null;');
const loaderEnd=backend.indexOf('async function merchantRequestBillingPackageLive(',loaderStart);
assert.ok(loaderStart>0&&loaderEnd>loaderStart);
const loaderScript=backend.slice(loaderStart,loaderEnd);
new vm.Script(loaderScript);
function loaderFixture(){
 const scripts=[],called=[];
 const rt={session:{user:{id:'actor-A'}},merchant:{merchantId:M},accessEpoch:7};
 const ctx=vm.createContext({
  merchantRuntime:rt,
  document:{
   createElement:()=>({}),
   querySelector:()=>({src:'https://parceiro.tamao.com.br/js/merchant.js?v=latest-verified'}),
   head:{appendChild:script=>scripts.push(script)}
  },
  location:{href:'https://parceiro.tamao.com.br/'},
  URL,encodeURIComponent,Error,String
 });
 ctx.globalThis=ctx;
 vm.runInContext(loaderScript+'\nthis.lazy={request:merchantBillingRequestLive,pix:merchantCreateBillingPixLive};',ctx);
 return {ctx,rt,scripts,called};
}
{
 const x=loaderFixture();
 const pending=x.ctx.lazy.request('request-billing-package',{planKey:'credit_300'});
 assert.equal(x.scripts.length,1,'script requested after click, not on initial page');
 assert.match(x.scripts[0].src,/merchant-billing-flow\.js\?v=latest-verified/);
 x.ctx.merchantBillingRequestImpl=async()=>{x.called.push('old click');return base;};
 x.ctx.merchantCreateBillingPixImpl=async()=>pix;
 x.rt.session={user:{id:'actor-B'}};
 x.scripts[0].onload();
 await assert.rejects(pending,/acesso da revenda mudou/i);
 assert.equal(x.called.length,0);
}
{
 const x=loaderFixture();
 const p1=x.ctx.lazy.request('request-billing-package',{planKey:'credit_300'});
 const p2=x.ctx.lazy.pix({planKey:'credit_300'});
 assert.equal(x.scripts.length,1,'concurrent first clicks share one JS download');
 x.ctx.merchantBillingRequestImpl=async()=>{x.called.push('request');return base;};
 x.ctx.merchantCreateBillingPixImpl=async()=>{x.called.push('pix');return pix;};
 x.scripts[0].onload();
 assert.equal((await p1).paymentRequestId,REQUEST);
 assert.equal((await p2).paymentRequestId,REQUEST);
 assert.equal(x.called.length,2);
}
{
 const x=loaderFixture();
 const fail=x.ctx.lazy.request('request-billing-package',{planKey:'credit_300'});
 x.scripts[0].onerror();
 await assert.rejects(fail,/carregar a conferência financeira/);
 const retry=x.ctx.lazy.request('request-billing-package',{planKey:'credit_300'});
 assert.equal(x.scripts.length,2,'download failure can be retried safely');
 x.ctx.merchantBillingRequestImpl=async()=>base;
 x.ctx.merchantCreateBillingPixImpl=async()=>pix;
 x.scripts[1].onload();
 assert.equal((await retry).paymentRequestId,REQUEST);
}

assert.match(moduleSource,/if\(!fresh\|\|merchantRuntime\.billing!==fresh\.billing/);
assert.match(backend,/merchantLoadBillingFlow/);
assert.match(read('scripts/build-live-portals.mjs'),/merchant-billing-flow\.js/);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/merchant-finance-exact-readback-v1-493.mjs'));
console.log('PASS #493 partner financial lifecycle: 4 requests, original Pix, exact readback, no false success, account/role changes and lost ACK.');
