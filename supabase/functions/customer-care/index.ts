import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  validateIdempotencyKey,
  requestFingerprint,
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
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEEDBACK_TAGS=new Set(["fast","on_time","friendly","careful","late","wrong_item","price_payment","other"]);
const CASE_CATEGORIES=new Set(["late","wrong_item","price_payment","no_show","delivery","other"]);

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return CUSTOMER_PRIMARY_ORIGINS.has(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:("https://tamao-sg-cliente.pages.dev");
  return {
    "Access-Control-Allow-Origin":allowed,
    "Access-Control-Allow-Headers":"authorization, apikey, content-type, idempotency-key",
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
  return data.user;
}
function cleanNote(value:unknown,max:number){
  const text=String(value??"").trim();
  if(text.length>max)throw new DomainError("MESSAGE_TOO_LONG","Mensagem muito longa.",400);
  return text||null;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const action=String(body.action??"");
    const orderId=String(body.orderId??"");
    if(!UUID_RE.test(orderId))throw new DomainError("INVALID_ORDER","Pedido inválido.",400);
    if(!["feedback","open-case"].includes(action))throw new DomainError("INVALID_ACTION","Ação inválida.",400);

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"customer-care",limit:20,windowSeconds:60});

    const {data:order,error:orderError}=await admin
      .from("orders")
      .select("id,customer_id,merchant_id,status")
      .eq("id",orderId)
      .eq("customer_id",user.id)
      .maybeSingle();
    if(orderError)throw orderError;
    if(!order)throw new DomainError("ORDER_NOT_FOUND","Pedido não encontrado.",404);

    if(action==="feedback"){
      if(order.status!=="SETTLED"||!order.merchant_id){
        throw new DomainError("FEEDBACK_NOT_AVAILABLE","A avaliação fica disponível após a conclusão da entrega.",409);
      }
      const rating=Number(body.rating);
      if(![1,5].includes(rating))throw new DomainError("INVALID_RATING","Avaliação inválida.",400);
      const rawTags:unknown[]=Array.isArray(body.tags)?body.tags:[];
      const tags=[...new Set(rawTags.map((x:unknown)=>String(x).trim()).filter((x:string)=>FEEDBACK_TAGS.has(x)))].slice(0,8);
      const note=cleanNote(body.note,500);
      const now=new Date().toISOString();

      const {data,error}=await admin
        .from("order_feedback")
        .upsert({
          order_id:order.id,
          customer_id:user.id,
          merchant_id:order.merchant_id,
          rating,
          tags,
          note,
          updated_at:now
        },{onConflict:"order_id"})
        .select("order_id,rating,tags,note,created_at,updated_at")
        .single();
      if(error)throw error;
      return json({
        ok:true,
        feedback:{
          orderId:data.order_id,
          rating:data.rating,
          tags:data.tags??[],
          note:data.note??null,
          createdAt:data.created_at,
          updatedAt:data.updated_at
        }
      },200,origin);
    }

    const idempotencyKey=validateIdempotencyKey(req.headers.get("Idempotency-Key"));
    const category=String(body.category??"").trim();
    if(!CASE_CATEGORIES.has(category))throw new DomainError("INVALID_CATEGORY","Tipo de problema inválido.",400);
    const message=cleanNote(body.message,1000);
    const requestHash=await requestFingerprint("customer-care:open-case",{orderId,category,message});

    const {data:existing,error:existingError}=await admin
      .from("support_cases")
      .select("id,customer_id,order_id,category,status,request_hash,created_at")
      .eq("request_idempotency_key",idempotencyKey)
      .maybeSingle();
    if(existingError)throw existingError;
    if(existing){
      if(existing.customer_id!==user.id||existing.request_hash!==requestHash){
        throw new DomainError("IDEMPOTENCY_CONFLICT","A mesma chave foi usada para outra solicitação.",409);
      }
      return json({ok:true,case:existing,replayed:true},200,origin);
    }

    const payload={
      order_id:order.id,
      customer_id:user.id,
      merchant_id:order.merchant_id,
      category,
      message,
      request_idempotency_key:idempotencyKey,
      request_hash:requestHash
    };
    const {data:created,error:createError}=await admin
      .from("support_cases")
      .insert(payload)
      .select("id,order_id,category,status,created_at")
      .single();

    if(createError){
      if(createError.code==="23505"){
        const {data:openCase,error:openError}=await admin
          .from("support_cases")
          .select("id,order_id,category,status,created_at")
          .eq("customer_id",user.id)
          .eq("order_id",order.id)
          .eq("category",category)
          .in("status",["open","in_review"])
          .order("created_at",{ascending:false})
          .limit(1)
          .maybeSingle();
        if(openError)throw openError;
        if(openCase)return json({ok:true,case:openCase,alreadyOpen:true},200,origin);
      }
      throw createError;
    }

    const {error:eventError}=await admin.from("order_events").insert({
      order_id:order.id,
      actor_user_id:user.id,
      actor_type:"customer",
      event_type:"SUPPORT_CASE_OPENED",
      title:"Ajuda solicitada",
      detail:"O cliente registrou um problema para acompanhamento.",
      metadata:{supportCaseId:created.id,category}
    });
    if(eventError)throw eventError;

    return json({ok:true,case:created},201,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("customer-care failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível registrar sua solicitação."},500,origin);
  }
});
