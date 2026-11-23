import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";

// V1.1159 — consulta exclusivamente pública/estática da identidade da PJ
// APÓS sua ativação. Não consulta/retorna rascunhos, documentos ou CPF PF.
const url=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const publicKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const PUB=publicKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const service=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const allowed=new Set([
  "https://tamao.com.br","https://tamao-sg-cliente.pages.dev",
  "https://parceiro.tamao.com.br","https://tamao-sg-revenda.pages.dev"
]);
function permitted(origin:string|null){
 return !origin||allowed.has(origin)||/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
}
function cors(origin:string|null){return {
 "Access-Control-Allow-Origin":origin&&permitted(origin)?origin:"https://tamao.com.br",
 "Access-Control-Allow-Methods":"GET,OPTIONS",
 "Access-Control-Allow-Headers":"apikey,content-type",
 "Vary":"Origin",
 "Cache-Control":"no-store",
 "Content-Type":"application/json; charset=utf-8"
}}
function response(data:unknown,status:number,origin:string|null){
 return new Response(JSON.stringify(data),{status,headers:cors(origin)});
}
Deno.serve(async req=>{
 const origin=req.headers.get("Origin");
 if(!permitted(origin))return response({error:"ORIGIN_DENIED"},403,origin);
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="GET")return response({error:"METHOD_NOT_ALLOWED"},405,origin);
 if(!PUB||!service||req.headers.get("apikey")!==PUB)
   return response({error:"NOT_AUTHORIZED"},401,origin);
 try{
   const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
   // Public read-only endpoint: rate limit by server-salted client IP.
   const ip=String(req.headers.get("cf-connecting-ip")||
     req.headers.get("x-real-ip")||
     req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown").slice(0,128);
   const keyMaterial=new TextEncoder().encode(service.slice(0,32)+":operator-public-identity:"+ip);
   const digest=await crypto.subtle.digest("SHA-256",keyMaterial);
   const key=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
   const {data:quota,error:quotaError}=await admin.rpc("consume_hashed_api_quota",{
     p_key_hash:key,p_action_name:"operator-public-identity-v1-1159",
     p_limit:120,p_window_seconds:3600
   });
   if(quotaError||!quota)return response({error:"TEMPORARILY_UNAVAILABLE"},503,origin);
   if(quota.allowed!==true)return response({error:"RATE_LIMITED"},429,origin);
   const {data,error}=await admin.rpc("platform_operator_public_identity_v1_1159");
   if(error||data?.source!=="platform_operator_public_identity_v1_1159"||
     !["individual","company"].includes(data?.entityType)||
     typeof data?.public!=="boolean")
     throw Error("OPERATOR_PUBLIC_PROFILE_INVALID");
   if(data.entityType==="individual"||data.public!==true)
     return response({source:"platform_operator_public_identity_v1_1159",
       public:false,entityType:"individual"},200,origin);
   // Safelist: never return extra database columns, evidence, CPF or private data.
   const fields=["cnpj","legalName","tradeName","publicAddress","contactEmail"];
   if(!fields.every(k=>typeof data[k]==="string"&&data[k].length>0)||
     typeof data.effectiveAt!=="string")
     throw Error("OPERATOR_PUBLIC_COMPANY_INVALID");
   return response({source:"platform_operator_public_identity_v1_1159",
     public:true,entityType:"company",cnpj:data.cnpj,
     legalName:data.legalName,tradeName:data.tradeName,
     publicAddress:data.publicAddress,contactEmail:data.contactEmail,
     effectiveAt:data.effectiveAt},200,origin);
 }catch(e){
   console.error("operator public identity unavailable",e instanceof Error?e.name:"UNKNOWN");
   return response({error:"TEMPORARILY_UNAVAILABLE"},503,origin);
 }
});
