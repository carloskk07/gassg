import assert from 'node:assert/strict';
import {prepareAdsPix,recoverAdsPix,adsPixProof} from '../supabase/functions/_shared/ads-native-pix.mjs';
import {verifiedOrderPix} from '../supabase/functions/_shared/order-pix-proof.mjs';
import {pixFixture} from './helpers/pix-fixture.mjs';
const owner='10000000-0000-4000-8000-000000000001',campaign='20000000-0000-4000-8000-000000000002';
const reference='tamao-ads-ind-'+campaign.replaceAll('-',''),seller='123456789';
function fixture({legacy=true,existing=false,lost=false,close=true,badIdentity=false,approved=false}={}){
 const calls=[],row={owner_user_id:owner,campaign_id:campaign,request_id:campaign,amount_cents:1990,
  duration_days:7,external_reference:reference,status:legacy?'checkout_ready':'reserved',
  preference_id:legacy?'123456789-original':null,pix_stage:'idle'};
 const payment=()=>({id:12345678901,collector_id:Number(seller),external_reference:reference,
  transaction_amount:19.9,currency_id:'BRL',live_mode:true,payment_method_id:'pix',
  status:approved?'approved':'pending',status_detail:approved?'accredited':'pending_waiting_transfer',
  date_of_expiration:new Date(Date.now()+86400000).toISOString(),
  point_of_interaction:{transaction_data:{qr_code:pixFixture()}}});
 let actual=existing?payment():null;
 const pref={id:row.preference_id,collector_id:badIdentity?987654321:Number(seller),external_reference:reference,
  items:[{id:'tamao-ads-independent-'+campaign,currency_id:'BRL',quantity:1,unit_price:19.9}],
  expires:true,expiration_date_to:new Date(Date.now()+3*86400000).toISOString()};
 const deps={webhookUrl:'https://project.invalid/ads-webhook',admin:{rpc:async(name,args)=>{
  calls.push({name,args});
  assert.equal(args.p_owner,owner);assert.equal(args.p_campaign,campaign);
  if(name==='ads_pix_begin'){
   if(row.pix_stage==='idle'){row.pix_stage='closing';row.pix_started_at=new Date().toISOString();}
   return {data:{source:name,checkout:{...row}},error:null};
  }
  if(name==='ads_pix_claim'){
   const create=row.pix_stage==='closing';
   if(create){row.pix_stage='creating';row.payment_channel='pix';row.status='checkout_ready';}
   return {data:{source:name,canCreate:create,checkout:{...row}},error:null};
  }
  assert.equal(name,'ads_pix_attach');assert.equal(args.p_code,pixFixture());
  assert.equal(args.p_amount,1990);row.pix_stage='ready';
  return {data:{source:name,status:'checkout_ready',pixPayable:true},error:null};
 }},provider:async(path,token,options={})=>{
  assert.equal(token,'server-token');const method=options.method||'GET';calls.push({path,method,options});
  if(path.startsWith('/v1/payments/search?'))return {paging:{total:actual?1:0,offset:0},results:actual?[actual]:[]};
  if(path.startsWith('/checkout/preferences/')){
   if(method==='PUT'&&close){pref.expiration_date_to=options.body.expiration_date_to;pref.expires=true;}
   return {...pref};
  }
  if(path==='/v1/payments'){
   if(legacy)assert(Date.parse(pref.expiration_date_to)<Date.now(),'retire legacy before creating instrument');
   assert.equal(method,'POST');assert.equal(options.body.transaction_amount,19.9);
   assert.equal(options.body.external_reference,reference);assert.equal(options.body.payment_method_id,'pix');
   assert.equal(options.body.payer.email,'owner@example.invalid');
   assert.equal(options.idempotencyKey,'tamao-ads-pix-'+campaign);
   actual=payment();if(lost){lost=false;throw new TypeError('lost response')}
   return {id:actual.id};
  }
  assert.equal(path,'/v1/payments/12345678901');return {...actual};
 },reconcile:async()=>({source:'ads_independent_reconcile_v1_886',status:'payment_approved',paymentApproved:true})};
 const prepare=()=>prepareAdsPix(deps,{ownerId:owner,campaignId:campaign,token:'server-token',sellerId:seller,payerEmail:'owner@example.invalid'});
 return {deps,row,calls,prepare,payment};
}
for(const legacy of [true,false]){
 const f=fixture({legacy});const [a,b]=await Promise.all([f.prepare(),f.prepare()]);
 assert(a.pixPayable&&b.pixPayable);assert.equal(a.pixCode,pixFixture());assert.equal(a.checkoutUrl,null);
 assert.equal(f.calls.filter(x=>x.path==='/v1/payments'&&x.method==='POST').length,1);
 await f.prepare();assert.equal(f.calls.filter(x=>x.path==='/v1/payments'&&x.method==='POST').length,1);
}
{
 const f=fixture({lost:true});await assert.rejects(f.prepare(),/lost response/);
 assert.equal((await f.prepare()).pixCode,pixFixture());
 assert.equal(f.calls.filter(x=>x.method==='POST').length,1,'recover a lost create response with GET only');
}
for(const bad of [{close:false},{badIdentity:true}]){
 const f=fixture(bad);await assert.rejects(f.prepare(),/ADS_PIX_LEGACY_/);
 assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
}
{
 const f=fixture({existing:true});assert.equal((await f.prepare()).pixCode,pixFixture());
 assert.equal(f.calls.filter(x=>x.method==='PUT'||x.method==='POST').length,0);
 const before=f.calls.length;await recoverAdsPix(f.deps,f.row,'server-token',seller);
 assert(f.calls.slice(before).every(x=>!x.method||x.method==='GET'));
}
{
 const f=fixture({existing:true,approved:true});assert.equal((await f.prepare()).paymentApproved,true);
 assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
}
{
 const f=fixture();const payment=f.payment();
 assert.equal(adsPixProof(payment,f.row,seller).code,pixFixture());
 for(const change of [{collector_id:987654321},{transaction_amount:9.9},{currency_id:'USD'},
  {live_mode:false},{external_reference:'foreign'},{payment_method_id:'card'},
  {date_of_expiration:new Date(Date.now()-1).toISOString()},
  {point_of_interaction:{transaction_data:{qr_code:pixFixture(4990)}}}])
  assert.throws(()=>adsPixProof({...payment,...change},f.row,seller),/PROOF_INVALID/);
}
{
 const createdAt=new Date().toISOString(),order={id:'ORD-native-123',user_id:seller,external_reference:'order-reference',
  total_amount:'19.90',status:'action_required',created_date:createdAt,
  transactions:{payments:[{id:'PAY-native-123',amount:'19.90',status:'action_required',created_date:createdAt,
   payment_method:{id:'pix',type:'bank_transfer',qr_code:pixFixture()}}]}};
 const options={reference:'order-reference',sellerId:seller,amountCents:1990,createdAt};
 assert.equal(verifiedOrderPix(order,options).pixCode,pixFixture());
 assert.equal(verifiedOrderPix({...order,user_id:'foreign'},options),null);
 assert.equal(verifiedOrderPix({...order,total_amount:'49.90'},options),null);
 assert.equal(verifiedOrderPix({...order,status:'processed'},options),null);
 assert.equal(verifiedOrderPix(order,{...options,createdAt:new Date(Date.now()-2*86400000).toISOString()}),null);
}
console.log('PASS: single native Pix, exact bank payload, legacy retirement, existing payment recovery, lost response, wrong seller/amount and canonical Orders Pix.');
