import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {selectIndependentAdsPayment} from '../supabase/functions/_shared/ads-independent-payment-search.mjs';
import {adsPixProof} from '../supabase/functions/_shared/ads-native-pix.mjs';
import {recordAdsCreditPayment} from '../supabase/functions/_shared/ads-credit-payment.mjs';
import {readJsonBody} from '../supabase/functions/_shared/domain.js';

// Run the actual request handler, replacing only external I/O. A separate
// PostgreSQL fixture exercises the real functions/transactions.
const src=readFileSync(new URL('../supabase/functions/ads-credit/index.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(src.replace(/^import [^\n]+;$/gm,''));
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const topupId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',paymentId='123456789012',seller='12345678';
const reference='tamao-ads-credit-'+requestId.replaceAll('-','');
const empty={paging:{total:0,offset:0},results:[]};
const match={paging:{total:1,offset:0},results:[{id:paymentId,external_reference:reference}]};
const basePayment={id:paymentId,external_reference:reference,collector_id:seller,live_mode:true,
 payment_method_id:'pix',transaction_amount:19.90,currency_id:'BRL',status:'approved',status_detail:'accredited'};
const factName='ads_credit_apply_payment_v1_1101';
function fixture({initial='reserved',listing=empty,payment=basePayment,attached=null}={}){
 let handler;
 const trace=[],facts=[],row={id:topupId,request_id:requestId,owner_user_id:owner,amount_cents:1990,
  external_reference:reference,status:initial,provider_payment_id:attached,created_at:new Date().toISOString()};
 const admin={
  auth:{getUser:async()=>({data:{user:{id:owner,email_confirmed_at:'verified',email:'test@example.invalid'}}})},
  from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{...row}})}},
  async rpc(name,args){
   trace.push(name);
   let payload={};
   if(name==='ads_credit_topup_reserve_v1_1097')payload={topupId,externalReference:reference};
   else if(name==='ads_credit_topup_claim_v1_1097'){assert.equal(row.status,'reserved');row.status='creating';payload={canCreate:true};}
   else if(name==='ads_credit_close_unissued_v1_1101')payload={status:row.status};
   else if(name===factName){
    facts.push(args);row.provider_payment_id=args.p_payment;
    row.status=args.p_status==='approved'?'approved':args.p_status==='cancelled'?'unpaid':row.status;
    payload={status:row.status,recorded:true};
   }else if(name==='ads_credit_topup_attach_v1_1097'){
    row.status='pix_pending';row.provider_payment_id=args.p_payment;row.pix_code=args.p_code;row.pix_expires_at=args.p_expires;
    payload={status:row.status,pixCode:row.pix_code,expiresAt:row.pix_expires_at};
   }else assert.fail('Unexpected RPC '+name);
   return {data:{source:name,...payload}};
  }
 };
 const provider=async(path,options)=>{
  trace.push([options.method||'GET',path]);
  if(path.includes('/search?'))return listing instanceof Error?Response.json({}, {status:503}):Response.json(listing);
  if(options.method==='POST'){
   assert.equal(options.idempotencyKey,'tamao-credit-'+requestId);
   assert.equal(options.body.external_reference,reference);return Response.json({id:paymentId});
  }
  assert.equal(path,'/v1/payments/'+paymentId);return Response.json(payment);
 };
 const context={URL,Date,Request,Response,crypto,TextEncoder,console:{error(){}},
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.invalid':k.includes('KEYS')?'{"default":"test"}':undefined},
   serve:fn=>{handler=fn}},
  createClient:()=>admin,readJsonBody,enforceApiQuota:async()=>{},adsPixProof,recordAdsCreditPayment,
  selectIndependentAdsPayment,readMercadoPagoJson:r=>r.json(),mercadoPagoFetch:provider,
  independentAdsCredentialConfig:()=>({checkoutConfigured:true,webhookConfigured:true,tokenConfigured:true,
   sellerConfigured:true,signedWebhookConfigured:true}),
  verifyIndependentAdsSeller:async()=>({token:'fixture',sellerId:seller})
 };
 vm.runInNewContext(js,context);
 async function send(action='topup'){
  const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{
   origin:'https://tamao.com.br',authorization:'Bearer fixture','content-type':'application/json'},
   body:JSON.stringify({action,topupId,requestId,amountCents:1990,acceptCreditTerms:true})}));
  return {status:response.status,body:await response.json()};
 }
 return {row,trace,facts,send};
}
const posts=f=>f.trace.filter(x=>Array.isArray(x)&&x[0]==='POST').length;
assert.deepEqual(selectIndependentAdsPayment(empty,reference),{kind:'review'});
assert.deepEqual(selectIndependentAdsPayment(empty,reference,'credit'),{kind:'none'});
assert.deepEqual(selectIndependentAdsPayment(match,reference,'credit'),{kind:'single',paymentId});
const fresh=fixture();
assert.equal((await fresh.send()).body.status,'approved');
assert.equal(fresh.facts.length,1);assert.equal(posts(fresh),1);
assert.equal((await fresh.send()).body.status,'approved');assert.equal(posts(fresh),1);
const transient=fixture({listing:Error('Search unavailable')});
assert.equal((await transient.send()).status,503);assert.equal(transient.row.status,'reserved');
assert.equal(posts(transient),0);
for(const listing of [{...match,paging:{total:2,offset:0}},
 {...match,results:[{id:paymentId,external_reference:reference.replace('credit','ind')}]}]){
 const f=fixture({listing});assert.equal((await f.send()).status,409);
 assert.equal(posts(f),0);assert.equal(f.row.status,'reserved');
}
const cancelled=fixture({initial:'creating',listing:match,payment:{...basePayment,status:'cancelled',status_detail:'expired'}});
assert.equal((await cancelled.send('reconcile')).body.status,'unpaid');assert.equal(posts(cancelled),0);
assert.equal(cancelled.facts[0].p_payment,paymentId);
const recovering=fixture({initial:'creating',listing:match});
assert.equal((await recovering.send()).body.status,'approved');assert.equal(posts(recovering),0);
const unknown=fixture({initial:'creating'});
assert.equal((await unknown.send('reconcile')).body.status,'creating');assert.equal(posts(unknown),0);
const expired=fixture({initial:'pix_pending',attached:paymentId,
 payment:{...basePayment,status:'pending',date_of_expiration:new Date(Date.now()-10000).toISOString()}});
