import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

// TAMÃO V1.286 — consented browser subscription management only.
// This endpoint NEVER sends a push or changes an order.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const publicKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const PUBLIC_KEY = publicKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SECRET_KEY = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = (Deno.env.get("MERCHANT_VAPID_PUBLIC_KEY") ?? "").trim();
const PUSH_DELIVERY_READY = Deno.env.get("MERCHANT_PUSH_SENDER_VERIFIED") === "true";
const ORIGINS = new Set([
 "https://parceiro.tamao.com.br","https://tamao-sg-revenda.pages.dev"
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]+$/;

function isOriginAllowed(origin: string | null): boolean {
 return !origin || ORIGINS.has(origin) ||
   /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function json(payload: unknown,status: number,origin: string|null): Response {
 return new Response(JSON.stringify(payload),{
   status,headers:{
     "Content-Type":"application/json; charset=utf-8",
     "Cache-Control":"no-store","Vary":"Origin",
     "Access-Control-Allow-Methods":"OPTIONS, POST",
     "Access-Control-Allow-Headers":"authorization, apikey, content-type",
     ...(origin&&isOriginAllowed(origin)?{"Access-Control-Allow-Origin":origin}:{})
   }
 });
}
function fail(code:string,status:number,origin:string|null):Response {
 return json({error:code,message:"Não foi possível atualizar os alertas deste aparelho."},status,origin);
}
async function bodyJson(req: Request):Promise<Record<string,unknown>|null>{
 const raw=await req.text();
 if(raw.length>4700)return null;
 try {
   const body=JSON.parse(raw);
   return body&&typeof body==="object"&&!Array.isArray(body)?body:null;
 }catch{return null}
}
function validEndpoint(value:unknown):value is string {
 if(typeof value!=="string"||value.length<40||value.length>2048)return false;
 try{
   const u=new URL(value);
   if(u.protocol!=="https:"||u.username||u.password||u.hash)return false;
   const h=u.hostname.toLowerCase();
   return h==="fcm.googleapis.com"||
      h==="updates.push.services.mozilla.com"||
      h==="web.push.apple.com"||
      /^[-a-z0-9]+\.push\.apple\.com$/.test(h)||
      /^[-a-z0-9.]+\.notify\.windows\.com$/.test(h);
 }catch{return false}
}
function validKey(value:unknown,min:number,max:number):value is string {
 return typeof value==="string"&&value.length>=min&&value.length<=max&&KEY.test(value);
}
async function sha256(value:string):Promise<string>{
 const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async (req:Request)=>{
 const origin=req.headers.get("Origin");
 if(!isOriginAllowed(origin))return fail("ORIGIN_NOT_ALLOWED",403,null);
 if(req.method==="OPTIONS")return json({ok:true},200,origin);
 if(req.method!=="POST")return fail("METHOD_NOT_ALLOWED",405,origin);
 const bearer=req.headers.get("Authorization");
 if(!bearer?.startsWith("Bearer "))return fail("UNAUTHORIZED",401,origin);
 if(!SUPABASE_URL||!PUBLIC_KEY||!SECRET_KEY)return fail("UNAVAILABLE",503,origin);
 try{
   const body=await bodyJson(req);
   if(!body||!["config","subscribe","unsubscribe"].includes(String(body.action||""))||
      !UUID.test(String(body.merchantId||"")))return fail("INVALID_REQUEST",400,origin);
   const publicClient=createClient(SUPABASE_URL,PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data:userData,error:authError}=await publicClient.auth.getUser(bearer.slice(7));
   const user=userData.user;
   if(authError||!user||user.is_anonymous)return fail("UNAUTHORIZED",401,origin);
   const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data:member,error:memberError}=await admin.from("merchant_members")
     .select("member_role").eq("merchant_id",body.merchantId).eq("user_id",user.id)
     .eq("active",true).maybeSingle();
   if(memberError)return fail("UNAVAILABLE",503,origin);
   if(!member||!["owner","manager","operator","driver"].includes(member.member_role))
     return fail("ACCESS_DENIED",403,origin);
   const {data:quota,error:quotaError}=await admin.rpc("consume_api_quota",{
     p_user_id:user.id,p_action_name:"merchant-push-register",
     p_limit:30,p_window_seconds:60
   });
   if(quotaError)return fail("UNAVAILABLE",503,origin);
   if(quota?.allowed!==true)return fail("RATE_LIMITED",429,origin);
   if(body.action==="config"){
     const enabled=PUSH_DELIVERY_READY&&validKey(VAPID_PUBLIC_KEY,85,100);
     return json({available:enabled,publicKey:enabled?VAPID_PUBLIC_KEY:null},200,origin);
   }
   if(!validEndpoint(body.endpoint))return fail("INVALID_ENDPOINT",400,origin);
   const endpointHash=await sha256(body.endpoint);
   if(body.action==="unsubscribe"){
     const {error}=await admin.from("merchant_push_subscriptions")
       .update({active:false,revoked_at:new Date().toISOString()})
       .eq("endpoint_hash",endpointHash).eq("merchant_id",body.merchantId)
       .eq("user_id",user.id);
     if(error)return fail("UNAVAILABLE",503,origin);
     return json({ok:true,active:false},200,origin);
   }
   if(!PUSH_DELIVERY_READY||!validKey(VAPID_PUBLIC_KEY,85,100))
     return fail("PUSH_NOT_READY",503,origin);
   const keys=body.keys;
   if(!keys||typeof keys!=="object"||Array.isArray(keys))
     return fail("INVALID_KEYS",400,origin);
   const publicPart=(keys as Record<string,unknown>).p256dh;
   const auth=(keys as Record<string,unknown>).auth;
   if(!validKey(publicPart,75,120)||!validKey(auth,15,70))
     return fail("INVALID_KEYS",400,origin);
   const {error}=await admin.from("merchant_push_subscriptions").upsert({
     endpoint_hash:endpointHash,endpoint_url:body.endpoint,
     p256dh:publicPart,auth_secret:auth,merchant_id:body.merchantId,user_id:user.id,
     active:true,registered_at:new Date().toISOString(),revoked_at:null
   },{onConflict:"endpoint_hash"});
   if(error)return fail("UNAVAILABLE",503,origin);
   return json({ok:true,active:true},200,origin);
 }catch{return fail("UNAVAILABLE",503,origin)}
});
