import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHmac} from 'node:crypto';
import {independentAdsCredentialConfig as config,verifyIndependentAdsSeller as verify,
 independentAdsProviderReadiness as readiness} from '../supabase/functions/_shared/ads-platform-credentials.mjs';
import {verifyMercadoPagoWebhook,moneyToCents} from '../supabase/functions/_shared/mercadopago.js';

const TOKEN='APP_USR-'+('p'.repeat(32)),SECRET='platform-webhook-secret-example';
const platform={MERCADOPAGO_ACCESS_TOKEN:TOKEN,MERCADOPAGO_WEBHOOK_SECRET:SECRET};
const env=values=>name=>values[name];
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
let requests=[];
const provider=async(url,options)=>{
 requests.push({url,options});
 assert.equal(url,'https://api.mercadolibre.com/users/me');
 assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
 assert.equal(options.method??'GET','GET');
 return response({id:123456789,tags:['normal']});
};
const resolved=await verify(config(env(platform)),{fetchImpl:provider});
assert.deepEqual(resolved,{token:TOKEN,sellerId:'123456789',credentialMode:'platform'});
assert.equal(requests.length,1);
const ready=await readiness(env(platform),{fetchImpl:provider});
assert.equal(ready.readyForFinancialHomologation,true);
assert.equal(ready.credentialMode,'platform');
assert(!JSON.stringify(ready).includes(TOKEN));assert(!JSON.stringify(ready).includes(SECRET));
assert(!JSON.stringify(ready).includes('123456789'),'readiness does not expose account identity');

for(const key of ['ADS_MP_CHECKOUT_ENABLED','ADS_MP_WEBHOOK_ENABLED']){
 for(const value of ['false','invalid']){
  const r=await readiness(env({...platform,[key]:value}),{fetchImpl:provider});
  assert.equal(r.readyForFinancialHomologation,false,'explicit disable/unknown value wins');
 }
}
for(const key of ['ADS_MP_ACCESS_TOKEN','ADS_MP_SELLER_ID','ADS_MP_WEBHOOK_SECRET']){
 const partial=config(env({...platform,[key]:key==='ADS_MP_SELLER_ID'?'123456789':'incomplete'}));
 assert.equal(partial.mode,'dedicated');
 assert.notEqual(partial.token,TOKEN,'partial dedicated credentials never use platform token');
 assert.equal((await readiness(env({...platform,[key]:'incomplete'}),{fetchImpl:provider}))
  .readyForFinancialHomologation,false);
}
const dedicated={...platform,ADS_MP_ACCESS_TOKEN:TOKEN,ADS_MP_SELLER_ID:'123456789',
 ADS_MP_WEBHOOK_SECRET:'dedicated-secret-example',ADS_MP_CHECKOUT_ENABLED:'true',ADS_MP_WEBHOOK_ENABLED:'true'};
assert.equal((await readiness(env(dedicated),{fetchImpl:provider})).readyForFinancialHomologation,true);
await assert.rejects(verify(config(env({...dedicated,ADS_MP_SELLER_ID:'987654321'})),{fetchImpl:provider}),/MISMATCH/);
for(const body of [{id:12},{id:123456789,tags:['test_user']},null])
 await assert.rejects(verify(config(env(platform)),{fetchImpl:async()=>response(body)}));
for(const fetchImpl of [async()=>response({},401),async()=>new Response('not json'),
 async()=>new Response('x'.repeat(20001)),async()=>{throw Error('network failed')}]){
 const r=await readiness(env(platform),{fetchImpl});assert.equal(r.sellerVerified,false);
 assert.equal(r.readyForFinancialHomologation,false);
}
const paused=config(env({...platform,ADS_MP_CHECKOUT_ENABLED:'false',ADS_MP_WEBHOOK_ENABLED:'false'}));
assert.equal((await verify(paused,{fetchImpl:provider})).sellerId,'123456789',
 'receipt reconciliation and refund identity checks remain possible while sales are paused');
assert.equal((await readiness(env({MERCADOPAGO_ACCESS_TOKEN:TOKEN}),{fetchImpl:provider}))
 .readyForFinancialHomologation,false,'missing signature secret blocks new checkout');

// Execute the actual signed webhook, not a parallel implementation of it.
const source=read('supabase/functions/ads-payment-webhook-mercadopago/index.ts')
 .replace(/^import[\s\S]*?;\n/gm,'').replace(/:(?:unknown|string|Request|any)\b/g,'');
