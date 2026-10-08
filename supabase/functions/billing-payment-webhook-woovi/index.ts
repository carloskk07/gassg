import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { sha256Hex } from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";

const WOOVI_PUBLIC_KEYS_URL="https://api.woovi.com/api/v1/webhook/public-keys";
const MAX_BODY_BYTES=65536;
const PUBLIC_KEY_FETCH_TIMEOUT_MS=3500;
const PUBLIC_KEY_CACHE_MS=55*60*1000;
const E2E_RE=/^[A-Za-z0-9]{20,80}$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cachedPublicKeys:CryptoKey[]=[];
let publicKeysExpiresAt=0;

function response(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store"
    }
  });
}
function constantTimeEqual(a:string,b:string){
  if(a.length!==b.length)return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
function base64Bytes(value:string){
  const clean=value.trim().replace(/\s+/g,"");
  if(!clean||clean.length>4096)return null;
  try{
    const binary=atob(clean);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return bytes;
  }catch{
    return null;
  }
}
function pemSpkiBytes(pem:string){
  const base64=pem
    .replace(/-----BEGIN PUBLIC KEY-----/g,"")
    .replace(/-----END PUBLIC KEY-----/g,"")
    .replace(/\s+/g,"");
  return base64Bytes(base64);
}
async function importWooviPublicKey(pem:string){
  const der=pemSpkiBytes(pem);
  if(!der)throw new Error("INVALID_WOOVI_PUBLIC_KEY");
  return await crypto.subtle.importKey(
    "spki",
    der,
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},
    false,
    ["verify"]
  );
}
async function wooviPublicKeys(){
  const now=Date.now();
  if(cachedPublicKeys.length&&now<publicKeysExpiresAt){
    return cachedPublicKeys;
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),PUBLIC_KEY_FETCH_TIMEOUT_MS);
  try{
    const res=await fetch(WOOVI_PUBLIC_KEYS_URL,{
      headers:{"Accept":"application/json","Cache-Control":"no-cache"},
      signal:controller.signal
    });
    if(!res.ok)throw new Error("WOOVI_PUBLIC_KEYS_HTTP_"+res.status);
    const body=await res.json();
    const entries=Array.isArray(body?.public_keys)?body.public_keys:[];
    const imported:CryptoKey[]=[];
    for(const entry of entries){
      const pem=String(entry?.key??"");
      if(!pem.includes("BEGIN PUBLIC KEY"))continue;
      imported.push(await importWooviPublicKey(pem));
    }
    if(!imported.length)throw new Error("WOOVI_PUBLIC_KEYS_EMPTY");
    cachedPublicKeys=imported;
    publicKeysExpiresAt=now+PUBLIC_KEY_CACHE_MS;
    return cachedPublicKeys;
  }catch(error){
    if(cachedPublicKeys.length)return cachedPublicKeys;
    throw error;
  }finally{
    clearTimeout(timer);
  }
}
async function verifyWooviSignature(rawBody:string,signature:string){
  const signatureBytes=base64Bytes(signature);
  if(!signatureBytes)return false;
  const rawBytes=new TextEncoder().encode(rawBody);
  const keys=await wooviPublicKeys();
  for(const key of keys){
    const valid=await crypto.subtle.verify(
      {name:"RSASSA-PKCS1-v1_5"},
      key,
      signatureBytes,
      rawBytes
    );
    if(valid)return true;
  }
  return false;
}
function parseIsoTimestamp(value:unknown){
  const raw=String(value??"").trim();
  if(!raw||!Number.isFinite(Date.parse(raw)))return null;
  return new Date(raw).toISOString();
}
function positiveSafeInteger(value:unknown){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
}
function safePayerName(value:unknown){
  const raw=String(value??"").trim().replace(/\s+/g," ");
  if(!raw||raw.length>120||/[\u0000-\u001f\u007f]/.test(raw))return null;
  return raw;
}

