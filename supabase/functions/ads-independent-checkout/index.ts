import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {readJsonBody,enforceApiQuota,DomainError} from "../_shared/domain.js";
import {mercadoPagoFetch,readMercadoPagoJson,safeMercadoPagoUrl} from "../_shared/mercadopago.js";

// V1.886: fixed-duration sponsored slot purchase. No browser view is billable.
// Reuses ONLY platform-owned Ads credentials, NEVER merchant/payment OAuth.
const URL_BASE=Deno.env.get("SUPABASE_URL")??"";
const PUB=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default
 ??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default
 ??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ORIGINS=new Set(["https://tamao.com.br","https://www.tamao.com.br",
 "https://tamao-sg-cliente.pages.dev"]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function cors(origin:string|null){
 return {"Access-Control-Allow-Origin":origin&&ORIGINS.has(origin)?origin:"null",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};
}
function json(body:unknown,status=200,origin:string|null=null){
 return new Response(JSON.stringify(body),{status,headers:{...cors(origin),
  "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
function creds(){
 const token=String(Deno.env.get("ADS_MP_ACCESS_TOKEN")??"").trim();
 const sellerId=String(Deno.env.get("ADS_MP_SELLER_ID")??"").trim();
 if(Deno.env.get("ADS_MP_CHECKOUT_ENABLED")!=="true"||
   Deno.env.get("ADS_MP_WEBHOOK_ENABLED")!=="true"||
   !/^APP_USR-\S{20,}$/.test(token)||!/^[0-9]{4,20}$/.test(sellerId)||
   String(Deno.env.get("ADS_MP_WEBHOOK_SECRET")||"").length<16)
  throw new DomainError("ADS_PAYMENT_NOT_CONFIGURED",
    "O checkout seguro ainda não está habilitado. Nenhuma cobrança foi criada.",503);
 return {token,sellerId};
}
async function verifySeller(token:string,sellerId:string){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),7000);
 try{
  const result=await fetch("https://api.mercadolibre.com/users/me",{
   headers:{"Authorization":"Bearer "+token,"Accept":"application/json"},signal:controller.signal
  });
  if(!result.ok)throw Error("ADS_SELLER_LOOKUP_FAILED");
  const raw=await result.text();
  if(raw.length>20000)throw Error("ADS_SELLER_RESPONSE_TOO_LARGE");
  const who=JSON.parse(raw);
  if(String(who?.id??"")!==sellerId)throw Error("ADS_SELLER_MISMATCH");
 }catch{
  throw new DomainError("ADS_SELLER_UNVERIFIED",
   "A identidade da conta recebedora ainda não foi confirmada. Não cobramos.",503);
 }finally{clearTimeout(timer)}
}
async function sessionUser(req:Request){
 const bearer=String(req.headers.get("authorization")||"").trim();
 if(!bearer.startsWith("Bearer "))return null;
 const client=createClient(URL_BASE,PUB,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.auth.getUser(bearer.slice(7));
 if(error||!data.user||data.user.is_anonymous===true||!data.user.email_confirmed_at)return null;
 return data.user;
}
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
  if(body.action!=="purchase")return json({error:"UNKNOWN_ACTION"},400,origin);
  if(body.acceptFixedFee!==true)return json({error:"FIXED_FEE_CONSENT_REQUIRED"},400,origin);
  const campaignId=String(body.campaignId||""),requestId=String(body.requestId||"");
  if(!UUID.test(campaignId)||!UUID.test(requestId))
   return json({error:"INVALID_PURCHASE_REQUEST"},400,origin);
  const user=await sessionUser(req);
  if(!user)return json({error:"VERIFIED_EMAIL_REQUIRED"},401,origin);
  const {token,sellerId}=creds(); // Fail closed BEFORE creating any reservation.
  await verifySeller(token,sellerId); // Prevent charging against the wrong seller account.
  const admin=createClient(URL_BASE,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
  await enforceApiQuota(admin,{userId:user.id,actionName:"ads-independent-fixed-fee-purchase",
   limit:8,windowSeconds:3600});
  const {data:reserved,error:reserveError}=await admin.rpc("ads_independent_checkout_reserve_v1_886",{
   p_owner:user.id,p_campaign:campaignId,p_request:requestId
  });
  if(reserveError)throw reserveError;
  if(reserved?.source!=="ads_independent_checkout_reserve_v1_886"||
    reserved.campaignId!==campaignId||
    !Number.isInteger(reserved.amountCents)||
    ![1990,4990,9990,19990].includes(reserved.amountCents))
   throw Error("ADS_PAYMENT_RESERVATION_INVALID");
  if(reserved.created!==true){
   const url=safeMercadoPagoUrl(reserved.checkoutUrl);
   if(reserved.status==="checkout_ready"&&url)return json({
     source:"ads_independent_checkout_v1_886",checkoutUrl:url,status:"checkout_ready",
     amountCents:reserved.amountCents,reused:true,viewChargesCents:0
   },200,origin);
   return json({error:"ADS_PAYMENT_REVIEW_PENDING",
     message:"Esta campanha já possui uma tentativa de pagamento. Consulte Minhas campanhas; não será gerada outra cobrança."},409,origin);
  }
  const reference=String(reserved.externalReference||"");
  if(!/^tamao-ads-ind-[0-9a-f]{32}$/.test(reference))
   throw Error("ADS_EXTERNAL_REFERENCE_INVALID");
  const start=new Date();
  const expires=new Date(start.getTime()+24*60*60*1000);
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
  const url=safeMercadoPagoUrl(pref?.init_point);
  if(preference.length<5||preference.length>120||!url)throw Error("ADS_PROVIDER_RESPONSE_INVALID");
  const {data:attached,error:attachError}=await admin.rpc("ads_independent_checkout_attach_v1_886",{
   p_campaign:campaignId,p_external_reference:reference,p_preference:preference,p_checkout_url:url
  });
  if(attachError)throw attachError;
  if(attached?.source!=="ads_independent_checkout_attach_v1_886"||
    attached?.status!=="checkout_ready"||attached?.checkoutUrl!==url)
   throw Error("ADS_CHECKOUT_READBACK_INVALID");
  return json({source:"ads_independent_checkout_v1_886",checkoutUrl:url,status:"checkout_ready",
   amountCents:reserved.amountCents,reused:false,viewChargesCents:0},200,origin);
 }catch(error){
  if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
  // Never log token, personal identity, reference, provider payload, or response.
  console.error("ads-independent-checkout failure",error instanceof Error?error.name:"unknown");
  return json({error:"ADS_PURCHASE_UNAVAILABLE",
   message:"Não foi possível confirmar o checkout. Consulte Minhas campanhas antes de tentar novamente."},503,origin);
 }
});