async function webhookFixture(values=platform){
 const gets=[],writes=[];let handler;
 const payment={id:12345678901,collector_id:123456789,transaction_amount:19.9,currency_id:'BRL',
  external_reference:'tamao-ads-ind-'+('a'.repeat(32)),status:'approved',status_detail:'accredited',live_mode:true};
 const context=vm.createContext({URL,Response,TextEncoder,crypto,Date,JSON,Number,String,Array,
  Deno:{env:{get:env({...values,SUPABASE_URL:'https://project.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-key'})},
   serve:fn=>handler=fn},
  independentAdsCredentialConfig:config,
  verifyIndependentAdsSeller:c=>verify(c,{fetchImpl:async()=>{gets.push('seller');return response({id:123456789})}}),
  verifyMercadoPagoWebhook,moneyToCents,
  mercadoPagoFetch:async(path,options)=>{gets.push(path);assert.equal(options.accessToken,TOKEN);return response(payment)},
  readMercadoPagoJson:r=>r.json(),
  createClient:()=>({rpc:async(name,args)=>{
   writes.push({name,args});return {data:{source:'ads_independent_payment_fact_v1_886',recorded:true,
    autoPublished:false,netSettlementVerified:false,paymentApproved:true},error:null};
  }})});
 vm.runInContext(source,context);
 const request=(valid=true)=>{
  const ts=String(Math.floor(Date.now()/1000)),requestId='actual-signed-fixture';
  const signature=createHmac('sha256',values.MERCADOPAGO_WEBHOOK_SECRET??SECRET)
   .update('id:12345678901;request-id:'+requestId+';ts:'+ts+';').digest('hex');
  return new Request('https://project.invalid/functions/v1/ads-payment-webhook-mercadopago?data.id=12345678901',{
   method:'POST',headers:{'content-type':'application/json','x-request-id':requestId,
    'x-signature':'ts='+ts+',v1='+(valid?signature:'0'.repeat(64))},
   body:JSON.stringify({type:'payment',action:'payment.updated',data:{id:'12345678901'}})});
 };
 return {handler,request,gets,writes,payment};
}
{
 const f=await webhookFixture();assert.equal((await f.handler(f.request(false))).status,401);
 assert.equal(f.gets.length,0,'unauthenticated webhook must not query provider');assert.equal(f.writes.length,0);
 assert.equal((await f.handler(f.request())).status,200);assert.equal(f.writes.length,1);
 assert.deepEqual(f.gets,['seller','/v1/payments/12345678901']);
 assert.equal(f.writes[0].name,'ads_independent_payment_fact_v1_886');
 assert.equal(f.writes[0].args.p_collector_id,'123456789');assert.equal(f.writes[0].args.p_amount_cents,1990);
}
{
 const f=await webhookFixture();f.payment.collector_id=987654321;
 assert.equal((await f.handler(f.request())).status,403);assert.equal(f.writes.length,0);
}
{
 const f=await webhookFixture();f.payment.live_mode=false;
 assert.equal((await f.handler(f.request())).status,403);assert.equal(f.writes.length,0);
}
{
 const f=await webhookFixture();f.payment.external_reference='tamao-ads-'+('a'.repeat(32))+'-v1';
 const r=await f.handler(f.request());assert.equal(r.status,200);
 assert.equal((await r.json()).reason,'legacy_ads_disabled');assert.equal(f.writes.length,0);
}
{
 const f=await webhookFixture({...platform,ADS_MP_WEBHOOK_ENABLED:'false'});
 assert.equal((await f.handler(f.request())).status,503);assert.equal(f.gets.length,0);
}
const checkout=read('supabase/functions/ads-independent-checkout/index.ts');
assert(checkout.indexOf('await creds()')<checkout.indexOf('admin.rpc("ads_independent_checkout_reserve'));
const worker=read('supabase/functions/payment-reconcile/index.ts');
assert(worker.indexOf('auth.data!==true')<worker.indexOf("get('inspect')"));
assert(worker.indexOf("get('inspect')")<worker.indexOf("admin.rpc('platform_payment_reconciliation_claim'"));
assert.match(worker,/adsCredentials:async\(\)=>\{\s*return await verifyIndependentAdsSeller/);
console.log('PASS: existing platform account, dedicated account isolation, explicit disables, provider identity failures, signed real webhook and private read-only inspection.');
