// Server-owned queue only. Reuses the same provider-verified business handlers
// as the webhooks; no new charge, refund, credit or coupon engine lives here.
import {readPaymentEntitlement} from '../_shared/payment-entitlement.js';
import {selectIndependentAdsPayment} from '../_shared/ads-independent-payment-search.mjs';
export const PAYMENT_SOURCES=Object.freeze({
 billing:{table:'merchant_billing_provider_charges',id:'id',amount:'amount_cents',reference:'correlation_id',order:'provider_charge_id',paid:['completed']},
 coupon:{table:'clube_coupon_paid_invoices',id:'id',amount:'sale_price_cents',reference:'id',order:'provider_order_id',paid:['paid']},
 mobility:{table:'mobility_fee_pix_invoices_v1_837',id:'id',amount:'amount_cents',reference:'external_reference',order:'provider_order_id',paid:['paid']},
 merchant_sale:{table:'merchant_sale_payment_attempts',id:'id',amount:'amount_cents',reference:'external_reference',order:'provider_order_id',paid:['approved']},
 advertising:{table:'ads_independent_checkouts_v1_886',id:'campaign_id',amount:'amount_cents',reference:'external_reference',paid:['payment_approved']},
 ads_credit:{table:'ads_credit_topups_v1_1097',id:'id',amount:'amount_cents',reference:'external_reference',paid:['approved']}
});
const safeId=value=>/^[A-Za-z0-9_-]{6,240}$/.test(String(value||''));
const reason=value=>String(value||'PROVIDER_RECHECK_REQUIRED').replace(/[^A-Za-z0-9_]/g,'_').slice(0,100);

export function uniqueProviderOrder(list,reference,amount,moneyToCents){
 const rows=list?.data,total=Number(list?.paging?.total);
 if(!Array.isArray(rows)||!Number.isSafeInteger(total)||total<0||total>10||rows.length!==total||
   list.paging.offset!=null&&Number(list.paging.offset)!==0||
   list.paging.total_pages!=null&&Number(list.paging.total_pages)>1)
  throw Error('PROVIDER_ORDER_SEARCH_INCOMPLETE');
 const matching=rows.filter(o=>o?.external_reference===reference);
 if(matching.length>1)throw Error('MULTIPLE_PROVIDER_ORDERS_REVIEW');
 if(!matching.length)return null;
 const order=matching[0];
 if(!safeId(order.id)||order.live_mode===false||
    moneyToCents(order.total_amount)!==amount||
    order.currency&&order.currency!=='BRL'||order.currency_id&&order.currency_id!=='BRL')
  throw Error('PROVIDER_ORDER_SEARCH_BINDING_FAILED');
 return String(order.id);
}

