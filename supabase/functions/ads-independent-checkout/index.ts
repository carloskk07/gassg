import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {readJsonBody,enforceApiQuota,DomainError} from "../_shared/domain.js";
import {mercadoPagoFetch,readMercadoPagoJson,safeMercadoPagoUrl,moneyToCents} from "../_shared/mercadopago.js";
import {verifiedIndependentAdsPreference} from "../_shared/ads-independent-preference.mjs";
import {selectIndependentAdsPayment} from "../_shared/ads-independent-payment-search.mjs";
import {prepareAdsPix} from "../_shared/ads-native-pix.mjs";

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
import {cors,json,creds,verifySeller,sessionUser,reconcileProviderPayment,providerPreferenceProof,recoverReservedPreference,adsPixDependencies} from "./handlers.ts";

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
  const {token,sellerId}=await creds(); // Verify the recipient BEFORE any reservation.
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
  const result=await prepareAdsPix(adsPixDependencies(admin,origin),{
   ownerId:user.id,campaignId,token,sellerId,payerEmail:user.email,origin:"owner"
  });
  return json(result,200,origin);
 }catch(error){
  if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
  const code=String((error as any)?.message||"");
  const messages:Record<string,string>={
   ADS_PIX_PREPARING:"O Pix original está sendo recuperado. Consulte novamente; a cobrança não será duplicada.",
   ADS_PIX_LEGACY_STILL_PAYABLE:"O checkout anterior ainda precisa ser encerrado pelo provedor antes do Pix integrado.",
   ADS_PIX_PAYMENT_IN_PROCESS:"O pagamento existente está em processamento. Nenhum outro Pix foi criado.",
   ADS_MULTIPLE_PAYMENTS_REVIEW_REQUIRED:"Há mais de um pagamento no provedor; a cobrança precisa de conferência.",
   ADS_PIX_VERIFIED_EMAIL_REQUIRED:"Confirme o e-mail da sua conta antes de gerar o Pix."
  };
  if(messages[code])return json({error:code,message:messages[code]},409,origin);
  // Never log token, personal identity, reference, provider payload, or response.
  console.error("ads-independent-checkout failure",error instanceof Error?error.name:"unknown");
  return json({error:"ADS_PURCHASE_UNAVAILABLE",
   message:"Não foi possível confirmar o checkout. Consulte Minhas campanhas antes de tentar novamente."},503,origin);
 }
});
