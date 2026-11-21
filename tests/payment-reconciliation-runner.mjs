import assert from 'node:assert/strict';
import {receiptFixture} from './helpers/payment-receipt-fixture.mjs';
import {PAYMENT_SOURCES,reconcilePaymentJob,uniqueProviderOrder} from '../supabase/functions/payment-reconcile/runner.js';
const ID='60000000-0000-4000-8000-000000000001';
const TOKEN='APP_USR-'+('x'.repeat(32));
const money=value=>Math.round(Number(value)*100);
const base={id:ID,campaign_id:ID,merchant_id:ID,owner_user_id:ID,payment_request_id:ID,
 provider:'mercadopago',amount_cents:890,sale_price_cents:890,
 external_reference:ID,correlation_id:ID,provider_order_id:'ORD123456789',
 provider_charge_id:'ORD123456789',status:'active',created_at:'2026-11-10T15:00:00Z'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status});
function fixture(kind){
 const readback=receiptFixture(kind,ID,ID);
 const row={...readback.row,...base},calls=[];let commit=true,response=200;
 readback.tables[PAYMENT_SOURCES[kind].table]=[row];
 readback.tables.mobility_fee_pix_evidence_v1_837[0].provider_order_id=row.provider_order_id;
 const business=async(name,...args)=>{
  calls.push({name,args});
  if(commit&&response===200){
   row.status=PAYMENT_SOURCES[kind].paid[0];
   row.provider_order_id||='ORD123456789';
  }
  return reply(response===200?{ok:true,paymentApproved:commit}:{error:'PROVIDER_UNAVAILABLE'},response);
 };
 const deps={
  admin:{from:table=>kind!=='billing'?readback.admin.from(table):({select(){return this},eq(){return this},limit(){return this},
   maybeSingle:async()=>{
    if(table===PAYMENT_SOURCES[kind].table)return {data:{...row},error:null};
    if(table==='merchant_billing_payment_requests')return {data:{id:ID,merchant_id:ID,
     request_kind:'package_purchase',plan_key:'credit_test',status:commit?'approved':'pending',
     expected_amount_cents:890,credit_grant_cents_snapshot:890,received_amount_cents:890,
     approval_source:'provider_event',provider_payment_event_id:ID,reconciliation_key:'verified-order'},error:null};
    if(table==='merchant_billing_payment_events')return {data:{id:ID,status:'applied',payment_request_id:ID,
     merchant_id:ID,amount_cents:890,reconciliation_key:'verified-order'},error:null};
    throw Error('unexpected table '+table);
   },then(resolve){assert.equal(table,'merchant_fee_credit_ledger');
    return Promise.resolve({data:[{merchant_id:ID,plan_key:'credit_test',amount_cents:890}],count:1,error:null}).then(resolve);
   }})},
  platformToken:TOKEN,encryptionKey:'private-test',moneyToCents:money,
  merchantToken:async id=>{assert.equal(id,ID);return TOKEN},
  adsCredentials:async()=>({token:TOKEN,sellerId:'123456'}),
  providerGet:async(path,token)=>{
   assert.equal(token,TOKEN);assert.match(path,/^\/v1\/orders\?/);
   const query=new URL('https://provider.invalid'+path).searchParams;
   assert.equal(query.get('page'),'1');assert.equal(query.get('page_size'),'10');
   assert.equal(query.has('limit'),false,'Orders uses page/page_size');
   assert(Date.parse(query.get('end_date'))-Date.parse(query.get('begin_date'))<=30*86400000);
   calls.push({name:'providerGet',path});
   return {paging:{total:1},data:[{id:'ORD123456789',external_reference:ID,total_amount:'8.90',live_mode:true,currency:'BRL'}]};
  },routes:{
   handlePlatformBillingOrder:(...a)=>business('billing',...a),
   handlePaidCouponOrder:(...a)=>business('coupon',...a),
   handleMobilityFeeOrder:(...a)=>business('mobility',...a),
   handleMerchantSaleOrder:(...a)=>business('merchant_sale',...a),
   verifySeller:async()=>{},
   recoverReservedPreference:async()=>reply({error:'ADS_CHECKOUT_EXPIRED'},409),
   reconcileProviderPayment:(...a)=>business('advertising',...a)
  }};
 return {row,calls,deps,job:{kind,resource_id:ID},noCommit:()=>commit=false,
  fail:()=>response=503};
}
for(const kind of Object.keys(PAYMENT_SOURCES).filter(k=>k!=='ads_credit')){
 const s=fixture(kind),result=await reconcilePaymentJob(s.job,s.deps);
 assert.equal(result.outcome,'verified',kind+' must read the actual stored business state');
 assert.equal(s.calls.filter(x=>x.name===kind).length,1,kind+' must use the existing handler');
 const failed=fixture(kind);failed.noCommit();
 assert.equal((await reconcilePaymentJob(failed.job,failed.deps)).outcome,'pending',
  'a provider/HTTP ACK cannot fabricate credit in '+kind);
 const retry=fixture(kind);retry.fail();
 assert.equal((await reconcilePaymentJob(retry.job,retry.deps)).outcome,'retry');
}
{
 const s=fixture('coupon');s.row.provider_order_id=null;s.row.status='prepared';
 assert.equal((await reconcilePaymentJob(s.job,s.deps)).outcome,'verified');
 assert.equal(s.calls[0].name,'providerGet');assert.equal(s.calls[1].name,'billing',
  'lost provider response must reuse the existing early coupon binding recovery');
}
{
 const s=fixture('mobility');s.row.provider_order_id=null;s.row.status='prepared';
 assert.equal((await reconcilePaymentJob(s.job,s.deps)).outcome,'verified');
 assert.equal(s.calls[1].name,'mobility');
}
{
 const s=fixture('billing');s.row.provider='unknown';
 assert.equal((await reconcilePaymentJob(s.job,s.deps)).outcome,'review');
 assert.equal(s.calls.length,0,'never guess credentials or credit for another provider');
}
{
 const s=fixture('advertising');s.row.status='reserved';
 assert.equal((await reconcilePaymentJob(s.job,s.deps)).outcome,'review');
 assert.equal(s.calls.length,0,'expired/unknown preference cannot create another checkout');
}
const order={id:'ORD123456789',external_reference:ID,total_amount:'8.90',currency:'BRL'};
{
 const s=fixture('billing');s.row.status='completed';
 s.deps.routes.handlePlatformBillingOrder=async()=>reply({pending:true,status:'processing'});
 assert.equal((await reconcilePaymentJob(s.job,s.deps)).outcome,'pending',
  'an earlier paid record cannot turn an incomplete current provider check into confirmation');
}
{
 const s=fixture('billing');s.noCommit();s.row.status='completed';
 s.deps.routes.handlePlatformBillingOrder=async()=>reply({ok:true});
 const result=await reconcilePaymentJob(s.job,s.deps);
 assert.equal(result.outcome,'pending');assert.equal(result.reason,'BILLING_ENTITLEMENT_NOT_APPLIED',
  'a provider receipt cannot close recovery while the real request and credit remain pending');
}
assert.equal(uniqueProviderOrder({data:[],paging:{total:0}},ID,890,money),null);
assert.equal(uniqueProviderOrder({data:[order],paging:{total:1}},ID,890,money),order.id);
for(const data of [
 {data:[order],paging:{total:2}},
 {data:[order],paging:{total:1,offset:10}},
 {data:[order],paging:{total:1,total_pages:2}},
 {data:[order,order],paging:{total:2}},
 {data:[{...order,total_amount:'99.00'}],paging:{total:1}},
 {data:[{...order,live_mode:false}],paging:{total:1}}
])assert.throws(()=>uniqueProviderOrder(data,ID,890,money));

