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
import {verifiedOrderPix} from "../_shared/order-pix-proof.mjs";
import {prepareAdsPix,recoverAdsPix} from "../_shared/ads-native-pix.mjs";
import {adsPixDependencies} from "../ads-independent-checkout/handlers.ts";

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
  // Explicit maintenance only: repair the instrument of the ONE already
  // consented founder test. Cron's ordinary route remains provider-read-only.
  if(new URL(req.url).searchParams.get('repair')==='existing-advertising-pix'){
   const controls=await admin.from('ads_independent_sales_controls_v1_886')
    .select('homologation_campaign_id,homologation_expires_at').eq('singleton',true).maybeSingle();
   const campaignId=controls.data?.homologation_campaign_id;
   if(controls.error||!campaignId||Date.parse(controls.data.homologation_expires_at)<=Date.now())
    return json({ok:false,error:'ADS_PIX_EXISTING_TEST_REQUIRED'},403);
   const existing=await admin.from('ads_independent_checkouts_v1_886')
    .select('owner_user_id,amount_cents,duration_days,status,preference_id,terms_accepted_at')
    .eq('campaign_id',campaignId).maybeSingle();
   const row=existing.data;
   if(existing.error||!row||!row.preference_id||!row.terms_accepted_at||row.amount_cents!==1990||row.duration_days!==7)
    return json({ok:false,error:'ADS_PIX_EXISTING_TEST_REQUIRED'},403);
   if(row.status==='payment_approved')return json({ok:true,paymentApproved:true,newPaymentInstrumentCreated:false});
   if(row.status!=='checkout_ready')return json({ok:false,error:'ADS_PIX_EXISTING_TEST_NOT_PAYABLE'},409);
   const owner=await admin.auth.admin.getUserById(row.owner_user_id);
   if(owner.error||owner.data.user?.is_anonymous===true||!owner.data.user?.email_confirmed_at)
    return json({ok:false,error:'ADS_PIX_VERIFIED_OWNER_REQUIRED'},403);
   const config=independentAdsCredentialConfig((key:string)=>Deno.env.get(key));
   if(!config.checkoutConfigured||!config.webhookConfigured||!config.signedWebhookConfigured)
    return json({ok:false,error:'ADS_PIX_PROVIDER_UNAVAILABLE'},503);
   const credentials=await verifyIndependentAdsSeller(config);
   const result=await prepareAdsPix(adsPixDependencies(admin,null),{ownerId:row.owner_user_id,
    campaignId,payerEmail:owner.data.user.email,origin:'system_repair',...credentials});
   return json({ok:true,source:'ads_existing_pix_instrument_repair',amountCents:1990,
    status:result.status,pixAvailable:result.pixPayable===true,expiresAt:result.expiresAt||null,
    newPaymentInstrumentCreated:result.reused===false,newObligationsCreated:0});
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
    handleMerchantSaleOrder,verifySeller,recoverReservedPreference,reconcileProviderPayment,
    recoverAdsPix:(row:any,token:string,sellerId:string)=>recoverAdsPix(adsPixDependencies(admin,null),row,token,sellerId)},
   providerGet:async(path:string,accessToken:string)=>{
    const response=await mercadoPagoFetch(path,{accessToken,method:'GET',timeoutMs:8000});
    if(!response.ok)throw Error('PROVIDER_LOOKUP_FAILED');
    return readMercadoPagoJson(response);
   },
   restoreSalePix:async(row:any,orderId:string,token:string)=>{
    if(row.payment_method_snapshot!=='pix'||!['preparing','checkout_ready','pending','review_required'].includes(row.status))return;
    if(row.status==='review_required'&&!['PROVIDER_CHECKOUT_OUTCOME_UNKNOWN','PROVIDER_CHECKOUT_COMMIT_FAILED'].includes(row.last_error_code))return;
    const account=await admin.from('merchant_payment_provider_accounts').select('provider_account_id')
     .eq('merchant_id',row.merchant_id).eq('provider','mercadopago').eq('status','active').maybeSingle();
    const owned=await admin.from('orders').select('customer_id,total_cents,merchant_id')
     .eq('id',row.order_id).eq('merchant_id',row.merchant_id).maybeSingle();
    if(account.error||owned.error||!account.data?.provider_account_id||!owned.data||owned.data.total_cents!==row.amount_cents)
     throw Error('SALE_PIX_REPAIR_BINDING_INVALID');
    const response=await mercadoPagoFetch('/v1/orders/'+encodeURIComponent(orderId),{accessToken:token});
    if(!response.ok)throw Error('SALE_PIX_PROVIDER_LOOKUP_FAILED');
    const details=await readMercadoPagoJson(response);
    const pix=verifiedOrderPix(details,{reference:row.external_reference,sellerId:account.data.provider_account_id,
     amountCents:row.amount_cents,createdAt:row.created_at,orderId});
    if(!pix)return;
    const attached=await admin.rpc('merchant_sale_pix_attach',{p_customer:owned.data.customer_id,p_order:row.order_id,
     p_attempt:row.id,p_provider_order:orderId,p_amount:row.amount_cents,p_code:pix.pixCode,p_expires:pix.expiresAt});
    if(attached.error)throw attached.error;
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
 }catch(error){
  const code=String((error as any)?.message||'');
  return json({ok:false,error:/^ADS_[A-Z0-9_]{3,100}$/.test(code)?code:'PAYMENT_RECONCILIATION_UNAVAILABLE'},503);
 }
});
