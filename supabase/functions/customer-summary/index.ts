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
const CUSTOMER_ALLOWED_ORIGIN=(Deno.env.get("CUSTOMER_ALLOWED_ORIGIN")??"").trim();

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return CUSTOMER_ALLOWED_ORIGIN.length>0&&origin===CUSTOMER_ALLOWED_ORIGIN;
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:(CUSTOMER_ALLOWED_ORIGIN||"null");
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
  const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user){
    throw new DomainError("UNAUTHORIZED","Sessão inválida ou expirada.",401);
  }
  return data.user;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    await readJsonBody(req);

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    await enforceApiQuota(admin,{
      userId:user.id,
      actionName:"customer-summary",
      limit:30,
      windowSeconds:60
    });

    const [
      {data,error},
      {data:benefitTotals,error:benefitTotalsError}
    ]=await Promise.all([
      admin.rpc("customer_financial_summary",{p_user_id:user.id}),
      admin.rpc("customer_benefit_totals",{p_user_id:user.id})
    ]);
    if(error)throw error;
    if(benefitTotalsError)throw benefitTotalsError;

    const ACTIVE_ORDER_STATUSES=[
      "OFFERED_TO_MERCHANT","MERCHANT_ACCEPTED","PREPARING","OUT_FOR_DELIVERY",
      "ARRIVING","AT_RISK","REASSIGNING","REQUOTE_REQUIRED"
    ];
    const [
      {data:activeOrder,error:activeOrderError},
      {data:recentOrders,error:recentOrdersError},
      {count:referredCount,error:referredCountError},
      {count:qualifiedReferralCount,error:qualifiedReferralCountError}
    ]=await Promise.all([
      admin
        .from("orders")
        .select("id,status,version,updated_at")
        .eq("customer_id",user.id)
        .in("status",ACTIVE_ORDER_STATUSES)
        .order("created_at",{ascending:false})
        .limit(1)
        .maybeSingle(),
      admin
        .from("orders")
        .select("id,public_code,address_text,payment_method,total_cents,settled_at,created_at")
        .eq("customer_id",user.id)
        .eq("status","SETTLED")
        .eq("financial_state","settled")
        .order("settled_at",{ascending:false})
        .limit(6),
      admin
        .from("referrals")
        .select("*",{count:"exact",head:true})
        .eq("referrer_user_id",user.id),
      admin
        .from("referrals")
        .select("*",{count:"exact",head:true})
        .eq("referrer_user_id",user.id)
        .not("qualified_order_id","is",null)
    ]);
    if(activeOrderError)throw activeOrderError;
    if(recentOrdersError)throw recentOrdersError;
    if(referredCountError)throw referredCountError;
    if(qualifiedReferralCountError)throw qualifiedReferralCountError;

    const settledIds=(recentOrders??[]).map((o)=>o.id);
    let recentItems:any[]=[];
    if(settledIds.length){
      const {data:itemRows,error:itemError}=await admin
        .from("order_items")
        .select("order_id,product_code,product_name,quantity")
        .in("order_id",settledIds)
        .order("product_code");
      if(itemError)throw itemError;
      recentItems=itemRows??[];
    }
    const itemsByOrder=new Map<string,any[]>();
    for(const item of recentItems){
      if(!itemsByOrder.has(item.order_id))itemsByOrder.set(item.order_id,[]);
      itemsByOrder.get(item.order_id)!.push({
        productCode:item.product_code,
        productName:item.product_name,
        quantity:Number(item.quantity)
      });
    }

    const lastOrder=(recentOrders??[])[0]??null;
    const lastOrderTemplate=lastOrder?{
      orderId:lastOrder.id,
      publicCode:lastOrder.public_code,
      address:lastOrder.address_text,
      paymentMethod:lastOrder.payment_method,
      totalCents:Number(lastOrder.total_cents??0),
      settledAt:lastOrder.settled_at,
      items:itemsByOrder.get(lastOrder.id)??[]
    }:null;

    const intervals:number[]=[];
    const history=recentOrders??[];
    for(let i=0;i<history.length-1;i++){
      const newer=Date.parse(history[i].settled_at??history[i].created_at??"");
      const older=Date.parse(history[i+1].settled_at??history[i+1].created_at??"");
      const days=(newer-older)/86400000;
      if(Number.isFinite(days)&&days>=7&&days<=180)intervals.push(days);
    }
    intervals.sort((a,b)=>a-b);
    const medianDays=intervals.length
      ? intervals.length%2
        ? intervals[(intervals.length-1)/2]
        : (intervals[intervals.length/2-1]+intervals[intervals.length/2])/2
      : null;
    const lastSettledAt=lastOrder?Date.parse(lastOrder.settled_at??lastOrder.created_at??""):NaN;
    const predictedAt=medianDays!=null&&Number.isFinite(lastSettledAt)
      ? new Date(lastSettledAt+medianDays*86400000).toISOString()
      : null;
    const reorderPrediction=predictedAt?{
      predictedAt,
      typicalIntervalDays:Math.max(1,Math.round(medianDays!)),
      samples:intervals.length,
      confidence:intervals.length>=3?"learned":"early"
    }:null;

    return json({
      referralCode:data?.referralCode??null,
      cashbackCents:Number(data?.cashbackCents??0),
      cashbackDebtCents:Number(data?.cashbackDebtCents??0),
      cashbackEarnedCents:Number(benefitTotals?.cashbackEarnedCents??0),
      comparisonSavingsCents:Number(benefitTotals?.comparisonSavingsCents??0),
      commissionPendingCents:Number(data?.commissionPendingCents??0),
      commissionAvailableCents:Number(data?.commissionAvailableCents??0),
      settledOrders:Number(data?.settledOrders??0),
      reversedOrders:Number(data?.reversedOrders??0),
      cashEarningEligible:user.is_anonymous!==true,
      identityType:user.is_anonymous===true?"anonymous":"permanent",
      referredCount:Number(referredCount??0),
      qualifiedReferralCount:Number(qualifiedReferralCount??0),
      lastOrderTemplate,
      reorderPrediction,
      activeOrderId:activeOrder?.id??null,
      activeOrderStatus:activeOrder?.status??null,
      activeOrderVersion:activeOrder?.version==null?null:Number(activeOrder.version)
    },200,origin);
  }catch(error){
    if(error instanceof DomainError){
      return json({error:error.code,message:error.message},error.status,origin);
    }
    console.error("customer-summary failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível carregar seu resumo."},500,origin);
  }
});