// Same server-side provider/ledger settlement used by the Ads credit webhook.
// Never create a new Pix or infer successful credit from provider ACK alone.
async function reconcileOriginalAdsCredit(row,read,deps){
 const {admin,providerGet,routes}=deps;
 if(row.status==='reserved')
  return {outcome:'pending',reason:'ADS_CREDIT_NOT_ISSUED',businessStatus:row.status};
 const reference=String(row.external_reference||'');
 if(!/^tamao-ads-credit-[0-9a-f]{32}$/.test(reference))
  return {outcome:'review',reason:'ADS_CREDIT_REFERENCE_INVALID',businessStatus:row.status};
 const {token,sellerId}=await deps.adsCredentials();
 if(!/^APP_USR-\S{20,}$/.test(token||'')||!/^[0-9]{4,20}$/.test(String(sellerId||'')))
  throw Error('ADS_CREDIT_PROVIDER_NOT_CONFIGURED');
 let paymentId=String(row.provider_payment_id||'');
 if(!paymentId){
  const query=new URLSearchParams({external_reference:reference,limit:'2',offset:'0'});
  const listing=await providerGet('/v1/payments/search?'+query,token);
  const selection=selectIndependentAdsPayment(listing,reference,'credit');
  if(selection.kind==='review')
   return {outcome:'review',reason:'ADS_CREDIT_PROVIDER_SEARCH_AMBIGUOUS',businessStatus:row.status};
  if(selection.kind==='none')
   return {outcome:'pending',reason:'ADS_CREDIT_PAYMENT_NOT_FOUND',businessStatus:row.status};
  paymentId=selection.paymentId;
 }
 if(!/^\d{5,30}$/.test(paymentId))
  return {outcome:'review',reason:'ADS_CREDIT_PROVIDER_ID_INVALID',businessStatus:row.status};
 const payment=await providerGet('/v1/payments/'+encodeURIComponent(paymentId),token);
 // The common recordAdsCreditPayment helper checks fresh LIVE PSP status,
 // fixed seller, exact reference, amount and currency before a locked RPC.
 if(typeof routes.recordAdsCreditPayment!=='function')
  throw Error('ADS_CREDIT_HANDLER_UNAVAILABLE');
 const fact=await routes.recordAdsCreditPayment(admin,payment,{
  paymentId,reference,amount:row.amount_cents,sellerId:String(sellerId)
 });
 if(fact?.source!=='ads_credit_payment_fact_v1_1097')
  throw Error('ADS_CREDIT_PROVIDER_FACT_UNVERIFIED');
 row=await read();
 const status=String(payment?.status||'');
 if(status==='in_mediation'||row.status==='review_required')
  return {outcome:'review',reason:'ADS_CREDIT_PAYMENT_REVIEW',businessStatus:row.status};
 if(status==='approved'&&row.status==='approved'){
  const entitlement=await readPaymentEntitlement('ads_credit',admin,row);
  if(entitlement.reviewRequired)
   return {outcome:'review',reason:'ADS_CREDIT_LEDGER_INCONSISTENT',businessStatus:row.status};
  if(!entitlement.entitlementApplied)
   return {outcome:'pending',reason:'ADS_CREDIT_NOT_CREDITED',businessStatus:row.status};
  return {outcome:'verified',reason:'PROVIDER_AND_LEDGER_CONFIRMED',businessStatus:row.status};
 }
 if(['refunded','charged_back','cancelled','rejected'].includes(status)&&
    ['reversed','unpaid'].includes(row.status))
  return {outcome:'closed',reason:'PROVIDER_STATE_RECORDED',businessStatus:row.status};
 return {outcome:'pending',reason:'AWAITING_PROVIDER_OR_LEDGER',businessStatus:row.status};
}

