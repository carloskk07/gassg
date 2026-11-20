import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";

// V1.1087: informational regional estimates only. This public Edge endpoint
// deliberately does not grant PostgreSQL anon EXECUTE on SECURITY DEFINER RPCs.
const URL_BASE=Deno.env.get("SUPABASE_URL")||"";
const publishable=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const PUB=publishable.default||Deno.env.get("SUPABASE_ANON_KEY")||"";
const SECRET=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ORIGINS=new Set([
 "https://tamao.com.br","https://www.tamao.com.br",
 "https://tamao-sg-cliente.pages.dev","https://carloskk07.github.io"
]);
function allowed(origin:string|null){
 return Boolean(origin&&(ORIGINS.has(origin)||
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)));
}
function headers(origin:string|null){
 return {
  "Access-Control-Allow-Origin":allowed(origin)?String(origin):"null",
  "Access-Control-Allow-Headers":"apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Vary":"Origin",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Content-Type":"application/json; charset=utf-8"
 };
}
function reply(payload:unknown,status:number,origin:string|null){
 return new Response(JSON.stringify(payload),{status,headers:headers(origin)});
}
async function digest(value:string){
 const result=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,"0")).join("");
}
async function boundedJson(req:Request,maxBytes=512){
 const declared=Number(req.headers.get("content-length")||0);
 if(Number.isFinite(declared)&&declared>maxBytes)throw new Error("PAYLOAD_TOO_LARGE");
 const reader=req.body?.getReader();
 if(!reader)return {};
 const decoder=new TextDecoder();
 let total=0,text="";
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value?.byteLength||0;
   if(total>maxBytes){
    try{await reader.cancel()}catch{}
    throw new Error("PAYLOAD_TOO_LARGE");
   }
   text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();
 }finally{try{reader.releaseLock()}catch{}}
 try{return JSON.parse(text)}catch{throw new Error("INVALID_JSON")}
}
const admin=URL_BASE&&SECRET?createClient(URL_BASE,SECRET,{
 auth:{persistSession:false,autoRefreshToken:false}
}):null;

Deno.serve(async req=>{
 const origin=req.headers.get("Origin");
 if(!allowed(origin))return reply({error:"ORIGIN_NOT_ALLOWED"},403,origin);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(origin)});
 if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405,origin);
 if(!admin||!PUB||req.headers.get("apikey")!==PUB)
  return reply({error:"NOT_AUTHORIZED"},401,origin);
 if(!/application\/json/i.test(req.headers.get("content-type")||""))
  return reply({error:"INVALID_CONTENT_TYPE"},415,origin);
 try{
  let input;
  try{input=await boundedJson(req,512)}
  catch(e){
   const code=e instanceof Error?e.message:"INVALID_JSON";
   return reply({error:code==="PAYLOAD_TOO_LARGE"?code:"INVALID_JSON"},
    code==="PAYLOAD_TOO_LARGE"?413:400,origin);
  }
  if(!input||typeof input!=="object"||Array.isArray(input))
   return reply({error:"INVALID_PAYLOAD"},400,origin);
  const city=String(input.p_city??"").trim();
  const state=String(input.p_state??"").trim().toUpperCase();
  if(!/^[\p{L}\p{M} .'-]{2,80}$/u.test(city)||!/^[A-Z]{2}$/.test(state))
   return reply({error:"INVALID_REGION"},400,origin);

  // Hash a proxy-provided client IP with a server-only secret. Never store IP
  // or fingerprint in a browser response or server log.
  const ip=String(req.headers.get("cf-connecting-ip")||
   req.headers.get("x-real-ip")||
   req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown").slice(0,128);
  const key=await digest(SECRET.slice(0,32)+":public-city-prices:"+ip);
  const {data:quota,error:quotaError}=await admin.rpc("consume_hashed_api_quota",{
   p_key_hash:key,p_action_name:"public-city-prices-v1-1087",
   p_limit:60,p_window_seconds:3600
  });
  if(quotaError||!quota)return reply({error:"PRICE_BOARD_UNAVAILABLE"},503,origin);
  if(quota.allowed!==true)
   return reply({error:"RATE_LIMITED",retryAfterSeconds:Math.max(1,Number(quota.retryAfterSeconds)||3600)},429,origin);

  const {data,error}=await admin.rpc("public_city_price_board_v1_341",{
   p_city:city,p_state:state
  });
  if(error)throw error;
  if(data?.source!=="public_city_price_board_v1_341"||
   data.city!==city||data.state!==state||
   data.kind!=="eligible_merchant_estimates"||
   data.real!==true||data.notAQuote!==true||
   data.requiresPostalConfirmation!==true||
   !Number.isSafeInteger(data.productCount)||data.productCount<0||
   !Array.isArray(data.products)||data.products.length!==data.productCount||
   data.products.length>120||
   !Number.isFinite(Date.parse(String(data.checkedAt||"")))||
   data.products.some((p:any)=>!p||!/^[A-Z][A-Z0-9_]{1,31}$/.test(String(p.code||""))||
    !Number.isSafeInteger(p.fromCents)||p.fromCents<=0||
    !Number.isSafeInteger(p.toCents)||p.toCents<p.fromCents||
    !Number.isSafeInteger(p.merchantCount)||p.merchantCount<1||
    !Number.isFinite(Date.parse(String(p.updatedAt||"")))))
   throw new Error("PRICE_BOARD_INTEGRITY");
  // Project only reviewed public numeric fields. Never expose merchant IDs,
  // buyer identity, addresses, balance, discounts, or a checkout quote token.
  const products=data.products.map((p:any)=>({
   code:p.code,fromCents:p.fromCents,toCents:p.toCents,
   merchantCount:p.merchantCount,updatedAt:p.updatedAt
  }));
  return reply({
   source:"public_city_price_board_v1_341",city,state,
   kind:"eligible_merchant_estimates",real:true,notAQuote:true,
   requiresPostalConfirmation:true,
   productCount:products.length,checkedAt:data.checkedAt,products
  },200,origin);
 }catch(err){
  console.error("public-city-prices unavailable",err instanceof Error?err.name:"error");
  return reply({error:"PRICE_BOARD_UNAVAILABLE"},503,origin);
 }
});
