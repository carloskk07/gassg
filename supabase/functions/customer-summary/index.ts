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
    const requestBody=await readJsonBody(req);

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    await enforceApiQuota(admin,{
      userId:user.id,
      actionName:"customer-summary",
      limit:30,
      windowSeconds:60
    });

    // A participant explicitly opening their statement does NOT become
    // eligible for the 24-hour pool simply by reading the statement.
    // Auth UID is derived from the verified token, never requestBody.userId.
    if(requestBody?.statementOnly===true){
      const category=String(requestBody.statementCategory??"all");
      const page=requestBody.statementPage??1;
      if(!["all","rede","cashback","clube"].includes(category)||
         !Number.isSafeInteger(page)||page<1||page>100)
        throw new DomainError("BENEFIT_STATEMENT_BAD_FILTER",
          "Selecione um filtro ou página válida do extrato.",400);
      const {data:statement,error:statementError}=await admin.rpc(
        "network_member_benefit_statement_v1_1045",{
          p_user:user.id,p_category:category,p_page:page,p_limit:12
        });
      if(statementError)throw statementError;
      if(statement?.source!=="network_member_statement_v1_1045"||
          statement.readOnly!==true||statement.moneyMoved!==false||
          statement.category!==category||statement.page!==page||
          statement.pageSize!==12||typeof statement.hasMore!=="boolean"||
          !Array.isArray(statement.items)||statement.items.length>12||
          !statement.items.every((item:Record<string,unknown>)=>
            typeof item.title==="string"&&typeof item.origin==="string"&&
            typeof item.detail==="string"&&typeof item.status==="string"&&
            ["wallet","network","discount","transfer"].includes(String(item.money_type))&&
            Number.isSafeInteger(item.amountCents)&&
            Number.isSafeInteger(item.amountMicrocents)&&
            typeof item.occurredAt==="string"&&item.unit==="BRL"))
        throw new DomainError("BENEFIT_STATEMENT_UNVERIFIED",
          "O extrato não pôde ser conferido no servidor.",503);
      return json(statement,200,origin);
    }

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
        .select("id,public_code,address_text,postal_code,address_number,payment_method,total_cents,settled_at,created_at")
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

    // Rede TAMÃO: an actual authenticated visit is explicitly signaled by
    // the user's Rede page. Ordinary refresh/token renewal is NOT activity.
    // No direct money writes: the financial statement comes from a separate
    // private, reconciled 10%-fee-package ledger.
    let networkPackage:Record<string,unknown>={available:false};
    let networkVisit:Record<string,unknown>={recorded:false};
    if(user.is_anonymous!==true){
      // The URL code is only a hint; Postgres verifies the inviter,
      // permanent account, first-touch and self-referral before binding.
      const hint=String(requestBody?.referralCode||"").trim().toUpperCase();
      if(/^[A-Z0-9]{5,40}$/.test(hint)){
        const {error:bindingError}=await admin.rpc("network_module_bind_invite_v1_1041",
          {p_actor:user.id,p_code:hint});
        if(bindingError)console.warn("Network first-touch unavailable",String(bindingError.message||""));
      }
      if(requestBody?.networkVisit===true){
        const {error:bonusError}=await admin.rpc("network_module_ads_bonus_refresh_v1_1041",
          {p_inviter:user.id});
        if(bonusError)console.warn("Network ads benefits unavailable",String(bonusError.message||""));
      }
      if(requestBody?.networkVisit===true){
        const {error:directError}=await admin.rpc("network_direct_module_refresh_v1_1044",
          {p_inviter:user.id});
        if(directError)console.warn("Network direct module benefits unavailable",
          String(directError.message||""));
      }
      if(requestBody?.networkVisit===true){
        const {error:celebraError}=await admin.rpc("network_celebra_refresh_v1_1046",
          {p_inviter:user.id});
        if(celebraError)console.warn("Celebration benefits unavailable",
          String(celebraError.message||""));
      }
      if(requestBody?.networkVisit===true){
        const {data:visit,error:visitError}=await admin.rpc(
          "network_record_visit_v1_1030",{p_user:user.id,p_portal:"customer"});
        if(!visitError&&visit?.source==="network_visit_v1_1030"){
          networkVisit=visit;
        }else if(visitError){
          console.warn("network visit unavailable",String(visitError.message||""));
        }
      }
      const {data:network,error:networkError}=await admin.rpc(
        "network_user_fee_package_summary_v1_1030",{p_user:user.id});
      if(!networkError&&network?.source==="network_fee_package_user_v1_1030"&&
        network.readOnly===true&&network.payoutsEnabled===false&&
        ["pendingMicrocents","validatedMicrocents","reversedMicrocents",
          "pendingCents","validatedCents"].every(k=>
            Number.isSafeInteger(network[k])&&network[k]>=0)){
        networkPackage={available:true,...network};
      }else if(networkError){
        console.warn("network fee-package balance unavailable",
          String(networkError.message||""));
      }
    }

    let moduleBenefits:Record<string,unknown>={available:false};
    if(user.is_anonymous!==true){
      const {data:verified,error:moduleError}=await admin.rpc(
        "network_module_benefits_summary_v1_1041",{p_inviter:user.id});
      const names=["products","merchants","mobility","professionals","rides","club","advertising"];
      if(!moduleError&&verified?.source==="network_module_benefits_v1_1041"&&
        verified.readOnly===true&&verified.cashPayoutsEnabled===false&&
        names.every(k=>Number.isSafeInteger(verified?.modules?.[k])&&verified.modules[k]>=0)&&
        Number.isSafeInteger(verified.verifiedConversions)&&verified.verifiedConversions>=0&&
        Number.isSafeInteger(verified.invitedAccounts)&&verified.invitedAccounts>=0){
        moduleBenefits={available:true,...verified};
      }else if(moduleError){
        console.warn("Network module benefits unavailable",String(moduleError.message||""));
      }
    }

    let networkDirect:Record<string,unknown>={available:false};
    if(user.is_anonymous!==true){
      const {data:direct,error:directError}=await admin.rpc(
        "network_direct_module_summary_v1_1044",{p_inviter:user.id});
      const validModule=(m:Record<string,unknown>|undefined)=>
        m&&typeof m.enabled==="boolean"&&
        ["inviterBps","validatedAwards","reversedAwards","validatedCents"]
          .every(k=>Number.isSafeInteger(m[k])&&(m[k] as number)>=0);
      if(!directError&&direct?.source==="network_direct_summary_v1_1044"&&
         direct.readOnly===true&&direct.cashPayoutsEnabled===false&&
         validModule(direct?.modules?.mobility)&&validModule(direct?.modules?.club)){
        networkDirect={available:true,...direct};
      }else if(directError){
        console.warn("Network direct bonus summary unavailable",String(directError.message||""));
      }
    }

    let networkCelebra:Record<string,unknown>={available:false};
    if(user.is_anonymous!==true){
      const {data:celebra,error:celebraError}=await admin.rpc(
        "network_celebra_user_summary_v1_1046",{p_user:user.id});
      if(!celebraError&&celebra?.source==="network_celebra_user_v1_1046"&&
         celebra.readOnly===true&&celebra.cashPayoutsEnabled===false&&
         Array.isArray(celebra.items)&&celebra.items.length<=2&&
         celebra.items.every((c:Record<string,unknown>)=>
           typeof c.key==="string"&&typeof c.title==="string"&&
           typeof c.message==="string"&&
           ["upcoming","active","ended"].includes(String(c.phase))&&
           Number.isSafeInteger(c.extraBps)&&
           Number.isSafeInteger(c.memberLimitCents)&&
           Number.isSafeInteger(c.validatedCents)&&
           typeof c.startsAt==="string"&&typeof c.endsAt==="string")){
        networkCelebra={available:true,...celebra};
      }else if(celebraError){
        console.warn("Celebration summary unavailable",String(celebraError.message||""));
      }
    }

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
      postalCode:lastOrder.postal_code,
      addressNumber:lastOrder.address_number,
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
      networkPackage,
      moduleBenefits,
      networkDirect,
      networkCelebra,
      networkVisit,
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
