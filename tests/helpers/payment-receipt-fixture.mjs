import assert from 'node:assert/strict';
import {PAYMENT_SOURCES} from '../../supabase/functions/payment-reconcile/runner.js';
const id='11000000-0000-4000-8000-000000000001',owner='22000000-0000-4000-8000-000000000002';
const payment='payment-proof-1234',order='order-proof-1234',now=new Date().toISOString();
export function receiptFixture(kind,resource=id,actor=owner){
 const id=resource,owner=actor;
 const row={id,campaign_id:id,merchant_id:owner,customer_user_id:owner,driver_id:owner,owner_user_id:owner,
  order_id:id,provider:'mercadopago',amount_cents:890,sale_price_cents:890,coupon_face_cents:500,coupons_per_pack:3,
  external_reference:id,provider_order_id:order,provider_payment_id:payment,payment_id:payment,
  paid_at:now,approved_at:now,status:PAYMENT_SOURCES[kind].paid[0],currency:'BRL',duration_days:7,
  provider_evidence_hash:'a'.repeat(64),invoice_kind:'prepaid_credit',plan_key:'essential',plan_fee_bps:600,grant_cents:890};
 const tables={
  [PAYMENT_SOURCES[kind].table]:[row],
  clube_coupon_paid_issuances:[1,2,3].map(ordinal=>({id:id+ordinal,invoice_id:id,ordinal,
   customer_user_id:owner,face_cents:500,status:'issued'})),
  mobility_fee_pix_evidence_v1_837:[{invoice_id:id,event_state:'paid',provider_order_id:order,
   provider_payment_id:payment,amount_cents:890,evidence_hash:'a'.repeat(64)}],
  mobility_fee_prepaid_lots_v1_838:[{invoice_id:id,driver_id:owner,plan_key:'essential',fee_bps:600,
   funded_cents:890,reserved_cents:100,spent_cents:90,status:'active'}],
  mobility_fee_pix_invoice_lines_v1_837:[{invoice_id:id,request_id:id,fee_cents:890}],
  mobility_platform_fee_accruals_v1_835:[{request_id:id,driver_id:owner,fee_cents:890}],
  ads_independent_campaigns_v1_884:[{id,owner_user_id:owner,budget_cents:890,duration_days:7,status:'active'}],
  ads_independent_payment_events_v1_886:[{campaign_id:id,payment_id:payment,provider_status:'approved'}],
  merchant_sale_payment_verifications:[{payment_attempt_id:id,order_id:id,merchant_id:owner,
   provider:'mercadopago',verification_level:'provider',evidence_type:'provider_api',
   provider_transaction_id:payment,amount_cents:890,currency:'BRL',status:'verified',funds_owner:'merchant'}]
 };
 // Advertiser campaign_id is also the checkout table's primary key.
 if(kind==='advertising')tables.ads_independent_checkouts_v1_886=[row];
 const queries=[];let unavailable='';
 const admin={from(table){
  const filters=[];let limit=Infinity;
  const result=()=>{
   queries.push({table,filters:[...filters]});
   if(table===unavailable)return {data:null,error:{message:'database unavailable'},count:null};
   assert(Object.hasOwn(tables,table),'unexpected table '+table);
   const rows=tables[table].filter(r=>filters.every(([key,values])=>values.includes(r[key])));
   return {data:rows.slice(0,limit),count:rows.length,error:null};
  };
  return {select(){return this},eq(key,value){filters.push([key,[value]]);return this},
   in(key,values){filters.push([key,values]);return this},limit(value){limit=value;return this},
   async maybeSingle(){const r=result();return {...r,data:r.data?.[0]??null}},
   then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};
 }};
 const deps={admin,platformToken:'APP_USR-'+('x'.repeat(32)),moneyToCents:v=>Math.round(Number(v)*100),
  merchantToken:async()=> 'APP_USR-'+('x'.repeat(32)),adsCredentials:async()=>({token:'owned',sellerId:'seller'}),
  routes:Object.fromEntries(['verifySeller','handlePaidCouponOrder','handleMobilityFeeOrder',
   'handleMerchantSaleOrder','reconcileProviderPayment'].map(name=>[name,async()=>
    new Response(JSON.stringify({ok:true,paymentApproved:true}),{status:200})]))};
 return {row,tables,admin,deps,queries,job:{kind,resource_id:id},unavailable:t=>unavailable=t};
}
