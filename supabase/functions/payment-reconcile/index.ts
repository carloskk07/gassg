import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {mercadoPagoFetch,readMercadoPagoJson,moneyToCents} from "../_shared/mercadopago.js";
import {sha256Hex} from "../_shared/domain.js";
import {independentAdsCredentialConfig,verifyIndependentAdsSeller,independentAdsProviderReadiness}
 from "../_shared/ads-platform-credentials.mjs";
import {decryptPaymentSecret,paymentEncryptionConfigured} from "../_shared/payment-secrets.js";
import {handlePlatformBillingOrder,handlePaidCouponOrder,handleMobilityFeeOrder,
 handleMerchantSaleOrder} from "../billing-payment-webhook-mercadopago/handlers.ts";
import {verifySeller,recoverReservedPreference,reconcileProviderPayment}
 from "../ads-independent-checkout/handlers.ts";
import {reconcilePaymentJob} from "./runner.js";

const URL_BASE=Deno.env.get('SUPABASE_URL')||'';
const SECRET=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,
 headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
 const token=req.headers.get('X-Tamao-Payment-Cron-Token')||'';
 if(!/^[0-9a-f]{64}$/.test(token)||!URL_BASE||!SECRET)return json({ok:false},403);
 const admin=createClient(URL_BASE,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
 const auth=await admin.rpc('platform_payment_reconciliation_authorize',{p_token_sha:await sha256Hex(token)});
 if(auth.error||auth.data!==true)return json({ok:false},403);
 try{
  // Private read-only deployment check; no queue claim, permit or charge.
  if(new URL(req.url).searchParams.get('inspect')==='advertising'){
   const readiness=await independentAdsProviderReadiness((key:string)=>Deno.env.get(key));
   let checkoutApiReachable=false;
   if(readiness.sellerVerified){
    const config=independentAdsCredentialConfig((key:string)=>Deno.env.get(key));
    const response=await mercadoPagoFetch('/checkout/preferences/search?limit=1',{
     accessToken:config.token,method:'GET',timeoutMs:8000});
    if(response.ok){
     const details=await readMercadoPagoJson(response);
     checkoutApiReachable=Array.isArray(details?.elements);
    }
   }
   return json({ok:true,source:'ads_platform_connection_readiness',readOnly:true,
    ...readiness,checkoutApiReachable,newChargesCreated:0});
  }
  const jobs=await admin.rpc('platform_payment_reconciliation_claim',{p_limit:8});
  if(jobs.error||!Array.isArray(jobs.data)||jobs.data.length>8)throw Error('QUEUE_UNAVAILABLE');
  const encryptionKey=String(Deno.env.get('MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY')||'').trim();
  const deps={admin,moneyToCents,encryptionKey,
   platformToken:String(Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')||'').trim(),
   // Sales may be paused while an already-created payment still needs receipt
   // reconciliation. Never enable checkout or create a preference here.
   adsCredentials:async()=>{
    return await verifyIndependentAdsSeller(independentAdsCredentialConfig((key:string)=>Deno.env.get(key)));
   },
   routes:{handlePlatformBillingOrder,handlePaidCouponOrder,handleMobilityFeeOrder,
    handleMerchantSaleOrder,verifySeller,recoverReservedPreference,reconcileProviderPayment},
   providerGet:async(path:string,accessToken:string)=>{
    const response=await mercadoPagoFetch(path,{accessToken,method:'GET',timeoutMs:8000});
    if(!response.ok)throw Error('PROVIDER_LOOKUP_FAILED');
    return readMercadoPagoJson(response);
   },
   merchantToken:async(merchantId:string)=>{
    if(!paymentEncryptionConfigured(encryptionKey))throw Error('MERCHANT_CREDENTIAL_UNAVAILABLE');
    const r=await admin.from('merchant_payment_provider_accounts')
     .select('status,access_token_ciphertext,access_token_nonce')
     .eq('merchant_id',merchantId).eq('provider','mercadopago').maybeSingle();
    if(r.error||r.data?.status!=='active')throw Error('MERCHANT_CREDENTIAL_UNAVAILABLE');
    return decryptPaymentSecret(r.data.access_token_ciphertext,r.data.access_token_nonce,
     encryptionKey,'provider-account:'+merchantId+':mercadopago:access');
   }};
  const counts:Record<string,number>={verified:0,pending:0,closed:0,retry:0,review:0};
  const started=Date.now();
  for(const job of jobs.data){
   let result;
   try{result=Date.now()-started>70000
     ?{outcome:'retry',reason:'CYCLE_TIME_BUDGET',businessStatus:null}
     :await reconcilePaymentJob(job,deps)}
   catch(error){
    const code=String((error as any)?.code||(error as any)?.message||'');
    const reason=/^[A-Z][A-Z0-9_]{2,99}$/.test(code)?code:'PROVIDER_OR_DATABASE_RETRY_REQUIRED';
    result={outcome:/MULTIPLE_|BINDING_|INVALID_SERVER_QUEUE/.test(reason)?'review':'retry',reason,businessStatus:null};
   }
   const saved=await admin.rpc('platform_payment_reconciliation_finish',{
    p_kind:job.kind,p_resource:job.resource_id,p_lease:job.lease_token,
    p_outcome:result.outcome,p_reason:result.reason,p_business_status:result.businessStatus});
   if(saved.error||saved.data!==true)throw Error('QUEUE_RESULT_NOT_RECORDED');
   counts[result.outcome]++;
  }
  return json({ok:true,checked:jobs.data.length,counts,newChargesCreated:0});
 }catch{return json({ok:false,error:'PAYMENT_RECONCILIATION_UNAVAILABLE'},503)}
});
