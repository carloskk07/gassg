import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/clube-coupon-shop.js',import.meta.url),'utf8');
new vm.Script(source);
const invoiceId='a5a16f8b-5a50-45de-80c3-855000000001';
const code='00020101021226800014br.gov.bcb.pix1234567890';
const timerCalls=[],handlers={},calls=[],messages=[],copies=[];
const leaseTimers=()=>timerCalls.filter(x=>x.ms>3500000&&x.ms<=3600000);
const fakeCodeImage='data:image/png;base64,'+'A'.repeat(32);
const url='https://www.mercadopago.com.br/payments/855';
const makePurchase=(overrides={})=>({
 invoiceId,status:'awaiting_payment',fundingModel:'partner_funded',
 servicePostalCode:'97000000',pixPayable:true,expiresAt:new Date(Date.now()+3600000).toISOString(),pixCode:code,
 qrImageDataUri:fakeCodeImage,paymentUrl:url,amountCents:890,...overrides
});
let user='buyer-855',hidden=false;
const document={
 get hidden(){return hidden;},
 addEventListener:(type,cb)=>{handlers[type]=cb;},
 getElementById:()=>({value:'97000000',checked:true})
};
const ctx=vm.createContext({
 globalThis:null,Date,Number,String,Object,Array,Set,Promise,URL,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 document,navigator:{clipboard:{writeText:async text=>copies.push(text)}},
 setTimeout:(fn,ms)=>{
  const t={fn,ms,cancelled:false};timerCalls.push(t);return t;
 },
 clearTimeout:t=>{t.cancelled=true;},
 crypto:{randomUUID:()=>invoiceId},
 esc:v=>String(v??''),
 route:()=> 'club',render:()=>{},
 toast:msg=>messages.push(msg),liveReady:()=>true,
 clubePaidCouponView:null,clubePaidCouponsRefresh:async()=>{},
 liveInvoke:async(name,request)=>{
  assert.equal(name,'coupon-credit-pix');calls.push(request);
  if(request.action==='invoice-status')return {
    ok:true,invoiceId,status:'awaiting_payment',fundingModel:'partner_funded',
    pixPayable:true,expiresAt:new Date(Date.now()+3600000).toISOString(),pixCode:code,qrImageDataUri:fakeCodeImage,paymentUrl:url
  };
  throw new Error('No invoice creation or provider calls permitted in this test');
 }
});
ctx.globalThis=ctx;
ctx.liveRuntime={session:{user:{id:user}}};
new vm.Script(source+'\nthis.state=clubeCouponShopState;'+
 'this.lease=clubeCouponPixLease;this.arm=clubeCouponArmPixLease;'+
 'this.panel=clubeCouponShopPanel;this.copy=clubeCouponCopyPix;'+
 'this.refreshInvoice=clubeCouponCheckInvoice;').runInContext(ctx);
assert.equal(typeof handlers.visibilitychange,'function');
Object.assign(ctx.state,{userId:user,status:'ready',packages:[],seller:null,
 busy:false,attempts:{},regionPostal:'97000000',purchase:null});
ctx.clubePaidCouponView={userId:user,status:'ready',purchases:[{
 invoiceId,packageKey:'partner_general_3x5_849',status:'awaiting_payment',
 fundingModel:'partner_funded',servicePostalCode:'97000000'
}]};

// A saved Pix without an actual new display lease must not show the QR.
ctx.state.purchase=makePurchase();
assert.doesNotMatch(ctx.panel(),/Código Pix copia e cola|QR Code Pix do pedido de cupom|Abrir pagamento seguro/);
assert.equal(calls.length,0);
ctx.arm();
assert.equal(leaseTimers().length,1,
 'auto-check watcher may coexist with exactly one QR display lease');
assert(leaseTimers()[0].ms>3500000,'QR remains available until the real provider deadline');
assert.match(ctx.panel(),/Código Pix copia e cola/);
assert.match(ctx.panel(),/QR Code Pix do pedido de cupom/);
assert.match(ctx.panel(),/Abrir pagamento seguro/);

// After lease expiry no stale QR, external payment link, or text remain,
// but the same invoice remains available to recheck without a new purchase.
leaseTimers()[0].fn();
assert.equal(ctx.state.purchase.invoiceId,invoiceId);
assert.equal(ctx.state.purchase.status,'awaiting_payment');
assert.equal(ctx.state.purchase.pixPayable,false);
assert.equal(ctx.state.purchase.pixCode,null);
assert.equal(ctx.state.purchase.qrImageDataUri,null);
assert.equal(ctx.state.purchase.paymentUrl,null);
assert.doesNotMatch(ctx.panel(),/Código Pix copia e cola|QR Code Pix do pedido de cupom|Abrir pagamento seguro/);
assert.match(ctx.panel(),/Conferir pagamento e cupons/);
await ctx.copy();
assert.equal(copies.length,0);
assert.equal(calls.length,0);

// Customer expressly rechecks original pending invoice; one authenticated
// invoice-status grants a NEW 45-second lease, never a second purchase.
await ctx.refreshInvoice(invoiceId);
assert.deepEqual(calls.map(x=>x.action),['invoice-status']);
assert.match(ctx.panel(),/Código Pix copia e cola/);
assert.equal(leaseTimers().length,2,'second lease is not duplicated by auto-check');

