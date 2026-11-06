// TAMÃO #867 — pure verifier of a live Mercado Pago Orders API refund.
// NEVER initiates a refund, persists evidence, or authorizes case closure.
export function couponProviderRefundEvidence(order,invoice,toCents){
  const unknown={orderBound:false,providerRefundVerified:false,
    refundAmountCents:null,refundTransactionCount:0,
    reason:"PROVIDER_ORDER_BINDING_UNVERIFIED"};
  if(!order||!invoice||typeof toCents!=="function"||
     !Number.isSafeInteger(invoice.sale_price_cents)||
     invoice.sale_price_cents<=0||
     !String(invoice.id||"")||!String(invoice.provider_order_id||"")||
     !String(invoice.provider_payment_id||"")||
     order.live_mode===false||order.test===true||
     String(order.id||"")!==String(invoice.provider_order_id)||
     String(order.external_reference||"")!==String(invoice.id)||
     (order.currency_id!=null&&String(order.currency_id)!=="BRL")||
     (order.country_code!=null&&String(order.country_code)!=="BRA")||
     toCents(order.total_amount)!==invoice.sale_price_cents)
    return unknown;
  const payments=order.transactions?.payments;
  if(!Array.isArray(payments)||payments.length!==1)return unknown;
  const payment=payments[0];
  if(!payment||payment.live_mode===false||payment.test===true||
     String(payment.id||"")!==String(invoice.provider_payment_id)||
     payment.payment_method?.id!=="pix"||
     payment.payment_method?.type!=="bank_transfer"||
     toCents(payment.amount)!==invoice.sale_price_cents)
    return unknown;
  const refunds=order.transactions?.refunds;
  const initial={orderBound:true,providerRefundVerified:false,
    refundAmountCents:null,refundTransactionCount:0,
    reason:"PROVIDER_REFUND_NOT_VERIFIED"};
  if(!Array.isArray(refunds)||refunds.length===0)return initial;
  if(refunds.length>15)return {...initial,reason:"PROVIDER_REFUND_HISTORY_INCOMPLETE"};
  const seen=new Set();
  let total=0;
  for(const r of refunds){
    const id=String(r?.id??"");
    const amount=toCents(r?.amount);
    if(id.length<3||seen.has(id)||
       String(r?.transaction_id??"")!==String(invoice.provider_payment_id)||
       !["processed","approved","refunded"].includes(String(r?.status??"").toLowerCase())||
       !Number.isSafeInteger(amount)||amount<=0||
       !Number.isSafeInteger(total+amount)||total+amount>invoice.sale_price_cents)
       return {...initial,reason:"PROVIDER_REFUND_TRANSACTION_UNVERIFIED"};
    seen.add(id);total+=amount;
  }
  if(total!==invoice.sale_price_cents||
     String(order.status||"").toLowerCase()!=="refunded"||
     String(order.status_detail||"").toLowerCase()!=="refunded")
    return {...initial,reason:"PROVIDER_FULL_REFUND_NOT_CONFIRMED"};
  return {orderBound:true,providerRefundVerified:true,
    refundAmountCents:total,refundTransactionCount:seen.size,
    reason:"PROVIDER_FULL_REFUND_CONFIRMED"};
}
