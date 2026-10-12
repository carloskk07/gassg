import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {enforceApiQuota} from "../_shared/domain.js";

// V1.190: isolated, read-only, finance-only RPC gateway.
// JWT validation happens in the handler, matching admin-ops' publishable-key model.
const URL=Deno.env.get("SUPABASE_URL")??"";
const PUBLISHABLE=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default
  ??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default
  ??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ALLOWED=new Set([
  "https://admin.tamao.com.br",
  "https://tamao-sg-admin.pages.dev",
  Deno.env.get("ADMIN_ALLOWED_ORIGIN")??"https://chama-sg-admin.netlify.app"
].filter(Boolean));
function originAllowed(origin:string|null){
  return !origin||ALLOWED.has(origin)||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(origin:string|null){
  return {
    "Access-Control-Allow-Origin":origin&&originAllowed(origin)?origin:"https://admin.tamao.com.br",
    "Access-Control-Allow-Headers":"authorization, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin"
  };
}
function reply(body:unknown,status:number,origin:string|null){
  return new Response(JSON.stringify(body),{
    status,headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}
Deno.serve(async (req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return reply({error:"ORIGIN_NOT_ALLOWED"},403,null);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405,origin);
  try{
    if(!URL||!PUBLISHABLE||!SECRET){
      return reply({error:"SERVICE_CONFIGURATION_MISSING"},503,origin);
    }
    const h=req.headers.get("Authorization")??"";
    if(!h.startsWith("Bearer ")||h.length<=8)return reply({error:"UNAUTHORIZED"},401,origin);
    const token=h.slice(7);
    const identity=createClient(URL,PUBLISHABLE,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data:auth,error:authError}=await identity.auth.getUser(token);
    if(authError||!auth.user)return reply({error:"UNAUTHORIZED"},401,origin);
    if(auth.user.is_anonymous===true)return reply({error:"PERMANENT_IDENTITY_REQUIRED"},403,origin);
    const admin=createClient(URL,SECRET,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data:access,error:accessError}=await admin.from("platform_admins")
      .select("user_id,admin_role,active")
      .eq("user_id",auth.user.id).eq("active",true).maybeSingle();
    if(accessError)return reply({error:"ADMIN_ACCESS_UNAVAILABLE"},503,origin);
    if(!access||!["superadmin","finance"].includes(access.admin_role)){
      return reply({error:"ADMIN_PERMISSION_DENIED"},403,origin);
    }
    await enforceApiQuota(admin,{userId:auth.user.id,
      actionName:"admin-finance-merchant",limit:120,windowSeconds:60});
    const {data,error}=await admin.rpc("admin_finance_merchant_performance_v1_190",{
      p_actor_user_id:auth.user.id
    });
    if(error)return reply({error:"FINANCE_MERCHANT_QUERY_FAILED"},503,origin);
    if(data?.source!=="database_complete_per_merchant"
      ||data?.rowLimit!==200||!Array.isArray(data?.rows)){
      return reply({error:"FINANCE_MERCHANT_METRICS_UNAVAILABLE"},503,origin);
    }
    return reply(data,200,origin);
  }catch(e){
    const status=Number((e as {status?:number})?.status);
    return reply({error:status===429?"RATE_LIMITED":"FINANCE_REPORT_UNAVAILABLE"},
      status===429?429:503,origin);
  }
});