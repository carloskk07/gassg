import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import { DomainError,
  assertPermanentMerchantUser,
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
const ACTIVE_STATUSES=[
  "OFFERED_TO_MERCHANT","MERCHANT_ACCEPTED","PREPARING","AT_RISK",
  "OUT_FOR_DELIVERY","ARRIVING"
];

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

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const requestedMerchantId=body.merchantId==null?null:String(body.merchantId);
    if(requestedMerchantId&&!UUID_RE.test(requestedMerchantId)){
      throw new DomainError("INVALID_MERCHANT","Revenda inválida.",400);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"merchant-orders",limit:120,windowSeconds:60});
    const {data:memberships,error:membershipError}=await admin
      .from("merchant_members")
      .select("merchant_id,member_role,active")
      .eq("user_id",user.id)
      .eq("active",true);
    if(membershipError)throw membershipError;
    if(!memberships?.length)return json({error:"NO_MERCHANT_ACCESS",message:"Sua conta ainda não está vinculada a uma revenda."},403,origin);

    const selected=requestedMerchantId
      ? memberships.find((m)=>m.merchant_id===requestedMerchantId)
      : memberships[0];
    if(!selected)return json({error:"MERCHANT_ACCESS_DENIED",message:"Você não possui acesso a esta revenda."},403,origin);
    if(!["owner","manager","operator"].includes(selected.member_role)){
      return json({error:"MERCHANT_ROLE_NOT_ENABLED",message:"Este papel ainda não possui painel operacional no piloto."},403,origin);
    }

    const membershipMerchantIds=memberships
      .filter((m)=>["owner","manager","operator"].includes(m.member_role))
      .map((m)=>m.merchant_id);
    const {data:membershipMerchants,error:membershipMerchantsError}=await admin
      .from("merchants")
      .select("id,name")
      .in("id",membershipMerchantIds);
    if(membershipMerchantsError)throw membershipMerchantsError;
    const merchantNames=new Map((membershipMerchants??[]).map((m)=>[m.id,m.name]));

    const {data:merchant,error:merchantError}=await admin
      .from("merchants")
      .select("id,name,status,online,trust_score,delivery_fee_cents,base_eta_minutes,accepts_citywide,price_confirmed_at,last_seen_at")
      .eq("id",selected.merchant_id)
      .maybeSingle();
    if(merchantError)throw merchantError;
    if(!merchant)return json({error:"MERCHANT_NOT_FOUND"},404,origin);

    const {data:catalog,error:catalogError}=await admin
      .from("catalog_items")
      .select("product_code,product_name,price_cents,available_stock,active,updated_at")
      .eq("merchant_id",selected.merchant_id)
      .order("product_code");
    if(catalogError)throw catalogError;

    const {data:orders,error:ordersError}=await admin
      .from("orders")
      .select("id,public_code,status,address_text,payment_method,gross_total_cents,cashback_reserved_cents,total_cents,supplier_name_snapshot,risk_reason,offer_expires_at,accepted_at,dispatch_due_at,dispatched_at,arriving_at,promised_by,pin_failures,version,created_at,updated_at")
      .eq("merchant_id",selected.merchant_id)
      .in("status",ACTIVE_STATUSES)
      .order("created_at",{ascending:true})
      .limit(100);
    if(ordersError)throw ordersError;

    const ids=(orders??[]).map((o)=>o.id);
    let items:any[]=[];
    if(ids.length){
      const {data,error}=await admin
        .from("order_items")
        .select("order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents")
        .in("order_id",ids)
        .order("product_code");
      if(error)throw error;
      items=data??[];
    }

    const byOrder=new Map<string,any[]>();
    for(const item of items){
      if(!byOrder.has(item.order_id))byOrder.set(item.order_id,[]);
      byOrder.get(item.order_id)!.push({
        productCode:item.product_code,
        productName:item.product_name,
        quantity:item.quantity,
        unitPriceCents:item.unit_price_cents,
        lineTotalCents:item.line_total_cents
      });
    }

    return json({
      merchant:{
        merchantId:merchant.id,
        name:merchant.name,
        memberRole:selected.member_role,
        status:merchant.status,
        online:merchant.online,
        trustScore:merchant.trust_score,
        deliveryFeeCents:merchant.delivery_fee_cents,
        baseEtaMinutes:merchant.base_eta_minutes,
        acceptsCitywide:merchant.accepts_citywide,
        priceConfirmedAt:merchant.price_confirmed_at,
        lastSeenAt:merchant.last_seen_at
      },
      memberships:memberships
        .filter((m)=>["owner","manager","operator"].includes(m.member_role))
        .map((m)=>({
          merchantId:m.merchant_id,
          memberRole:m.member_role,
          name:merchantNames.get(m.merchant_id)??"Revenda"
        })),
      catalog:(catalog??[]).map((item)=>({
        productCode:item.product_code,
        productName:item.product_name,
        priceCents:item.price_cents,
        availableStock:item.available_stock,
        active:item.active,
        updatedAt:item.updated_at
      })),
      orders:(orders??[]).map((o)=>({
        orderId:o.id,
        publicCode:o.public_code,
        status:o.status,
        address:o.status==="OFFERED_TO_MERCHANT"?null:o.address_text,
        addressVisible:o.status!=="OFFERED_TO_MERCHANT",
        paymentMethod:o.payment_method,
        grossTotalCents:o.gross_total_cents,
        cashbackReservedCents:o.cashback_reserved_cents,
        totalCents:o.total_cents,
        supplierName:o.supplier_name_snapshot,
        riskReason:o.risk_reason,
        offerExpiresAt:o.offer_expires_at,
        acceptedAt:o.accepted_at,
        dispatchDueAt:o.dispatch_due_at,
        dispatchedAt:o.dispatched_at,
        arrivingAt:o.arriving_at,
        promisedBy:o.promised_by,
        pinFailures:o.pin_failures,
        version:o.version,
        items:byOrder.get(o.id)??[],
        createdAt:o.created_at,
        updatedAt:o.updated_at
      }))
    },200,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("merchant-orders failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível carregar os pedidos da revenda."},500,origin);
  }
});
