import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  mercadoPagoFetch,readMercadoPagoJson,moneyToCents,
  verifyMercadoPagoWebhook
} from "../_shared/mercadopago.js";

// TAMÃO V1.316: signed, provider-verified Ads event INBOX ONLY.
// This endpoint never writes into payment-approval ledgers, creates a charge,
// sends notifications to customers or publishes advertising.
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SERVICE_KEY=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MAX_BODY=16384;

function json(payload:unknown,status=200){
 return new Response(JSON.stringify(payload),{status,headers:{
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store"
 }});
}
function recentTimestamp(value:string){
 if(!/^\d{10,13}$/.test(value))return false;
 const n=Number(value);
 const ms=value.length===13?n:n*1000;
 return Number.isSafeInteger(ms)&&Math.abs(Date.now()-ms)<=15*60*1000;
}
async function digest(value:string){
 const bytes=new TextEncoder().encode(value);
 const hash=await crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
 const token=String(Deno.env.get("ADS_MP_ACCESS_TOKEN")||"").trim();
 const sellerId=String(Deno.env.get("ADS_MP_SELLER_ID")||"").trim();
 const signatureSecret=String(Deno.env.get("ADS_MP_WEBHOOK_SECRET")||"").trim();
 if(Deno.env.get("ADS_MP_WEBHOOK_ENABLED")!=="true"||
   !/^APP_USR-[^\s]{20,}$/.test(token)||
   !/^[0-9]{4,20}$/.test(sellerId)||
   signatureSecret.length<16||!SERVICE_KEY||!SUPABASE_URL)
  return json({error:"ADS_WEBHOOK_NOT_CONFIGURED"},503);
 const length=Number(req.headers.get("content-length")||0);
 if(!Number.isFinite(length)||length>MAX_BODY)return json({error:"PAYLOAD_TOO_LARGE"},413);
 const contentType=String(req.headers.get("content-type")||"");
 if(!contentType.toLowerCase().startsWith("application/json"))
  return json({error:"CONTENT_TYPE_INVALID"},415);
 let body:any;
 try{
  const raw=await req.text();
  if(new TextEncoder().encode(raw).byteLength>MAX_BODY)return json({error:"PAYLOAD_TOO_LARGE"},413);
  body=JSON.parse(raw);
 }catch{return json({error:"BAD_REQUEST"},400);}
 const url=new URL(req.url);
 const queryId=String(url.searchParams.get("data.id")||"").trim();
 const id=String(body?.data?.id??"").trim();
 const paymentId=id||queryId;
 if(!/^[0-9]{5,30}$/.test(paymentId)||(queryId&&id&&queryId!==id))
  return json({error:"PAYMENT_ID_INVALID"},400);
 const topic=String(body?.type||"").toLowerCase();
 const action=String(body?.action||"").toLowerCase();
 if(topic!=="payment"&&!action.startsWith("payment."))
  return json({ok:true,recorded:false,reason:"not_payment"});
 const header=String(req.headers.get("x-signature")||"");
 const ts=header.split(",").map(x=>x.trim()).find(x=>x.startsWith("ts="))?.slice(3)||"";
 if(!recentTimestamp(ts))return json({error:"WEBHOOK_TIMESTAMP_INVALID"},401);
 const valid=await verifyMercadoPagoWebhook(req,signatureSecret,paymentId);
 if(!valid)return json({error:"WEBHOOK_SIGNATURE_INVALID"},401);
 const requestId=String(req.headers.get("x-request-id")||"");
 if(!requestId||requestId.length>180)return json({error:"WEBHOOK_REQUEST_INVALID"},401);
 try{
  const response=await mercadoPagoFetch("/v1/payments/"+paymentId,{accessToken:token});
  if(!response.ok)return json({error:"PROVIDER_LOOKUP_UNAVAILABLE"},503);
  const payment=await readMercadoPagoJson(response);
  const amount=moneyToCents(payment?.transaction_amount);
  const collectorId=String(payment?.collector_id??payment?.collector?.id??"");
  const reference=String(payment?.external_reference||"");
  const currency=String(payment?.currency_id||"");
  const providerStatus=String(payment?.status||"");
  const detail=String(payment?.status_detail||"");
  if(String(payment?.id||"")!==paymentId||
    collectorId!==sellerId||
    !/^tamao-ads-[0-9a-f]{32}-v[0-9]+$/.test(reference)||
    currency!=="BRL"||!Number.isSafeInteger(amount)||
    amount<1000||amount>5000000||
    providerStatus.length<3||providerStatus.length>48||detail.length>120)
   return json({error:"ADS_PROVIDER_EVIDENCE_INVALID"},403);
  const client=createClient(SUPABASE_URL,SERVICE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const eventKey=await digest(requestId+"|"+paymentId);
  const {data,error}=await client.rpc("ads_mp_inbox_record_v1_316",{
    p_event_key:eventKey,p_payment_id:paymentId,
    p_external_reference:reference,p_collector_id:collectorId,
    p_amount_cents:amount,p_currency:currency,
    p_provider_status:providerStatus,
    p_status_detail:detail||null
  });
  if(error)throw error;
  if(data?.source!=="ads_mp_inbox_v1_316"||
    data.paymentApproved!==false||data.adsLive!==false||
    data.automaticReconciliation!==false)
   return json({error:"ADS_INBOX_RECORD_UNVERIFIED"},503);
  return json({ok:true,received:true,recorded:data.recorded===true,
    paymentApproved:false,automaticReconciliation:false});
 }catch{
  return json({error:"ADS_INBOX_TEMPORARILY_UNAVAILABLE"},503);
 }
});
