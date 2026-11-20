import {moneyToCents} from './mercadopago.js';

// Both the signed webhook and owner reconciliation receive an authoritative
// provider GET. Never consume client-supplied payment facts.
export async function recordAdsCreditPayment(admin,payment,expected){
 const paymentId=String(payment?.id??''),reference=String(payment?.external_reference??'');
 const seller=String(payment?.collector_id??payment?.collector?.id??'');
 const amount=moneyToCents(payment?.transaction_amount);
 if(!/^\d{5,30}$/.test(paymentId)||paymentId!==expected.paymentId||
   !/^tamao-ads-credit-[0-9a-f]{32}$/.test(reference)||reference!==expected.reference||
   !/^\d{4,20}$/.test(seller)||seller!==expected.sellerId||
   amount===null||amount!==expected.amount||payment?.currency_id!=='BRL'||
   payment?.payment_method_id!=='pix'||payment?.live_mode!==true)
  throw Error('ADS_CREDIT_PROVIDER_PROOF_INVALID');
 const status=String(payment.status||''),detail=String(payment.status_detail||'');
 const reported=payment.transaction_amount_refunded;
 const zero=typeof reported==='number'?reported===0:typeof reported==='string'&&/^0(?:\.0{1,2})?$/.test(reported);
 const refunded=reported==null?null:zero?0:
  ['number','string'].includes(typeof reported)?moneyToCents(reported):null;
 if(detail.length>120||(reported!=null&&(refunded===null||refunded>amount)))
  throw Error('ADS_CREDIT_REFUND_PROOF_INVALID');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(
  JSON.stringify(['ads-credit',paymentId,status,detail,refunded])));
 const eventKey=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const {data,error}=await admin.rpc('ads_credit_apply_payment_v1_1101',{
  p_event_key:eventKey,p_reference:reference,p_payment:paymentId,p_collector:seller,
  p_amount:amount,p_status:status,p_status_detail:detail,p_live:true,p_refunded_cents:refunded
 });
 if(error)throw error;
 if(data?.source!=='ads_credit_apply_payment_v1_1101')throw Error('ADS_CREDIT_LEDGER_UNVERIFIED');
 return {...data,source:'ads_credit_payment_fact_v1_1097'};
}
