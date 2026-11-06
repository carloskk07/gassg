import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync(new URL('../js/clube-coupon-shop.js',import.meta.url),'utf8');
new vm.Script(src);
const invoiceId='a5a16f8b-5a50-45de-80c3-854000000001';
const otherInvoice='a5a16f8b-5a50-45de-80c3-854000000002';
const requestId='a5a16f8b-5a50-45de-80c3-854000000003';
const code='00020101021226800014br.gov.bcb.pix1234567890';
const calls=[],copies=[],messages=[];
let activeUser='buyer-854',invoiceResponse=null;
let confirmCount=0,refundResponse=null,refundCalls=0;
const ctx=vm.createContext({
  Number,String,Object,Array,Set,Promise,Date,URL,
  BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
  esc:value=>String(value??''),route:()=> 'club',render:()=>{},
  liveReady:()=>true,toast:value=>messages.push(value),
  navigator:{clipboard:{writeText:async text=>{copies.push(text);}}},
  document:{getElementById:()=>({value:'arrependimento',checked:true})},
  window:{confirm:()=>{confirmCount++;return true;}},
  crypto:{randomUUID:()=>requestId},
  liveInvoke:async(name,payload)=>{
    assert.equal(name,'coupon-credit-pix');
    calls.push(payload);
    if(payload.action==='invoice-status')return typeof invoiceResponse==='function'
      ?invoiceResponse():invoiceResponse;
    if(payload.action==='request-refund'){
      refundCalls++;
      return typeof refundResponse==='function'
        ?refundResponse():refundResponse;
    }
    throw Error('Unexpected live request: '+payload.action);
  },
  clubePaidCouponView:null,
  clubePaidCouponsRefresh:async()=>{}
});
ctx.globalThis=ctx;
ctx.liveRuntime={session:{user:{id:activeUser}}};
new vm.Script(src+'\nthis.state=clubeCouponShopState;this.refunds=clubeCouponRefundState;'+
  'this.copy=clubeCouponCopyPix;this.refund=clubeCouponRefundAsk;'+
  'this.historyPanel=clubeCouponPurchasesPanel;this.shopPanel=clubeCouponShopPanel;').runInContext(ctx);
Object.assign(ctx.state,{
  userId:activeUser,status:'ready',packages:[],seller:null,busy:false,
  attempts:{},purchase:null,regionPostal:'97000000'
});
ctx.clubePaidCouponView={userId:activeUser,status:'ready',purchases:[]};
const purchase=(extra={})=>({
 invoiceId,pixCode:code,pixPayable:true,status:'awaiting_payment',
 amountCents:890,fundingModel:'partner_funded',servicePostalCode:'97000000',
 ...extra
});
const verified=()=>({
 ok:true,invoiceId,status:'awaiting_payment',pixPayable:true,
 pixCode:code,fundingModel:'partner_funded'
});

// The copy button is not an authority: hidden, unpayable or unbound
// historical QR codes must never reach the device clipboard.
for(const invalid of [
 {status:'paid'},{pixPayable:false},{servicePostalCode:null},
 {pixCode:'short'},{invoiceId:'wrong'}
]){
 ctx.state.purchase=purchase(invalid);
 const before=calls.length;
 await ctx.copy();
 assert.equal(calls.length,before,'invalid locally cached Pix never calls provider');
 assert.equal(copies.length,0,'invalid Pix never reaches clipboard');
}
ctx.state.purchase=purchase();
invoiceResponse=verified();
assert.match(ctx.shopPanel(),/Copiar código Pix/);
await ctx.copy();
assert.equal(copies.length,1,'valid Pix copies after a fresh authoritative read');
assert.equal(copies[0],code);
assert.deepEqual(calls.map(x=>x.action),['invoice-status']);
assert.equal(calls[0].invoiceId,invoiceId);
assert.equal(ctx.state.busy,false);
assert.match(messages.at(-1),/confirmado e copiado/);

// Duplicate clicks cannot start two remote status checks and copy twice.
calls.length=0;
ctx.state.purchase=purchase();
let completeRemote;
invoiceResponse=()=>new Promise(resolve=>{completeRemote=resolve;});
const firstCopy=ctx.copy();
await ctx.copy();
assert.equal(calls.length,1);
assert.equal(ctx.state.busy,true);
assert.doesNotMatch(ctx.shopPanel(),/onclick="clubeCouponCopyPix\(\)">/,
 'copy control is disabled during remote verification');
