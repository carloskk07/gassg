import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";

// Public, READ-ONLY merchant tariff catalogue. No direct anon grants on
// merchant_billing_plans; this endpoint projects ONLY approved public fields.
const URL_BASE=Deno.env.get("SUPABASE_URL")||"";
const publishable=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const PUB=publishable.default||Deno.env.get("SUPABASE_ANON_KEY")||"";
const SECRET=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ORIGINS=new Set([
 "https://tamao.com.br","https://www.tamao.com.br",
 "https://parceiro.tamao.com.br","https://tamao-sg-cliente.pages.dev",
 "https://carloskk07.github.io"
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
  "Vary":"Origin","Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Content-Type":"application/json; charset=utf-8"
 };
}
function reply(value:unknown,status:number,origin:string|null){
 return new Response(JSON.stringify(value),{status,headers:headers(origin)});
}
async function digest(value:string){
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("");
}
const admin=URL_BASE&&SECRET?createClient(URL_BASE,SECRET,{
 auth:{persistSession:false,autoRefreshToken:false}
}):null;

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin");
 if(!allowed(origin))return reply({error:"ORIGIN_NOT_ALLOWED"},403,origin);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(origin)});
 if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405,origin);
 if(!admin||!PUB||req.headers.get("apikey")!==PUB)
  return reply({error:"NOT_AUTHORIZED"},401,origin);
 if(!/application\/json/i.test(req.headers.get("content-type")||""))
  return reply({error:"INVALID_CONTENT_TYPE"},415,origin);
 const size=Number(req.headers.get("content-length")||0);
 if(!Number.isFinite(size)||size>64||size<0)
  return reply({error:"INVALID_PAYLOAD"},413,origin);
 try{
  // No body parameters, merchant identifier, login, financial action or
  // user-provided filter can influence the returned catalogue.
  const body=await req.text();
  if(body.length>64||body.trim()!=="{}")
   return reply({error:"INVALID_PAYLOAD"},400,origin);
  const ip=String(req.headers.get("cf-connecting-ip")||
   req.headers.get("x-real-ip")||
   req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown").slice(0,128);
  const key=await digest(SECRET.slice(0,32)+":merchant-public-plans:"+ip);
  const {data:quota,error:quotaError}=await admin.rpc("consume_hashed_api_quota",{
   p_key_hash:key,p_action_name:"merchant-public-plans-v1-1115",
   p_limit:120,p_window_seconds:3600
  });
  if(quotaError||!quota)return reply({error:"CATALOG_UNAVAILABLE"},503,origin);
  if(quota.allowed!==true)
   return reply({error:"RATE_LIMITED"},429,origin);

  const {data,error}=await admin.from("merchant_billing_plans")
   .select("plan_key,display_name,billing_mode,platform_fee_bps,purchase_amount_cents,credit_grant_cents,active,sort_order")
   .eq("active",true).order("sort_order",{ascending:true});
  if(error)throw error;
  if(!Array.isArray(data)||data.length<2||data.length>12||
     data.filter(p=>p.plan_key==="flex_daily").length!==1||
     data.some(p=>!p||p.active!==true||
      !/^[a-z][a-z0-9_]{1,39}$/.test(String(p.plan_key||""))||
      typeof p.display_name!=="string"||p.display_name.length<2||p.display_name.length>60||
      !Number.isSafeInteger(p.platform_fee_bps)||p.platform_fee_bps<0||p.platform_fee_bps>2000||
      !Number.isSafeInteger(p.sort_order)||
      (p.plan_key==="flex_daily"?
       p.billing_mode!=="postpaid_daily"||p.purchase_amount_cents!==null||
       p.credit_grant_cents!==null:
       p.billing_mode!=="prepaid_credit"||
       !Number.isSafeInteger(p.purchase_amount_cents)||p.purchase_amount_cents<100||
       p.purchase_amount_cents>10000000||
       p.credit_grant_cents!==p.purchase_amount_cents))||
     new Set(data.map(p=>p.plan_key)).size!==data.length)
   throw new Error("CATALOG_INTEGRITY");
  const plans=data.map(p=>({
   planKey:p.plan_key,displayName:p.display_name,
   billingMode:p.billing_mode,platformFeeBps:p.platform_fee_bps,
   purchaseAmountCents:p.purchase_amount_cents,
   creditGrantCents:p.credit_grant_cents,sortOrder:p.sort_order
  }));
  return reply({source:"merchant_billing_plans",verified:true,
   checkedAt:new Date().toISOString(),plans},200,origin);
 }catch(err){
  console.error("merchant-public-plans unavailable",err instanceof Error?err.name:"error");
  return reply({error:"CATALOG_UNAVAILABLE"},503,origin);
 }
});
