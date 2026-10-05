import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  readJsonBody,
  enforceApiQuota,
  requestFingerprint
} from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const LEGACY_ADMIN_ALLOWED_ORIGIN=(Deno.env.get("ADMIN_ALLOWED_ORIGIN")??"https://chama-sg-admin.netlify.app").trim();
const LEGACY_CUSTOMER_ALLOWED_ORIGIN=(Deno.env.get("CUSTOMER_ALLOWED_ORIGIN")??"https://chama-sg-cliente.netlify.app").trim();
const LEGACY_MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"https://chama-sg-revenda.netlify.app").trim();
const ADMIN_LIVE_ORIGIN="https://admin.tamao.com.br";
const CUSTOMER_LIVE_ORIGIN="https://tamao.com.br";
const MERCHANT_LIVE_ORIGIN="https://parceiro.tamao.com.br";
const ADMIN_PAGES_ORIGIN="https://tamao-sg-admin.pages.dev";
const ADMIN_PRIMARY_ORIGINS=new Set([
  ADMIN_LIVE_ORIGIN,
  ADMIN_PAGES_ORIGIN,
  LEGACY_ADMIN_ALLOWED_ORIGIN
].filter(Boolean));
const TEST_TURNSTILE_KEYS=new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
  "0x4AAAAAAAAAA-demo-site-key"
]);
const PORTAL_PROBE_TIMEOUT_MS=5000;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return ADMIN_PRIMARY_ORIGINS.has(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:ADMIN_LIVE_ORIGIN;
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
  if(data.user.is_anonymous===true){
    throw new DomainError("PERMANENT_IDENTITY_REQUIRED","Admin exige conta permanente.",403);
  }
  return data.user;
}
function uuid(value:unknown,name:string){
  const v=String(value??"");
  if(!UUID_RE.test(v))throw new DomainError("INVALID_"+name.toUpperCase(),name+" inválido.",400);
  return v;
}
function cleanText(value:unknown,{min=0,max=240,name="texto"}={}){
  const v=String(value??"").trim().replace(/\s+/g," ");
  if(v.length<min||v.length>max)throw new DomainError("INVALID_TEXT",name+" inválido.",400);
  return v;
}
async function requireAdmin(admin:any,userId:string){
  const {data,error}=await admin
    .from("platform_admins")
    .select("user_id,active")
    .eq("user_id",userId)
    .eq("active",true)
    .maybeSingle();
  if(error)throw error;
  if(!data)throw new DomainError("ADMIN_ACCESS_DENIED","Esta conta não possui acesso administrativo.",403);
}
async function fetchTextWithTimeout(url:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),PORTAL_PROBE_TIMEOUT_MS);
  try{
    const response=await fetch(url,{
      method:"GET",
      headers:{"Accept":"application/json,text/plain,*/*","Cache-Control":"no-cache"},
      signal:controller.signal
    });
    if(!response.ok)throw new Error("PORTAL_HTTP_"+response.status);
    return await response.text();
  }finally{
    clearTimeout(timer);
  }
}
function runtimeAssignment(source:string,key:string){
  const pattern=new RegExp("globalThis\\."+key+"=([^;]+);");
  const match=pattern.exec(source);
  if(!match)return null;
  try{return JSON.parse(match[1])}catch{return null}
}
async function probePortal(role:"customer"|"merchant"|"admin",origin:string){
  try{
    const [buildText,runtimeText]=await Promise.all([
      fetchTextWithTimeout(origin+"/portal-build.json"),
      fetchTextWithTimeout(origin+"/js/runtime-config.js")
    ]);
    const build=JSON.parse(buildText);
    const roleInRuntime=runtimeAssignment(runtimeText,"CHAMA_PORTAL_ROLE");
    const turnstileKey=String(runtimeAssignment(runtimeText,"CHAMA_TURNSTILE_SITE_KEY")??"").trim();
    const customerOrigin=String(runtimeAssignment(runtimeText,"CHAMA_CUSTOMER_ORIGIN")??"").trim();
    const merchantOrigin=String(runtimeAssignment(runtimeText,"CHAMA_MERCHANT_ORIGIN")??"").trim();
    const adminOrigin=String(runtimeAssignment(runtimeText,"CHAMA_ADMIN_ORIGIN")??"").trim();
    const sourceSha=String(build?.sourceSha??"").trim().toLowerCase();
    const ok=
      build?.schemaVersion===1
      &&build?.portalRole===role
      &&roleInRuntime===role
      &&/^[0-9a-f]{40}$/.test(sourceSha)
      &&turnstileKey.length>0
      &&!TEST_TURNSTILE_KEYS.has(turnstileKey)
      &&customerOrigin===CUSTOMER_LIVE_ORIGIN
      &&merchantOrigin===MERCHANT_LIVE_ORIGIN
      &&adminOrigin===ADMIN_LIVE_ORIGIN
      &&build?.customerOrigin===CUSTOMER_LIVE_ORIGIN
      &&build?.merchantOrigin===MERCHANT_LIVE_ORIGIN
      &&build?.adminOrigin===ADMIN_LIVE_ORIGIN;
    return {role,origin,ok,sourceSha:ok?sourceSha:null};
  }catch(error){
    return {
      role,
      origin,
      ok:false,
      sourceSha:null,
      error:error instanceof Error?error.message:String(error)
    };
  }
}
async function verifyLivePortals(){
  const probes=await Promise.all([
    probePortal("customer",CUSTOMER_LIVE_ORIGIN),
    probePortal("merchant",MERCHANT_LIVE_ORIGIN),
    probePortal("admin",ADMIN_LIVE_ORIGIN)
  ]);
  const shas=new Set(probes.filter(x=>x.ok&&x.sourceSha).map(x=>x.sourceSha));
  const allOk=probes.every(x=>x.ok)&&shas.size===1;
  return {
    ok:allOk,
    sourceSha:allOk?[...shas][0]:null,
    probes
  };
}
async function summary(admin:any,actorUserId:string){
  const [apps,merchants,compliance,capabilities,referralReviews,rewardFailures,accountingFailures,receivables,reimbursements,adjustments,platformAdmins,prelaunchLeads,publicRequests,audit]=await Promise.all([
    admin.from("merchant_applications")
      .select("id,applicant_user_id,cnpj,company_name,responsible_name,phone,address_text,status,created_at,updated_at")
      .order("created_at",{ascending:false})
      .limit(50),
    admin.from("merchants")
      .select("id,name,cnpj,status,online,trust_score,address_text,delivery_fee_cents,base_eta_minutes,accepts_citywide,price_confirmed_at,last_seen_at,created_at")
      .order("created_at",{ascending:false})
      .limit(100),
    admin.from("merchant_compliance")
      .select("merchant_id,cnpj_status,anp_status,anp_reference,notes,verified_at,cnpj_verified_at,anp_verified_at,verified_by,updated_at")
      .limit(100),
    admin.from("merchant_delivery_capabilities")
      .select("merchant_id,capability_code,active,verified_at,verified_by,notes,updated_at")
      .limit(200),
    admin.from("referral_reward_reviews")
      .select("order_id,referrer_user_id,referred_user_id,risk_status,risk_reasons,reviewed_at,reviewed_by,review_notes,created_at,updated_at")
      .in("risk_status",["review_required","approved","rejected"])
      .order("created_at",{ascending:false})
      .limit(100),
    admin.from("reward_processing_failures")
      .select("order_id,attempts,last_sqlstate,last_error,next_retry_at,last_attempt_at,dead_lettered_at,resolved_at,created_at,updated_at")
      .is("resolved_at",null)
      .order("updated_at",{ascending:false})
      .limit(100),
    admin.from("settlement_accounting_failures")
      .select("order_id,attempts,last_sqlstate,last_error,next_retry_at,last_attempt_at,dead_lettered_at,resolved_at,created_at,updated_at")
      .is("resolved_at",null)
      .order("updated_at",{ascending:false})
      .limit(100),
    admin.from("platform_receivables")
      .select("order_id,merchant_id,gross_total_cents,platform_fee_bps,platform_fee_cents,status,due_at,paid_at,waived_at,reversed_at,created_at")
      .eq("status","open")
      .order("due_at",{ascending:true})
      .limit(100),
    admin.from("merchant_cashback_reimbursements")
      .select("order_id,merchant_id,cashback_cents,status,due_at,paid_at,offset_at,reversed_at,created_at")
      .eq("status","open")
      .order("due_at",{ascending:true})
      .limit(100),
    admin.from("platform_settlement_adjustments")
      .select("id,order_id,merchant_id,adjustment_type,direction,amount_cents,status,reason,reference,settled_at,created_at")
      .eq("status","open")
      .order("created_at",{ascending:true})
      .limit(100),
    admin.from("platform_admins")
      .select("user_id,active,created_by,created_at")
      .order("created_at",{ascending:true})
      .limit(100),
    admin.from("prelaunch_leads")
      .select("id,lead_type,contact_name,business_name,phone,postal_code,interests,note,admin_note,status,submission_count,source,medium,campaign,content,term,referrer,landing_path,contacted_at,qualified_at,converted_at,closed_at,created_at,updated_at")
      .order("created_at",{ascending:false})
      .limit(200),
    admin.from("public_requests")
      .select("id,request_kind,privacy_action,contact_name,contact_channel,contact_value,message,status,resolution_note,resolved_at,source,medium,campaign,referrer,landing_path,created_at,updated_at")
      .order("created_at",{ascending:false})
      .limit(200),
    admin.from("platform_admin_audit")
      .select("id,actor_user_id,action,target_type,target_id,metadata,created_at")
      .order("created_at",{ascending:false})
      .limit(50)
  ]);
  for(const result of [apps,merchants,compliance,capabilities,referralReviews,rewardFailures,accountingFailures,receivables,reimbursements,adjustments,platformAdmins,prelaunchLeads,publicRequests,audit]){
    if(result.error)throw result.error;
  }
  const pilotPartners=await admin
    .from("pilot_partner_drafts")
    .select("id,display_name,proposed_product_code,proposed_delivered_price_cents,delivery_included,price_status,onboarding_status,merchant_id,pricing_mode,min_delivered_price_cents,preferred_delivered_price_cents,max_delivered_price_cents,pricing_strategy,notes,created_at,updated_at")
    .order("created_at",{ascending:true})
    .limit(50);
  if(pilotPartners.error)throw pilotPartners.error;
  const merchantBusinessDetails=await admin
    .from("merchant_business_details")
    .select("merchant_id,legal_name,trade_name,responsible_name,phone,whatsapp,postal_code,city,state,address_text,admin_notes,updated_at")
    .limit(100);
  if(merchantBusinessDetails.error)throw merchantBusinessDetails.error;
  const commercialPolicy=await admin
    .from("reward_policy")
    .select("policy_key,active,platform_fee_bps,variable_cost_bps,minimum_contribution_bps,cashback_bps,direct_referral_bps,commission_hold_hours,policy_version,updated_at,updated_by,last_change_reason")
    .eq("policy_key","default")
    .single();
  if(commercialPolicy.error)throw commercialPolicy.error;
  const [productCategories,productProfiles]=await Promise.all([
    admin.from("product_categories")
      .select("category_key,category_name,active,sort_order,updated_at,updated_by")
      .order("sort_order",{ascending:true})
      .order("category_name",{ascending:true}),
    admin.from("product_delivery_profiles")
      .select("product_code,product_name,category_key,delivery_class,requires_isolated_delivery,customer_visible,merchant_add_allowed,active,sort_order,updated_at,updated_by")
      .order("sort_order",{ascending:true})
      .order("product_name",{ascending:true})
      .limit(500)
  ]);
  if(productCategories.error)throw productCategories.error;
  if(productProfiles.error)throw productProfiles.error;

  const controlOrders=await admin
    .from("orders")
    .select("id,public_code,status,customer_id,merchant_id,proposed_merchant_id,supplier_name_snapshot,payment_method,gross_total_cents,total_cents,risk_reason,offer_expires_at,accepted_at,dispatch_due_at,dispatched_at,arriving_at,promised_by,version,address_text,postal_code,address_complement,delivery_reference,customer_phone_digits,created_at,updated_at")
    .order("updated_at",{ascending:false})
    .limit(120);
  if(controlOrders.error)throw controlOrders.error;
  const controlOrderIds=(controlOrders.data??[]).map((x:any)=>x.id).filter(Boolean);
  const controlItems=controlOrderIds.length
    ? await admin.from("order_items")
        .select("order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents")
        .in("order_id",controlOrderIds)
        .order("product_code")
    : {data:[],error:null};
  if(controlItems.error)throw controlItems.error;
  const controlItemsByOrder=new Map<string,any[]>();
  for(const item of controlItems.data??[]){
    if(!controlItemsByOrder.has(item.order_id))controlItemsByOrder.set(item.order_id,[]);
    controlItemsByOrder.get(item.order_id)!.push(item);
  }

  const [supportCases,businessMetrics,launchReadiness,acquisitionMetrics]=await Promise.all([
    admin.from("support_cases")
      .select("id,order_id,customer_id,merchant_id,category,status,message,resolution_note,resolved_at,created_at,updated_at")
      .in("status",["open","in_review","resolved"])
      .order("updated_at",{ascending:false})
      .limit(100),
    admin.rpc("platform_business_metrics"),
    admin.rpc("platform_launch_readiness"),
    admin.rpc("admin_prelaunch_acquisition_metrics",{p_actor_user_id:actorUserId})
  ]);
  if(supportCases.error)throw supportCases.error;
  if(businessMetrics.error)throw businessMetrics.error;
  if(launchReadiness.error)throw launchReadiness.error;
  if(acquisitionMetrics.error)throw acquisitionMetrics.error;

  const referralOrderIds=(referralReviews.data??[]).map((x:any)=>x.order_id).filter(Boolean);
  const referralOrderStates=referralOrderIds.length
    ? await admin.from("orders")
        .select("id,financial_state,financial_reversed_at")
        .in("id",referralOrderIds)
    : {data:[],error:null};
  if(referralOrderStates.error)throw referralOrderStates.error;
  const referralStateByOrder=new Map((referralOrderStates.data??[]).map((x:any)=>[x.id,x]));

  const byMerchant=new Map((compliance.data??[]).map((x:any)=>[x.merchant_id,x]));
  const businessByMerchant=new Map((merchantBusinessDetails.data??[]).map((x:any)=>[x.merchant_id,x]));
  const capabilitiesByMerchant=new Map<string,any[]>();
  for(const cap of capabilities.data??[]){
    if(!capabilitiesByMerchant.has(cap.merchant_id))capabilitiesByMerchant.set(cap.merchant_id,[]);
    capabilitiesByMerchant.get(cap.merchant_id)!.push(cap);
  }
  return {
    applications:apps.data??[],
    pilotPartners:pilotPartners.data??[],
    merchants:(merchants.data??[]).map((m:any)=>({
      ...m,
      compliance:byMerchant.get(m.id)??null,
      businessDetails:businessByMerchant.get(m.id)??null,
      deliveryCapabilities:capabilitiesByMerchant.get(m.id)??[]
    })),
    businessMetrics:businessMetrics.data??{},
    launchReadiness:launchReadiness.data??{},
    commercialPolicy:commercialPolicy.data??null,
    productRegistry:{
      categories:productCategories.data??[],
      products:productProfiles.data??[]
    },
    supportCases:supportCases.data??[],
    controlOrders:(controlOrders.data??[]).map((o:any)=>({
      ...o,
      items:controlItemsByOrder.get(o.id)??[]
    })),
    finance:{
      receivables:receivables.data??[],
      cashbackReimbursements:reimbursements.data??[],
      adjustments:adjustments.data??[]
    },
    platformAdmins:platformAdmins.data??[],
    prelaunchLeads:prelaunchLeads.data??[],
    acquisitionMetrics:acquisitionMetrics.data??{},
    publicRequests:publicRequests.data??[],
    rewardFailures:rewardFailures.data??[],
    accountingFailures:accountingFailures.data??[],
    referralReviews:(referralReviews.data??[]).map((x:any)=>{
      const state:any=referralStateByOrder.get(x.order_id);
      return {
        ...x,
        financialState:state?.financial_state??null,
        financialReversedAt:state?.financial_reversed_at??null
      };
    }),
    recentAudit:audit.data??[]
  };
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const action=String(body.action??"summary");

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });

    await enforceApiQuota(admin,{
      userId:user.id,
      actionName:"admin-ops",
      limit:120,
      windowSeconds:60
    });
    await requireAdmin(admin,user.id);

    if(action==="summary"){
      return json(await summary(admin,user.id),200,origin);
    }

    const idempotencyKey=String(req.headers.get("Idempotency-Key")??"").trim();
    if(idempotencyKey.length<12||idempotencyKey.length>120){
      throw new DomainError("INVALID_IDEMPOTENCY_KEY","Chave de idempotência obrigatória para mutações administrativas.",400);
    }

    let payload:Record<string,unknown>;

    if(action==="approve-application"){
      payload={applicationId:uuid(body.applicationId,"application")};
    }else if(action==="reject-application"){
      payload={
        applicationId:uuid(body.applicationId,"application"),
        reason:cleanText(body.reason,{min:3,max:240,name:"motivo"})
      };
    }else if(action==="verify-merchant"){
      const cnpjStatus=String(body.cnpjStatus??"");
      const anpStatus=String(body.anpStatus??"");
      if(!["pending","verified","rejected"].includes(cnpjStatus)){
        throw new DomainError("INVALID_CNPJ_STATUS","Status de CNPJ inválido.",400);
      }
      if(!["pending","verified","not_required","rejected"].includes(anpStatus)){
        throw new DomainError("INVALID_ANP_STATUS","Status ANP inválido.",400);
      }
      payload={
        merchantId:uuid(body.merchantId,"merchant"),
        cnpjStatus,
        anpStatus,
        anpReference:body.anpReference==null?null:(cleanText(body.anpReference,{min:0,max:240,name:"referência ANP"})||null),
        notes:body.notes==null?null:(cleanText(body.notes,{min:0,max:1000,name:"observações"})||null)
      };
    }else if(action==="activate-merchant"||action==="suspend-merchant"){
      payload={merchantId:uuid(body.merchantId,"merchant")};
    }else if(action==="set-delivery-capability"){
      payload={
        merchantId:uuid(body.merchantId,"merchant"),
        active:body.active===true,
        notes:body.notes==null?null:(cleanText(body.notes,{min:0,max:1000,name:"observações"})||null)
      };
    }else if(action==="review-referral"){
      const decision=String(body.decision??"");
      if(!["approved","rejected"].includes(decision)){
        throw new DomainError("INVALID_REFERRAL_REVIEW_DECISION","Decisão de revisão inválida.",400);
      }
      payload={
        orderId:uuid(body.orderId,"order"),
        decision,
        notes:body.notes==null?null:(cleanText(body.notes,{min:0,max:1000,name:"observações"})||null)
      };
    }else if(action==="retry-reward"){
      payload={orderId:uuid(body.orderId,"order")};
    }else if(action==="retry-accounting"){
      payload={orderId:uuid(body.orderId,"order")};
    }else if(action==="reverse-order"){
      payload={
        orderId:uuid(body.orderId,"order"),
        reason:cleanText(body.reason,{min:3,max:240,name:"motivo"}),
        reference:body.reference==null?null:(cleanText(body.reference,{min:0,max:120,name:"referência"})||null)
      };
    }else if(action==="set-platform-admin"){
      payload={
        targetUserId:uuid(body.targetUserId,"targetUser"),
        active:body.active===true
      };
    }else if(action==="product-registry"){
      const registryAction=String(body.registryAction??"").trim().toLowerCase();
      if(!["upsert-category","upsert-product","set-product-active"].includes(registryAction)){
        throw new DomainError("INVALID_PRODUCT_REGISTRY_ACTION","Ação do catálogo administrativo inválida.",400);
      }
      const sortOrderRaw=Number(body.sortOrder??100);
      if(!Number.isSafeInteger(sortOrderRaw)||sortOrderRaw<0||sortOrderRaw>10000){
        throw new DomainError("INVALID_PRODUCT_SORT_ORDER","Ordem do produto/categoria inválida.",400);
      }
      const categoryKey=String(body.categoryKey??"").trim().toLowerCase();
      const productCode=String(body.productCode??"").trim().toUpperCase();
      const common={
        registryAction,
        categoryKey:categoryKey||null,
        categoryName:body.categoryName==null?null:(cleanText(body.categoryName,{min:2,max:80,name:"nome da categoria"})||null),
        productCode:productCode||null,
        productName:body.productName==null?null:(cleanText(body.productName,{min:2,max:120,name:"nome do produto"})||null),
        deliveryClass:body.deliveryClass==null?null:String(body.deliveryClass).trim().toLowerCase(),
        requiresIsolatedDelivery:body.requiresIsolatedDelivery===true,
        customerVisible:body.customerVisible!==false,
        merchantAddAllowed:body.merchantAddAllowed!==false,
        active:body.active!==false,
        sortOrder:sortOrderRaw,
        reason:cleanText(body.reason,{min:3,max:1000,name:"motivo da alteração"})
      };
      if(registryAction==="upsert-category"){
        if(!/^[a-z][a-z0-9_]{1,39}$/.test(categoryKey)){
          throw new DomainError("INVALID_PRODUCT_CATEGORY","Chave da categoria inválida.",400);
        }
      }else{
        if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(productCode)){
          throw new DomainError("INVALID_PRODUCT_PROFILE","Código do produto inválido.",400);
        }
        if(registryAction==="upsert-product"&&!["regulated_glp","household_general"].includes(String(common.deliveryClass||""))){
          throw new DomainError("INVALID_PRODUCT_PROFILE","Classe logística inválida.",400);
        }
      }
      payload=common;
    }else if(action==="commercial-policy"){
      const expectedVersion=Number(body.expectedVersion);
      const asBps=(value:unknown,name:string)=>{
        const n=Number(value);
        if(!Number.isSafeInteger(n)||n<0||n>5000){
          throw new DomainError("INVALID_COMMERCIAL_POLICY_BPS",name+" inválido.",400);
        }
        return n;
      };
      const commissionHoldHours=Number(body.commissionHoldHours);
      if(!Number.isSafeInteger(commissionHoldHours)||commissionHoldHours<0||commissionHoldHours>2160){
        throw new DomainError("INVALID_COMMISSION_HOLD","Carência de comissão inválida.",400);
      }
      if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1){
        throw new DomainError("INVALID_POLICY_VERSION","Versão da política inválida.",400);
      }
      payload={
        expectedVersion,
        active:body.active===true,
        platformFeeBps:asBps(body.platformFeeBps,"taxa da plataforma"),
        variableCostBps:asBps(body.variableCostBps,"reserva de custo"),
        minimumContributionBps:asBps(body.minimumContributionBps,"contribuição mínima"),
        cashbackBps:asBps(body.cashbackBps,"cashback"),
        directReferralBps:asBps(body.directReferralBps,"indicação"),
        commissionHoldHours,
        reason:cleanText(body.reason,{min:3,max:1000,name:"motivo da política"})
      };
    }else if(action==="order-control"){
      const controlAction=String(body.controlAction??"").trim().toLowerCase();
      if(!["note","rescue","cancel"].includes(controlAction)){
        throw new DomainError("INVALID_ADMIN_ORDER_ACTION","Ação da Torre de Controle inválida.",400);
      }
      const expectedVersion=Number(body.expectedVersion);
      if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1){
        throw new DomainError("INVALID_VERSION","Versão do pedido inválida.",400);
      }
      payload={
        orderId:uuid(body.orderId,"order"),
        controlAction,
        expectedVersion,
        reason:cleanText(body.reason,{min:3,max:1000,name:"motivo da intervenção"})
      };
    }else if(action==="assisted-merchant-onboarding"){
      const draftId=body.draftId==null||String(body.draftId).trim()===""?null:uuid(body.draftId,"draft");
      const productCode=String(body.productCode??"").trim().toUpperCase();
      if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(productCode)){
        throw new DomainError("INVALID_PRODUCT_CODE","Código do produto inicial inválido.",400);
      }
      const pricingMode=String(body.pricingMode??"").trim().toLowerCase();
      const pricingStrategy=String(body.pricingStrategy??"balanced").trim().toLowerCase();
      if(!["fixed","range"].includes(pricingMode)||!["volume","balanced","margin"].includes(pricingStrategy)){
        throw new DomainError("INVALID_PRICING_POLICY","Política de preço inválida.",400);
      }
      const minPriceCents=Number(body.minPriceCents);
      const preferredPriceCents=Number(body.preferredPriceCents);
      const maxPriceCents=Number(body.maxPriceCents);
      const availableStock=Number(body.availableStock??0);
      const deliveryFeeCents=Number(body.deliveryFeeCents??0);
      const baseEtaMinutes=Number(body.baseEtaMinutes??30);
      for(const [name,value,min,max] of [
        ["preço mínimo",minPriceCents,1,1000000],
        ["preço normal",preferredPriceCents,1,1000000],
        ["preço máximo",maxPriceCents,1,1000000],
        ["estoque",availableStock,0,1000000],
        ["taxa de entrega",deliveryFeeCents,0,100000],
        ["ETA",baseEtaMinutes,5,180]
      ] as const){
        if(!Number.isSafeInteger(value)||value<min||value>max){
          throw new DomainError("INVALID_ASSISTED_ONBOARDING_NUMBER",name+" inválido.",400);
        }
      }
      if(minPriceCents>preferredPriceCents||preferredPriceCents>maxPriceCents||
         (pricingMode==="fixed"&&(minPriceCents!==preferredPriceCents||preferredPriceCents!==maxPriceCents))){
        throw new DomainError("INVALID_PRICE_RANGE","Faixa de preço inválida.",400);
      }
      const rawPayments:string[]=Array.isArray(body.paymentMethods)?body.paymentMethods.map((x:any)=>String(x)):[];
      const paymentMethods:string[]=[...new Set<string>(rawPayments)];
      if(paymentMethods.length>3||paymentMethods.some(x=>!["pix","card","cash"].includes(x))){
        throw new DomainError("INVALID_PAYMENT_METHOD","Forma de pagamento inválida.",400);
      }
      const ownerUserId=body.ownerUserId==null||String(body.ownerUserId).trim()===""?null:uuid(body.ownerUserId,"owner");
      const serviceRadiusKm=body.serviceRadiusKm==null||String(body.serviceRadiusKm).trim()===""?null:Number(body.serviceRadiusKm);
      if(serviceRadiusKm!=null&&(!Number.isFinite(serviceRadiusKm)||serviceRadiusKm<0||serviceRadiusKm>100)){
        throw new DomainError("INVALID_SERVICE_RADIUS","Raio de atendimento inválido.",400);
      }
      payload={
        draftId,
        tradeName:cleanText(body.tradeName,{min:2,max:120,name:"nome fantasia"}),
        legalName:cleanText(body.legalName,{min:2,max:180,name:"razão social"}),
        cnpj:cleanText(body.cnpj,{min:14,max:24,name:"CNPJ"}),
        responsibleName:cleanText(body.responsibleName,{min:2,max:120,name:"responsável"}),
        phone:cleanText(body.phone,{min:10,max:24,name:"telefone"}),
        whatsapp:cleanText(body.whatsapp,{min:10,max:24,name:"WhatsApp"}),
        postalCode:cleanText(body.postalCode,{min:8,max:12,name:"CEP"}),
        city:cleanText(body.city,{min:2,max:120,name:"cidade"}),
        state:cleanText(body.state??"RS",{min:2,max:2,name:"UF"}).toUpperCase(),
        addressText:cleanText(body.addressText,{min:5,max:240,name:"endereço"}),
        ownerUserId,
        ownerDisplayName:body.ownerDisplayName==null?null:(cleanText(body.ownerDisplayName,{min:0,max:60,name:"nome do owner"})||null),
        productCode,
        productName:cleanText(body.productName,{min:2,max:120,name:"produto"}),
        pricingMode,minPriceCents,preferredPriceCents,maxPriceCents,pricingStrategy,
        availableStock,paymentMethods,deliveryFeeCents,baseEtaMinutes,
        acceptsCitywide:body.acceptsCitywide===true,
        serviceRadiusKm,
        adminNotes:body.adminNotes==null?null:(cleanText(body.adminNotes,{min:0,max:2000,name:"observações"})||null)
      };
    }else if(action==="confirm-launch-requirement"){
      const requirementKey=String(body.requirementKey??"").trim();
      const status=String(body.status??"confirmed").trim();
      if(!/^[a-z0-9][a-z0-9_:-]{1,119}$/.test(requirementKey)){
        throw new DomainError("INVALID_LAUNCH_REQUIREMENT_KEY","Requisito de produção inválido.",400);
      }
      if(!["confirmed","revoked"].includes(status)){
        throw new DomainError("INVALID_LAUNCH_CONFIRMATION_STATUS","Status de confirmação inválido.",400);
      }
      const reason=cleanText(body.reason,{min:3,max:1000,name:"motivo da confirmação"});
      const evidence=body.evidence==null?"":cleanText(body.evidence,{min:0,max:2000,name:"evidência"});
      const source=body.source==null?"admin-panel":cleanText(body.source,{min:2,max:80,name:"origem"});
      let expiresAt:null|string=null;
      if(body.expiresAt!=null&&String(body.expiresAt).trim()!==""){
        const parsed=new Date(String(body.expiresAt));
        if(!Number.isFinite(parsed.getTime())||parsed.getTime()<=Date.now()){
          throw new DomainError("LAUNCH_CONFIRMATION_EXPIRY_INVALID","A validade da confirmação precisa estar no futuro.",400);
        }
        expiresAt=parsed.toISOString();
      }
      payload={requirementKey,status,reason,evidence,expiresAt,source};
    }else if(action==="set-operation-mode"){
      const mode=String(body.mode??"").trim().toUpperCase();
      if(!["PRELAUNCH","PILOT","LIVE","PAUSED"].includes(mode)){
        throw new DomainError("INVALID_OPERATION_MODE","Modo operacional inválido.",400);
      }
      payload={
        mode,
        reason:cleanText(body.reason,{min:3,max:1000,name:"motivo da mudança de modo"}),
        sourceSha:body.sourceSha==null?null:String(body.sourceSha).trim().toLowerCase()||null
      };
      if(payload.sourceSha&&!/^[0-9a-f]{40}$/.test(String(payload.sourceSha))){
        throw new DomainError("INVALID_OPERATION_SOURCE_SHA","Versão de origem inválida.",400);
      }
    }else if(action==="verify-launch-portals"){
      const verification=await verifyLivePortals();
      if(!verification.ok){
        return json({
          error:"LIVE_PORTALS_NOT_READY",
          message:"Os três portais live ainda não passaram na verificação de origem, bundle e Turnstile.",
          verification
        },409,origin);
      }
      payload={
        sourceSha:verification.sourceSha,
        customerOk:true,
        merchantOk:true,
        adminOk:true
      };
    }else if(action==="enable-commerce"||action==="disable-commerce"){
      payload={};
    }else if(action==="support-case-status"){
      const status=String(body.status??"");
      if(!["in_review","resolved","closed"].includes(status)){
        throw new DomainError("INVALID_SUPPORT_STATUS","Status de atendimento inválido.",400);
      }
      payload={
        caseId:uuid(body.caseId,"case"),
        status,
        resolutionNote:body.resolutionNote==null?null:(cleanText(body.resolutionNote,{min:0,max:1000,name:"resolução"})||null)
      };
      if(["resolved","closed"].includes(status)&&!payload.resolutionNote){
        throw new DomainError("SUPPORT_RESOLUTION_NOTE_REQUIRED","Informe como o atendimento foi resolvido.",400);
      }
    }else if(action==="financial-action"){
      const kind=String(body.kind??"");
      const financialAction=String(body.financialAction??"");
      const allowed:Record<string,string[]>={
        platform_receivable:["paid","waived"],
        cashback_reimbursement:["paid"],
        settlement_adjustment:["paid","waived"]
      };
      if(!allowed[kind]?.includes(financialAction)){
        throw new DomainError("INVALID_FINANCIAL_ACTION","Ação financeira inválida.",400);
      }
      payload={
        kind,
        targetId:uuid(body.targetId,"target"),
        financialAction,
        reference:cleanText(body.reference,{min:3,max:240,name:"referência de conciliação"})
      };
    }else if(action==="lead-status"){
      const status=String(body.status??"");
      if(!["contacted","qualified","converted","closed"].includes(status)){
        throw new DomainError("INVALID_LEAD_STATUS","Status de lead inválido.",400);
      }
      payload={
        leadId:uuid(body.leadId,"lead"),
        status,
        note:body.note==null?null:(cleanText(body.note,{min:0,max:1000,name:"observação do lead"})||null)
      };
      if(status==="closed"&&!payload.note){
        throw new DomainError("PRELAUNCH_LEAD_CLOSE_NOTE_REQUIRED","Informe o motivo do encerramento.",400);
      }
    }else if(action==="public-request-status"){
      const status=String(body.status??"");
      if(!["in_review","resolved","closed"].includes(status)){
        throw new DomainError("INVALID_PUBLIC_REQUEST_STATUS","Status da solicitação inválido.",400);
      }
      payload={
        requestId:uuid(body.requestId,"request"),
        status,
        resolutionNote:body.resolutionNote==null?null:(cleanText(body.resolutionNote,{min:0,max:2000,name:"resolução"})||null)
      };
      if(["resolved","closed"].includes(status)&&!payload.resolutionNote){
        throw new DomainError("PUBLIC_REQUEST_RESOLUTION_REQUIRED","Informe como a solicitação foi tratada.",400);
      }
    }else{
      throw new DomainError("INVALID_ACTION","Ação administrativa inválida.",400);
    }

    const requestHash=await requestFingerprint("admin-ops:"+action,payload);
    let rpcName="admin_execute_action";
    let rpcArgs:any={
      p_actor_user_id:user.id,
      p_action_name:action,
      p_payload:payload,
      p_idempotency_key:idempotencyKey,
      p_request_hash:requestHash
    };
    if(action==="set-delivery-capability"){
      rpcName="admin_delivery_capability_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_merchant_id:payload.merchantId,
        p_active:payload.active,
        p_notes:payload.notes,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="review-referral"){
      rpcName="admin_referral_review_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_order_id:payload.orderId,
        p_decision:payload.decision,
        p_notes:payload.notes,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="retry-reward"){
      rpcName="admin_reward_retry_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_order_id:payload.orderId,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="support-case-status"){
      rpcName="admin_support_case_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_case_id:payload.caseId,
        p_status:payload.status,
        p_resolution_note:payload.resolutionNote,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="retry-accounting"){
      rpcName="admin_settlement_accounting_retry_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_order_id:payload.orderId,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="lead-status"){
      rpcName="admin_prelaunch_lead_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_lead_id:payload.leadId,
        p_status:payload.status,
        p_note:payload.note,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="public-request-status"){
      rpcName="admin_public_request_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_request_id:payload.requestId,
        p_status:payload.status,
        p_resolution_note:payload.resolutionNote,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="product-registry"){
      rpcName="admin_product_registry_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_action:payload.registryAction,
        p_category_key:payload.categoryKey,
        p_category_name:payload.categoryName,
        p_product_code:payload.productCode,
        p_product_name:payload.productName,
        p_delivery_class:payload.deliveryClass,
        p_requires_isolated_delivery:payload.requiresIsolatedDelivery,
        p_customer_visible:payload.customerVisible,
        p_merchant_add_allowed:payload.merchantAddAllowed,
        p_active:payload.active,
        p_sort_order:payload.sortOrder,
        p_reason:payload.reason,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="commercial-policy"){
      rpcName="admin_commercial_policy_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_expected_version:payload.expectedVersion,
        p_active:payload.active,
        p_platform_fee_bps:payload.platformFeeBps,
        p_variable_cost_bps:payload.variableCostBps,
        p_minimum_contribution_bps:payload.minimumContributionBps,
        p_cashback_bps:payload.cashbackBps,
        p_direct_referral_bps:payload.directReferralBps,
        p_commission_hold_hours:payload.commissionHoldHours,
        p_reason:payload.reason,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="order-control"){
      rpcName="admin_order_control_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_order_id:payload.orderId,
        p_action:payload.controlAction,
        p_expected_version:payload.expectedVersion,
        p_reason:payload.reason,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="assisted-merchant-onboarding"){
      rpcName="admin_assisted_merchant_onboarding";
      rpcArgs={
        p_actor_user_id:user.id,
        p_draft_id:payload.draftId,
        p_trade_name:payload.tradeName,
        p_legal_name:payload.legalName,
        p_cnpj:payload.cnpj,
        p_responsible_name:payload.responsibleName,
        p_phone:payload.phone,
        p_whatsapp:payload.whatsapp,
        p_postal_code:payload.postalCode,
        p_city:payload.city,
        p_state:payload.state,
        p_address_text:payload.addressText,
        p_owner_user_id:payload.ownerUserId,
        p_owner_display_name:payload.ownerDisplayName,
        p_product_code:payload.productCode,
        p_product_name:payload.productName,
        p_pricing_mode:payload.pricingMode,
        p_min_price_cents:payload.minPriceCents,
        p_preferred_price_cents:payload.preferredPriceCents,
        p_max_price_cents:payload.maxPriceCents,
        p_pricing_strategy:payload.pricingStrategy,
        p_available_stock:payload.availableStock,
        p_payment_methods:payload.paymentMethods,
        p_delivery_fee_cents:payload.deliveryFeeCents,
        p_base_eta_minutes:payload.baseEtaMinutes,
        p_accepts_citywide:payload.acceptsCitywide,
        p_service_radius_km:payload.serviceRadiusKm,
        p_admin_notes:payload.adminNotes,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="confirm-launch-requirement"){
      rpcName="admin_confirm_launch_requirement";
      rpcArgs={
        p_actor_user_id:user.id,
        p_requirement_key:payload.requirementKey,
        p_status:payload.status,
        p_reason:payload.reason,
        p_evidence:payload.evidence?{note:payload.evidence}:{},
        p_expires_at:payload.expiresAt,
        p_metadata:{},
        p_source:payload.source,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="set-operation-mode"){
      rpcName="admin_operation_mode_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_mode:payload.mode,
        p_reason:payload.reason,
        p_source_sha:payload.sourceSha,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="set-platform-admin"){
      rpcName="admin_platform_admin_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_target_user_id:payload.targetUserId,
        p_active:payload.active,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(["verify-launch-portals","enable-commerce","disable-commerce"].includes(action)){
      rpcName="admin_launch_control_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_action:action==="verify-launch-portals"?"record-portals":action,
        p_source_sha:action==="verify-launch-portals"?payload.sourceSha:null,
        p_customer_ok:action==="verify-launch-portals"?true:false,
        p_merchant_ok:action==="verify-launch-portals"?true:false,
        p_admin_ok:action==="verify-launch-portals"?true:false,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    const {data,error}=await admin.rpc(rpcName,rpcArgs);
    if(error)throw error;
    return json(data,200,origin);


  }catch(error){
    if(error instanceof DomainError){
      return json({error:error.code,message:error.message},error.status,origin);
    }

    const message=error instanceof Error?error.message:String(error);
    if(message.includes("ADMIN_ACCESS_DENIED")){
      return json({error:"ADMIN_ACCESS_DENIED",message:"Esta conta não possui acesso administrativo."},403,origin);
    }
    if(message.includes("ADMIN_USER_NOT_FOUND")){
      return json({error:"ADMIN_USER_NOT_FOUND",message:"Usuário permanente não encontrado."},404,origin);
    }
    if(message.includes("PERMANENT_IDENTITY_REQUIRED")){
      return json({error:"PERMANENT_IDENTITY_REQUIRED",message:"Administrador precisa usar uma conta permanente."},409,origin);
    }
    if(message.includes("LAST_ADMIN_CANNOT_BE_REMOVED")){
      return json({error:"LAST_ADMIN_CANNOT_BE_REMOVED",message:"O último administrador ativo não pode ser removido."},409,origin);
    }
    if(message.includes("LAUNCH_NOT_READY")){
      return json({error:"LAUNCH_NOT_READY",message:"A operação ainda possui pendências não resolvidas. Revise a Central de Produção."},409,origin);
    }
    if(message.includes("PRODUCT_CATEGORY_NOT_FOUND")){
      return json({error:"PRODUCT_CATEGORY_NOT_FOUND",message:"A categoria informada não existe."},404,origin);
    }
    if(message.includes("PRODUCT_PROFILE_NOT_FOUND")){
      return json({error:"PRODUCT_PROFILE_NOT_FOUND",message:"O produto informado não existe no registro."},404,origin);
    }
    if(message.includes("GLP_PRODUCT_CANONICAL_POLICY")){
      return json({error:"GLP_PRODUCT_CANONICAL_POLICY",message:"Produtos GLP possuem nome, classe, visibilidade e logística canônicos e não podem ser reclassificados."},409,origin);
    }
    if(message.includes("GENERAL_PRODUCT_CLASS_POLICY")){
      return json({error:"GENERAL_PRODUCT_CLASS_POLICY",message:"Produtos gerais precisam usar a classe logística doméstica e não podem imitar códigos reservados de GLP."},409,origin);
    }
    if(message.includes("INVALID_PRODUCT_CATEGORY")||message.includes("INVALID_PRODUCT_PROFILE")){
      return json({error:"INVALID_PRODUCT_REGISTRY",message:"Revise código, categoria, nome e regras do produto."},400,origin);
    }
    if(message.includes("COMMERCIAL_POLICY_CONTRIBUTION_UNFUNDED")){
      return json({error:"COMMERCIAL_POLICY_CONTRIBUTION_UNFUNDED",message:"A taxa da plataforma não cobre a reserva de custo e a contribuição mínima."},409,origin);
    }
    if(message.includes("COMMERCIAL_POLICY_REWARDS_UNFUNDED")){
      return json({error:"COMMERCIAL_POLICY_REWARDS_UNFUNDED",message:"Cashback e indicação excedem o orçamento disponível depois de custos e contribuição mínima."},409,origin);
    }
    if(message.includes("COMMERCIAL_POLICY_DISABLE_REQUIRES_PAUSE")){
      return json({error:"COMMERCIAL_POLICY_DISABLE_REQUIRES_PAUSE",message:"Pause a operação antes de desativar a política financeira."},409,origin);
    }
    if(message.includes("POLICY_VERSION_CONFLICT")){
      return json({error:"POLICY_VERSION_CONFLICT",message:"A política mudou desde que o painel foi carregado. Atualize antes de salvar."},409,origin);
    }
    if(message.includes("FINANCIAL_POLICY_MISSING")){
      return json({error:"FINANCIAL_POLICY_MISSING",message:"A política financeira padrão não está disponível."},503,origin);
    }
    if(message.includes("ORDER_ALREADY_DISPATCHED")){
      return json({error:"ORDER_ALREADY_DISPATCHED",message:"O pedido já saiu para entrega. Cancelamento ou reatribuição automática não são mais seguros."},409,origin);
    }
    if(message.includes("ORDER_NOT_RESCUABLE")){
      return json({error:"ORDER_NOT_RESCUABLE",message:"Este estado do pedido não permite reatribuição automática segura."},409,origin);
    }
    if(message.includes("ORDER_NOT_CANCELLABLE")||message.includes("ORDER_TERMINAL")){
      return json({error:"ORDER_NOT_CANCELLABLE",message:"Este pedido não pode ser cancelado por esta ação administrativa."},409,origin);
    }
    if(message.includes("ADMIN_ORDER_REASON_REQUIRED")){
      return json({error:"ADMIN_ORDER_REASON_REQUIRED",message:"Informe o motivo da intervenção administrativa."},400,origin);
    }
    if(message.includes("PILOT_PARTNER_NOT_FOUND")){
      return json({error:"PILOT_PARTNER_NOT_FOUND",message:"Parceiro piloto não encontrado."},404,origin);
    }
    if(message.includes("PILOT_PARTNER_CANCELLED")){
      return json({error:"PILOT_PARTNER_CANCELLED",message:"Este parceiro piloto foi cancelado."},409,origin);
    }
    if(message.includes("OWNER_USER_NOT_FOUND")){
      return json({error:"OWNER_USER_NOT_FOUND",message:"A conta owner informada não existe ou ainda é anônima."},404,origin);
    }
    if(message.includes("PILOT_PRODUCT_MISMATCH")){
      return json({error:"PILOT_PRODUCT_MISMATCH",message:"O produto não corresponde ao rascunho comercial do parceiro."},409,origin);
    }
    if(message.includes("INVALID_MERCHANT_IDENTITY")||message.includes("INVALID_MERCHANT_PHONE")||message.includes("INVALID_MERCHANT_ADDRESS")||message.includes("INVALID_PRICE_RANGE")){
      return json({error:"INVALID_ASSISTED_ONBOARDING",message:"Revise os dados cadastrais, endereço e faixa comercial informados."},400,origin);
    }
    if(message.includes("LAUNCH_BLOCKED_SECURITY")){
      return json({error:"LAUNCH_BLOCKED_SECURITY",message:"Existe um bloqueio técnico de segurança ou integridade que não pode ser ignorado."},409,origin);
    }
    if(message.includes("LAUNCH_WARNINGS_UNCONFIRMED")){
      return json({error:"LAUNCH_WARNINGS_UNCONFIRMED",message:"Existem alertas operacionais ainda não confirmados pelo administrador."},409,origin);
    }
    if(message.includes("LAUNCH_REQUIREMENT_NOT_ACTIVE")){
      return json({error:"LAUNCH_REQUIREMENT_NOT_ACTIVE",message:"Esta pendência já não está ativa. Atualize a Central de Produção."},409,origin);
    }
    if(message.includes("LAUNCH_CONFIRMATION_REASON_REQUIRED")){
      return json({error:"LAUNCH_CONFIRMATION_REASON_REQUIRED",message:"Informe o motivo da decisão administrativa."},400,origin);
    }
    if(message.includes("OPERATION_MODE_REASON_REQUIRED")){
      return json({error:"OPERATION_MODE_REASON_REQUIRED",message:"Informe o motivo da mudança do modo operacional."},400,origin);
    }
    if(message.includes("INVALID_OPERATION_MODE")){
      return json({error:"INVALID_OPERATION_MODE",message:"Modo operacional inválido."},400,origin);
    }
    if(message.includes("PORTAL_ATTESTATION_INVALID")){
      return json({error:"PORTAL_ATTESTATION_INVALID",message:"A verificação dos portais live não é válida."},409,origin);
    }
    if(message.includes("LAUNCH_CONTROL_MISSING")){
      return json({error:"LAUNCH_CONTROL_MISSING",message:"A autoridade de lançamento não está disponível."},503,origin);
    }
    if(message.includes("CNPJ_VERIFICATION_REQUIRED")){
      return json({error:"CNPJ_VERIFICATION_REQUIRED",message:"Valide o CNPJ antes de ativar a revenda."},409,origin);
    }
    if(message.includes("CNPJ_REVERIFICATION_REQUIRED")){
      return json({error:"CNPJ_REVERIFICATION_REQUIRED",message:"A verificação de CNPJ está ausente ou venceu e precisa ser refeita."},409,origin);
    }
    if(message.includes("ANP_REVERIFICATION_REQUIRED")){
      return json({error:"ANP_REVERIFICATION_REQUIRED",message:"A verificação ANP do GLP está ausente ou venceu e precisa ser refeita."},409,origin);
    }
    if(
      message.includes("ANP_VERIFICATION_REQUIRED")
      || message.includes("GLP_REGULATORY_VERIFICATION_REQUIRED")
      || message.includes("P13_REGULATORY_VERIFICATION_REQUIRED")
    ){
      return json({error:"ANP_VERIFICATION_REQUIRED",message:"Revenda com produto GLP ativo exige validação ANP antes da operação."},409,origin);
    }
    if(message.includes("PRELAUNCH_LEAD_NOT_FOUND")){
      return json({error:"PRELAUNCH_LEAD_NOT_FOUND",message:"Lead não encontrado."},404,origin);
    }
    if(message.includes("PRELAUNCH_LEAD_CLOSE_NOTE_REQUIRED")){
      return json({error:"PRELAUNCH_LEAD_CLOSE_NOTE_REQUIRED",message:"Informe o motivo do encerramento."},400,origin);
    }
    if(message.includes("PRELAUNCH_LEAD_FINAL")||message.includes("INVALID_LEAD_TRANSITION")){
      return json({error:"PRELAUNCH_LEAD_STATE_CONFLICT",message:"Este lead já mudou de etapa. Atualize o painel."},409,origin);
    }
    if(message.includes("PUBLIC_REQUEST_NOT_FOUND")){
      return json({error:"PUBLIC_REQUEST_NOT_FOUND",message:"Solicitação não encontrada."},404,origin);
    }
    if(message.includes("PUBLIC_REQUEST_ALREADY_CLOSED")||message.includes("INVALID_PUBLIC_REQUEST_TRANSITION")){
      return json({error:"PUBLIC_REQUEST_STATE_CONFLICT",message:"Esta solicitação já mudou de estado. Atualize o painel."},409,origin);
    }
    if(message.includes("PUBLIC_REQUEST_RESOLUTION_REQUIRED")){
      return json({error:"PUBLIC_REQUEST_RESOLUTION_REQUIRED",message:"Informe como a solicitação foi tratada."},400,origin);
    }
    if(message.includes("SUPPORT_CASE_NOT_FOUND")){
      return json({error:"SUPPORT_CASE_NOT_FOUND",message:"Atendimento não encontrado."},404,origin);
    }
    if(message.includes("SUPPORT_CASE_ALREADY_CLOSED")||message.includes("INVALID_SUPPORT_TRANSITION")){
      return json({error:"SUPPORT_CASE_STATE_CONFLICT",message:"O atendimento já mudou de estado. Atualize o painel."},409,origin);
    }
    if(message.includes("SUPPORT_RESOLUTION_NOTE_REQUIRED")){
      return json({error:"SUPPORT_RESOLUTION_NOTE_REQUIRED",message:"Informe como o atendimento foi resolvido."},400,origin);
    }
    if(message.includes("FINANCIAL_ITEM_NOT_OPEN")){
      return json({error:"FINANCIAL_ITEM_NOT_OPEN",message:"Este item financeiro já foi processado."},409,origin);
    }
    if(message.includes("FINANCIAL_REFERENCE_REQUIRED")){
      return json({error:"FINANCIAL_REFERENCE_REQUIRED",message:"Informe uma referência de conciliação para concluir a operação financeira."},400,origin);
    }

    if(message.includes("REFERRAL_REVIEW_NOT_FOUND")){
      return json({error:"REFERRAL_REVIEW_NOT_FOUND",message:"A revisão de indicação não foi encontrada."},404,origin);
    }
    if(message.includes("REFERRAL_REVIEW_ALREADY_FINAL")){
      return json({error:"REFERRAL_REVIEW_ALREADY_FINAL",message:"Esta revisão de indicação já possui decisão final."},409,origin);
    }
    if(message.includes("REFERRAL_REWARD_ALREADY_REVERSED")){
      return json({error:"REFERRAL_REWARD_ALREADY_REVERSED",message:"A liquidação financeira deste pedido já foi revertida; a comissão não pode ser aprovada."},409,origin);
    }
    if(message.includes("MERCHANT_OWNERSHIP_CONFLICT")){
      return json({error:"MERCHANT_OWNERSHIP_CONFLICT",message:"Este CNPJ já possui outro owner ativo. Use um fluxo explícito de transferência de propriedade."},409,origin);
    }
    if(message.includes("MERCHANT_REJECTED_EXISTS")){
      return json({error:"MERCHANT_REJECTED_EXISTS",message:"Já existe uma revenda rejeitada com este CNPJ. Revise o histórico antes de aprovar."},409,origin);
    }
    if(message.includes("INVALID_MERCHANT_STATUS_TRANSITION")){
      return json({error:"INVALID_MERCHANT_STATUS_TRANSITION",message:"A mudança de status solicitada não é válida para o estado atual da revenda."},409,origin);
    }
    if(message.includes("APPLICATION_ALREADY_APPROVED")){
      return json({error:"APPLICATION_ALREADY_APPROVED",message:"Esta aplicação já foi aprovada e não pode ser rejeitada."},409,origin);
    }

    if(message.includes("IDEMPOTENCY_CONFLICT")){
      return json({error:"IDEMPOTENCY_CONFLICT",message:"A chave desta operação já foi usada com outro conteúdo."},409,origin);
    }
    if(message.includes("IDEMPOTENCY_STATE_INVALID")){
      return json({error:"IDEMPOTENCY_STATE_INVALID",message:"Não foi possível confirmar o estado idempotente da operação."},409,origin);
    }

    console.error("admin-ops failed",message);
    return json({error:"INTERNAL_ERROR",message:"Não foi possível executar a operação administrativa."},500,origin);
  }
});
