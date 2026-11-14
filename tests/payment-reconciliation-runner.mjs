import assert from 'node:assert/strict';
import {PAYMENT_SOURCES,reconcilePaymentJob,uniqueProviderOrder} from '../supabase/functions/payment-reconcile/runner.js';
const ID='60000000-0000-4000-8000-000000000001';
const TOKEN='APP_USR-'+('x'.repeat(32));
const money=value=>Math.round(Number(value)*100);
const base={id:ID,campaign_id:ID,merchant_id:ID,owner_user_id:ID,
 provider:'mercadopago',amount_cents:890,sale_price_cents:890,
 external_reference:ID,correlation_id:ID,provider_order_id:'ORD123456789',
 provider_charge_id:'ORD123456789',status:'active',created_at:'2026-11-10T15:00:00Z'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status});
function fixture(kind){
 const row={...base},calls=[];let commit=true,response=200;
 const business=async(name,...args)=>{
  calls.push({name,args});
  if(commit&&response===200)row.status=PAYMENT_SOURCES[kind].paid[0];
  return reply(response===200?{ok:true,paymentApproved:commit}:{error:'PROVIDER_UNAVAILABLE'},response);
 };
 const deps={
  admin:{from:table=>({select(){return this},eq(key,id){
   assert.equal(table,PAYMENT_SOURCES[kind].table);assert.equal(id,ID);return this;
  },maybeSingle:async()=>({data:{...row},error:null})})},
  platformToken:TOKEN,encryptionKey:'private-test',moneyToCents:money,
  merchantToken:async id=>{assert.equal(id,ID);return TOKEN},
  adsCredentials:async()=>({token:TOKEN,sellerId:'123456'}),
  providerGet:async(path,token)=>{
   assert.equal(token,TOKEN);assert.match(path,/^\/v1\/orders\?/);
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
for(const kind of Object.keys(PAYMENT_SOURCES)){
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
assert.equal(uniqueProviderOrder({data:[],paging:{total:0}},ID,890,money),null);
assert.equal(uniqueProviderOrder({data:[order],paging:{total:1}},ID,890,money),order.id);
for(const data of [
 {data:[order],paging:{total:2}},
 {data:[order,order],paging:{total:2}},
 {data:[{...order,total_amount:'99.00'}],paging:{total:1}},
 {data:[{...order,live_mode:false}],paging:{total:1}}
])assert.throws(()=>uniqueProviderOrder(data,ID,890,money));
await assert.rejects(reconcilePaymentJob({kind:'other',resource_id:ID},{}),/INVALID_SERVER_QUEUE_ITEM/);
console.log('PASS: all five payment families, exact server binding, lost-response recovery, persisted credit readback and no new charges.');
