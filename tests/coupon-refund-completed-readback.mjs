import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const shop=read('js/clube-coupon-shop.js');
const id='22000000-0000-4000-8000-000000000004',owner='owner-one';
const take=name=>{const start=edge.indexOf('function '+name+'('),end=edge.indexOf('\n}',start);
 assert(start>=0&&end>start);return edge.slice(start,end+2).replace(/:any(?=[,)])/g,'')};
const start=edge.indexOf('if(operation==="invoice-status")'),end=edge.indexOf('if(operation!=="purchase"',start);
assert(start>0&&end>start);
const route=edge.slice(start,end);
async function server(status,refundStatus,actor=owner){
 const invoice={id,customer_user_id:owner,status,sale_price_cents:890,
  provider_order_id:'ORD123456789',provider_payment_id:'PAY123456789',
  pix_br_code:'old-bank-code',payment_url:'https://www.mercadopago.com.br/old',
  coupon_face_cents:500,coupons_per_pack:3};
 let lookups=0;
 const ctx=vm.createContext({operation:'invoice-status',body:{invoiceId:id},user:{id:actor},origin:'https://admin.tamao.com.br',
  UUID_RE:/^[0-9a-f-]{36}$/i,Number,String,Boolean,Date,
  enforceApiQuota:async()=>{},couponRecoverPaidFromProvider:async(_admin,row)=>row,
  couponOwnerSponsorSpendable:async()=>false,couponVerifiedReplay:()=>assert.fail('pending refund cannot restore a Pix'),
  couponOfficialPixTicket:()=>assert.fail('completed refund cannot expose a bank link'),
  admin:{from:table=>{lookups++;const filters={};return {select(){return this},eq(k,v){filters[k]=v;return this},
   maybeSingle:async()=>({error:null,data:filters.customer_user_id!==owner?null:
    table==='clube_coupon_paid_invoices'?invoice:refundStatus?{status:refundStatus}:null})}}},
  respond:(data,status)=>({data,status})});
 vm.runInContext(['couponInvoiceCanPresent','couponInvoiceNetCovered','couponNetReconciliationRecorded','publicInvoice'].map(take).join('\n')+
  ';this.call=async()=>{'+route+'};',ctx);
 const response=await ctx.call();return {...response,lookups};
}
const done=await server('refunded','refunded');
assert.equal(done.status,200);assert.equal(done.data.ok,true);
assert.equal(done.data.status,'refunded');assert.equal(done.data.refundStatus,'refunded');
assert.equal(done.data.pixPayable,false);assert.equal(done.data.pixCode,null);assert.equal(done.data.paymentUrl,null);
assert.equal(done.data.issuedCoupons,0);assert.equal(done.data.sponsorFundedSpendable,false);
for(const [status,protocol] of [['awaiting_payment','requested'],['paid','requested'],['paid','refunded'],['refunded','requested']]){
 const result=await server(status,protocol);assert.equal(result.status,409);
 assert.equal(result.data.pixPayable,false);assert.equal(result.data.error,'COUPON_REFUND_REQUESTED');
}
const stranger=await server('refunded','refunded','another-owner');
assert.equal(stranger.status,404);assert.equal(stranger.lookups,1);
assert.doesNotMatch(route,/method:"POST"|\.insert\(|\.update\(|clube_coupon_paid_payment_refund/);

let active=owner,refreshes=0,response=async()=>done.data;const calls=[];
const ctx=vm.createContext({liveRuntime:{session:{user:{id:owner}}},liveReady:()=>true,
 liveInvoke:async(name,body)=>{assert.equal(name,'coupon-credit-pix');calls.push(body);return response()},
 clubePaidCouponView:{userId:owner,status:'ready',purchases:[{invoiceId:id,status:'paid',refundStatus:'refunded',amountCents:890}]},
 clubePaidCouponsRefresh:async()=>{refreshes++;ctx.clubePaidCouponView.purchases[0].status='refunded'},
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 esc:s=>String(s).replaceAll('<','&lt;'),toast:()=>{},render:()=>{},route:()=> 'club',
 window:{confirm:()=>assert.fail('checking a refund cannot authorize money movement')},
 document:{getElementById:()=>null},setTimeout:()=>1,clearTimeout:()=>{},
 Date,Number,String,Object,Array,Set,Promise,URL});
ctx.globalThis=ctx;
vm.runInContext(shop+';this.flow={state:clubeCouponShopState,view:clubeCouponPurchasesPanel,check:clubeCouponCheckInvoice};',ctx);
Object.assign(ctx.flow.state,{userId:owner,busy:false,status:'ready'});
let html=ctx.flow.view();
assert.match(html,/clubeCouponCheckInvoice/);assert.doesNotMatch(html,/clubeCouponRefundAsk|Solicitar cancelamento/);
assert.match(html,/atualize a compra original/);
await ctx.flow.check(id);
assert.deepEqual(calls.map(x=>x.action),['invoice-status']);assert.equal(refreshes,1);
html=ctx.flow.view();assert.match(html,/Compra estornada/);assert.match(html,/Reembolso confirmado pelo provedor/);
assert.doesNotMatch(html,/Conferir reembolso|clubeCouponRefundAsk|Aguardando pagamento/);
let resolve;
response=()=>new Promise(r=>resolve=r);
const pending=ctx.flow.check(id);
active='owner-two';ctx.liveRuntime.session.user.id=active;
Object.assign(ctx.flow.state,{userId:active,busy:true,purchase:null});
resolve(done.data);await pending;
assert.equal(ctx.flow.state.busy,true,'late read from another account cannot unlock its in-flight operation');
assert.equal(ctx.flow.state.purchase,null);assert.equal(refreshes,1);
assert.equal(ctx.flow.view(),'','old purchase history must not cross accounts');
console.log('PASS: completed refund is readable without Pix/credit, pending refund stays blocked, buyer refresh is read-only and account switch preserves the new lock.');
