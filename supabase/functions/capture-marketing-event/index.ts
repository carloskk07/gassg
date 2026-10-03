import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ALLOWED_ORIGINS=new Set([
  "https://tamao.com.br",
  "https://www.tamao.com.br"
]);
const EVENT_TYPES=new Set(["landing_view","lead_form_view"]);
const AUDIENCES=new Set(["customer","merchant"]);

function originAllowed(origin:string|null){
  if(!origin)return false;
  if(ALLOWED_ORIGINS.has(origin))return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(origin:string|null){
  return {
    "Access-Control-Allow-Origin":origin&&originAllowed(origin)?origin:"null",
    "Access-Control-Allow-Headers":"content-type, apikey",
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
  return String(value??"").trim().replace(/\s+/g," ").slice(0,max);
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

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(req.method==="OPTIONS"){
    if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
    return new Response("ok",{headers:cors(origin)});
  }
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);
  if(!String(req.headers.get("content-type")||"").toLowerCase().includes("application/json")){
    return json({error:"INVALID_CONTENT_TYPE"},415,origin);
  }

  try{
    const raw=await req.text();
    if(raw.length>6000)return json({error:"PAYLOAD_TOO_LARGE"},413,origin);
    let body:any;
    try{body=JSON.parse(raw)}catch{return json({error:"INVALID_JSON"},400,origin)}

    const eventType=String(body.eventType??"").trim();
    const audience=String(body.audience??"").trim();
    if(!EVENT_TYPES.has(eventType))return json({error:"INVALID_EVENT_TYPE"},400,origin);
    if(!AUDIENCES.has(audience))return json({error:"INVALID_AUDIENCE"},400,origin);

    const source=clean(body.source,80);
    const medium=clean(body.medium,80);
    const campaign=clean(body.campaign,120);
    const content=clean(body.content,120);
    const landingPath=clean(body.landingPath,240);
    const referrerHost=clean(body.referrerHost,253).toLowerCase();

    if(landingPath&&!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*(#[A-Za-z0-9_-]{1,80})?$/.test(landingPath)){
      return json({error:"INVALID_LANDING_PATH"},400,origin);
    }
    if(referrerHost&&!/^[a-z0-9.-]+$/.test(referrerHost)){
      return json({error:"INVALID_REFERRER_HOST"},400,origin);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const ipHash=await sha256Hex(SECRET_KEY.slice(0,32)+":"+clientIp(req));
    const {data:quota,error:quotaError}=await admin.rpc("consume_prelaunch_lead_quota",{
      p_ip_hash:ipHash,
      p_action_name:"capture-marketing-event",
      p_limit:120,
      p_window_seconds:3600
    });
    if(quotaError)throw quotaError;
    if(quota?.allowed!==true){
      return json({error:"RATE_LIMITED",retryAfterSeconds:quota?.retryAfterSeconds||3600},429,origin);
    }

    const {data,error}=await admin.rpc("record_prelaunch_marketing_event",{
      p_event_type:eventType,
      p_audience:audience,
      p_source:source,
      p_medium:medium,
      p_campaign:campaign,
      p_content:content,
      p_landing_path:landingPath,
      p_referrer_host:referrerHost
    });
    if(error)throw error;

    return json({ok:true,accepted:true,eventDate:data?.eventDate??null},202,origin);
  }catch(error){
    console.error("capture-marketing-event failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR"},500,origin);
  }
});