async function retireWooviSiblingCharges(admin:any,paidCorrelationId:string){
  const {data:paidCharge,error:paidError}=await admin
    .from("merchant_billing_provider_charges")
    .select("id,payment_request_id")
    .eq("provider","woovi")
    .eq("correlation_id",paidCorrelationId)
    .maybeSingle();

  if(paidError||!paidCharge?.payment_request_id){
    if(paidError)console.error("woovi paid charge lookup failed",String(paidError.message??paidError));
    return {attempted:0,cancelled:0,failed:0};
  }

  const {data:siblings,error:siblingError}=await admin
    .from("merchant_billing_provider_charges")
    .select("id,correlation_id")
    .eq("provider","woovi")
    .eq("payment_request_id",paidCharge.payment_request_id)
    .eq("status","cancelled")
    .eq("last_error_code","PROVIDER_CANCEL_REQUIRED")
    .neq("id",paidCharge.id)
    .limit(5);

  if(siblingError){
    console.error("woovi sibling charge lookup failed",String(siblingError.message??siblingError));
    return {attempted:0,cancelled:0,failed:0};
  }

  const rows=siblings??[];
  if(!rows.length)return {attempted:0,cancelled:0,failed:0};

  const appId=String(Deno.env.get("WOOVI_APP_ID")??"").trim();
  const apiBase=String(
    Deno.env.get("WOOVI_API_BASE_URL")??"https://api.woovi.com"
  ).trim().replace(/\/$/,"");
  const allowedBases=new Set([
    "https://api.woovi.com",
    "https://api.woovi-sandbox.com"
  ]);
  let cancelled=0;
  let failed=0;

  for(const sibling of rows){
    let ok=false;
    if(appId.length>=12&&allowedBases.has(apiBase)){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),4500);
      try{
        const response=await fetch(
          apiBase+"/api/v1/charge/"+encodeURIComponent(String(sibling.correlation_id)),
          {
            method:"DELETE",
            headers:{
              "Accept":"application/json",
              "Authorization":appId
            },
            signal:controller.signal
          }
        );
        ok=response.ok;
        try{await response.body?.cancel()}catch{}
      }catch(error){
        console.error("woovi sibling charge cancel failed",String(error));
      }finally{
        clearTimeout(timer);
      }
    }

    const {error:updateError}=await admin
      .from("merchant_billing_provider_charges")
      .update({
        last_error_code:ok?null:"PROVIDER_CANCEL_FAILED",
        last_error_at:ok?null:new Date().toISOString(),
        updated_at:new Date().toISOString()
      })
      .eq("id",sibling.id)
      .eq("status","cancelled")
      .eq("last_error_code","PROVIDER_CANCEL_REQUIRED");

    if(updateError){
      console.error("woovi sibling charge cancel state failed",String(updateError.message??updateError));
      failed++;
    }else if(ok){
      cancelled++;
    }else{
      failed++;
    }
  }

  return {attempted:rows.length,cancelled,failed};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return response({error:"METHOD_NOT_ALLOWED"},405);

  const expectedAuthorization=String(Deno.env.get("WOOVI_WEBHOOK_AUTHORIZATION")??"");
  const expectedCompanyId=String(Deno.env.get("WOOVI_COMPANY_ID")??"").trim();
  if(expectedAuthorization.length<24||expectedCompanyId.length<6||expectedCompanyId.length>160){
    return response({error:"WOOVI_ADAPTER_NOT_CONFIGURED"},503);
  }

  const authorization=String(req.headers.get("authorization")??"");
  if(!constantTimeEqual(authorization,expectedAuthorization)){
    return response({error:"INVALID_WOOVI_AUTHORIZATION"},401);
  }

  const signature=String(req.headers.get("x-webhook-signature")??"").trim();
  if(!signature)return response({error:"INVALID_WOOVI_SIGNATURE"},401);

  const declared=Number(req.headers.get("content-length")??0);
  if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES){
    return response({error:"PAYLOAD_TOO_LARGE"},413);
  }

  const rawBody=await req.text();
  if(new TextEncoder().encode(rawBody).byteLength>MAX_BODY_BYTES){
    return response({error:"PAYLOAD_TOO_LARGE"},413);
  }

  try{
    if(!await verifyWooviSignature(rawBody,signature)){
      return response({error:"INVALID_WOOVI_SIGNATURE"},401);
    }
  }catch(error){
    console.error("woovi public key verification unavailable",String(error));
    return response({error:"WOOVI_SIGNATURE_VERIFICATION_UNAVAILABLE"},503);
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

  const companyId=String(body?.company?.id??"").trim();
  if(!constantTimeEqual(companyId,expectedCompanyId)){
    return response({error:"WOOVI_COMPANY_MISMATCH"},401);
  }

  const eventName=String(body.event??"").trim();
  if(![
    "OPENPIX:TRANSACTION_RECEIVED",
    "OPENPIX:CHARGE_COMPLETED",
    "OPENPIX:CHARGE_EXPIRED",
    "PIX_TRANSACTION_REFUND_SENT_CONFIRMED"
  ].includes(eventName)){
    return response({ok:true,ignored:true,reason:"UNSUPPORTED_WOOVI_EVENT"},202);
  }

  if(eventName==="PIX_TRANSACTION_REFUND_SENT_CONFIRMED"){
    const refund=body.refundTransaction;
    const original=body.originalTransaction;
    if(!refund||typeof refund!=="object"||Array.isArray(refund)
       ||!original||typeof original!=="object"||Array.isArray(original)){
      return response({error:"INVALID_WOOVI_REFUND_EVENT"},400);
    }

    const refundEndToEndId=String(refund.endToEndId??"").trim();
    const originalEndToEndId=String(original.endToEndId??"").trim();
    const refundAmountCents=positiveSafeInteger(refund.value);
    const originalAmountCents=positiveSafeInteger(original.value);
    const occurredAt=parseIsoTimestamp(refund.time??refund.createdAt);
    const refundStatus=String(refund.status??"").trim().toUpperCase();
    const refundType=String(refund.type??"").trim().toUpperCase();
    const originalStatus=String(original.status??"").trim().toUpperCase();
    const originalType=String(original.type??"").trim().toUpperCase();

    if(!E2E_RE.test(refundEndToEndId)
       ||!E2E_RE.test(originalEndToEndId)
       ||refundEndToEndId===originalEndToEndId
       ||refundAmountCents==null
       ||originalAmountCents==null
       ||refundAmountCents>originalAmountCents
       ||!occurredAt
       ||refundStatus!=="CONFIRMED"
       ||refundType!=="REFUND"
       ||originalStatus!=="CONFIRMED"
       ||originalType!=="PAYMENT"){
      return response({error:"INVALID_WOOVI_REFUND_EVENT"},400);
    }

    const providerEventId=eventName+":"+refundEndToEndId;
    const payloadHash=await sha256Hex(rawBody);
    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data,error}=await admin.rpc(
      "ingest_merchant_billing_payment_refund",
      {
        p_provider:"woovi",
        p_provider_event_id:providerEventId,
        p_original_reconciliation_key:originalEndToEndId,
        p_refund_reconciliation_key:refundEndToEndId,
        p_amount_cents:refundAmountCents,
        p_currency:"BRL",
        p_occurred_at:occurredAt,
        p_raw_payload_sha256:payloadHash
      }
    );

    if(error){
      const message=String(error.message??error);
      if(message.includes("PAYMENT_REFUND_IDEMPOTENCY_CONFLICT")){
        return response({error:"PAYMENT_REFUND_IDEMPOTENCY_CONFLICT"},409);
      }
      if(message.includes("INVALID_PAYMENT_REFUND_")
         ||message.includes("UNSUPPORTED_PAYMENT_REFUND_")
         ||message.includes("PAYMENT_REFUND_KEYS_MUST_DIFFER")){
        return response({error:"INVALID_PAYMENT_REFUND"},400);
      }
      console.error("woovi billing refund ingest failed",message);
      return response({error:"PAYMENT_REFUND_INGEST_FAILED"},503);
    }

    return response({
      ok:true,
      provider:"woovi",
      event:eventName,
      ...(data??{})
    },202);
  }

  if(eventName==="OPENPIX:CHARGE_EXPIRED"){
    const charge=body.charge;
    if(!charge||typeof charge!=="object"||Array.isArray(charge)){
      return response({error:"INVALID_WOOVI_CHARGE_EXPIRY_EVENT"},400);
    }

    const correlationId=String(charge.correlationID??"").trim();
    const amountCents=positiveSafeInteger(charge.value);
    const status=String(charge.status??"").trim().toUpperCase();
    const expiresAt=parseIsoTimestamp(charge.expiresDate??charge.updatedAt);

    if(!UUID_RE.test(correlationId)
       ||amountCents==null
       ||status!=="EXPIRED"
       ||!expiresAt){
      return response({error:"INVALID_WOOVI_CHARGE_EXPIRY_EVENT"},400);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data,error}=await admin.rpc(
      "merchant_billing_provider_charge_expire",
      {
        p_provider:"woovi",
        p_correlation_id:correlationId,
        p_amount_cents:amountCents,
        p_provider_expires_at:expiresAt
      }
    );

    if(error){
      const message=String(error.message??error);
      if(message.includes("INVALID_PIX_CHARGE_")){
        return response({error:"INVALID_WOOVI_CHARGE_EXPIRY_EVENT"},400);
      }
      console.error("woovi charge expiry failed",message);
      return response({error:"PIX_CHARGE_EXPIRY_FAILED"},503);
    }

    return response({
      ok:true,
      provider:"woovi",
      event:eventName,
      ...(data??{})
    },202);
  }

  const pix=body.pix;
  if(!pix||typeof pix!=="object"||Array.isArray(pix)){
    return response({error:"INVALID_WOOVI_PIX_EVENT"},400);
  }

  const endToEndId=String(pix.endToEndId??"").trim();
  const pixAmountCents=positiveSafeInteger(pix.value);
  const occurredAt=parseIsoTimestamp(pix.time??pix.createdAt);
  const pixStatus=String(pix.status??"").trim().toUpperCase();
  const payerReference=safePayerName(
    pix?.payer?.name??pix?.debitParty?.holder?.name
  );

  if(!E2E_RE.test(endToEndId)
     ||pixAmountCents==null
     ||!occurredAt
     ||pixStatus!=="CONFIRMED"){
    return response({error:"INVALID_WOOVI_PIX_EVENT"},400);
  }

  let providerCorrelationId:string|null=null;
  let amountCents=pixAmountCents;

  if(eventName==="OPENPIX:CHARGE_COMPLETED"){
    const charge=body.charge;
    if(!charge||typeof charge!=="object"||Array.isArray(charge)){
      return response({error:"INVALID_WOOVI_CHARGE_EVENT"},400);
    }
    providerCorrelationId=String(charge.correlationID??"").trim();
    const chargeAmount=positiveSafeInteger(charge.value);
    const chargeStatus=String(charge.status??"").trim().toUpperCase();

    if(!UUID_RE.test(providerCorrelationId)
       ||chargeAmount==null
       ||chargeAmount!==pixAmountCents
       ||chargeStatus!=="COMPLETED"){
      return response({error:"INVALID_WOOVI_CHARGE_EVENT"},400);
    }
    amountCents=chargeAmount;
  }

  const providerEventId=eventName+":"+endToEndId;
  const payloadHash=await sha256Hex(rawBody);
  const admin=createClient(SUPABASE_URL,SECRET_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data,error}=await admin.rpc("ingest_merchant_billing_payment_event",{
    p_provider:"woovi",
    p_provider_event_id:providerEventId,
    p_reconciliation_key:endToEndId,
    p_payment_method:"pix",
    p_amount_cents:amountCents,
    p_currency:"BRL",
    p_occurred_at:occurredAt,
    p_raw_payload_sha256:payloadHash,
    p_payer_reference:payerReference,
    p_provider_correlation_id:providerCorrelationId
  });

  if(error){
    const message=String(error.message??error);
    if(message.includes("PAYMENT_EVENT_IDEMPOTENCY_CONFLICT")){
      return response({error:"PAYMENT_EVENT_IDEMPOTENCY_CONFLICT"},409);
    }
    if(message.includes("INVALID_PAYMENT_")
       ||message.includes("INVALID_PROVIDER_CORRELATION_ID")
       ||message.includes("UNSUPPORTED_PAYMENT_EVENT_")){
      return response({error:"INVALID_PAYMENT_EVENT"},400);
    }
    console.error("woovi billing event ingest failed",message);
    return response({error:"PAYMENT_EVENT_INGEST_FAILED"},503);
  }

  const siblingCancellation=eventName==="OPENPIX:CHARGE_COMPLETED"
    &&providerCorrelationId
      ?await retireWooviSiblingCharges(admin,providerCorrelationId)
      :{attempted:0,cancelled:0,failed:0};

  return response({
    ok:true,
    provider:"woovi",
    event:eventName,
    siblingCancellation,
    ...(data??{})
  },202);
});
