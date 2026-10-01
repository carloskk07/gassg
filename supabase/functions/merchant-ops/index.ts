import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
  asNonNegativeCents,
  asPositiveInt,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const PROD_ORIGIN="https://carloskk07.github.io";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PRODUCT_NAMES:Record<string,string>={
  P13:"Gás P13",
  WATER20:"Água 20 L",
  CHARCOAL4:"Carvão 4 kg",
  WOOD:"Lenha",
  ICE5:"Gelo 5 kg"
};

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(origin===PROD_ORIGIN)return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:PROD_ORIGIN;
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
  if(!authHeader?.startsWith("Bearer "))throw new DomainError("UNAUTHORIZED","Autenticação obrigatória.",401);
  const token=authHeader.slice("Bearer ".length);
  const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user)throw new DomainError("UNAUTHORIZED","Sessão inválida ou expirada.",401);
  return assertPermanentMerchantUser(data.user);
}
function canOperate(role:string){return ["owner","manager","operator"].includes(role)}
function canManage(role:string){return ["owner","manager"].includes(role)}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const merchantId=String(body.merchantId??"");
    const action=String(body.action??"");
    if(!UUID_RE.test(merchantId))throw new DomainError("INVALID_MERCHANT","Revenda inválida.",400);
    if(!["heartbeat","set-online","update-product","update-logistics"].includes(action)){
      throw new DomainError("INVALID_ACTION","Ação inválida.",400);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"merchant-ops",limit:180,windowSeconds:60});
    const {data:membership,error:membershipError}=await admin
      .from("merchant_members")
      .select("member_role,active")
      .eq("merchant_id",merchantId)
      .eq("user_id",user.id)
      .eq("active",true)
      .maybeSingle();
    if(membershipError)throw membershipError;
    if(!membership)throw new DomainError("MERCHANT_ACCESS_DENIED","Você não possui acesso a esta revenda.",403);

    const role=membership.member_role;
    const now=new Date().toISOString();

    if(action==="heartbeat"){
      if(!canOperate(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Seu papel não pode manter a operação ativa.",403);
      const {error}=await admin.from("merchants").update({last_seen_at:now}).eq("id",merchantId);
      if(error)throw error;
      return json({ok:true,lastSeenAt:now},200,origin);
    }

    if(action==="set-online"){
      if(!canOperate(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Seu papel não pode alterar a operação.",403);
      const online=body.online===true;

      if(online){
        const {data:merchant,error:merchantError}=await admin
          .from("merchants")
          .select("status,price_confirmed_at")
          .eq("id",merchantId)
          .maybeSingle();
        if(merchantError)throw merchantError;
        if(!merchant||merchant.status!=="active"){
          throw new DomainError("MERCHANT_NOT_ACTIVE","A revenda ainda não está ativa.",409);
        }
        const confirmedAt=Date.parse(merchant.price_confirmed_at??"");
        if(!Number.isFinite(confirmedAt)||Date.now()-confirmedAt>24*60*60*1000){
          throw new DomainError("PRICE_CONFIRMATION_REQUIRED","Confirme os preços antes de ficar online.",409);
        }

        const {count,error:countError}=await admin
          .from("catalog_items")
          .select("*",{count:"exact",head:true})
          .eq("merchant_id",merchantId)
          .eq("active",true)
          .gt("available_stock",0);
        if(countError)throw countError;
        if(!count)throw new DomainError("NO_AVAILABLE_STOCK","Nenhum produto possui estoque disponível.",409);
      }

      const {data,error}=await admin
        .from("merchants")
        .update({online,last_seen_at:now})
        .eq("id",merchantId)
        .select("online,last_seen_at")
        .single();
      if(error)throw error;
      return json({ok:true,...data},200,origin);
    }

    if(action==="update-product"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar catálogo.",403);
      const productCode=String(body.productCode??"").toUpperCase();
      if(!PRODUCT_NAMES[productCode])throw new DomainError("INVALID_PRODUCT","Produto inválido.",400);
      const priceCents=asPositiveInt(body.priceCents,"priceCents",{min:1,max:100000000});
      const availableStock=asPositiveInt(body.availableStock,"availableStock",{min:0,max:100000});
      const active=body.active!==false;

      const {data,error}=await admin
        .from("catalog_items")
        .upsert({
          merchant_id:merchantId,
          product_code:productCode,
          product_name:PRODUCT_NAMES[productCode],
          price_cents:priceCents,
          available_stock:availableStock,
          active,
          updated_at:now
        },{onConflict:"merchant_id,product_code"})
        .select("product_code,product_name,price_cents,available_stock,active,updated_at")
        .single();
      if(error)throw error;

      const {error:merchantUpdateError}=await admin
        .from("merchants")
        .update({price_confirmed_at:now,last_seen_at:now})
        .eq("id",merchantId);
      if(merchantUpdateError)throw merchantUpdateError;

      const {count,error:availableError}=await admin
        .from("catalog_items")
        .select("*",{count:"exact",head:true})
        .eq("merchant_id",merchantId)
        .eq("active",true)
        .gt("available_stock",0);
      if(availableError)throw availableError;
      if(!count){
        await admin.from("merchants").update({online:false}).eq("id",merchantId);
      }

      return json({ok:true,product:data,priceConfirmedAt:now},200,origin);
    }

    if(action==="update-logistics"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar logística.",403);
      const deliveryFeeCents=asNonNegativeCents(body.deliveryFeeCents,"deliveryFeeCents");
      if(deliveryFeeCents>100000)throw new DomainError("INVALID_DELIVERY_FEE","Taxa de entrega inválida.",400);
      const baseEtaMinutes=asPositiveInt(body.baseEtaMinutes,"baseEtaMinutes",{min:5,max:180});
      const acceptsCitywide=body.acceptsCitywide===true;

      const {data,error}=await admin
        .from("merchants")
        .update({
          delivery_fee_cents:deliveryFeeCents,
          base_eta_minutes:baseEtaMinutes,
          accepts_citywide:acceptsCitywide,
          last_seen_at:now
        })
        .eq("id",merchantId)
        .select("delivery_fee_cents,base_eta_minutes,accepts_citywide,last_seen_at")
        .single();
      if(error)throw error;
      return json({ok:true,...data},200,origin);
    }

    return json({error:"INVALID_ACTION"},400,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("merchant-ops failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível atualizar a operação."},500,origin);
  }
});