completeRemote(verified());
await firstCopy;
assert.equal(copies.length,2);
assert.equal(ctx.state.busy,false);

// An old QR from a withdrawn supplier cannot be copied or re-presented.
ctx.state.purchase=purchase();
invoiceResponse={ok:false,error:'PARTNER_COUPON_PENDING_SUPPLY_UNAVAILABLE'};
await ctx.copy();
assert.equal(copies.length,2,'withdrawn Pix must not be copied');
assert.equal(ctx.state.purchase,null,'old QR must be removed from page state');
assert.match(messages.at(-1),/Não pague o código anterior/);
assert.doesNotMatch(ctx.shopPanel(),/Código Pix copia e cola/);

// A changed BR code is not the same originally bound charge.
ctx.state.purchase=purchase();
invoiceResponse={...verified(),pixCode:code+'123'};
await ctx.copy();
assert.equal(copies.length,2);
assert.equal(ctx.state.purchase,null);

// A late response after logout/switch must not copy A's Pix for user B.
ctx.state.purchase=purchase();
let release;
invoiceResponse=()=>new Promise(resolve=>{release=resolve;});
const changing=ctx.copy();
ctx.liveRuntime.session.user.id='buyer-854-other';
release(verified());
await changing;
assert.equal(copies.length,2,'logged-out buyer Pix never copied to next user');
ctx.liveRuntime.session.user.id=activeUser;

// Refund request serialization: no two simultaneous RPCs or random
// payment-provider idempotency keys for one buyer's identical invoice.
ctx.clubePaidCouponView={
 userId:activeUser,status:'ready',
 purchases:[{invoiceId,status:'paid',refundStatus:null,amountCents:890}]
};
let resolveRefund;
refundResponse=()=>new Promise(resolve=>{resolveRefund=resolve;});
const firstRefund=ctx.refund(invoiceId);
await ctx.refund(invoiceId);
assert.equal(refundCalls,1,'double click sends only one cancellation');
assert.equal(confirmCount,1,'only one confirmation prompt');
assert.equal(calls.at(-1).requestId,requestId);
assert.match(ctx.historyPanel(),/Solicitar cancelamento \/ reembolso/);
assert.match(ctx.historyPanel(),/disabled/,'pending refund button is disabled');
resolveRefund({ok:true,source:'clube_coupon_refund_request_v1_814',
 invoiceId,requestId,status:'requested',receivedAt:new Date().toISOString()});
await firstRefund;
assert.equal(ctx.refunds.inFlight.size,0);
assert.match(messages.at(-1),/Aguardando análise do reembolso/);

// Ambiguous network failures reuse exact request ID; no second protocol
// is invented simply because the first HTTP response was lost.
refundResponse=()=>{throw Error('network ambiguous');};
await ctx.refund(invoiceId);
const retryKey=calls.at(-1).requestId;
assert.equal(retryKey,requestId);
refundResponse={
 ok:true,source:'clube_coupon_refund_request_v1_814',
 invoiceId,requestId,status:'refunded',refundConfirmed:true
};
await ctx.refund(invoiceId);
assert.equal(calls.at(-1).requestId,retryKey);
assert.match(messages.at(-1),/Reembolso confirmado/);

// User and invoice isolation: one request ID never leaks into another.
ctx.clubePaidCouponView.purchases.push({
 invoiceId:otherInvoice,status:'paid',refundStatus:null,amountCents:890
});
await ctx.refund(otherInvoice);
assert.notEqual(ctx.refunds.attempts[otherInvoice],undefined);
assert.equal(ctx.refunds.inFlight.size,0);
ctx.liveRuntime.session.user.id='buyer-854-other';
ctx.clubePaidCouponView={
 userId:'buyer-854-other',status:'ready',
 purchases:[{invoiceId:otherInvoice,status:'paid',refundStatus:null,amountCents:890}]
};
await ctx.refund(otherInvoice);
assert.equal(ctx.refunds.userId,'buyer-854-other');
assert.equal(Object.keys(ctx.refunds.attempts).length,1,
 'refund idempotency cache belongs only to the current authenticated account');
assert.equal(ctx.refunds.inFlight.size,0);
console.log('PASS #854: live status before Pix copy, stale QR cleared, duplicate refund serialized, stable replay and user isolation.');