// Leaving the tab while Pix is on-screen immediately revokes display.
// Returning does not silently restore either the BR code or the QR image.
hidden=true;
handlers.visibilitychange();
assert.equal(ctx.state.purchase.invoiceId,invoiceId);
assert.equal(ctx.state.purchase.pixPayable,false);
assert.doesNotMatch(ctx.panel(),/Código Pix copia e cola|QR Code Pix do pedido de cupom|Abrir pagamento seguro/);
hidden=false;
handlers.visibilitychange();
assert.doesNotMatch(ctx.panel(),/Código Pix copia e cola/);
assert.equal(calls.length,1);
await ctx.refreshInvoice(invoiceId);
assert.match(ctx.panel(),/Código Pix copia e cola/);

// Even if an old timer callback fires after cancellation/rearm, it must
// not hide or rewrite a DIFFERENT invoice/user card.
const staleTimer=leaseTimers().at(-1);
ctx.state.purchase=makePurchase({invoiceId:'a5a16f8b-5a50-45de-80c3-855000000002'});
ctx.arm();
assert.equal(staleTimer.cancelled,true);
staleTimer.fn();
assert.equal(ctx.state.purchase.invoiceId,'a5a16f8b-5a50-45de-80c3-855000000002');
assert.equal(ctx.state.purchase.pixPayable,true);

// No payment card is revealed while browser is already hidden, even
// when a valid status response arrives later from a real authenticated API.
hidden=true;
ctx.state.purchase=makePurchase();
ctx.arm();
assert.equal(ctx.state.purchase.pixPayable,false);
assert.doesNotMatch(ctx.panel(),/Código Pix copia e cola/);
hidden=false;

// A page redraw also fails closed if an actual 45-second timer cannot
// fire: elapsed deadline alone prevents re-displaying saved payment data.
ctx.state.purchase=makePurchase();
ctx.arm();
ctx.lease.expiresAt=Date.now()-1;
assert.doesNotMatch(ctx.panel(),/Código Pix copia e cola|QR Code Pix do pedido de cupom|Abrir pagamento seguro/);
await ctx.copy();
assert.equal(copies.length,0);
assert.equal(ctx.state.busy,false);
console.log('PASS #855: QR/Pix/link display lease expires, hides on background, recheck restores only original invoice, stale callbacks isolated.');


// V1.954 retry: a single network failure must not strand the buyer's
// already-issued Pix. A second GET of the SAME invoice can confirm payment.
// No new purchase, copied QR, credit mutation or fake PSP result is permitted.
new vm.Script('this.autoCheckStart=clubeCouponPixAutoStart;'+
 'this.autoCheckStop=clubeCouponPixAutoStop;').runInContext(ctx);
ctx.autoCheckStop();
ctx.state.purchase=makePurchase();
let autoChecks=0,autoRefreshes=0;
const earlierTimers=timerCalls.length;
ctx.liveInvoke=async(name,request)=>{
 assert.equal(name,'coupon-credit-pix');
 assert.equal(request.action,'invoice-status','automatic retry cannot create Pix');
 assert.equal(request.invoiceId,invoiceId,'retry cannot switch to another invoice');
 autoChecks++;
 if(autoChecks===1)throw Error('temporary network timeout');
 return {ok:true,invoiceId,status:'paid',pixPayable:false};
};
ctx.clubePaidCouponsRefresh=async()=>{autoRefreshes++};
ctx.autoCheckStart(invoiceId);
const firstAuto=timerCalls.slice(earlierTimers).find(t=>t.ms===60000&&!t.cancelled);
assert.ok(firstAuto,'existing unpaid invoice schedules one bounded lookup');
firstAuto.cancelled=true; // simulate a one-shot browser timeout firing
await firstAuto.fn();
assert.equal(autoChecks,1);
assert.equal(autoRefreshes,0);
assert.equal(ctx.state.purchase.status,'awaiting_payment','failed GET cannot mark a Pix paid');
const retry=timerCalls.slice(earlierTimers).find(t=>t.ms===70000&&!t.cancelled);
assert.ok(retry,'transient error must retry the original invoice');
retry.cancelled=true; // fired timeout is no longer scheduled
await retry.fn();
assert.equal(autoChecks,2,'one retry after a temporary failure');
assert.equal(autoRefreshes,1,'approved existing invoice reloads buyer vouchers');
assert.equal(ctx.state.purchase.status,'paid');
assert.equal(ctx.state.purchase.invoiceId,invoiceId);
assert.equal(timerCalls.slice(earlierTimers).filter(t=>t.ms===70000&&!t.cancelled).length,0,
 'terminal paid state stops further automatic checks');

// The same bounded watcher may never query an invoice after account change.
ctx.liveRuntime.session.user.id=user;
ctx.state.purchase=makePurchase();
const priorChecks=autoChecks;
const nextTimerOffset=timerCalls.length;
ctx.autoCheckStart(invoiceId);
const pendingAfterSwitch=timerCalls.slice(nextTimerOffset).find(t=>t.ms===60000&&!t.cancelled);
assert.ok(pendingAfterSwitch);
ctx.liveRuntime.session.user.id='different-buyer';
pendingAfterSwitch.cancelled=true;
await pendingAfterSwitch.fn();
assert.equal(autoChecks,priorChecks,'account change prevents even a read');
assert.equal(timerCalls.slice(nextTimerOffset).filter(t=>t.ms===70000&&!t.cancelled).length,0);
console.log('V1.954 PASS — transient Pix status error retries original invoice only; paid readback, no new charge, account isolation.');
