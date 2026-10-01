import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import { DomainError,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const PROD_ORIGIN="https://carloskk07.github.io";
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"").trim();
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function merchantOriginAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return MERCHANT_ALLOWED_ORIGIN.length>0&&origin===MERCHANT_ALLOWED_ORIGIN;
}
function originAllowed(origin:string|null){
  if(!origin)return true;
  if(origin===PROD_ORIGIN)return true;
  if(merchantOriginAllowed(origin))return true;
  return false;
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
  return data.user;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const orderId=String(body.orderId??"");
    if(!UUID_RE.test(orderId))throw new DomainError("INVALID_ORDER","Pedido inválido.",400);

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"get-order",limit:120,windowSeconds:60});
    const {data:order,error:orderError}=await admin
      .from("orders")
      .select("id,public_code,customer_id,merchant_id,status,financial_state,financial_reversed_at,financial_reversal_reason,address_text,payment_method,gross_total_cents,cashback_reserved_cents,total_cents,proposed_total_cents,supplier_name_snapshot,risk_reason,offer_expires_at,accepted_at,dispatch_due_at,dispatched_at,arriving_at,promised_by,delivered_at,settled_at,payment_confirmed_at,pin_failures,version,created_at,updated_at")
      .eq("id",orderId)
      .maybeSingle();

    if(orderError)throw orderError;
    if(!order)return json({error:"ORDER_NOT_FOUND",message:"Pedido não encontrado."},404,origin);

    let role:"customer"|"merchant"|null=null;
    let memberRole:string|null=null;

    if(order.customer_id===user.id){
      role="customer";
    }else if(order.merchant_id&&!["REASSIGNING","REQUOTE_REQUIRED","CANCELLED"].includes(order.status)){
      const {data:membership,error:membershipError}=await admin
        .from("merchant_members")
        .select("member_role,active")
        .eq("merchant_id",order.merchant_id)
        .eq("user_id",user.id)
        .eq("active",true)
        .maybeSingle();
      if(membershipError)throw membershipError;
      if(membership&&["owner","manager","operator"].includes(membership.member_role)){
        role="merchant";
        memberRole=membership.member_role;
      }
    }

    if(!role)return json({error:"ACCESS_DENIED",message:"Você não possui acesso a este pedido."},403,origin);
    if(role==="merchant"&&!merchantOriginAllowed(origin)){
      return json({error:"MERCHANT_ORIGIN_REQUIRED",message:"O acesso operacional da revenda exige uma origem dedicada."},403,origin);
    }

    const [{data:items,error:itemError},{data:events,error:eventError}]=await Promise.all([
      admin.from("order_items")
        .select("product_code,product_name,quantity,unit_price_cents,line_total_cents")
        .eq("order_id",order.id)
        .order("product_code"),
      admin.from("order_events")
        .select("event_type,title,detail,created_at")
        .eq("order_id",order.id)
        .order("created_at",{ascending:true})
    ]);
    if(itemError)throw itemError;
    if(eventError)throw eventError;

    let deliveryPin:string|null=null;
    if(role==="customer"&&["OUT_FOR_DELIVERY","ARRIVING"].includes(order.status)){
      const {data:secret,error:secretError}=await admin
        .from("order_delivery_secrets")
        .select("pin_code,revealed_at,consumed_at")
        .eq("order_id",order.id)
        .maybeSingle();
      if(secretError)throw secretError;
      if(secret&&!secret.consumed_at){
        deliveryPin=secret.pin_code;
        if(!secret.revealed_at){
          await admin.from("order_delivery_secrets")
            .update({revealed_at:new Date().toISOString()})
            .eq("order_id",order.id)
            .is("revealed_at",null);
        }
      }
    }

    const safeOrder={
      orderId:order.id,
      publicCode:order.public_code,
      role,
      memberRole:role==="merchant"?memberRole:null,
      status:order.status,
      financialState:order.financial_state,
      financialReversedAt:role==="customer"?order.financial_reversed_at:null,
      financialReversalReason:role==="customer"?order.financial_reversal_reason:null,
      version:order.version,
      address:role==="customer"||order.status!=="OFFERED_TO_MERCHANT"?order.address_text:null,
      addressVisible:role==="customer"||order.status!=="OFFERED_TO_MERCHANT",
      paymentMethod:order.payment_method,
      grossTotalCents:order.gross_total_cents,
      cashbackReservedCents:order.cashback_reserved_cents,
      totalCents:order.total_cents,
      proposedTotalCents:role==="customer"&&order.status==="REQUOTE_REQUIRED"?order.proposed_total_cents:null,
      supplierName:order.supplier_name_snapshot,
      riskReason:order.risk_reason,
      offerExpiresAt:order.offer_expires_at,
      acceptedAt:order.accepted_at,
      dispatchDueAt:order.dispatch_due_at,
      dispatchedAt:order.dispatched_at,
      arrivingAt:order.arriving_at,
      promisedBy:order.promised_by,
      deliveredAt:order.delivered_at,
      settledAt:order.settled_at,
      paymentConfirmedAt:order.payment_confirmed_at,
      pinFailures:role==="merchant"?order.pin_failures:null,
      deliveryPin,
      items:items??[],
      events:(events??[]).map((e)=>({
        type:e.event_type,
        title:e.title,
        detail:e.detail,
        createdAt:e.created_at
      })),
      createdAt:order.created_at,
      updatedAt:order.updated_at
    };

    return json(safeOrder,200,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("get-order failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível carregar o pedido."},500,origin);
  }
});
