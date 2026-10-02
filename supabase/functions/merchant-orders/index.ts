import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import { DomainError,
  assertPermanentMerchantUser,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";
import {
  isOperationalMerchantRole,
  operationalMerchantMemberships,
  selectMerchantMembership
} from "../_shared/merchant-membership.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"").trim();
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES=[
  "OFFERED_TO_MERCHANT","MERCHANT_ACCEPTED","PREPARING","AT_RISK",
  "OUT_FOR_DELIVERY","ARRIVING"
];

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return MERCHANT_ALLOWED_ORIGIN.length>0&&origin===MERCHANT_ALLOWED_ORIGIN;
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:(MERCHANT_ALLOWED_ORIGIN||"null");
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

    const selected=selectMerchantMembership(memberships,requestedMerchantId);
    if(!selected)return json({error:"MERCHANT_ACCESS_DENIED",message:"Você não possui acesso a esta revenda."},403,origin);
    if(!isOperationalMerchantRole(selected.member_role)){
      return json({error:"MERCHANT_ROLE_NOT_ENABLED",message:"Este papel ainda não possui painel operacional no piloto."},403,origin);
    }

    const membershipMerchantIds=operationalMerchantMemberships(memberships)
      .map((m)=>m.merchant_id);
    const {data:membershipMerchants,error:membershipMerchantsError}=await admin
      .from("merchants")
      .select("id,name")
      .in("id",membershipMerchantIds);
    if(membershipMerchantsError)throw membershipMerchantsError;
    const merchantNames=new Map((membershipMerchants??[]).map((m)=>[m.id,m.name]));

    const {data:merchant,error:merchantError}=await admin
      .from("merchants")
      .select("id,name,status,online,trust_score,delivery_fee_cents,delivery_fee_confirmed_at,base_eta_minutes,accepts_citywide,last_seen_at")
      .eq("id",selected.merchant_id)
      .maybeSingle();
    if(merchantError)throw merchantError;
    if(!merchant)return json({error:"MERCHANT_NOT_FOUND"},404,origin);

    const {data:catalog,error:catalogError}=await admin
      .from("catalog_items")
      .select("product_code,product_name,price_cents,available_stock,active,price_confirmed_at,updated_at")
      .eq("merchant_id",selected.merchant_id)
      .order("product_code");
    if(catalogError)throw catalogError;

    const [
      {data:compliance,error:complianceError},
      {data:compliancePolicy,error:compliancePolicyError},
      {data:cnpjCurrent,error:cnpjCurrentError},
      {data:anpCurrent,error:anpCurrentError}
    ]=await Promise.all([
      admin
        .from("merchant_compliance")
        .select("cnpj_status,anp_status,cnpj_verified_at,anp_verified_at")
        .eq("merchant_id",selected.merchant_id)
        .maybeSingle(),
      admin
        .from("merchant_compliance_policy")
        .select("cnpj_max_age_days,anp_max_age_days")
        .eq("policy_key","default")
        .maybeSingle(),
      admin.rpc("merchant_cnpj_compliance_current",{p_merchant_id:selected.merchant_id}),
      admin.rpc("merchant_anp_compliance_current",{p_merchant_id:selected.merchant_id})
    ]);
    if(complianceError)throw complianceError;
    if(compliancePolicyError)throw compliancePolicyError;
    if(cnpjCurrentError)throw cnpjCurrentError;
    if(anpCurrentError)throw anpCurrentError;

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
        deliveryFeeConfirmedAt:merchant.delivery_fee_confirmed_at,
        lastSeenAt:merchant.last_seen_at,
        compliance:{
          cnpjStatus:compliance?.cnpj_status??"pending",
          anpStatus:compliance?.anp_status??"pending",
          cnpjVerifiedAt:compliance?.cnpj_verified_at??null,
          anpVerifiedAt:compliance?.anp_verified_at??null,
          cnpjCurrent:cnpjCurrent===true,
          anpCurrent:anpCurrent===true,
          cnpjMaxAgeDays:Number(compliancePolicy?.cnpj_max_age_days??30),
          anpMaxAgeDays:Number(compliancePolicy?.anp_max_age_days??7)
        }
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
        priceConfirmedAt:item.price_confirmed_at,
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
