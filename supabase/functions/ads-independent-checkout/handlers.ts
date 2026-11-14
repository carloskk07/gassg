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
async function reconcileProviderPayment(admin:any,ownerId:string,campaignId:string,
 token:string,sellerId:string,origin:string|null){
 const {data:checkout,error:checkoutErr}=await admin.from("ads_independent_checkouts_v1_886")
  .select("external_reference,amount_cents,status,payment_id")
  .eq("campaign_id",campaignId).eq("owner_user_id",ownerId).maybeSingle();
 if(checkoutErr)throw checkoutErr;
 if(!checkout)return json({error:"ADS_CHECKOUT_NOT_FOUND"},404,origin);
 if(checkout.status==="reserved")return json({
  source:"ads_independent_reconcile_v1_886",status:"reserved",paymentApproved:false
 },200,origin);
 const reference=String(checkout.external_reference||"");
 if(!/^tamao-ads-ind-[0-9a-f]{32}$/.test(reference))
  throw Error("ADS_PAYMENT_REFERENCE_INVALID");
 const search=await mercadoPagoFetch("/v1/payments/search?external_reference="+
   encodeURIComponent(reference)+"&limit=10",{accessToken:token});
 if(!search.ok)throw Error("ADS_PROVIDER_SEARCH_FAILED");
 const listing:any=await readMercadoPagoJson(search);
 const choice=selectIndependentAdsPayment(listing,reference);
 if(choice.kind==="review")return json({error:"ADS_MULTIPLE_PAYMENTS_REVIEW_REQUIRED",
  message:"A busca do provedor não comprovou um único pagamento; requer conferência financeira."},409,origin);
 if(choice.kind==="none"){
  if(["payment_approved","payment_reversed"].includes(checkout.status))
   return json({error:"ADS_PAYMENT_PROVIDER_RECHECK_REQUIRED",
    message:"O histórico e o provedor precisam de conciliação antes da confirmação."},409,origin);
  return json({source:"ads_independent_reconcile_v1_886",
   status:checkout.status,paymentApproved:false,providerFound:false},200,origin);
 }
 const paymentId=choice.paymentId;
 const resp=await mercadoPagoFetch("/v1/payments/"+paymentId,{accessToken:token});
 if(!resp.ok)throw Error("ADS_PROVIDER_PAYMENT_LOOKUP_FAILED");
 const p:any=await readMercadoPagoJson(resp);
 const amount=moneyToCents(p?.transaction_amount);
 const collector=String(p?.collector_id??p?.collector?.id??"");
 const status=String(p?.status??"");
 const detail=String(p?.status_detail??"");
 if(String(p?.id)!==paymentId||p?.live_mode!==true||
   String(p?.external_reference||"")!==reference||collector!==sellerId||
   amount!==checkout.amount_cents||p?.currency_id!=="BRL"||
   !["approved","refunded","charged_back","cancelled","rejected","pending","in_process"].includes(status)||
   detail.length>120)
   throw new DomainError("ADS_PAYMENT_EVIDENCE_MISMATCH",
    "O provedor não confirmou o pagamento correspondente a esta campanha.",409);
 const basis="adsind886-reconcile|"+paymentId+"|"+status+"|"+detail;
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(basis));
 const eventKey=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
 const {data,error}=await admin.rpc("ads_independent_payment_fact_v1_886",{
  p_event_key:eventKey,p_external_reference:reference,p_payment_id:paymentId,
  p_collector_id:collector,p_amount_cents:amount,p_currency:"BRL",
  p_provider_status:status,p_status_detail:detail||null,p_live_mode:true
 });
 if(error)throw error;
 if(data?.source!=="ads_independent_payment_fact_v1_886"||
   data?.autoPublished!==false||data?.netSettlementVerified!==false)
   throw Error("ADS_PAYMENT_READBACK_INVALID");
 return json({source:"ads_independent_reconcile_v1_886",status:data.status,
   paymentApproved:data.paymentApproved===true,providerFound:true,
   netSettlementVerified:false,autoPublished:false},200,origin);
}

