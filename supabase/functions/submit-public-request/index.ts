import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ALLOWED_ORIGINS=new Set([
  "https://tamao.com.br",
  "https://www.tamao.com.br",
  "https://tamao-sg-cliente.pages.dev",
  "https://carloskk07.github.io"
]);

function originAllowed(origin:string|null){
  if(!origin)return false;
  if(ALLOWED_ORIGINS.has(origin))return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(origin:string|null){
  return {
    "Access-Control-Allow-Origin":origin&&originAllowed(origin)?origin:"null",
    "Access-Control-Allow-Headers":"content-type, apikey, idempotency-key",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin"
  };
}
function json(body:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}
function clean(value:unknown,max:number){
  const text=String(value??"").trim().replace(/\s+/g," ");
  return text?text.slice(0,max):null;
}
async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function clientIp(req:Request){
  return String(
    req.headers.get("cf-connecting-ip")
    ||req.headers.get("x-real-ip")
    ||req.headers.get("x-forwarded-for")?.split(",")[0]
    ||"unknown"
  ).trim().slice(0,128);
}
function normalizeContact(channel:string,value:unknown){
  const raw=String(value??"").trim();
  if(channel==="email"){
    const email=raw.toLowerCase().slice(0,180);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return null;
    return email;
  }
  const phone=raw.replace(/\D/g,"").slice(0,13);
  if(phone.length<10||phone.length>13)return null;
  return phone;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(req.method==="OPTIONS"){
    if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
    return new Response("ok",{headers:cors(origin)});
  }
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);
  if(!String(req.headers.get("content-type")||"").toLowerCase().includes("application/json")){
    return json({error:"INVALID_CONTENT_TYPE",message:"Formato inválido."},415,origin);
  }

  try{
    const raw=await req.text();
    if(raw.length>16000)return json({error:"PAYLOAD_TOO_LARGE",message:"Dados excedem o limite."},413,origin);
    let body:any;
    try{body=JSON.parse(raw)}catch{return json({error:"INVALID_JSON",message:"Dados inválidos."},400,origin)}
    if(clean(body.website,200))return json({ok:true,accepted:true},202,origin);
    if(body.acknowledged!==true){
      return json({error:"ACK_REQUIRED",message:"Confirme que os dados serão usados para responder à sua solicitação."},400,origin);
    }

    const requestKind=String(body.requestKind??"").trim();
    if(!["general","support","privacy"].includes(requestKind)){
      return json({error:"INVALID_REQUEST_KIND",message:"Tipo de solicitação inválido."},400,origin);
    }
    const privacyActionRaw=String(body.privacyAction??"").trim();
    const privacyActions=new Set(["confirmation","access","correction","deletion","information","revocation","other"]);
    const privacyAction=requestKind==="privacy"&&privacyActions.has(privacyActionRaw)?privacyActionRaw:null;
    if(requestKind==="privacy"&&!privacyAction){
      return json({error:"PRIVACY_ACTION_REQUIRED",message:"Escolha o direito ou assunto de privacidade."},400,origin);
    }

    const contactName=clean(body.contactName,120);
    if(!contactName||contactName.length<2){
      return json({error:"NAME_REQUIRED",message:"Informe seu nome."},400,origin);
    }
    const contactChannel=String(body.contactChannel??"").trim();
    if(!["email","whatsapp"].includes(contactChannel)){
      return json({error:"INVALID_CONTACT_CHANNEL",message:"Escolha e-mail ou WhatsApp."},400,origin);
    }
    const contactValue=normalizeContact(contactChannel,body.contactValue);
    if(!contactValue){
      return json({error:"INVALID_CONTACT",message:contactChannel==="email"?"Informe um e-mail válido.":"Informe um WhatsApp válido com DDD."},400,origin);
    }
    const message=clean(body.message,2000);
    if(!message||message.length<10){
      return json({error:"MESSAGE_REQUIRED",message:"Explique sua solicitação em pelo menos 10 caracteres."},400,origin);
    }

    const idempotencyKey=String(req.headers.get("Idempotency-Key")??"").trim()||null;
    if(idempotencyKey&&(idempotencyKey.length<12||idempotencyKey.length>120||!/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))){
      return json({error:"INVALID_IDEMPOTENCY_KEY",message:"Não foi possível identificar esta tentativa com segurança."},400,origin);
    }

    const attribution=body.attribution&&typeof body.attribution==="object"?body.attribution:{};
    const normalized={
      request_kind:requestKind,
      privacy_action:privacyAction,
      contact_name:contactName,
      contact_channel:contactChannel,
      contact_value:contactValue,
      message,
      source:clean(attribution.source,80),
      medium:clean(attribution.medium,80),
      campaign:clean(attribution.campaign,120),
      referrer:clean(attribution.referrer,500),
      landing_path:clean(attribution.landingPath,240)
    };
    const requestHash=await sha256Hex(JSON.stringify(normalized));
    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

    const {data:existing,error:existingError}=idempotencyKey
      ? await admin.from("public_requests")
          .select("id,request_kind,status,created_at,request_hash")
          .eq("request_idempotency_key",idempotencyKey)
          .maybeSingle()
      : {data:null,error:null};
    if(existingError)throw existingError;
    if(existing){
      if(existing.request_hash!==requestHash){
        return json({error:"IDEMPOTENCY_CONFLICT",message:"Esta tentativa já foi usada com outros dados."},409,origin);
      }
      return json({
        ok:true,
        accepted:true,
        protocol:String(existing.id).slice(0,8).toUpperCase(),
        replayed:true,
        message:requestKind==="privacy"
          ?"Solicitação de privacidade recebida. Poderemos pedir confirmação de identidade antes de fornecer ou alterar dados."
          :"Solicitação recebida. Usaremos o canal informado para responder."
      },200,origin);
    }

    const ipHash=await sha256Hex(SECRET_KEY.slice(0,32)+":"+clientIp(req));
    const {data:quota,error:quotaError}=await admin.rpc("consume_prelaunch_lead_quota",{
      p_ip_hash:ipHash,
      p_action_name:"submit-public-request",
      p_limit:5,
      p_window_seconds:3600
    });
    if(quotaError)throw quotaError;
    if(quota?.allowed!==true){
      return json({error:"RATE_LIMITED",message:"Muitas solicitações em pouco tempo. Tente novamente mais tarde.",retryAfterSeconds:quota?.retryAfterSeconds||3600},429,origin);
    }

    const payload={
      ...normalized,
      acknowledged_at:new Date().toISOString(),
      ip_hash:ipHash,
      request_idempotency_key:idempotencyKey,
      request_hash:idempotencyKey?requestHash:null
    };
    const {data,error}=await admin
      .from("public_requests")
      .insert(payload)
      .select("id,request_kind,status,created_at,request_hash")
      .single();
    if(error){
      if(idempotencyKey&&String(error.code)==="23505"){
        const {data:race,error:raceError}=await admin
          .from("public_requests")
          .select("id,request_kind,status,created_at,request_hash")
          .eq("request_idempotency_key",idempotencyKey)
          .maybeSingle();
        if(raceError)throw raceError;
        if(race&&race.request_hash===requestHash){
          return json({
            ok:true,
            accepted:true,
            protocol:String(race.id).slice(0,8).toUpperCase(),
            replayed:true,
            message:requestKind==="privacy"
              ?"Solicitação de privacidade recebida. Poderemos pedir confirmação de identidade antes de fornecer ou alterar dados."
              :"Solicitação recebida. Usaremos o canal informado para responder."
          },200,origin);
        }
        if(race) return json({error:"IDEMPOTENCY_CONFLICT",message:"Esta tentativa já foi usada com outros dados."},409,origin);
      }
      throw error;
    }

    return json({
      ok:true,
      accepted:true,
      protocol:String(data.id).slice(0,8).toUpperCase(),
      replayed:false,
      message:requestKind==="privacy"
        ?"Solicitação de privacidade recebida. Poderemos pedir confirmação de identidade antes de fornecer ou alterar dados."
        :"Solicitação recebida. Usaremos o canal informado para responder."
    },201,origin);
  }catch(error){
    console.error("submit-public-request failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível enviar agora. Tente novamente."},500,origin);
  }
});
