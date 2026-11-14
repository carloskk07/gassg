import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {readJsonBody,enforceApiQuota,DomainError} from "../_shared/domain.js";
import {mercadoPagoFetch,readMercadoPagoJson,safeMercadoPagoUrl,moneyToCents} from "../_shared/mercadopago.js";
import {verifiedIndependentAdsPreference} from "../_shared/ads-independent-preference.mjs";
import {selectIndependentAdsPayment} from "../_shared/ads-independent-payment-search.mjs";

// V1.886: fixed-duration sponsored slot purchase. No browser view is billable.
// Reuses ONLY platform-owned Ads credentials, NEVER merchant/payment OAuth.
const URL_BASE=Deno.env.get("SUPABASE_URL")??"";
const PUB=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default
 ??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default
 ??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ORIGINS=new Set(["https://tamao.com.br","https://www.tamao.com.br",
 "https://tamao-sg-cliente.pages.dev","https://admin.tamao.com.br"]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
import {cors,json,creds,verifySeller,sessionUser,reconcileProviderPayment,providerPreferenceProof,recoverReservedPreference} from "./handlers.ts";

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(!origin||!ORIGINS.has(origin))return json({error:"ORIGIN_DENIED"},403,origin);
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);
 if(!String(req.headers.get("content-type")||"").startsWith("application/json"))
  return json({error:"CONTENT_TYPE_INVALID"},415,origin);
 if(!URL_BASE||!PUB||!SECRET)return json({error:"ADS_SERVICE_NOT_CONFIGURED"},503,origin);
 try{
  const body:any=await readJsonBody(req,{maxBytes:4000});
  if(!["purchase","reconcile"].includes(body.action))return json({error:"UNKNOWN_ACTION"},400,origin);
  const campaignId=String(body.campaignId||"").toLowerCase(),requestId=String(body.requestId||"");
  if(!UUID.test(campaignId)||(body.action==="purchase"&&!UUID.test(requestId)))
   return json({error:"INVALID_PURCHASE_REQUEST"},400,origin);
  if(body.action==="purchase"&&body.acceptFixedFee!==true)
   return json({error:"FIXED_FEE_CONSENT_REQUIRED"},400,origin);
  const user=await sessionUser(req);
  if(!user)return json({error:"VERIFIED_EMAIL_REQUIRED"},401,origin);
  const {token,sellerId}=creds(); // Fail closed BEFORE creating any reservation.
  await verifySeller(token,sellerId); // Prevent charging against the wrong seller account.
  const admin=createClient(URL_BASE,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
  await enforceApiQuota(admin,{userId:user.id,
   actionName:body.action==="purchase"?"ads-independent-fixed-fee-purchase":"ads-independent-payment-reconcile",
   limit:8,windowSeconds:3600});
  if(body.action==="reconcile"){
   return await reconcileProviderPayment(admin,user.id,campaignId,token,sellerId,origin);
  }
  const {data:reserved,error:reserveError}=await admin.rpc("ads_independent_checkout_reserve_v1_886",{
   p_owner:user.id,p_campaign:campaignId,p_request:requestId
  });
  if(reserveError)throw reserveError;
  if(reserved?.source!=="ads_independent_checkout_reserve_v1_886"||
    reserved.campaignId!==campaignId||
    !Number.isInteger(reserved.amountCents)||
    ![1990,4990,9990,19990].includes(reserved.amountCents))
   throw Error("ADS_PAYMENT_RESERVATION_INVALID");
  const reference=String(reserved.externalReference||"");
  const expiresAt=String(reserved.expiresAt||"");
  const deadline=Date.parse(expiresAt);
  if(!/^tamao-ads-ind-[0-9a-f]{32}$/.test(reference)||
     !Number.isFinite(deadline))
   throw Error("ADS_EXTERNAL_REFERENCE_INVALID");
  if(reserved.created!==true){
   if(reserved.status==="checkout_ready"){
    const url=safeMercadoPagoUrl(reserved.checkoutUrl);
    if(url&&deadline>Date.now()+60000)return json({
      source:"ads_independent_checkout_v1_886",checkoutUrl:url,status:"checkout_ready",
      amountCents:reserved.amountCents,reused:true,viewChargesCents:0
    },200,origin);
    return json({error:"ADS_CHECKOUT_EXPIRED",message:
      "O link expirou. Confira Minhas campanhas antes de uma nova contratação."},409,origin);
   }
   if(reserved.status==="reserved")return await recoverReservedPreference(
     admin,token,sellerId,campaignId,reference,reserved.amountCents,expiresAt,origin
   );
   return json({error:"ADS_PAYMENT_REVIEW_PENDING",message:
     "Já existe uma tentativa para esta campanha. Consulte a situação do pagamento; nenhuma nova cobrança foi criada."},409,origin);
  }
  const start=new Date();
  const expires=new Date(deadline);
  if(deadline<=start.getTime()+60000||deadline>start.getTime()+73*60*60*1000)
   throw Error("ADS_CHECKOUT_DEADLINE_INVALID");
  const result=await mercadoPagoFetch("/checkout/preferences",{
   accessToken:token,method:"POST",
   idempotencyKey:"adsind-"+campaignId.replaceAll("-",""),
   body:{
    items:[{id:"tamao-ads-independent-"+campaignId,title:"Publicidade TAMÃO — veiculação por período",
     quantity:1,currency_id:"BRL",unit_price:reserved.amountCents/100}],
    external_reference:reference,
    expires:true,expiration_date_from:start.toISOString(),
    expiration_date_to:expires.toISOString(),
    notification_url:URL_BASE+"/functions/v1/ads-payment-webhook-mercadopago",
    back_urls:{success:"https://tamao.com.br/#sponsors",
      failure:"https://tamao.com.br/#sponsors",pending:"https://tamao.com.br/#sponsors"},
    auto_return:"approved"
   }
  });
  const pref:any=await readMercadoPagoJson(result);
  if(!result.ok)throw Error("ADS_PROVIDER_CHECKOUT_FAILED");
  const preference=String(pref?.id||"");
  const proof=await providerPreferenceProof(token,preference,{
    reference,campaignId,sellerId,amountCents:reserved.amountCents,expiresAt
  });
  const {data:attached,error:attachError}=await admin.rpc("ads_independent_checkout_attach_v1_886",{
   p_campaign:campaignId,p_external_reference:reference,
   p_preference:proof.id,p_checkout_url:proof.checkoutUrl
  });
  if(attachError)throw attachError;
  if(attached?.source!=="ads_independent_checkout_attach_v1_886"||
    attached?.status!=="checkout_ready"||attached?.checkoutUrl!==proof.checkoutUrl)
   throw Error("ADS_CHECKOUT_READBACK_INVALID");
  return json({source:"ads_independent_checkout_v1_886",
   checkoutUrl:proof.checkoutUrl,status:"checkout_ready",
   amountCents:reserved.amountCents,reused:false,recovered:false,viewChargesCents:0},200,origin);
 }catch(error){
  if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
  // Never log token, personal identity, reference, provider payload, or response.
  console.error("ads-independent-checkout failure",error instanceof Error?error.name:"unknown");
  return json({error:"ADS_PURCHASE_UNAVAILABLE",
   message:"Não foi possível confirmar o checkout. Consulte Minhas campanhas antes de tentar novamente."},503,origin);
 }
});
