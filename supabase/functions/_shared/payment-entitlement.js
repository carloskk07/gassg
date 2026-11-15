// Read-only receipt/entitlement checks. The existing settlement handlers are
// the only writers; a paid status alone cannot certify their side effects.
import {readBillingEntitlement} from './merchant-billing-entitlement.js';
const cents=n=>Number.isSafeInteger(Number(n))&&Number(n)>0;
const sameCents=(a,b)=>cents(a)&&cents(b)&&Number(a)===Number(b);
const present=v=>typeof v==='string'&&v.length>0;
const dated=v=>present(v)&&Number.isFinite(Date.parse(v));
const verdict=ok=>({entitlementApplied:ok,reviewRequired:!ok});
async function one(admin,table,columns,filters){
 let q=admin.from(table).select(columns);
 for(const [key,value] of filters)q=q.eq(key,value);
 const r=await q.maybeSingle();
 if(r.error)throw Error('PAYMENT_ENTITLEMENT_READ_UNAVAILABLE');
 return r.data;
}
async function many(admin,table,columns,filters,limit,inFilter=null){
 let q=admin.from(table).select(columns,{count:'exact'});
 for(const [key,value] of filters)q=q.eq(key,value);
 if(inFilter)q=q.in(inFilter[0],inFilter[1]);
 const r=await q.limit(limit);
 if(r.error)throw Error('PAYMENT_ENTITLEMENT_READ_UNAVAILABLE');
 // A truncated response cannot prove a complete grant or invoice allocation.
 return Array.isArray(r.data)&&Number.isSafeInteger(r.count)&&r.count===r.data.length
  ?r.data:null;
}
export async function readPaymentEntitlement(kind,admin,row){
 if(kind==='billing')return readBillingEntitlement(admin,row);
 if(kind==='coupon'){
  const count=Number(row.coupons_per_pack);
  if(!dated(row.paid_at)||!present(row.provider_order_id)||!present(row.provider_payment_id)||
    !present(row.customer_user_id)||!Number.isSafeInteger(count)||count<1||count>15||
    !cents(row.coupon_face_cents))return verdict(false);
  const grants=await many(admin,'clube_coupon_paid_issuances',
   'id,invoice_id,ordinal,customer_user_id,face_cents,status',[['invoice_id',row.id]],16);
  return verdict(!!grants&&grants.length===count&&
   new Set(grants.map(g=>g.id)).size===count&&
   new Set(grants.map(g=>g.ordinal)).size===count&&
   grants.every(g=>g.invoice_id===row.id&&g.customer_user_id===row.customer_user_id&&
    Number.isInteger(g.ordinal)&&g.ordinal>=1&&g.ordinal<=count&&
    sameCents(g.face_cents,row.coupon_face_cents)&&
    (row.status==='refunded'?g.status==='void':['issued','reserved','redeemed'].includes(g.status))));
 }
 if(kind==='mobility'){
  if(!dated(row.paid_at)||!present(row.driver_id)||!present(row.provider_order_id)||
    !present(row.provider_payment_id)||!cents(row.amount_cents)||
    !/^[0-9a-f]{64}$/.test(String(row.provider_evidence_hash||'')))return verdict(false);
  const proof=await one(admin,'mobility_fee_pix_evidence_v1_837',
   'invoice_id,event_state,provider_order_id,provider_payment_id,amount_cents,evidence_hash',
   [['invoice_id',row.id],['event_state','paid']]);
  if(!proof||proof.invoice_id!==row.id||proof.event_state!=='paid'||
    proof.provider_order_id!==row.provider_order_id||proof.provider_payment_id!==row.provider_payment_id||
    !sameCents(proof.amount_cents,row.amount_cents)||proof.evidence_hash!==row.provider_evidence_hash)
   return verdict(false);
  if(row.invoice_kind==='prepaid_credit'){
   const lot=await one(admin,'mobility_fee_prepaid_lots_v1_838',
    'invoice_id,driver_id,plan_key,fee_bps,funded_cents,reserved_cents,spent_cents,status',
    [['invoice_id',row.id]]);
   return verdict(!!lot&&lot.invoice_id===row.id&&lot.driver_id===row.driver_id&&
    lot.plan_key===row.plan_key&&[500,550,600].includes(Number(lot.fee_bps))&&
    Number(lot.fee_bps)===Number(row.plan_fee_bps)&&sameCents(lot.funded_cents,row.amount_cents)&&
    sameCents(row.grant_cents,row.amount_cents)&&lot.status==='active'&&
    [lot.reserved_cents,lot.spent_cents].every(n=>Number.isSafeInteger(Number(n))&&Number(n)>=0)&&
    Number(lot.reserved_cents)+Number(lot.spent_cents)<=Number(lot.funded_cents));
  }
  if(row.invoice_kind!=='fee')return verdict(false);
  const lines=await many(admin,'mobility_fee_pix_invoice_lines_v1_837',
   'request_id,invoice_id,fee_cents',[['invoice_id',row.id]],501);
  if(!lines?.length||lines.length>500||lines.some(l=>l.invoice_id!==row.id||!cents(l.fee_cents))||
    new Set(lines.map(l=>l.request_id)).size!==lines.length||
    lines.reduce((n,l)=>n+Number(l.fee_cents),0)!==Number(row.amount_cents))return verdict(false);
  // Keep each REST URL below proxy limits even for a legitimate large batch.
  const accruals=[];
  for(let start=0;start<lines.length;start+=100){
   const page=await many(admin,'mobility_platform_fee_accruals_v1_835',
    'request_id,driver_id,fee_cents',[['driver_id',row.driver_id]],101,
    ['request_id',lines.slice(start,start+100).map(l=>l.request_id)]);
   if(!page)return verdict(false);
   accruals.push(...page);
  }
  return verdict(accruals.length===lines.length&&lines.every(l=>
   accruals.some(a=>a.request_id===l.request_id&&a.driver_id===row.driver_id&&sameCents(a.fee_cents,l.fee_cents))));
 }
 if(kind==='advertising'){
  if(!dated(row.approved_at)||!present(row.payment_id)||!present(row.owner_user_id))return verdict(false);
  const campaign=await one(admin,'ads_independent_campaigns_v1_884',
   'id,owner_user_id,budget_cents,duration_days',[['id',row.campaign_id]]);
  if(!campaign||campaign.owner_user_id!==row.owner_user_id||
    !sameCents(campaign.budget_cents,row.amount_cents)||campaign.duration_days!==row.duration_days)
   return verdict(false);
  const events=await many(admin,'ads_independent_payment_events_v1_886',
   'campaign_id,payment_id,provider_status',
   [['campaign_id',row.campaign_id],['payment_id',row.payment_id]],201);
  return verdict(!!events&&events.every(e=>e.campaign_id===row.campaign_id&&e.payment_id===row.payment_id)&&
   events.some(e=>e.provider_status==='approved')&&
   !events.some(e=>['refunded','charged_back','cancelled','rejected'].includes(e.provider_status)));
 }
 if(kind==='merchant_sale'){
  if(!dated(row.approved_at)||!present(row.provider_payment_id))return verdict(false);
  const records=await many(admin,'merchant_sale_payment_verifications',
   'payment_attempt_id,order_id,merchant_id,provider,verification_level,evidence_type,provider_transaction_id,amount_cents,currency,status,funds_owner',
   [['payment_attempt_id',row.id],['verification_level','provider'],['status','verified']],2);
  const proof=records?.length===1?records[0]:null;
  return verdict(!!proof&&proof.payment_attempt_id===row.id&&proof.order_id===row.order_id&&
   proof.merchant_id===row.merchant_id&&proof.provider===row.provider&&
   proof.provider_transaction_id===row.provider_payment_id&&sameCents(proof.amount_cents,row.amount_cents)&&
   proof.currency==='BRL'&&row.currency==='BRL'&&proof.funds_owner==='merchant'&&
   proof.verification_level==='provider'&&['provider_api','provider_webhook'].includes(proof.evidence_type)&&proof.status==='verified');
 }
 throw Error('INVALID_PAYMENT_ENTITLEMENT_KIND');
}