async function providerPreferenceProof(token:string,preferenceId:string,
 expected:{reference:string;campaignId:string;sellerId:string;amountCents:number;expiresAt:string}){
 if(!/^[a-zA-Z0-9-]{5,120}$/.test(preferenceId))
  throw new DomainError("ADS_PREFERENCE_ID_INVALID","Identificador do checkout inválido.",409);
 const response=await mercadoPagoFetch("/checkout/preferences/"+encodeURIComponent(preferenceId),
  {accessToken:token,timeoutMs:8000});
 if(!response.ok)throw new DomainError("ADS_PREFERENCE_UNAVAILABLE",
  "O Mercado Pago ainda não confirmou os detalhes da preferência.",503);
 const details:any=await readMercadoPagoJson(response);
 const verified=verifiedIndependentAdsPreference(details,expected);
 if(!verified||verified.id!==preferenceId)
  throw new DomainError("ADS_PREFERENCE_EVIDENCE_MISMATCH",
   "O checkout não corresponde ao valor, prazo e conta recebedora autorizados.",409);
 return verified;
}
async function recoverReservedPreference(admin:any,token:string,sellerId:string,
 campaignId:string,reference:string,amountCents:number,expiresAt:string,origin:string|null){
 const deadline=Date.parse(String(expiresAt||""));
 if(!Number.isFinite(deadline)||deadline<=Date.now()+60000)
  return json({error:"ADS_CHECKOUT_EXPIRED",message:
   "Esta tentativa expirou. Nenhuma nova cobrança será gerada sem revisão do financeiro."},409,origin);
 // SEARCH + GET from the PSP, no second POST ever for the existing checkout.
 // If a first POST was still in flight, a zero-result SEARCH is not enough
 // evidence that it is safe to recreate a preference.
 const response=await mercadoPagoFetch("/checkout/preferences/search?external_reference="+
  encodeURIComponent(reference)+"&limit=10",{accessToken:token,timeoutMs:8000});
 if(!response.ok)throw new DomainError("ADS_PREFERENCE_SEARCH_UNAVAILABLE",
  "Não foi possível conferir a preferência no Mercado Pago.",503);
 const found:any=await readMercadoPagoJson(response);
 const all=Array.isArray(found?.elements)?found.elements:[];
 const total=Number(found?.total);
 if(!Number.isSafeInteger(total)||total<0||total>1||all.length>1)
  return json({error:"ADS_PREFERENCE_REVIEW_REQUIRED",message:
   "Há referências de preferência ambíguas. O financeiro precisa conferir antes de liberar."},409,origin);
 if(total!==1||all.length!==1)
  return json({error:"ADS_PREFERENCE_PENDING",message:
   "O Mercado Pago ainda não retornou a preferência. Confira novamente; não será criada uma segunda cobrança."},409,origin);
 // SEARCH often omits external_reference in the elements response.
 // GET detail below is authoritative and MUST verify the exact reference.
 const proof=await providerPreferenceProof(token,String(all[0].id||""),{
  reference,campaignId,sellerId,amountCents,expiresAt
 });
 const {data:attached,error}=await admin.rpc("ads_independent_checkout_attach_v1_886",{
  p_campaign:campaignId,p_external_reference:reference,
  p_preference:proof.id,p_checkout_url:proof.checkoutUrl
 });
 if(error)throw error;
 if(attached?.source!=="ads_independent_checkout_attach_v1_886"||
  attached?.status!=="checkout_ready"||attached?.checkoutUrl!==proof.checkoutUrl)
  throw new DomainError("ADS_PREFERENCE_ATTACH_UNVERIFIED",
   "A preferência foi encontrada, mas ainda não foi confirmada na campanha.",503);
 return json({source:"ads_independent_checkout_v1_886",
  checkoutUrl:proof.checkoutUrl,status:"checkout_ready",
  amountCents,reused:true,recovered:true,viewChargesCents:0},200,origin);
}

export {cors,json,creds,verifySeller,sessionUser,reconcileProviderPayment,providerPreferenceProof,recoverReservedPreference};
