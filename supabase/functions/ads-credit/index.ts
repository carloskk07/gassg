import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {readJsonBody,enforceApiQuota} from "../_shared/domain.js";
import {mercadoPagoFetch,readMercadoPagoJson} from "../_shared/mercadopago.js";
import {independentAdsCredentialConfig,verifyIndependentAdsSeller,independentAdsProviderReadiness} from "../_shared/ads-platform-credentials.mjs";
import {recordAdsCreditPayment} from "../_shared/ads-credit-payment.mjs";
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
const STATES=new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS",
 "MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);
function clean(value:unknown,max:number){
 return String(value??"").trim().replace(/\s+/g," ").slice(0,max);
}
function safeDestination(value:unknown){
 const raw=String(value??"").trim();
 if(raw.length<15||raw.length>300||/[<>\s@\\]/.test(raw))return false;
 try{
  const x=new URL(raw),host=x.hostname.toLowerCase();
  return x.protocol==="https:"&&!x.username&&!x.password&&(!x.port||x.port==="443")&&
    host.includes(".")&&!host.endsWith(".local")&&!host.endsWith(".internal")&&
    !host.endsWith(".localhost")&&host!=="localhost"&&
    !/^\d+\.\d+\.\d+\.\d+$/.test(host)&&!host.startsWith("[");
 }catch{return false}
}
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
 const choice=selectIndependentAdsPayment(listing,ref,"credit");
 if(choice.kind==="review")throw Error("ADS_CREDIT_MULTIPLE_PROVIDER_PAYMENTS");
 if(choice.kind==="none")return null;
 if(typeof choice.paymentId!=='string'||!/^\d{5,30}$/.test(choice.paymentId))
  throw Error("ADS_CREDIT_PROVIDER_ID_INVALID");
 return await getPayment(token,choice.paymentId);
}
async function recordPayment(admin:any,row:any,p:any,sellerId:string){
 return await recordAdsCreditPayment(admin,p,{paymentId:String(row.provider_payment_id||p.id),
  reference:row.external_reference,amount:row.amount_cents,sellerId});
}
// When the PSP settles first, account for the payment without requiring a still-payable QR.
async function handlePayment(admin:any,row:any,p:any,sellerId:string){
 if(p.status!=="pending"||Date.parse(String(p.date_of_expiration||""))<=Date.now()+60000){
  const fact=await recordPayment(admin,row,p,sellerId);
  return {status:fact.status,topupId:row.id,amountCents:row.amount_cents};
 }
 const proof=adsPixProof(p,row,sellerId);
 const attached=await rpc(admin,"ads_credit_topup_attach_v1_1097",{
  p_owner:row.owner_user_id,p_topup:row.id,p_payment:proof.id,
  p_collector:proof.collector,p_code:proof.code,p_expires:proof.expiresAt});
 return {status:attached.status,topupId:row.id,amountCents:row.amount_cents,
  pixCode:attached.pixCode,expiresAt:attached.expiresAt};
}
async function recoverPayment(admin:any,row:any,token:string,sellerId:string){
 const payment=row.provider_payment_id?await getPayment(token,row.provider_payment_id):
  await providerSearch(token,row.external_reference);
 if(payment)return await handlePayment(admin,row,payment,sellerId);
 const closed=await rpc(admin,"ads_credit_close_unissued_v1_1101",{
  p_owner:row.owner_user_id,p_topup:row.id});
 return {status:closed.status,topupId:row.id,amountCents:row.amount_cents};
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
  if(!["mine","topup","reconcile","campaign-submit","campaign-owner",
      "admin-read","admin-action","admin-pilot-read","admin-pilot-prepare"].includes(action))
   return respond({error:"UNKNOWN_ACTION"},400,origin);
  const pilot=action==="admin-pilot-prepare";
  if((pilot||action==="admin-pilot-read")&&origin!=="https://admin.tamao.com.br")
   return respond({error:"ADMIN_ORIGIN_REQUIRED"},403,origin);
  const user=await sessionUser(req);
  if(!user)return respond({error:"VERIFIED_ACCOUNT_REQUIRED"},401,origin);
  const admin=createClient(URL_BASE,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
  await enforceApiQuota(admin,{userId:user.id,actionName:"ads-credit-"+action,
    limit:action==="mine"?120:(action==="admin-read"||action==="admin-pilot-read")?120:action==="campaign-owner"?35:8,
    windowSeconds:3600});
  if(action==="mine"){
   const [data,campaigns]=await Promise.all([
    rpc(admin,"ads_credit_balance_v1_1097",{p_owner:user.id}),
    rpc(admin,"ads_credit_campaigns_mine_v1_1098",{p_owner:user.id})
   ]);
   return respond({...data,campaigns:campaigns.rows},200,origin);
  }
  if(action==="campaign-submit"){
   const request=String(body.requestId||"");
   const advertiser=clean(body.advertiser,120),title=clean(body.title,80),
    description=clean(body.description,240),city=clean(body.city,100),
    state=clean(body.state,2).toUpperCase();
   const destination=String(body.destination||"").trim();
   if(!UUID.test(request)||advertiser.length<2||title.length<12||
    description.length<20||city.length<2||!STATES.has(state)||
    !safeDestination(destination)||body.acceptCampaignTerms!==true)
    return respond({error:"ADS_CREDIT_CREATIVE_INVALID",
     message:"Confira empresa, mensagem, cidade, destino HTTPS e aceite."},400,origin);
   const data=await rpc(admin,"ads_credit_campaign_submit_v1_1098",{
    p_owner:user.id,p_request:request,p_advertiser:advertiser,p_title:title,
    p_description:description,p_city:city,p_state:state,p_destination:destination
   });
   return respond(data,200,origin);
  }
  if(action==="campaign-owner"){
   const id=String(body.campaignId||""),version=Number(body.version),
    choice=String(body.decision||"");
   if(!UUID.test(id)||!Number.isSafeInteger(version)||version<1||
    !["pause","resume"].includes(choice))
    return respond({error:"ADS_CREDIT_ACTION_INVALID"},400,origin);
   const data=await rpc(admin,"ads_credit_campaign_owner_action_v1_1098",{
    p_owner:user.id,p_campaign:id,p_expected_version:version,p_action:choice
   });
   return respond(data,200,origin);
  }
  if(action==="admin-read"||action==="admin-action"){
   if(action==="admin-read"){
    const data=await rpc(admin,"ads_credit_admin_read_v1_1098",{p_actor:user.id});
    return respond(data,200,origin);
   }
   const id=String(body.campaignId||""),version=Number(body.version),
    choice=String(body.decision||""),reason=clean(body.reason,500);
   if(!UUID.test(id)||!Number.isSafeInteger(version)||version<1||
    !["approve","reject","publish","pause","resume","end"].includes(choice)||
    reason.length<12)
    return respond({error:"ADS_CREDIT_ADMIN_ACTION_INVALID"},400,origin);
   const data=await rpc(admin,"ads_credit_admin_action_v1_1098",{
    p_actor:user.id,p_campaign:id,p_expected_version:version,
    p_action:choice,p_reason:reason
   });
   return respond(data,200,origin);
  }
  if(action==="admin-pilot-read"){
   const data=await rpc(admin,"admin_ads_credit_pilot_v1_1101",{p_actor:user.id,p_operation:"read",p_previous:null});
   if(data.status==="other_owner")return respond(data,200,origin);
   const readiness=await independentAdsProviderReadiness((key:string)=>Deno.env.get(key));
   return respond({...data,providerReady:readiness.readyForFinancialHomologation===true},200,origin);
  }
  if(pilot&&(body.acceptPilotTerms!==true||
    (body.previousTopup!=null&&!UUID.test(String(body.previousTopup)))))
   return respond({error:"PILOT_CONFIRMATION_REQUIRED"},400,origin);
  if(pilot){
   const read=await rpc(admin,"admin_ads_credit_pilot_v1_1101",{p_actor:user.id,p_operation:"read",p_previous:null});
   if(read.status==="other_owner"||(!read.topupId&&read.canStart!==true))
    return respond({error:"ADS_CREDIT_PILOT_UNAVAILABLE",message:"Consulte a homologação no painel."},409,origin);
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
   const recovered=await recoverPayment(admin,row,token,sellerId);
   return respond({...recovered,source:"ads_credit_payment_fact_v1_1097"},200,origin);
  }
  let requestId=String(body.requestId||"");
  const amount=pilot?1990:Number(body.amountCents);
  if(!pilot&&(!UUID.test(requestId)||!Number.isSafeInteger(amount)||!PRICE_OPTIONS.has(amount)||
    body.acceptCreditTerms!==true))
   return respond({error:"TOPUP_REQUEST_INVALID"},400,origin);
  const reserved=pilot?await rpc(admin,"admin_ads_credit_pilot_v1_1101",{
   p_actor:user.id,p_operation:"prepare",p_previous:body.previousTopup??null
  }):await rpc(admin,"ads_credit_topup_reserve_v1_1097",{
   p_owner:user.id,p_request:requestId,p_amount:amount});
  if(pilot){
   if(!reserved.topupId||!UUID.test(String(reserved.requestId)))
    return respond({error:"ADS_CREDIT_PILOT_UNAVAILABLE",message:"Consulte a homologação no painel."},409,origin);
   requestId=reserved.requestId;
  }
  const {data:row,error}=await admin.from("ads_credit_topups_v1_1097")
   .select("*").eq("id",reserved.topupId).eq("owner_user_id",user.id).maybeSingle();
  if(error||!row||row.external_reference!==reserved.externalReference||
    row.request_id!==requestId||row.amount_cents!==amount||(pilot&&row.admin_pilot!==true))throw Error("ADS_CREDIT_RESERVATION_MISMATCH");
  const result=(data:any,reused=true)=>respond({...data,source:"ads_credit_topup_v1_1097",reused},200,origin);
  if(["approved","reversed","review_required","unpaid","closed_unissued"].includes(row.status))
   return result({status:row.status,topupId:row.id,amountCents:amount});
  if(row.status==="pix_pending"&&Date.parse(String(row.pix_expires_at))>Date.now()+60000)
   return result({status:row.status,topupId:row.id,amountCents:amount,pixCode:row.pix_code,
    expiresAt:row.pix_expires_at});
  const expiry=Date.parse(row.created_at)+86400000;
  if(row.status!=="reserved"||!Number.isFinite(expiry)||expiry<=Date.now()+60000)
   return result(await recoverPayment(admin,row,token,sellerId));
  // Look up the unique reference before claiming the one permitted POST. A read
  // outage therefore leaves a retryable reservation, not a stranded charge.
  if(typeof user.email!=="string"||!/^\S+@\S+\.\S+$/.test(user.email))
   return respond({error:"VERIFIED_EMAIL_REQUIRED"},401,origin);
  let payment=await providerSearch(token,row.external_reference);
  const claim=await rpc(admin,"ads_credit_topup_claim_v1_1097",{
   p_owner:user.id,p_topup:row.id});
  if(claim.canCreate!==true)
   return result({status:claim.status,topupId:row.id,amountCents:amount});
  if(!payment){
   const expiresAt=new Date(expiry).toISOString();
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
  return result(await handlePayment(admin,row,payment,sellerId),false);
 }catch(e){
  const message=String((e as any)?.message||"");
  if(message.includes("ADS_CREDIT_PILOT_DENIED"))
   return respond({error:"ADS_CREDIT_PILOT_DENIED"},403,origin);
  if(message.includes("ADS_CREDIT_RECHARGE_DISABLED"))
   return respond({error:"ADS_CREDIT_RECHARGE_DISABLED",
    message:"As novas recargas aguardam validação financeira."},409,origin);
  if(message.includes("ADS_CREDIT_PENDING_TOPUP_EXISTS")||message.includes("ADS_CREDIT_MULTIPLE_PROVIDER_PAYMENTS"))
   return respond({error:"ADS_CREDIT_PAYMENT_PENDING",
    message:"Há uma recarga em conferência. Consulte o histórico antes de emitir outro Pix."},409,origin);
  console.error("ads-credit payment",e instanceof Error?e.name:"unknown");
  return respond({error:"ADS_CREDIT_OPERATION_UNAVAILABLE",
   message:"Não foi possível confirmar a operação. Consulte o saldo antes de tentar novamente."},503,origin);
 }
});
