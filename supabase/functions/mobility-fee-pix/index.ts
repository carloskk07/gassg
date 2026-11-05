import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {DomainError,enforceApiQuota} from "../_shared/domain.js";
import {validatePixBrCode} from "../_shared/pix-brcode.js";
import {
 mercadoPagoConfigured,mercadoPagoFetch,readMercadoPagoJson,
 mercadoPagoPixDeadline,mercadoPagoQrDataUri,
 moneyToCents,safeMercadoPagoUrl
} from "../_shared/mercadopago.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const pub=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const sec=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=pub.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=sec.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGINS=new Set(["https://tamao.com.br","https://tamao-sg-cliente.pages.dev"]);
const TOKEN=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
function originAllowed(origin:string|null){
 return !origin||ORIGINS.has(origin)||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(origin:string|null){
 return {"Access-Control-Allow-Origin":origin&&originAllowed(origin)?origin:"https://tamao.com.br",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
}
function reply(data:unknown,status=200,origin:string|null=null){
 return new Response(JSON.stringify(data),{status,headers:{
  ...cors(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
function paymentOf(order:any){
 const candidates=Array.isArray(order?.transactions?.payments)?order.transactions.payments:[];
 return candidates.find((p:any)=>p?.payment_method?.id==="pix"&&
   p?.payment_method?.type==="bank_transfer")??candidates[0]??null;
}
function checkedOrder(order:any,invoice:any,allowPaid=false){
 const orderId=String(order?.id??""),payment=paymentOf(order);
 const paymentId=String(payment?.id??"");
 const amount=Number(invoice.amount_cents);
 const state=String(order?.status??"").toLowerCase();
 const pstate=String(payment?.status??"").toLowerCase();
 if(!orderId||order?.live_mode===false||payment?.live_mode===false
  ||order?.external_reference!==invoice.external_reference
  ||moneyToCents(order?.total_amount)!==amount
  ||moneyToCents(payment?.amount)!==amount
  ||(order?.currency_id&&order.currency_id!=="BRL")
  ||(order?.currency&&order.currency!=="BRL")
  ||payment?.payment_method?.id!=="pix"
  ||payment?.payment_method?.type!=="bank_transfer"
  ||!paymentId||paymentId.length>200){
  throw new DomainError("MOBILITY_PIX_ORDER_BINDING_FAILED",
   "Não foi possível validar o Pix com o Mercado Pago.",409);
 }
 if(invoice.provider_order_id&&invoice.provider_order_id!==orderId
  ||invoice.provider_payment_id&&invoice.provider_payment_id!==paymentId){
  throw new DomainError("MOBILITY_PIX_ORDER_CHANGED",
   "Cobrança Pix diverge da referência original.",409);
 }
 const adverse=["refunded","partially_refunded","chargeback","charged_back",
  "disputed","in_mediation","canceled","cancelled","failed"];
 const refund=Array.isArray(order?.transactions?.refunds)&&order.transactions.refunds.length>0;
 const abnormal=refund||[state,pstate,
  String(order?.status_detail??"").toLowerCase(),
  String(payment?.status_detail??"").toLowerCase()].some(x=>adverse.includes(x));
 if(!allowPaid&&(abnormal||state==="processed"||pstate==="processed")){
  throw new DomainError("MOBILITY_PIX_NOT_PAYABLE",
   "O Pix não está mais disponível para pagamento.",409);
 }
 return {payment,orderId,paymentId,state,pstate,abnormal,amount};
}
async function lookup(orderId:string){
 const r=await mercadoPagoFetch("/v1/orders/"+encodeURIComponent(orderId),
  {accessToken:TOKEN});
 const data=await readMercadoPagoJson(r);
 if(!r.ok)throw new DomainError("MOBILITY_PSP_LOOKUP_FAILED",
  "Não foi possível conferir o Pix com o Mercado Pago.",503);
 return data;
}
async function reconcile(admin:any,invoice:any){
 if(!invoice.provider_order_id)return invoice;
 const order=await lookup(invoice.provider_order_id);
 const proof=checkedOrder(order,invoice,true);
 const payment=proof.payment;
 const detail=[order?.status_detail,payment?.status_detail]
  .map(x=>String(x??"").toLowerCase());
 const paid=!proof.abnormal&&proof.state==="processed"&&proof.pstate==="processed"
  &&detail.every(x=>!x||x==="accredited");
 const expired=!paid&&!proof.abnormal&&
  (proof.state==="expired"||proof.pstate==="expired");
 const eventState=proof.abnormal?"review_required":paid?"paid":expired?"expired":null;
 if(eventState){
  // Stable evidence only: no user-supplied status, amount, e2e or beneficiary.
  const body=JSON.stringify({
   orderId:proof.orderId,paymentId:proof.paymentId,
   amountCents:proof.amount,state:eventState,
   externalReference:invoice.external_reference});
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body)));
  const hash=[...digest].map(x=>x.toString(16).padStart(2,"0")).join("");
  const {error}=await admin.rpc("mobility_fee_pix_apply_proof_v1_837",{
   p_invoice:invoice.id,p_order:proof.orderId,p_payment:proof.paymentId,
   p_amount_cents:proof.amount,p_state:eventState,p_evidence_sha256:hash
  });
  if(error)throw error;
  const next=await admin.from("mobility_fee_pix_invoices_v1_837")
   .select("id,driver_id,amount_cents,status,external_reference,provider_order_id,provider_payment_id,pix_br_code,pix_qr_data_uri,payment_link_url,expires_at,created_at")
   .eq("id",invoice.id).single();
  if(next.error)throw next.error;
  return next.data;
 }
 return invoice;
}
function publicInvoice(invoice:any){
 const status=String(invoice.status??"");
 const canPay=status==="active"&&Date.parse(String(invoice.expires_at??""))>Date.now()+60000;
 const code=String(invoice.pix_br_code??"");
 if(canPay&&(!code||!validatePixBrCode(code,{expectedAmountCents:invoice.amount_cents}).valid)){
  throw new DomainError("MOBILITY_PIX_STORED_CODE_INVALID",
   "Pix indisponível: solicite conferência antes de pagar.",409);
 }
 const img=String(invoice.pix_qr_data_uri??"");
 return {invoiceId:invoice.id,status:status==="active"&&!canPay?"expired":status,
  amountCents:invoice.amount_cents,
  brCode:canPay?code:null,
  qrDataUri:canPay&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img)
    &&img.length<550100?img:null,
  paymentLinkUrl:canPay?safeMercadoPagoUrl(invoice.payment_link_url):null,
  expiresAt:invoice.expires_at??null,
  paidByProvider:status==="paid"};
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin");
 if(!originAllowed(origin))return reply({error:"ORIGIN_NOT_ALLOWED"},403,origin);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
 if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405,origin);
 try{
  const auth=String(req.headers.get("authorization")??"");
  if(!auth.startsWith("Bearer "))throw new DomainError("UNAUTHORIZED","Entre na sua conta.",401);
  const jwt=auth.slice(7);
  const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{
   auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data:{user},error}=await client.auth.getUser(jwt);
  if(error||!user||user.is_anonymous===true)throw new DomainError(
   "UNAUTHORIZED","Conta permanente autenticada obrigatória.",401);
  const len=Number(req.headers.get("content-length")??0);
  if(len>2048)throw new DomainError("REQUEST_TOO_LARGE","Solicitação inválida.",413);
  const raw=await req.text();
  if(new TextEncoder().encode(raw).length>2048)throw new DomainError(
   "REQUEST_TOO_LARGE","Solicitação inválida.",413);
  let body:any;
  try{body=raw?JSON.parse(raw):{}}catch{throw new DomainError("INVALID_JSON","Solicitação inválida.",400)}
  if(!body||!["charge","status"].includes(body.action)){
   throw new DomainError("INVALID_ACTION","Ação financeira inválida.",400);
  }
  const admin=createClient(SUPABASE_URL,SECRET_KEY,{
   auth:{persistSession:false,autoRefreshToken:false}
  });
  await enforceApiQuota(admin,{userId:user.id,actionName:"mobility-fee-pix",
   limit:15,windowSeconds:60});
  const latest=await admin.from("mobility_fee_pix_invoices_v1_837")
   .select("id,driver_id,amount_cents,status,external_reference,provider_order_id,provider_payment_id,pix_br_code,pix_qr_data_uri,payment_link_url,expires_at,created_at")
   .eq("driver_id",user.id).order("created_at",{ascending:false})
   .limit(1).maybeSingle();
  if(latest.error)throw latest.error;
  if(!mercadoPagoConfigured(TOKEN)){
   throw new DomainError("MOBILITY_MP_NOT_READY",
    "O pagamento de taxas está temporariamente indisponível.",503);
  }
  // Confirm every ACTIVE Pix against the provider, not a stale QR in the DB.
  if(body.action==="status"){
   if(!latest.data)return reply({ok:true,charge:null},200,origin);
   const invoice=latest.data.provider_order_id?
     await reconcile(admin,latest.data):latest.data;
   return reply({ok:true,charge:publicInvoice(invoice)},200,origin);
  }
  const prepared=await admin.rpc("mobility_fee_pix_prepare_v1_837",{p_driver:user.id});
  if(prepared.error)throw prepared.error;
  if(prepared.data?.status==="below_minimum"){
   return reply({ok:true,status:"below_minimum",
    amountCents:prepared.data.amountCents,minCents:100},200,origin);
  }
  const id=String(prepared.data?.invoiceId??"");
  if(!UUID.test(id))throw new DomainError("MOBILITY_FEE_PREPARE_INVALID",
   "Não foi possível preparar a cobrança.",503);
  const current=await admin.from("mobility_fee_pix_invoices_v1_837")
   .select("id,driver_id,amount_cents,status,external_reference,provider_order_id,provider_payment_id,pix_br_code,pix_qr_data_uri,payment_link_url,expires_at,created_at")
   .eq("id",id).eq("driver_id",user.id).single();
  if(current.error)throw current.error;
  const invoice=current.data;
  if(invoice.status!=="prepared"){
   const reconciled=invoice.provider_order_id?await reconcile(admin,invoice):invoice;
   return reply({ok:true,charge:publicInvoice(reconciled)},200,origin);
  }
  const email=String(user.email??"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new DomainError(
   "MOBILITY_PAYER_EMAIL_REQUIRED","Atualize o e-mail da conta antes de gerar Pix.",409);
  const amount=(Number(invoice.amount_cents)/100).toFixed(2);
  const response=await mercadoPagoFetch("/v1/orders",{
   accessToken:TOKEN,method:"POST",idempotencyKey:invoice.id,
   body:{type:"online",total_amount:amount,
     external_reference:invoice.external_reference,
     processing_mode:"automatic",
     transactions:{payments:[{amount,payment_method:{id:"pix",type:"bank_transfer"},
       expiration_time:"P1D"}]},payer:{email}}
  });
  if(!response.ok)throw new DomainError("MOBILITY_MP_ORDER_FAILED",
   "O Mercado Pago não conseguiu gerar o Pix. Repetir a solicitação não duplica a cobrança.",503);
  let order=await readMercadoPagoJson(response);
  let proof=checkedOrder(order,invoice);
  let code=String(proof.payment?.payment_method?.qr_code??"");
  if(!code){
   for(let i=0;i<3&&!code;i++){
    await new Promise(resolve=>setTimeout(resolve,250*(i+1)));
    order=await lookup(proof.orderId);
    proof=checkedOrder(order,invoice);
    code=String(proof.payment?.payment_method?.qr_code??"");
   }
  }
  if(!code||!validatePixBrCode(code,{expectedAmountCents:invoice.amount_cents}).valid)
   throw new DomainError("MOBILITY_MP_PIX_CODE_INVALID",
    "O Mercado Pago não devolveu um Pix válido para este valor.",503);
  const expiry=mercadoPagoPixDeadline(order,proof.payment,invoice.created_at);
  if(!expiry)throw new DomainError("MOBILITY_MP_PIX_EXPIRED",
   "A cobrança não possui validade verificável.",409);
  const image=mercadoPagoQrDataUri(proof.payment?.payment_method?.qr_code_base64);
  const link=safeMercadoPagoUrl(proof.payment?.payment_method?.ticket_url);
  const saved=await admin.rpc("mobility_fee_pix_commit_v1_837",{
   p_invoice:invoice.id,p_driver:user.id,p_order:proof.orderId,
   p_payment:proof.paymentId,p_br_code:code,p_qr_image:image,
   p_link_url:link,p_expires:expiry
  });
  if(saved.error)throw saved.error;
  const {data:final,error:readErr}=await admin.from("mobility_fee_pix_invoices_v1_837")
   .select("id,driver_id,amount_cents,status,external_reference,provider_order_id,provider_payment_id,pix_br_code,pix_qr_data_uri,payment_link_url,expires_at,created_at")
   .eq("id",invoice.id).eq("driver_id",user.id).single();
  if(readErr)throw readErr;
  return reply({ok:true,charge:publicInvoice(final)},200,origin);
 }catch(error){
  const known=error instanceof DomainError;
  const status=known?error.status:503;
  console.error("MOBILITY_FEE_PIX_ERROR",known?error.code:
   (error instanceof Error?error.name:"unknown"));
  return reply({error:known?error.code:"MOBILITY_FEE_PIX_UNAVAILABLE",
    message:known?error.message:"Não foi possível confirmar o Pix no provedor. Atualize antes de repetir."},
   status,origin);
 }
});
