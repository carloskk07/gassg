import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";

// V1.294: read-only operational radar. Never changes the delivery gate.
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const pub=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const priv=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE=pub.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET=priv.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ALLOWED_ORIGINS=new Set([
 "https://admin.tamao.com.br","https://tamao-sg-admin.pages.dev"
]);
function respond(result:Record<string,unknown>,status:number,origin:string|null){
 return new Response(JSON.stringify(result),{status,headers:{
  "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "Vary":"Origin","X-Content-Type-Options":"nosniff",
  "Access-Control-Allow-Methods":"OPTIONS, POST",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  ...(origin&&ALLOWED_ORIGINS.has(origin)?{"Access-Control-Allow-Origin":origin}:{})
 }});
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin");
 if(origin&&!ALLOWED_ORIGINS.has(origin))return respond({error:"ORIGIN_NOT_ALLOWED"},403,null);
 if(req.method==="OPTIONS")return respond({ok:true},200,origin);
 if(req.method!=="POST")return respond({error:"METHOD_NOT_ALLOWED"},405,origin);
 if(!SUPABASE_URL||!PUBLISHABLE||!SECRET)return respond({error:"UNAVAILABLE"},503,origin);
 const bearer=req.headers.get("Authorization");
 if(!bearer?.startsWith("Bearer "))return respond({error:"UNAUTHORIZED"},401,origin);
 try{
  const raw=await req.text();
  if(raw.length>512)return respond({error:"INVALID_REQUEST"},400,origin);
  let body;
  try{body=JSON.parse(raw)}catch{return respond({error:"INVALID_REQUEST"},400,origin)}
  if(!body||typeof body!=="object"||Array.isArray(body)||body.action!=="read")
   return respond({error:"INVALID_REQUEST"},400,origin);
  const auth=createClient(SUPABASE_URL,PUBLISHABLE,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:authError}=await auth.auth.getUser(bearer.slice(7));
  const user=userData.user;
  if(authError||!user||user.is_anonymous===true)return respond({error:"UNAUTHORIZED"},401,origin);
  const admin=createClient(SUPABASE_URL,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:access,error:accessError}=await admin.from("platform_admins")
   .select("admin_role").eq("user_id",user.id).eq("active",true).maybeSingle();
  if(accessError)return respond({error:"UNAVAILABLE"},503,origin);
  if(!access||!["superadmin","operations","readonly"].includes(access.admin_role))
   return respond({error:"ADMIN_ACCESS_DENIED"},403,origin);
  const {data,error}=await admin.rpc("admin_merchant_push_reliability_v1_294",{p_actor:user.id});
  if(error||data?.source!=="admin_push_reliability_v1_294"||data?.readOnly!==true)
   return respond({error:"RESULT_UNAVAILABLE"},503,origin);
  return respond(data,200,origin);
 }catch{
  // Never log any JWT, private key, subscription endpoint or personal data.
  return respond({error:"UNAVAILABLE"},503,origin);
 }
});
