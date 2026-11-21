import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('js/core.js'),credits=read('js/ads-credits.js');
const planner=read('js/ads-planner.js'),clube=read('js/clube-coupon-shop.js');
const backend=read('js/backend.js'),customer=read('js/customer.js');
const merchant=read('js/merchant.js'),mobility=read('js/mobility.js');

for(const [name,source] of Object.entries({core,credits,planner,clube,backend,customer,merchant,mobility}))
 assert.doesNotThrow(()=>new vm.Script(source),name+' must parse');

const handlers={},timers=new Map();
let next=0,active=true,seen=0,visible='visible';
const part=core.slice(core.indexOf('// The same bank-readable Pix'));
assert.match(part,/globalThis\.tamaoPixWatch=/);
const ctx=vm.createContext({
 document:{currentScript:null,get visibilityState(){return visible},
  addEventListener:(type,fn)=>{handlers['document:'+type]=fn}},
 window:{addEventListener:(type,fn)=>{handlers['window:'+type]=fn}},
 setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id},
 clearTimeout:id=>timers.delete(id),
 Promise,Date,URL,TextEncoder,TextDecoder
});
vm.runInContext(part,ctx);
ctx.tamaoPixWatch('account:payment-id',()=>active,async()=>{seen++});
ctx.tamaoPixWatch('account:payment-id',()=>active,async()=>{seen++});
assert.equal(timers.size,1,'one status watch per payment and participant');
assert.equal([...timers.values()][0].ms,35000,'no aggressive provider polling');
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
handlers['window:online']();await flush();
assert.equal(seen,1,'network recovery reads existing obligation');
visible='hidden';handlers['document:visibilitychange']();await flush();
assert.equal(seen,1,'hidden tab never performs provider reads');
visible='visible';handlers['document:visibilitychange']();await flush();
assert.equal(seen,2,'returning from the bank resumes status');
active=false;handlers['window:online']();await flush();
assert.equal(seen,2,'closed or owner-switched watchers must not recheck');

// Wallet Pix: server ledger read precedes the bounded provider reconciliation.
// Never call the payment-creation or provider POST endpoints in this observer.
const start=credits.indexOf('async function tamaoCreditObservePayment(');
const end=credits.indexOf('\nfunction tamaoCreditPixHtml(',start);
assert(start>0&&end>start);
const id='11111111-1111-4111-8111-111111111111';
let owner='owner-a',walletReads=0,providerReads=0;
let pending=[{id,status:'pix_pending'}];
const watch={actor:owner,generation:1,topupId:'',attempts:0,nextAt:0,busy:false};
const scope={actor:owner,generation:1};
const walletCtx=vm.createContext({
 tamaoCreditRefresh:async()=>{walletReads++;return true},
 tamaoCreditMatches:s=>s.actor===owner&&s.generation===1,
 tamaoCreditPending:()=>pending,tamaoCreditProviderWatch:watch,
 tamaoCreditState:{busy:false},document:{visibilityState:'visible'},
 tamaoCreditInvoke:async body=>{
  assert.equal(body.action,'reconcile');
  assert.equal(body.topupId,id);
  providerReads++;
  return {source:'ads_credit_payment_fact_v1_1097',status:'approved'};
 },Date
});
vm.runInContext(credits.slice(start,end),walletCtx);
assert.equal(await walletCtx.tamaoCreditObservePayment(scope),true);
assert.equal(walletReads,2,'a confirmed provider result must be reread in the ledger');
assert.equal(providerReads,1);
assert.equal(await walletCtx.tamaoCreditObservePayment(scope),true);
assert.equal(providerReads,1,'bounded probe must not repeat immediately');
pending=[{id,status:'approved'}];
assert.equal(await walletCtx.tamaoCreditObservePayment(scope),true);
assert.equal(providerReads,1,'confirmed payment stops PSP requests');
owner='owner-b';pending=[{id,status:'pix_pending'}];
assert.equal(await walletCtx.tamaoCreditObservePayment(scope),false);
assert.equal(providerReads,1,'cross-account original payment must not be probed');

assert.match(planner,/tamaoAdsAutoPayment\.tries===1\?35000:120000/);
assert.match(planner,/action:'reconcile',campaignId:match\.id/);
assert.match(clube,/w\.timer=setTimeout\(poll,15000\)/);
assert.match(clube,/action:'invoice-status',invoiceId:id/);
assert.match(backend,/terminalPaymentAttemptAt/);
assert.match(backend,/liveGetOrder\(requestedOrderId,\{silent:true\}\)/);
assert.match(customer,/Conferindo automaticamente o pagamento com a revenda/);
assert.match(merchant,/confirmação acompanhada automaticamente/);
assert.match(mobility,/A situação deste Pix é conferida automaticamente/);
assert.match(credits,/Conferindo automaticamente no Mercado Pago/);
assert(!credits.slice(start,end).includes('action:\'topup\''),'background probe cannot create Pix');
console.log('PASS V1.1103: payment watchers resume safely, confirm original Pix, respect identity and bound provider checks across TAMÃO.');
