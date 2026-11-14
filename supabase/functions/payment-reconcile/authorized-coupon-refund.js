import {couponProviderRefundEvidence} from '../admin-ops/coupon-refund-provider-evidence.js';

// Single delegated maintenance operation, explicitly authorized by the owner
// in the 14/11/2026 conversation ("autorizo"). This is NOT an authenticated
// customer action. No human actor/session is invented. The private cron
// credential is checked by index.ts BEFORE entering this operation.
// No caller can supply an invoice, owner, amount, payment or idempotency key.
export const AUTHORIZED_COUPON_REFUND=Object.freeze({
 invoiceId:'9af683aa-1064-4999-8809-0c92e565a1b5',
 customerId:'251d8e1a-eda7-4362-9d67-181fb9fe6501',
 orderId:'ORD01M730R9E7NNNCWHWFG8JG4AYJ',
 paymentId:'PAY01M730R9EF8XZM1B02SXVGPDWB',
 requestId:'36da5f30-c211-4940-a97e-f554b51a3ff9',
 amountCents:890,couponCount:3,faceCents:500,
 expiresAt:'2026-11-15T01:00:00Z'
});
const fail=code=>{throw Error(code)};

export async function authorizedCouponRefund(deps){
 const s=AUTHORIZED_COUPON_REFUND;
 const {admin,moneyToCents,providerGet,providerRefund}=deps;
 const now=()=>typeof deps.now==='function'?deps.now():Date.now();
 const invoiceResult=await admin.from('clube_coupon_paid_invoices')
  .select('id,customer_user_id,status,sale_price_cents,provider_order_id,provider_payment_id,coupons_per_pack')
  .eq('id',s.invoiceId).eq('customer_user_id',s.customerId).maybeSingle();
 const inv=invoiceResult.data;
 if(invoiceResult.error||!inv||inv.id!==s.invoiceId||
    inv.customer_user_id!==s.customerId||inv.sale_price_cents!==s.amountCents||
    inv.coupons_per_pack!==s.couponCount||inv.provider_order_id!==s.orderId||
    inv.provider_payment_id!==s.paymentId||!['paid','refunded'].includes(inv.status))
  fail('COUPON_DELEGATION_BINDING_INVALID');
 const endpoint='/v1/orders/'+encodeURIComponent(s.orderId);
 const order=await providerGet(endpoint);
 const initial=couponProviderRefundEvidence(order,inv,moneyToCents);
 if(!initial.orderBound)fail('COUPON_DELEGATION_PROVIDER_BINDING_INVALID');
 let attempted=false,mayPost=false;
 const previous=await admin.from('clube_coupon_refund_requests_v1_814')
  .select('status,request_id,customer_user_id').eq('invoice_id',s.invoiceId).maybeSingle();
 if(previous.error||(previous.data&&(previous.data.request_id!==s.requestId||
    previous.data.customer_user_id!==s.customerId||
    !['requested','refunded'].includes(previous.data.status))))
  fail('COUPON_DELEGATION_REQUEST_INVALID');
 if(inv.status==='refunded'&&!previous.data)
  fail('COUPON_DELEGATION_REQUEST_INVALID');
 if(!initial.providerRefundVerified&&inv.status==='paid'){
  const payments=order.transactions?.payments;
  if(order.status!=='processed'||payments?.[0]?.status!=='processed'||
     (Array.isArray(order.transactions?.refunds)&&order.transactions.refunds.length>0))
   fail('COUPON_DELEGATION_PROVIDER_REVIEW_REQUIRED');
  // Expiry limits money movement, not subsequent independent GET recovery.
  if(!previous.data&&(!Number.isFinite(now())||now()>=Date.parse(s.expiresAt)))
   fail('COUPON_DELEGATION_EXPIRED');
 }
 if(inv.status==='paid'){
  const request=await admin.rpc('clube_coupon_refund_request_v1_814',{
   p_customer:s.customerId,p_invoice:s.invoiceId,p_request:s.requestId,p_reason:'outro'
  });
  const r=request.data;
  if(request.error||r?.ok!==true||r.invoiceId!==s.invoiceId||
     r.requestId!==s.requestId||r.status!=='requested'||typeof r.replayed!=='boolean')
   fail('COUPON_DELEGATION_REQUEST_INVALID');
  mayPost=r.replayed===false&&!initial.providerRefundVerified;
 }
 // Read exposure AFTER the canonical request freezes reservation/order use
 // under the original invoice lock. Reading it before the freeze races use.
 const vouchers=await admin.from('clube_coupon_paid_issuances')
  .select('status,face_cents',{count:'exact'}).eq('invoice_id',s.invoiceId).limit(4);
 const uses=await admin.from('clube_coupon_paid_order_applications')
  .select('voucher_id',{count:'exact',head:true}).eq('invoice_id',s.invoiceId);
 if(vouchers.error||uses.error||uses.count!==0||
    vouchers.count!==s.couponCount||!Array.isArray(vouchers.data)||
    vouchers.data.length!==s.couponCount||vouchers.data.some(v=>
     v.face_cents!==s.faceCents||!['issued','void'].includes(v.status)))
  fail('COUPON_DELEGATION_EXPOSURE_INVALID');
  // The canonical request is also the persistent one-shot claim. Only its
  // creator may POST. Replays (including a lost POST response) use GET only.
  // The same request UUID is additionally the provider idempotency key.
  if(mayPost&&Number.isFinite(now())&&now()<Date.parse(s.expiresAt)){
   attempted=true;
   try{await providerRefund(endpoint+'/refund',s.requestId)}
   catch{/* A POST acknowledgement/exception never proves the return. */}
  }
 const fresh=await providerGet(endpoint);
 const evidence=couponProviderRefundEvidence(fresh,inv,moneyToCents);
 if(!evidence.orderBound)fail('COUPON_DELEGATION_PROVIDER_BINDING_INVALID');
 if(!evidence.providerRefundVerified)return {ok:true,
  source:'explicit_owner_delegation',amountCents:s.amountCents,
  refundConfirmed:false,providerPostAttempted:attempted,status:'pending_provider_proof'};
 const finalized=await admin.rpc('clube_coupon_paid_payment_refund',{
  p_invoice_id:s.invoiceId,p_provider_order_id:s.orderId
 });
 if(finalized.error||finalized.data?.ok!==true||finalized.data?.refunded!==true)
  fail('COUPON_DELEGATION_LOCAL_RECONCILIATION_PENDING');
 const saved=await admin.from('clube_coupon_paid_invoices').select('status')
  .eq('id',s.invoiceId).maybeSingle();
 const cancelled=await admin.from('clube_coupon_paid_issuances')
  .select('status',{count:'exact'}).eq('invoice_id',s.invoiceId).limit(4);
 const request=await admin.from('clube_coupon_refund_requests_v1_814')
  .select('status,request_id').eq('invoice_id',s.invoiceId).maybeSingle();
 if(saved.error||saved.data?.status!=='refunded'||cancelled.error||
    cancelled.count!==s.couponCount||cancelled.data?.length!==s.couponCount||
    cancelled.data.some(v=>v.status!=='void')||request.error||
    request.data?.status!=='refunded'||request.data?.request_id!==s.requestId)
  fail('COUPON_DELEGATION_LOCAL_RECONCILIATION_PENDING');
 return {ok:true,source:'explicit_owner_delegation',amountCents:s.amountCents,
  refundConfirmed:true,providerRefundVerified:true,providerPostAttempted:attempted,
  cancelledCoupons:s.couponCount,status:'refunded'};
}
