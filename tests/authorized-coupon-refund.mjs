import assert from 'node:assert/strict';
import fs from 'node:fs';
import {authorizedCouponRefund,AUTHORIZED_COUPON_REFUND as s}
 from '../supabase/functions/payment-reconcile/authorized-coupon-refund.js';

const money=x=>Math.round(Number(x)*100);
function fixture(){
 const calls=[],invoice={id:s.invoiceId,customer_user_id:s.customerId,status:'paid',
  sale_price_cents:s.amountCents,coupons_per_pack:3,
  provider_order_id:s.orderId,provider_payment_id:s.paymentId};
 const state={invoice,vouchers:Array.from({length:3},()=>({status:'issued',face_cents:500})),
  count:3,uses:0,request:null,post:'complete',readback:true,now:Date.parse('2026-11-14T23:30:00Z')};
 state.order={id:s.orderId,external_reference:s.invoiceId,total_amount:'8.90',
  live_mode:true,currency_id:'BRL',country_code:'BRA',status:'processed',status_detail:'accredited',
  transactions:{payments:[{id:s.paymentId,amount:'8.90',status:'processed',
   payment_method:{id:'pix',type:'bank_transfer'}}],refunds:[]}};
 const complete=()=>{
  state.order.status='refunded';state.order.status_detail='refunded';
  state.order.transactions.refunds=[{id:'REF_AUTHORIZED',transaction_id:s.paymentId,
   amount:'8.90',status:'processed'}];
 };
 const deps={moneyToCents:money,now:()=>state.now,
  admin:{from:table=>({select(){return this},eq(){return this},limit(){return this},
   result(){
    calls.push('read:'+table);
    if(table==='clube_coupon_paid_invoices')return {data:{...invoice},error:null};
    if(table==='clube_coupon_refund_requests_v1_814')return {data:state.request?{...state.request}:null,error:null};
    if(table==='clube_coupon_paid_issuances')return {data:structuredClone(state.vouchers),count:state.count,error:null};
    if(table==='clube_coupon_paid_order_applications')return {count:state.uses,error:null};
    throw Error('unexpected table '+table);
   },maybeSingle(){return Promise.resolve(this.result())},
   then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject)}
  }),rpc:async(name,args)=>{
   calls.push(name);
   if(name==='clube_coupon_refund_request_v1_814'){
    assert.deepEqual(args,{p_customer:s.customerId,p_invoice:s.invoiceId,p_request:s.requestId,p_reason:'outro'});
    const replayed=Boolean(state.request);
    state.request??={status:'requested',request_id:s.requestId,customer_user_id:s.customerId};
    state.onFreeze?.();
    return {data:{ok:true,invoiceId:s.invoiceId,requestId:state.request.request_id,
     status:state.request.status,replayed},error:null};
   }
   assert.equal(name,'clube_coupon_paid_payment_refund');
   assert.deepEqual(args,{p_invoice_id:s.invoiceId,p_provider_order_id:s.orderId});
   assert.equal(state.order.status,'refunded','only independently fetched proof may finalize');
   if(state.readback){invoice.status='refunded';state.vouchers.forEach(v=>v.status='void');state.request.status='refunded'}
   return {data:{ok:true,refunded:true},error:null};
  }},providerGet:async path=>{
   assert.equal(path,'/v1/orders/'+s.orderId);calls.push('GET');return structuredClone(state.order);
  },providerRefund:async(path,key)=>{
   assert.equal(path,'/v1/orders/'+s.orderId+'/refund');assert.equal(key,s.requestId);
   assert.equal(state.request?.status,'requested','original protocol must freeze use first');
   calls.push('POST');
   if(state.post==='complete'||state.post==='lost-complete')complete();
   if(state.post==='lost'||state.post==='lost-complete')throw Error('NETWORK_AMBIGUOUS');
   return new Response('{}',{status:201});
  }};
 return {state,calls,deps,complete};
}
{
 const f=fixture(),result=await authorizedCouponRefund(f.deps);
 assert.equal(result.refundConfirmed,true);assert.equal(result.amountCents,890);
 assert.equal(result.cancelledCoupons,3);assert.equal(f.calls.filter(x=>x==='POST').length,1);
 assert(f.calls.indexOf('clube_coupon_refund_request_v1_814')<f.calls.indexOf('read:clube_coupon_paid_issuances'));
 await authorizedCouponRefund(f.deps);
 assert.equal(f.calls.filter(x=>x==='POST').length,1,'successful replay performs GET only');
}
for(const change of [
 {customer_user_id:'other'},{sale_price_cents:1990},{provider_order_id:'other'},
 {provider_payment_id:'other'},{coupons_per_pack:4},{status:'review_required'}
]){
 const f=fixture();Object.assign(f.state.invoice,change);
 await assert.rejects(authorizedCouponRefund(f.deps),/BINDING_INVALID/);
 assert.equal(f.calls.includes('POST'),false);assert.equal(f.calls.includes('GET'),false);
}
for(const change of [
 f=>f.state.uses=1,f=>f.state.uses=null,f=>f.state.count=4,
 f=>f.state.vouchers.pop(),f=>f.state.vouchers[0].status='reserved',
 f=>f.state.vouchers[0].face_cents=600,
 f=>f.state.onFreeze=()=>f.state.vouchers[0].status='redeemed'
]){
 const f=fixture();change(f);
 await assert.rejects(authorizedCouponRefund(f.deps),/EXPOSURE_INVALID/);
 assert.equal(f.calls.includes('POST'),false,'no money movement with any lifetime exposure');
}
for(const change of [
 {id:'other'},{external_reference:'other'},{total_amount:'19.90'},{live_mode:false},
 {currency_id:'USD'},{test:true}
]){
 const f=fixture();Object.assign(f.state.order,change);
 await assert.rejects(authorizedCouponRefund(f.deps),/PROVIDER_BINDING_INVALID/);
 assert.equal(f.state.request,null);assert.equal(f.calls.includes('POST'),false);
}
{
 const f=fixture();f.state.now=Date.parse(s.expiresAt);
 await assert.rejects(authorizedCouponRefund(f.deps),/EXPIRED/);
 assert.equal(f.state.request,null);assert.equal(f.calls.includes('POST'),false);
}
{
 const f=fixture();f.state.post='lost-complete';
 assert.equal((await authorizedCouponRefund(f.deps)).refundConfirmed,true,
  'independent GET recovers a lost successful POST response');
}
for(const post of ['pending','lost']){
 const f=fixture();f.state.post=post;
 assert.equal((await authorizedCouponRefund(f.deps)).refundConfirmed,false);
 assert.equal(f.calls.includes('clube_coupon_paid_payment_refund'),false);
 f.state.now=Date.parse(s.expiresAt)+1000;
 assert.equal((await authorizedCouponRefund(f.deps)).refundConfirmed,false);
 assert.equal(f.calls.filter(x=>x==='POST').length,1,'ambiguous replay must never repeat POST');
 f.complete();assert.equal((await authorizedCouponRefund(f.deps)).refundConfirmed,true);
 assert.equal(f.calls.filter(x=>x==='POST').length,1);
}
{
 const f=fixture();f.state.request={request_id:'other',status:'requested',customer_user_id:s.customerId};
 await assert.rejects(authorizedCouponRefund(f.deps),/REQUEST_INVALID/);
 assert.equal(f.calls.includes('POST'),false);
}
{
 const f=fixture();f.state.readback=false;
 await assert.rejects(authorizedCouponRefund(f.deps),/LOCAL_RECONCILIATION_PENDING/);
}
const ingress=fs.readFileSync(new URL('../supabase/functions/payment-reconcile/index.ts',import.meta.url),'utf8');
assert(ingress.indexOf('if(auth.error||auth.data!==true)')<ingress.indexOf("get('refund')"));
assert.match(ingress,/X-Tamao-Payment-Cron-Token/);
assert.match(ingress,/authorizedCouponRefund\(\{admin,moneyToCents/);
console.log('PASS: exact authorized R$8.90 refund, canonical freeze, one POST, independent proof, expiry and readback');