const expiredReply=await expired.send('reconcile');
assert.equal(expiredReply.body.status,'pix_pending');assert.equal(expiredReply.body.pixCode,undefined);
assert.equal(posts(expired),0);
for(const change of [{collector_id:'999999'},{live_mode:false},{transaction_amount:49.9},
 {payment_method_id:'card'},{external_reference:'other'},{id:'654321012345'},{transaction_amount_refunded:20}]){
 const f=fixture({initial:'creating',listing:match,payment:{...basePayment,...change}});
 assert.equal((await f.send('reconcile')).status,503);
 assert.equal(f.facts.length,0);assert.equal(posts(f),0);
}
const amounts=[],keys=[];
const args={paymentId,reference,sellerId:seller,amount:1990};
const fake={rpc:async(name,p)=>{assert.equal(name,factName);amounts.push(p.p_refunded_cents);
 keys.push(p.p_event_key);return {data:{source:name}};}};
for(const value of [5,5,10])await recordAdsCreditPayment(fake,{...basePayment,
 status_detail:'partially_refunded',transaction_amount_refunded:value},args);
assert.deepEqual(amounts,[500,500,1000]);assert.equal(keys[0],keys[1]);assert.notEqual(keys[1],keys[2]);
// A valid test BR Code lets the actual Edge and QR proof run through issuance and reuse.
const fields='00020126310014br.gov.bcb.pix0109TESTE-PIX520400005303986540519.905802BR5905TESTE6005TESTE6304';
let crc=65535;
for(const byte of Buffer.from(fields)){crc^=byte<<8;for(let i=0;i<8;i++)crc=(crc&32768)?((crc<<1)^4129)&65535:(crc<<1)&65535;}
const code=fields+crc.toString(16).padStart(4,'0').toUpperCase();
const pending=fixture({payment:{...basePayment,status:'pending',date_of_expiration:new Date(Date.now()+3600000).toISOString(),
 point_of_interaction:{transaction_data:{qr_code:code}}}});
assert.equal((await pending.send()).body.pixCode,code);
assert.equal((await pending.send()).body.pixCode,code);assert.equal(posts(pending),1);
console.log('PASS V1.1101 actual Ads Pix handler: initial search, QR reuse, recovery after loss, terminal proof before QR, exact amount/seller/namespace, cumulative refund and no duplicate POST.');
