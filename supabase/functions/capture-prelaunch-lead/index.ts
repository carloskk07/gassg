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
const INTERESTS=new Set(["gas","water","charcoal","firewood","ice","other"]);

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
function digits(value:unknown,max=13){
  return String(value??"").replace(/\D/g,"").slice(0,max);
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


// City detection never blocks consented lead capture; the source is independently
// resolved on the server, not accepted from user-supplied city/UF text.
function canonicalCityKey(city:string){
  return city.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9 ]/g," ")
    .replace(/\s+/g," ").trim().toUpperCase().slice(0,120);
}
async function resolveLeadCity(postalCode:string|null){
  if(!postalCode)return null;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),3500);
  try{
    const response=await fetch("https://viacep.com.br/ws/"+postalCode+"/json/",{
      headers:{"Accept":"application/json"},signal:controller.signal
    });
    if(!response.ok)return null;
    const data=await response.json();
    if(data?.erro)return null;
    const city=String(data?.localidade||"").trim().slice(0,120);
    const state=String(data?.uf||"").trim().toUpperCase();
    const ibgeCode=String(data?.ibge||"").replace(/\D/g,"");
    if(!city||!(/^[A-Z]{2}$/.test(state)))return null;
    const cityKey=canonicalCityKey(city);
    if(!/^[A-Z0-9 ]{2,120}$/.test(cityKey))return null;
    return {city,state,cityKey,ibgeCode:/^[0-9]{7}$/.test(ibgeCode)?ibgeCode:null};
  }catch{return null}
  finally{clearTimeout(timeout)}
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

    const leadType=String(body.leadType??"").trim();
    if(!["customer","merchant"].includes(leadType)){
      return json({error:"INVALID_LEAD_TYPE",message:"Tipo de cadastro inválido."},400,origin);
    }
    if(body.consent!==true){
      return json({error:"CONSENT_REQUIRED",message:"Confirme a autorização de contato para entrar na lista."},400,origin);
    }

    const phone=digits(body.phone);
    if(phone.length<10||phone.length>13){
      return json({error:"INVALID_PHONE",message:"Informe um WhatsApp válido com DDD."},400,origin);
    }

    const contactName=clean(body.contactName,120);
    const businessName=clean(body.businessName,120);
    const postalCode=digits(body.postalCode,8)||null;
    if(postalCode&&postalCode.length!==8){
      return json({error:"INVALID_POSTAL_CODE",message:"Informe um CEP válido."},400,origin);
    }
    if(leadType==="customer"&&!postalCode){
      return json({error:"POSTAL_CODE_REQUIRED",message:"Informe seu CEP para sabermos onde existe demanda."},400,origin);
    }
    if(leadType==="merchant"){
      if(!businessName||businessName.length<2)return json({error:"BUSINESS_REQUIRED",message:"Informe o nome da empresa."},400,origin);
      if(!contactName||contactName.length<2)return json({error:"CONTACT_REQUIRED",message:"Informe o nome do responsável."},400,origin);
    }

    const interests=Array.isArray(body.interests)
      ? [...new Set(body.interests.map((v:any)=>String(v||"").trim().toLowerCase()).filter((v:string)=>INTERESTS.has(v)))].slice(0,6)
      : [];
    if(!interests.length){
      return json({error:"INTEREST_REQUIRED",message:leadType==="merchant"?"Marque pelo menos uma categoria que sua empresa vende.":"Marque pelo menos um produto de interesse."},400,origin);
    }

    const idempotencyKey=String(req.headers.get("Idempotency-Key")??"").trim()||null;
    if(idempotencyKey&&(idempotencyKey.length<12||idempotencyKey.length>120||!/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))){
      return json({error:"INVALID_IDEMPOTENCY_KEY",message:"Não foi possível identificar esta tentativa com segurança."},400,origin);
    }

    const campaign={
      source:clean(body.source,80),
      medium:clean(body.medium,80),
      campaign:clean(body.campaign,120),
      content:clean(body.content,120),
      term:clean(body.term,120),
      referrer:clean(body.referrer,500),
      landing_path:clean(body.landingPath,240)
    };
    const normalized={
      lead_type:leadType,
      contact_name:contactName,
      business_name:leadType==="merchant"?businessName:null,
      phone,
      postal_code:postalCode,
      interests,
      note:clean(body.note,500),
      ...campaign
    };
    const requestHash=await sha256Hex(JSON.stringify(normalized));
    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

    const ip=clientIp(req);
    const ipHash=await sha256Hex(SECRET_KEY.slice(0,32)+":"+ip);
    const {data:result,error:rpcError}=await admin.rpc("capture_prelaunch_lead_idempotent",{
      p_lead_type:normalized.lead_type,
      p_contact_name:normalized.contact_name,
      p_business_name:normalized.business_name,
      p_phone:normalized.phone,
      p_postal_code:normalized.postal_code,
      p_interests:normalized.interests,
      p_note:normalized.note,
      p_source:normalized.source,
      p_medium:normalized.medium,
      p_campaign:normalized.campaign,
      p_content:normalized.content,
      p_term:normalized.term,
      p_referrer:normalized.referrer,
      p_landing_path:normalized.landing_path,
      p_ip_hash:ipHash,
      p_idempotency_key:idempotencyKey,
      p_request_hash:requestHash
    });
    if(rpcError){
      const message=String(rpcError.message??rpcError.details??rpcError.code??"");
      if(message.includes("IDEMPOTENCY_CONFLICT")){
        return json({error:"IDEMPOTENCY_CONFLICT",message:"Esta tentativa já foi usada com outros dados."},409,origin);
      }
      if(message.includes("IDEMPOTENCY_STATE_INVALID")||message.includes("IDEMPOTENCY_RESULT_MISSING")){
        return json({error:"IDEMPOTENCY_RETRY",message:"Não foi possível confirmar esta tentativa. Tente novamente."},409,origin);
      }
      throw rpcError;
    }
    if(result?.error==="RATE_LIMITED"){
      return json({
        error:"RATE_LIMITED",
        message:"Muitas tentativas. Aguarde um pouco e tente novamente.",
        retryAfterSeconds:Number(result?.retryAfterSeconds||3600)
      },429,origin);
    }

    // Preserve leads even when the CEP provider is offline or times out.
    const resolvedCity=await resolveLeadCity(postalCode);
    if(resolvedCity&&result?.leadId){
      const {error:cityError}=await admin.from("market_cities").upsert({
        state:resolvedCity.state,
        city_key:resolvedCity.cityKey,
        city_name:resolvedCity.city,
        ibge_code:resolvedCity.ibgeCode
      },{onConflict:"state,city_key",ignoreDuplicates:true});
      if(!cityError){
        const {error:leadGeoError}=await admin.from("prelaunch_leads").update({
          city:resolvedCity.city,state:resolvedCity.state,city_ibge_code:resolvedCity.ibgeCode
        }).eq("id",result.leadId);
        if(leadGeoError)console.error("lead city enrichment failed",leadGeoError.code||"error");
      }else{
        console.error("city discovery failed",cityError.code||"error");
      }
    }
    const reused=result?.reused===true;
    const replayed=result?.replayed===true;
    return json({
      ok:true,
      accepted:true,
      leadId:result?.leadId,
      leadType:String(result?.leadType||leadType),
      region:resolvedCity?{city:resolvedCity.city,state:resolvedCity.state,ibgeCode:resolvedCity.ibgeCode}:null,
      reused,
      replayed,
      message:leadType==="merchant"
        ?"Interesse recebido. O TAMÃO pode entrar em contato pelo WhatsApp informado."
        :"Você entrou na lista de abertura. O TAMÃO pode avisar pelo WhatsApp informado."
    },reused||replayed?200:201,origin);
  }catch(error){
    console.error("capture-prelaunch-lead failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível salvar agora. Tente novamente."},500,origin);
  }
});
