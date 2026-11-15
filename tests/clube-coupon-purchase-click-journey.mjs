import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the exact buyer module and the inline onclick emitted by its real
// shop panel. PSP/Edge responses are intentionally synthetic; the separate
// isolated-Supabase tests check the actual payment/order SQL and HTTP rules.
const source=fs.readFileSync(new URL('../js/clube-coupon-shop.js',import.meta.url),'utf8');
new vm.Script(source,{filename:'clube-coupon-shop.js'});
const buyerA='buyer-ui-a',buyerB='buyer-ui-b';
const packageKey='club_3x5_ui';
const partnerKey='partner_general_3x5_849';
const invoiceA='a1234567-1234-4123-8123-123456789001';
const preparedInvoice='a1234567-1234-4123-8123-123456789002';
const requestA='b1234567-1234-4123-8123-123456789001';
const requestB='b1234567-1234-4123-8123-123456789002';
const requestC='b1234567-1234-4123-8123-123456789003';
const mockCode='00020101021226800014br.gov.bcb.pix12345678901234567890';
const calls=[],messages=[],renders=[];
let acceptedTerms=false,currentRoute='club',generated=0,history=[],purchaseResponse=null,statusResponse=null,serverCalls=0;
const universal={
 packageKey,title:'Pacote 3 cupons',priceCents:890,faceCents:500,
 couponCount:3,validDays:180,minOrderCents:1000,
 termsVersion:'clube_coupon_terms_v1_813'
};
const seller={name:'Vendedor fictício CI',taxDocument:'00000000000000',
 address:'Rua Fictícia 1',supportEmail:'ficticio@example.test'};
const partner={
 packageKey:partnerKey,title:'Parceiro 3 cupons',priceCents:890,
 faceCents:500,couponCount:3,validDays:180,minOrderCents:1000,
 fundingModel:'partner_funded',
 eligiblePostalCode:'97300000',eligibleProducts:'participating_merchants_only',
 termsVersion:'clube_partner_coupon_terms_v1_846',
 termsText:'Contrato informativo CI. '.repeat(40),seller
};
const clock=()=>new Date(Date.now()+600000).toISOString();
const makePix=(extra={})=>({
 ok:true,invoiceId:invoiceA,status:'awaiting_payment',pixPayable:true,
 fundingModel:'owner_funded',amountCents:890,expiresAt:clock(),pixCode:mockCode,
 ...extra
});
const ctx=vm.createContext({
 Number,String,Object,Array,Set,Promise,Date,URL,Math,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 route:()=>currentRoute,render:()=>renders.push('render'),
 toast:v=>messages.push(v),liveReady:()=>true,
 crypto:{randomUUID:()=>[requestA,requestB,requestC][generated++]||requestC},
 document:{getElementById:id=>{
   if(id.startsWith('clube-coupon-terms-'))return {checked:acceptedTerms};
   if(id==='clube-partner-coupon-cep')return {value:'97300-000'};
   return null;
 }},
 liveInvoke:async(name,body)=>{
   assert.equal(name,'coupon-credit-pix');
   calls.push(body);serverCalls++;
   if(body.action==='catalog'){
     return {ok:true,source:'clube_paid_catalog_v1_807',packages:[universal],seller};
   }
   if(body.action==='partner-catalog'){
     assert.equal(body.postalCode,'97300000');
     return {ok:true,source:'clube_partner_coupon_catalog_v1_849',packages:[partner]};
   }
   if(body.action==='purchase'||body.action==='partner-purchase'){
     if(typeof purchaseResponse==='function')return purchaseResponse(body);
     return purchaseResponse;
   }
   if(body.action==='invoice-status'){
     if(typeof statusResponse==='function')return statusResponse(body);
     return statusResponse;
   }
   throw Error('Unexpected buyer operation '+body.action);
 },
 clubePaidCouponView:null,clubePaidCouponsRefresh:async()=>{
   ctx.clubePaidCouponView={userId:ctx.liveRuntime.session.user.id,
     status:'ready',purchases:[...history]};
 }
});
ctx.globalThis=ctx;
ctx.liveRuntime={session:{user:{id:buyerA}}};
vm.runInContext(source+
 ';this.state=clubeCouponShopState;this.refresh=clubeCouponShopRefresh;'+
 'this.panel=clubeCouponShopPanel;this.buy=clubeCouponBuy;'+
 'this.verifyPostal=clubeCouponVerifyPostal;this.check=clubeCouponCheckInvoice;',ctx);
ctx.clubePaidCouponView={userId:buyerA,status:'ready',purchases:[]};
const purchaseOps=()=>calls.filter(x=>['purchase','partner-purchase'].includes(x.action));
function emittedClick(key){
 const markup=ctx.panel();
 assert.match(markup,/Comprar com Pix/);
 const fn="clubeCouponBuy('"+key+"')";
 assert.ok(markup.includes('onclick="'+fn+'"'),
   'button must actually wire the tested buyer handler');
 return vm.runInContext(fn,ctx);
}
await ctx.refresh();
assert.equal(ctx.state.userId,buyerA);
assert.equal(ctx.state.status,'ready');
assert.match(ctx.panel(),/3 cupons de R\$\s*5,00/);
assert.equal(purchaseOps().length,0,'opening Club never issues a Pix');

// Consent is required from the exact package checkbox. The screenshot-worthy
// button exists but its handler must refuse buying without explicit consent.
await emittedClick(packageKey);
assert.equal(purchaseOps().length,0);
assert.match(messages.at(-1),/aceite as condições/);

