import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const CUSTOMER_ALLOWED_ORIGIN=(Deno.env.get("CUSTOMER_ALLOWED_ORIGIN")??"https://chama-sg-cliente.netlify.app").trim();
const CUSTOMER_PRIMARY_ORIGINS=new Set([
  "https://tamao-sg-cliente.pages.dev",
  "https://tamao.com.br",
  "https://www.tamao.com.br",
  CUSTOMER_ALLOWED_ORIGIN
].filter(Boolean));

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return CUSTOMER_PRIMARY_ORIGINS.has(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:("https://tamao-sg-cliente.pages.dev");
  return {
    "Access-Control-Allow-Origin":allowed,
    "Access-Control-Allow-Headers":"authorization, apikey, content-type",
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
async function authenticatedUser(req:Request){
  const authHeader=req.headers.get("Authorization");
  if(!authHeader?.startsWith("Bearer ")){
    throw new DomainError("UNAUTHORIZED","Autenticação obrigatória.",401);
  }
  const token=authHeader.slice("Bearer ".length);
  const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user)throw new DomainError("UNAUTHORIZED","Sessão inválida ou expirada.",401);
  return data.user;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED",message:"Origem não autorizada."},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    await readJsonBody(req);

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"market-status",limit:30,windowSeconds:60});

    const [{data,error},{data:launchStatus,error:launchError},commercialPolicy]=await Promise.all([
      admin.rpc("market_supply_status"),
      admin.rpc("commerce_launch_status"),
      admin
        .from("reward_policy")
        .select("active,platform_fee_bps,cashback_bps,direct_referral_bps,commission_hold_hours,policy_version")
        .eq("policy_key","default")
        .single()
    ]);
    if(error)throw error;
    if(launchError)throw launchError;
    if(commercialPolicy.error)throw commercialPolicy.error;

    const commerceEnabled=launchStatus?.commerceEnabled===true;
    const operationMode=String(
      launchStatus?.operationMode??(commerceEnabled?"LIVE":"PRELAUNCH")
    ).toUpperCase();
    return json({
      commerceEnabled,
      operationMode,
      launchMode:operationMode.toLowerCase(),
      supplyConfigured:data?.realSupplyConfigured===true,
      realSupplyConfigured:commerceEnabled&&data?.realSupplyConfigured===true,
      configuredMerchantCount:Number(data?.configuredMerchantCount??0),
      availableNow:commerceEnabled&&data?.availableNow===true,
      availableMerchantCount:commerceEnabled?Number(data?.availableMerchantCount??0):0,
      productCodes:Array.isArray(data?.productCodes)?data.productCodes:[],
      commercialPolicy:{
        active:commercialPolicy.data?.active===true,
        platformFeeBps:Number(commercialPolicy.data?.platform_fee_bps??0),
        cashbackBps:Number(commercialPolicy.data?.cashback_bps??0),
        directReferralBps:Number(commercialPolicy.data?.direct_referral_bps??0),
        commissionHoldHours:Number(commercialPolicy.data?.commission_hold_hours??0),
        version:Number(commercialPolicy.data?.policy_version??1)
      }
    },200,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("market-status failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível consultar o estado do mercado."},500,origin);
  }
});