export async function reconcilePaymentJob(job,deps){
 const {admin,routes,providerGet,moneyToCents}=deps;
 const spec=Object.hasOwn(PAYMENT_SOURCES,String(job?.kind))?PAYMENT_SOURCES[job.kind]:null;
 if(!spec||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(job?.resource_id||'')))
  throw Error('INVALID_SERVER_QUEUE_ITEM');
 const read=async()=>{
  const r=await admin.from(spec.table).select('*').eq(spec.id,job.resource_id).maybeSingle();
  if(r.error)throw Error('LOCAL_PAYMENT_LOOKUP_FAILED');
  if(!r.data)throw Error('LOCAL_PAYMENT_RECORD_MISSING');
  return r.data;
 };
 let row=await read();
 const amount=Number(row[spec.amount]),reference=String(row[spec.reference]||'');
 if(!Number.isSafeInteger(amount)||amount<1||!reference||reference.length>160)
  throw Error('LOCAL_PAYMENT_BINDING_INVALID');
 if(job.kind==='ads_credit')return reconcileOriginalAdsCredit(row,read,deps);
 const provider=job.kind==='advertising'?'mercadopago':String(row.provider||'mercadopago');
 if(provider!=='mercadopago')return {outcome:'review',reason:'PROVIDER_ADAPTER_REQUIRED',businessStatus:row.status};
 let response;
 if(job.kind==='advertising'){
  const {token,sellerId}=await deps.adsCredentials();
  await routes.verifySeller(token,sellerId);
  if(row.pix_stage&&row.pix_stage!=='idle'&&!['payment_approved','payment_reversed'].includes(row.status)){
   await routes.recoverAdsPix(row,token,sellerId);
  }else  if(row.status==='reserved'){
   const recovered=await routes.recoverReservedPreference(admin,token,sellerId,
    row.campaign_id,reference,amount,row.expires_at,null);
   if(!recovered.ok){
    const error=reason((await recovered.json()).error);
    return {outcome:['ADS_CHECKOUT_EXPIRED','ADS_PREFERENCE_REVIEW_REQUIRED'].includes(error)?'review':'retry',reason:error,businessStatus:row.status};
   }
  }
  response=await routes.reconcileProviderPayment(admin,row.owner_user_id,row.campaign_id,token,sellerId,null);
 }else{
  const token=job.kind==='merchant_sale'?await deps.merchantToken(row.merchant_id):deps.platformToken;
  if(!/^APP_USR-\S{20,}$/.test(token||''))throw Error('PAYMENT_PROVIDER_NOT_CONFIGURED');
  let orderId=String(row[spec.order]||'');
  if(!orderId){
   const created=Date.parse(row.created_at);
   if(!Number.isFinite(created))throw Error('LOCAL_PAYMENT_DATE_INVALID');
   const query=new URLSearchParams({external_reference:reference,
    begin_date:new Date(created-300000).toISOString(),
    end_date:new Date(Math.min(Date.now(),created+86400000)).toISOString(),page:'1',page_size:'10'});
   orderId=uniqueProviderOrder(await providerGet('/v1/orders?'+query,token),reference,amount,moneyToCents)||'';
   if(!orderId)return {outcome:'pending',reason:'PROVIDER_ORDER_NOT_FOUND_YET',businessStatus:row.status};
  }
  if(!safeId(orderId))throw Error('PROVIDER_ORDER_ID_INVALID');
  if(job.kind==='merchant_sale'&&deps.restoreSalePix)await deps.restoreSalePix(row,orderId,token);
  if(job.kind==='billing'||job.kind==='coupon'&&!row.provider_order_id)
   response=await routes.handlePlatformBillingOrder(admin,orderId,{},token);
  else if(job.kind==='coupon')response=await routes.handlePaidCouponOrder(admin,orderId,row,token);
  else if(job.kind==='mobility')response=await routes.handleMobilityFeeOrder(admin,orderId,row);
  else response=await routes.handleMerchantSaleOrder(admin,row,orderId,{},deps.encryptionKey);
 }
 const result=await response.json();
 if(!response.ok)return {outcome:response.status>=500?'retry':'review',reason:reason(result.error),businessStatus:row.status};
 // HTTP 200 is not proof of the grant. Read the persisted business record
 // after the original transaction; never infer credit from provider ACK alone.
 row=await read();
 if(row.status==='review_required'||result.reviewRequired===true)
  return {outcome:'review',reason:'PAYMENT_REQUIRES_REVIEW',businessStatus:row.status};
 if(result.pending===true||result.paymentApproved===false||
   ['pending','pending_provider_confirmation'].includes(result.status))
  return {outcome:'pending',reason:'AWAITING_PROVIDER_OR_LEDGER',businessStatus:row.status};
 if(spec.paid.includes(row.status)||job.kind==='coupon'&&row.status==='refunded'){
  const entitlement=await readPaymentEntitlement(job.kind,admin,row);
  const prefix=job.kind==='billing'?'BILLING':'PAYMENT';
  if(entitlement.reviewRequired)return {outcome:'review',reason:prefix+'_ENTITLEMENT_REVIEW_REQUIRED',businessStatus:row.status};
  if(!entitlement.entitlementApplied)return {outcome:'pending',reason:prefix+'_ENTITLEMENT_NOT_APPLIED',businessStatus:row.status};
 }
 if(spec.paid.includes(row.status))return {outcome:'verified',reason:'PROVIDER_AND_LEDGER_CONFIRMED',businessStatus:row.status};
 if(['refunded','payment_reversed','cancelled','expired','rejected'].includes(row.status))
  return {outcome:'closed',reason:'PROVIDER_STATE_RECORDED',businessStatus:row.status};
 return {outcome:'pending',reason:'AWAITING_PROVIDER_OR_LEDGER',businessStatus:row.status};
}