const CREDIT_REF='tamao-ads-credit-'+('a'.repeat(32));
const CREDIT_PAY='189719364925';
function creditFixture({attached=true,search='single',committed=true,
  providerStatus='approved',terminal=false,missingLedger=false}={}){
 const row={id:ID,owner_user_id:ID,external_reference:CREDIT_REF,
  provider_payment_id:attached?CREDIT_PAY:null,amount_cents:1990,
  status:'pix_pending',reversed_cents:0,paid_at:null};
 const wallet={owner_user_id:ID,total_loaded_cents:0,frozen:false};
 let entries=[],calls=[],recorded=0;
 const docs={ads_credit_topups_v1_1097:()=>[row],
  ads_credit_wallets_v1_1097:()=>[wallet],
  ads_credit_ledger_v1_1097:()=>entries};
 const admin={from:table=>{
  const filters=[];
  const query={
   select(){return this},eq(k,v){filters.push([k,v]);return this},
   limit(){return this},
   maybeSingle:async()=>{const all=(docs[table]?.()||[]).filter(x=>
     filters.every(([k,v])=>x[k]===v));return {data:all[0]||null,error:null}},
   then(resolve,reject){const all=(docs[table]?.()||[]).filter(x=>
     filters.every(([k,v])=>x[k]===v));return Promise.resolve({
      data:all,count:all.length,error:null}).then(resolve,reject)}
  };
  return query;
 }};
 const payment={id:CREDIT_PAY,external_reference:CREDIT_REF,collector_id:'123456',
  transaction_amount:19.90,currency_id:'BRL',status:providerStatus,
  payment_method_id:'pix',live_mode:true};
 const deps={admin,
  adsCredentials:async()=>({token:TOKEN,sellerId:'123456'}),
  providerGet:async(path,token)=>{
   assert.equal(token,TOKEN);calls.push(path);
   if(path.startsWith('/v1/payments/search?')){
    const u=new URL('https://provider.invalid'+path);
    assert.equal(u.searchParams.get('external_reference'),CREDIT_REF);
    assert.equal(u.searchParams.get('limit'),'2');
    assert.equal(u.searchParams.get('offset'),'0');
    if(search==='missing')return {paging:{offset:0,total:0},results:[]};
    if(search==='ambiguous')return {paging:{offset:0,total:2},results:[
      {id:CREDIT_PAY,external_reference:CREDIT_REF}]};
    return {paging:{offset:0,total:1},results:[
      {id:CREDIT_PAY,external_reference:CREDIT_REF}]};
   }
   assert.equal(path,'/v1/payments/'+CREDIT_PAY);
   return payment;
  },
  routes:{recordAdsCreditPayment:async(_admin,p,expected)=>{
   recorded++;
   assert.equal(p,payment);assert.equal(expected.paymentId,CREDIT_PAY);
   assert.equal(expected.reference,CREDIT_REF);
   assert.equal(expected.amount,1990);assert.equal(expected.sellerId,'123456');
   if(committed){
    row.provider_payment_id=CREDIT_PAY;
    if(providerStatus==='approved'){
     row.status='approved';row.paid_at='2026-11-20T23:26:43.999Z';
     wallet.total_loaded_cents=1990;
     entries=missingLedger?[]:[{id:1,topup_id:ID,owner_user_id:ID,operation:'topup',delta_cents:1990}];
    }else if(terminal){
     row.status='reversed';row.reversed_cents=1990;
    }
   }
   return {source:'ads_credit_payment_fact_v1_1097',status:row.status};
  }}};
 return {job:{kind:'ads_credit',resource_id:ID},row,deps,calls,
  get recorded(){return recorded},wallet,
  clearLedger:()=>{entries=[]}};
}
// V1.1104: worker fetches only an existing PSP payment and performs the
// same authoritative settlement handler used by the signed webhook.
{
 const s=creditFixture();
 const result=await reconcilePaymentJob(s.job,s.deps);
 assert.equal(result.outcome,'verified');
 assert.equal(s.calls.length,1,'attached credit uses only the original payment GET');
 assert.equal(s.calls[0],'/v1/payments/'+CREDIT_PAY);
 assert.equal(s.recorded,1);
}
{
 const s=creditFixture({attached:false});
 assert.equal((await reconcilePaymentJob(s.job,s.deps)).outcome,'verified');
 assert.equal(s.calls.length,2,'unknown provider ID uses exact reference search then GET');
}
{
 const s=creditFixture({attached:false,search:'ambiguous'});
 const r=await reconcilePaymentJob(s.job,s.deps);
 assert.equal(r.outcome,'review');
 assert.equal(s.recorded,0,'ambiguous provider search cannot write credit');
}
{
 const s=creditFixture({attached:false,search:'missing'});
 const r=await reconcilePaymentJob(s.job,s.deps);
 assert.equal(r.outcome,'pending');
 assert.equal(s.recorded,0,'an unavailable original payment cannot create another');
}
{
 const s=creditFixture({committed:false});
 assert.equal((await reconcilePaymentJob(s.job,s.deps)).outcome,'pending',
  'MP approved response without actual ledger credit must remain pending');
}
{
 const s=creditFixture({missingLedger:true});
 assert.equal((await reconcilePaymentJob(s.job,s.deps)).outcome,'review',
  'a database approval without immutable ledger grant is not verified');
}
{
 const s=creditFixture({providerStatus:'refunded',terminal:true});
 const r=await reconcilePaymentJob(s.job,s.deps);
 assert.equal(r.outcome,'closed');assert.equal(s.recorded,1);
}
{
 const s=creditFixture();s.row.status='reserved';s.row.provider_payment_id=null;
 const r=await reconcilePaymentJob(s.job,s.deps);
 assert.equal(r.outcome,'pending');assert.equal(s.calls.length,0);
 assert.equal(s.recorded,0,'view-only reserved intent must never create Pix');
}

await assert.rejects(reconcilePaymentJob({kind:'other',resource_id:ID},{}),/INVALID_SERVER_QUEUE_ITEM/);
console.log('PASS: existing five families plus credit regression, exact server binding, lost-response recovery, persisted credit readback and no new charges.');
