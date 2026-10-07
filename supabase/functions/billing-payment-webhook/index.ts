import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { sha256Hex } from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MAX_BODY_BYTES=16384;
const MAX_SKEW_SECONDS=300;
const PROVIDER_RE=/^[a-z0-9][a-z0-9._-]{1,39}$/;
const ID_RE=/^[^\u0000-\u001f\u007f]{6,160}$/;

function response(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store"
    }
  });
}
function webhookSecrets(){
  try{
    const parsed=JSON.parse(Deno.env.get("BILLING_PAYMENT_WEBHOOK_SECRETS")??"{}");
    return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};
  }catch{
    return {};
  }
}
function cleanSignature(value:string|null){
  const raw=String(value??"").trim().toLowerCase();
  const hex=raw.startsWith("sha256=")?raw.slice(7):raw;
  return /^[0-9a-f]{64}$/.test(hex)?hex:null;
}
function constantTimeEqualHex(a:string,b:string){
  if(a.length!==b.length)return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function hmacSha256Hex(secret:string,message:string){
  const key=await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},
    false,
    ["sign"]
  );
  const signed=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));
  return [...new Uint8Array(signed)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function positiveSafeInteger(value:unknown){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
}
function parseIsoTimestamp(value:unknown){
  const raw=String(value??"").trim();
  if(!raw||!Number.isFinite(Date.parse(raw)))return null;
  return new Date(raw).toISOString();
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return response({error:"METHOD_NOT_ALLOWED"},405);

  const provider=String(req.headers.get("x-tamao-provider")??"").trim().toLowerCase();
  const providerEventId=String(req.headers.get("x-tamao-event-id")??"").trim();
  const timestampRaw=String(req.headers.get("x-tamao-timestamp")??"").trim();
  const signature=cleanSignature(req.headers.get("x-tamao-signature"));

  if(!PROVIDER_RE.test(provider)||!ID_RE.test(providerEventId)){
    return response({error:"INVALID_WEBHOOK_IDENTITY"},400);
  }

  const timestamp=Number(timestampRaw);
  const nowSeconds=Math.floor(Date.now()/1000);
  if(!Number.isInteger(timestamp)||Math.abs(nowSeconds-timestamp)>MAX_SKEW_SECONDS){
    return response({error:"STALE_WEBHOOK"},401);
  }

  const secrets=webhookSecrets() as Record<string,string>;
  const secret=String(
    secrets[provider]
      ??(provider==="generic"?Deno.env.get("BILLING_PAYMENT_WEBHOOK_SECRET")??"":"")
  );
  if(secret.length<24){
    return response({error:"WEBHOOK_PROVIDER_NOT_CONFIGURED"},503);
  }
  if(!signature)return response({error:"INVALID_WEBHOOK_SIGNATURE"},401);

  const declared=Number(req.headers.get("content-length")??0);
  if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES){
    return response({error:"PAYLOAD_TOO_LARGE"},413);
  }

  const rawBody=await req.text();
  if(new TextEncoder().encode(rawBody).byteLength>MAX_BODY_BYTES){
    return response({error:"PAYLOAD_TOO_LARGE"},413);
  }

  const canonical=provider+"\n"+providerEventId+"\n"+timestampRaw+"\n"+rawBody;
  const expected=await hmacSha256Hex(secret,canonical);
  if(!constantTimeEqualHex(signature,expected)){
    return response({error:"INVALID_WEBHOOK_SIGNATURE"},401);
  }

  let body:any;
  try{
    body=JSON.parse(rawBody);
  }catch{
    return response({error:"INVALID_JSON"},400);
  }
  if(!body||typeof body!=="object"||Array.isArray(body)){
    return response({error:"INVALID_JSON"},400);
  }

  const reconciliationKey=String(body.reconciliationKey??"").trim();
  const paymentMethod=String(body.paymentMethod??"").trim().toLowerCase();
  const amountCents=positiveSafeInteger(body.amountCents);
  const currency=String(body.currency??"BRL").trim().toUpperCase();
  const occurredAt=parseIsoTimestamp(body.occurredAt);
  const payerReference=body.payerReference==null?null:String(body.payerReference).trim();

  if(!ID_RE.test(reconciliationKey)
     ||!["pix","bank_transfer","cash","card","other"].includes(paymentMethod)
     ||amountCents==null
     ||currency!=="BRL"
     ||!occurredAt
     ||(payerReference!=null&&payerReference.length>240)){
    return response({error:"INVALID_PAYMENT_EVENT"},400);
  }

  const payloadHash=await sha256Hex(rawBody);
  const admin=createClient(SUPABASE_URL,SECRET_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data,error}=await admin.rpc("ingest_merchant_billing_payment_event",{
    p_provider:provider,
    p_provider_event_id:providerEventId,
    p_reconciliation_key:reconciliationKey,
    p_payment_method:paymentMethod,
    p_amount_cents:amountCents,
    p_currency:currency,
    p_occurred_at:occurredAt,
    p_raw_payload_sha256:payloadHash,
    p_payer_reference:payerReference||null
  });

  if(error){
    const message=String(error.message??error);
    if(message.includes("PAYMENT_EVENT_IDEMPOTENCY_CONFLICT")){
      return response({error:"PAYMENT_EVENT_IDEMPOTENCY_CONFLICT"},409);
    }
    if(message.includes("INVALID_PAYMENT_")||message.includes("UNSUPPORTED_PAYMENT_EVENT_")){
      return response({error:"INVALID_PAYMENT_EVENT"},400);
    }
    console.error("billing-payment-webhook ingest failed",message);
    return response({error:"PAYMENT_EVENT_INGEST_FAILED"},503);
  }

  return response({ok:true,...(data??{})},202);
});
