import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {readJsonBody,enforceApiQuota} from "../_shared/domain.js";
import {mercadoPagoFetch,readMercadoPagoJson,moneyToCents} from "../_shared/mercadopago.js";
import {independentAdsCredentialConfig,verifyIndependentAdsSeller} from "../_shared/ads-platform-credentials.mjs";
import {adsPixProof} from "../_shared/ads-native-pix.mjs";
import {selectIndependentAdsPayment} from "../_shared/ads-independent-payment-search.mjs";

// Prepaid funds are a distinct obligation. No legacy duration-based checkout
// can be converted or credited here. Monetization remains fail-closed until
// the server-side V1.1097 controls are approved.
const URL_BASE=Deno.env.get("SUPABASE_URL")??"";
const PUB=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default
 ??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default
 ??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ORIGINS=new Set(["https://tamao.com.br","https://www.tamao.com.br",
 "https://tamao-sg-cliente.pages.dev","https://admin.tamao.com.br"]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRICE_OPTIONS=new Set([1990,4990,9990,19990]);
const cors=(origin:string|null)=>({"Access-Control-Allow-Origin":origin&&ORIGINS.has(origin)?origin:"null",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"});
function respond(data:any,status:number,origin:string|null){
 return new Response(JSON.stringify(data),{status,headers:{
  ...cors(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
async function sessionUser(req:Request){
 const auth=String(req.headers.get("authorization")||"");
 if(!auth.startsWith("Bearer "))return null;
 const client=createClient(URL_BASE,PUB,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.auth.getUser(auth.slice(7));
 if(error||!data?.user||data.user.is_anonymous===true||!data.user.email_confirmed_at)return null;
 return data.user;
}
async function rpc(admin:any,name:string,args:any){
 const {data,error}=await admin.rpc(name,args);
 if(error)throw error;
 if(data?.source!==name)throw Error("ADS_CREDIT_DATABASE_CONTRACT_MISMATCH");
 return data;
}
async function getPayment(token:string,id:string){
 const res=await mercadoPagoFetch("/v1/payments/"+id,{accessToken:token});
 if(!res.ok)throw Error("ADS_CREDIT_PROVIDER_LOOKUP_FAILED");
 const p:any=await readMercadoPagoJson(res);
 if(String(p?.id)!==id)throw Error("ADS_CREDIT_PAYMENT_ID_MISMATCH");
 return p;
}
async function providerSearch(token:string,ref:string){
 const res=await mercadoPagoFetch("/v1/payments/search?external_reference="+
  encodeURIComponent(ref)+"&limit=10",{accessToken:token});
 if(!res.ok)throw Error("ADS_CREDIT_PROVIDER_SEARCH_FAILED");
 const listing:any=await readMercadoPagoJson(res);
 const choice=selectIndependentAdsPayment(listing,ref);
 if(choice.kind==="review")throw Error("ADS_CREDIT_MULTIPLE_PROVIDER_PAYMENTS");
 if(choice.kind==="none")return null;
 if(typeof choice.paymentId!=='string'||!/^\d{5,30}$/.test(choice.paymentId))
  throw Error("ADS_CREDIT_PROVIDER_ID_INVALID");
 return await getPayment(token,choice.paymentId);
}
async function finishPix(admin:any,row:any,p:any,sellerId:string){
 const proof=adsPixProof(p,row,sellerId);
 return await rpc(admin,"ads_credit_topup_attach_v1_1097",{
  p_owner:row.owner_user_id,p_topup:row.id,p_payment:proof.id,
  p_collector:proof.collector,p_code:proof.code,p_expires:proof.expiresAt});
}
async function reconcile(admin:any,row:any,token:string,sellerId:string){
 const paymentId=String(row.provider_payment_id||"");
 if(!/^\d{5,30}$/.test(paymentId))
  throw Error("ADS_CREDIT_PAYMENT_NOT_ATTACHED");
 const p=await getPayment(token,paymentId);
 if(p.live_mode!==true||p.external_reference!==row.external_reference||
   moneyToCents(p.transaction_amount)!==row.amount_cents||p.currency_id!=="BRL"||
   String(p.collector_id??p.collector?.id??"")!==sellerId||
   p.payment_method_id!=="pix")
   throw Error("ADS_CREDIT_PROVIDER_PROOF_INVALID");
 const detail=String(p.status_detail||"");
 if(detail.length>120)throw Error("ADS_CREDIT_STATUS_INVALID");
 const input="adscredit1097|"+paymentId+"|"+p.status+"|"+detail;
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input));
 const eventKey=[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("");
 return await rpc(admin,"ads_credit_payment_fact_v1_1097",{
  p_event_key:eventKey,p_reference:row.external_reference,
  p_payment:paymentId,p_collector:sellerId,p_amount:row.amount_cents,
  p_status:String(p.status||""),p_status_detail:detail,p_live:true
 });
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(!origin||!ORIGINS.has(origin))return respond({error:"ORIGIN_DENIED"},403,origin);
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST")return respond({error:"METHOD_NOT_ALLOWED"},405,origin);
 if(!String(req.headers.get("content-type")||"").startsWith("application/json"))
  return respond({error:"CONTENT_TYPE_INVALID"},415,origin);
 if(!URL_BASE||!PUB||!SECRET)return respond({error:"ADS_CREDIT_UNAVAILABLE"},503,origin);
 try{
  const body:any=await readJsonBody(req,{maxBytes:3000});
  const action=String(body.action||"");
  if(!["mine","topup","reconcile"].includes(action))
   return respond({error:"UNKNOWN_ACTION"},400,origin);
  const user=await sessionUser(req);
  if(!user)return respond({error:"VERIFIED_ACCOUNT_REQUIRED"},401,origin);
  const admin=createClient(URL_BASE,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
  await enforceApiQuota(admin,{userId:user.id,actionName:"ads-credit-"+action,
    limit:action==="mine"?120:8,windowSeconds:3600});
  if(action==="mine"){
   const data=await rpc(admin,"ads_credit_balance_v1_1097",{p_owner:user.id});
   return respond(data,200,origin);
  }
  const config=independentAdsCredentialConfig((key:string)=>Deno.env.get(key));
  if(!config.checkoutConfigured||!config.webhookConfigured||
     !config.tokenConfigured||!config.sellerConfigured||
     !config.signedWebhookConfigured)
   return respond({error:"ADS_CREDIT_PAYMENT_NOT_CONFIGURED"},503,origin);
  const {token,sellerId}=await verifyIndependentAdsSeller(config);
  if(action==="reconcile"){
   const topupId=String(body.topupId||"");
   if(!UUID.test(topupId))return respond({error:"TOPUP_ID_INVALID"},400,origin);
   const {data:row,error}=await admin.from("ads_credit_topups_v1_1097").select("*")
    .eq("id",topupId).eq("owner_user_id",user.id).maybeSingle();
   if(error)throw error;
   if(!row)return respond({error:"TOPUP_NOT_FOUND"},404,origin);
   const status=await reconcile(admin,row,token,sellerId);
   return respond(status,200,origin);
  }
  const requestId=String(body.requestId||"");
  const amount=Number(body.amountCents);
  if(!UUID.test(requestId)||!Number.isSafeInteger(amount)||!PRICE_OPTIONS.has(amount)||
    body.acceptCreditTerms!==true)
   return respond({error:"TOPUP_REQUEST_INVALID"},400,origin);
  const reserved=await rpc(admin,"ads_credit_topup_reserve_v1_1097",{
   p_owner:user.id,p_request:requestId,p_amount:amount});
  const {data:row,error}=await admin.from("ads_credit_topups_v1_1097")
   .select("*").eq("id",reserved.topupId).eq("owner_user_id",user.id).maybeSingle();
  if(error||!row||row.external_reference!==reserved.externalReference||
    row.amount_cents!==amount)throw Error("ADS_CREDIT_RESERVATION_MISMATCH");
  if(row.status==="approved"||row.status==="reversed"||row.status==="review_required")
   return respond({source:"ads_credit_topup_v1_1097",status:row.status},200,origin);
  if(row.status==="pix_pending"){
   if(Date.parse(String(row.pix_expires_at))>Date.now()+60000){
    return respond({source:"ads_credit_topup_v1_1097",status:"pix_pending",
     topupId:row.id,pixCode:row.pix_code,expiresAt:row.pix_expires_at,
     amountCents:row.amount_cents,reused:true},200,origin);
   }
   return respond({error:"ADS_CREDIT_PIX_EXPIRED",
    message:"Esta cobrança expirou. Confira a conciliação antes de criar outra."},409,origin);
  }
  const claim=await rpc(admin,"ads_credit_topup_claim_v1_1097",{
   p_owner:user.id,p_topup:row.id});
  if(claim.canCreate!==true&&claim.status!=="creating")
   return respond({error:"ADS_CREDIT_INTENTION_REVIEW_REQUIRED"},409,origin);
  // An already-claimed reservation may have created a payment before a timeout.
  // Recovery checks MP; it NEVER repeats the POST.
  let payment=await providerSearch(token,row.external_reference);
  if(!payment){
   if(claim.canCreate!==true)
    return respond({error:"ADS_CREDIT_PAYMENT_PENDING",
     message:"A confirmação do provedor ainda não apareceu; não foi criado outro Pix."},409,origin);
   if(typeof user.email!=="string"||!/^\S+@\S+\.\S+$/.test(user.email))
    return respond({error:"VERIFIED_EMAIL_REQUIRED"},401,origin);
   const expiresAt=new Date(Date.now()+86400000).toISOString();
   const response=await mercadoPagoFetch("/v1/payments",{
    accessToken:token,method:"POST",
    idempotencyKey:"tamao-credit-"+requestId,
    body:{transaction_amount:amount/100,
     description:"Recarga de publicidade TAMÃO",
     payment_method_id:"pix",external_reference:row.external_reference,
     payer:{email:user.email},
     date_of_expiration:expiresAt,
     notification_url:URL_BASE+"/functions/v1/ads-payment-webhook-mercadopago"}
   });
   if(!response.ok)throw Error("ADS_CREDIT_PIX_CREATION_UNCONFIRMED");
   const created:any=await readMercadoPagoJson(response);
   if(!/^\d{5,30}$/.test(String(created?.id??"")))
    throw Error("ADS_CREDIT_PAYMENT_ID_UNCONFIRMED");
   payment=await getPayment(token,String(created.id));
  }
  const attached=await finishPix(admin,row,payment,sellerId);
  return respond({source:"ads_credit_topup_v1_1097",
   status:"pix_pending",topupId:row.id,amountCents:amount,
   pixCode:attached.pixCode,expiresAt:attached.expiresAt,
   reused:claim.canCreate!==true},200,origin);
 }catch(e){
  const message=String((e as any)?.message||"");
  if(message.includes("ADS_CREDIT_RECHARGE_DISABLED"))
   return respond({error:"ADS_CREDIT_RECHARGE_DISABLED",
    message:"As novas recargas aguardam validação financeira."},409,origin);
  console.error("ads-credit payment",e instanceof Error?e.name:"unknown");
  return respond({error:"ADS_CREDIT_OPERATION_UNAVAILABLE",
   message:"Não foi possível confirmar a operação. Consulte o saldo antes de tentar novamente."},503,origin);
 }
});