// Two rapid clicks must create only one remote attempt and expose a disabled
// button until the server responds.
acceptedTerms=true;
let resolveFirst;
purchaseResponse=()=>new Promise(resolve=>{resolveFirst=resolve;});
const first=emittedClick(packageKey);
assert.equal(ctx.state.busy,true);
assert.match(ctx.panel(),/Comprar com Pix<\/button>/);
assert.match(ctx.panel(),/onclick="clubeCouponBuy\('club_3x5_ui'\)" disabled/);
await emittedClick(packageKey);
assert.equal(purchaseOps().length,1,'double click must issue one purchase');
assert.equal(purchaseOps()[0].termsAccepted,true);
assert.equal(purchaseOps()[0].termsVersion,universal.termsVersion);
assert.equal(purchaseOps()[0].requestId,requestA);
assert.equal(purchaseOps()[0].postalCode,undefined);
history=[{invoiceId:invoiceA,status:'awaiting_payment',
 packageKey,requestId:requestA}];
resolveFirst(makePix());
await first;
assert.equal(ctx.state.busy,false);
assert.equal(ctx.state.purchase?.invoiceId,invoiceA);
assert.match(ctx.panel(),/Pagamento do seu pacote/);

// A second click on the same pending package only reads the same invoice.
// It must not request another Pix or allocate another idempotency key.
statusResponse=makePix();
const before=purchaseOps().length;
await emittedClick(packageKey);
assert.equal(purchaseOps().length,before);
assert.equal(calls.at(-1).action,'invoice-status');
assert.equal(calls.at(-1).invoiceId,invoiceA);
assert.equal(generated,1,'pending invoice must not mint a second request UUID');

// In an ambiguous network failure with no invoice history, the same original
// request key must be used on retry. Never silently generate another order.
history=[];
await ctx.clubePaidCouponsRefresh();
ctx.state.purchase=null;
ctx.state.attempts={};
purchaseResponse=()=>{throw Error('network lost after possible charge');};
await emittedClick(packageKey);
const firstAmbiguous=purchaseOps().at(-1);
assert.equal(firstAmbiguous.requestId,requestB);
assert.match(messages.at(-1),/Consulte o pedido/);
purchaseResponse=makePix({invoiceId:preparedInvoice});
await emittedClick(packageKey);
assert.equal(purchaseOps().at(-1).requestId,requestB,
 'ambiguous response must retry the identical purchase request');
assert.equal(ctx.state.purchase?.invoiceId,preparedInvoice);

// Returning after refresh to an already prepared original invoice recovers
// the original request UUID instead of creating a new financial operation.
history=[{invoiceId:preparedInvoice,status:'prepared',
 packageKey,requestId:requestB}];
await ctx.clubePaidCouponsRefresh();
ctx.state.attempts={};
ctx.state.purchase=null;
purchaseResponse=makePix({invoiceId:preparedInvoice});
await emittedClick(packageKey);
assert.equal(purchaseOps().at(-1).requestId,requestB);
assert.equal(generated,2,'prepared invoice must reuse persisted request key');

// Partner-funded coupons must not be sold without verified original CEP.
ctx.state.regionPostal='97300000';
await ctx.refresh();
assert.match(ctx.panel(),/CEP vinculado|revendas participantes/);
ctx.state.regionPostal='';
const beforePartner=purchaseOps().length;
await emittedClick(partnerKey);
assert.equal(purchaseOps().length,beforePartner);
assert.match(messages.at(-1),/Verifique seu CEP/);
ctx.state.regionPostal='97300000';
history=[{invoiceId:invoiceA,status:'awaiting_payment',
 packageKey:partnerKey,requestId:requestC,servicePostalCode:'97000000'}];
await ctx.clubePaidCouponsRefresh();
await emittedClick(partnerKey);
assert.equal(purchaseOps().length,beforePartner,
 'a pending Pix for another region may not be reused or relabeled');
assert.match(messages.at(-1),/outro CEP/);

// Account switching must remove previous attempts and previous invoice.
// A response arriving from buyer A must never populate buyer B's UI.
history=[];
purchaseResponse=()=>new Promise(resolve=>{resolveFirst=resolve;});
ctx.state.attempts={};
ctx.state.purchase=null;
const originalBuyerPurchase=emittedClick(packageKey);
ctx.liveRuntime.session.user.id=buyerB;
assert.doesNotMatch(ctx.panel(),/Pagamento do seu pacote/,
 'old account invoice must be hidden immediately on switch');
resolveFirst(makePix({invoiceId:invoiceA}));
await originalBuyerPurchase;
assert.equal(ctx.state.busy,false,'prior account purchase must release the busy state');
// The real application re-renders after finally; panel() schedules the new
// account's catalog via a microtask, not during the previous pending purchase.
ctx.panel();
await new Promise(resolve=>setTimeout(resolve,0));
if(ctx.state.userId!==buyerB)await ctx.refresh();
await new Promise(resolve=>setTimeout(resolve,0));
console.log('CI_ACCOUNT_SWITCH_PROBE',JSON.stringify({
 liveUser:ctx.liveRuntime.session.user.id,shopOwner:ctx.state.userId,
 busy:ctx.state.busy,status:ctx.state.status,
 autoQueuedFor:ctx.state.autoQueuedFor,
 historyOwner:ctx.clubePaidCouponView.userId,
 lastCalls:calls.slice(-4).map(x=>x.action)
}));
assert.equal(ctx.state.userId,buyerB);
assert.deepEqual(Object.keys(ctx.state.attempts),[]);
assert.equal(ctx.state.purchase,null,'old account charge must not appear for B');
assert.equal(purchaseOps().at(-1).requestId,requestC);
assert.equal(ctx.clubePaidCouponView.userId,buyerB);
assert.ok(renders.length>0);
console.log('PASS: real Clube button/terms, two-click serialization, original Pix recovery, stable ambiguity key, CEP provenance and user isolation; mocked PSP/Edge only.');
