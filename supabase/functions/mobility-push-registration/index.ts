import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";

// Device enrollment only. The commercial/merchant push tables are unrelated.
// All session and eligibility checks are server-side, using a real Auth user.
const URL_BASE=Deno.env.get("SUPABASE_URL")??"";
const pub=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const sec=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLIC_KEY=pub.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SERVICE_KEY=sec.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ORIGINS=new Set(["https://tamao.com.br"]);
const B64=/^[A-Za-z0-9_-]+$/;
function allowed(origin:string|null){
 return !origin||ORIGINS.has(origin)||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function respond(body:unknown,status:number,origin:string|null){
 return new Response(JSON.stringify(body),{status,headers:{
  "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "Vary":"Origin","X-Content-Type-Options":"nosniff",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  ...(origin&&allowed(origin)?{"Access-Control-Allow-Origin":origin}:{})
 }});
}
function fail(error:string,status:number,origin:string|null){
 return respond({error},status,origin);
}
function endpointValid(value:unknown):value is string{
 if(typeof value!=="string"||value.length<40||value.length>2048)return false;
 try{
  const u=new URL(value);
  if(u.protocol!=="https:"||u.username||u.password||u.hash)return false;
  const host=u.hostname.toLowerCase();
  return host==="fcm.googleapis.com"||
   host==="updates.push.services.mozilla.com"||
   host==="web.push.apple.com"||
   /^[-a-z0-9]+\.push\.apple\.com$/.test(host)||
   /^[-a-z0-9.]+\.notify\.windows\.com$/.test(host);
 }catch{return false}
}
function keyValid(value:unknown,minimum:number,maximum:number){
 return typeof value==="string"&&value.length>=minimum&&value.length<=maximum&&B64.test(value);
}
async function hash(endpoint:string){
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(endpoint));
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async req=>{
 const origin=req.headers.get("Origin");
 if(!allowed(origin))return fail("ORIGIN_NOT_ALLOWED",403,null);
 if(req.method==="OPTIONS")return respond({ok:true},200,origin);
 if(req.method!=="POST")return fail("METHOD_NOT_ALLOWED",405,origin);
 if(!URL_BASE||!PUBLIC_KEY||!SERVICE_KEY)return fail("UNAVAILABLE",503,origin);
 const token=req.headers.get("Authorization");
 if(!token?.startsWith("Bearer ")||token.length>5000)return fail("UNAUTHORIZED",401,origin);
 try{
  const raw=await req.text();
  if(raw.length>4600)return fail("INVALID_REQUEST",400,origin);
  const body=JSON.parse(raw);
  if(!body||typeof body!=="object"||Array.isArray(body)||
   !["config","subscribe","unsubscribe"].includes(body.action))return fail("INVALID_REQUEST",400,origin);
  const auth=createClient(URL_BASE,PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await auth.auth.getUser(token.slice(7));
  if(userError||!user||user.is_anonymous)return fail("UNAUTHORIZED",401,origin);
  const admin=createClient(URL_BASE,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:quota,error:quotaErr}=await admin.rpc("consume_api_quota",{
   p_user_id:user.id,p_action_name:"mobility-push-register",p_limit:20,p_window_seconds:60
  });
  if(quotaErr)return fail("UNAVAILABLE",503,origin);
  if(quota?.allowed!==true)return fail("RATE_LIMITED",429,origin);
  if(body.action==="config"){
   const {data:cfg,error}=await admin.rpc("merchant_push_public_config");
   if(error||!cfg)return fail("UNAVAILABLE",503,origin);
   const {data:sender,error:senderError}=await admin.rpc("merchant_push_sender_credentials");
   if(senderError)return fail("UNAVAILABLE",503,origin);
   const available=cfg.available===true&&keyValid(cfg.publicKey,87,87);
   return respond({available,publicKey:available?cfg.publicKey:null,
    senderEnabled:sender?.enabled===true,testMode:cfg.testMode!==false},200,origin);
  }
  if(!endpointValid(body.endpoint))return fail("INVALID_ENDPOINT",400,origin);
  const endpointHash=await hash(body.endpoint);
  if(body.action==="unsubscribe"){
   const {error}=await admin.from("mobility_push_subscriptions")
    .update({active:false,revoked_at:new Date().toISOString()})
    .eq("driver_id",user.id).eq("endpoint_hash",endpointHash);
   return error?fail("UNAVAILABLE",503,origin):respond({ok:true,active:false},200,origin);
  }
  const keys=body.keys;
  if(!keys||typeof keys!=="object"||Array.isArray(keys)||
   !keyValid(keys.p256dh,75,120)||!keyValid(keys.auth,15,70))
    return fail("INVALID_KEYS",400,origin);
  const {data:listings,error:eligibleError}=await admin.from("discovery_listings")
   .select("id").eq("owner_id",user.id).eq("vertical","professionals")
   .eq("status","published").limit(1);
  if(eligibleError)return fail("UNAVAILABLE",503,origin);
  if(!Array.isArray(listings)||listings.length===0)return fail("DRIVER_NOT_PUBLISHED",403,origin);
  const {data:cfg,error:configError}=await admin.rpc("merchant_push_public_config");
  if(configError||cfg?.available!==true||!keyValid(cfg.publicKey,87,87))
   return fail("PUSH_NOT_READY",503,origin);
  const {data:active,error:activeError}=await admin.from("mobility_push_subscriptions")
   .select("endpoint_hash").eq("driver_id",user.id).eq("active",true).limit(5);
  if(activeError)return fail("UNAVAILABLE",503,origin);
  if(active.length>=4&&!active.some((s:{endpoint_hash:string})=>s.endpoint_hash===endpointHash))
   return fail("DEVICE_LIMIT",429,origin);
  const {error:writeError}=await admin.from("mobility_push_subscriptions").upsert({
   driver_id:user.id,endpoint_hash:endpointHash,endpoint_url:body.endpoint,
   p256dh:keys.p256dh,auth_secret:keys.auth,
   active:true,registered_at:new Date().toISOString(),revoked_at:null
  },{onConflict:"endpoint_hash"});
  if(writeError)return fail("UNAVAILABLE",503,origin);
  return respond({ok:true,active:true,
   senderEnabled:false, // Do not infer delivery from enrollment.
   testMode:cfg.testMode!==false},200,origin);
 }catch{return fail("UNAVAILABLE",503,origin)}
});
