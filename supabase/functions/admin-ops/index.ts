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
const ADMIN_ALLOWED_ORIGIN=(Deno.env.get("ADMIN_ALLOWED_ORIGIN")??"").trim();
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return ADMIN_ALLOWED_ORIGIN.length>0&&origin===ADMIN_ALLOWED_ORIGIN;
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:(ADMIN_ALLOWED_ORIGIN||"null");
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
async function summary(admin:any){
  const [apps,merchants,compliance,capabilities,referralReviews,rewardFailures,accountingFailures,receivables,reimbursements,adjustments,audit]=await Promise.all([
    admin.from("merchant_applications")
      .select("id,applicant_user_id,cnpj,company_name,responsible_name,phone,address_text,status,created_at,updated_at")
      .order("created_at",{ascending:false})
      .limit(50),
    admin.from("merchants")
      .select("id,name,cnpj,status,online,trust_score,address_text,delivery_fee_cents,base_eta_minutes,accepts_citywide,price_confirmed_at,last_seen_at,created_at")
      .order("created_at",{ascending:false})
      .limit(100),
    admin.from("merchant_compliance")
      .select("merchant_id,cnpj_status,anp_status,anp_reference,notes,verified_at,verified_by,updated_at")
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
    admin.from("platform_admin_audit")
      .select("id,actor_user_id,action,target_type,target_id,metadata,created_at")
      .order("created_at",{ascending:false})
      .limit(50)
  ]);
  for(const result of [apps,merchants,compliance,capabilities,referralReviews,rewardFailures,accountingFailures,receivables,reimbursements,adjustments,audit]){
    if(result.error)throw result.error;
  }
  const referralOrderIds=(referralReviews.data??[]).map((x:any)=>x.order_id).filter(Boolean);
  const referralOrderStates=referralOrderIds.length
    ? await admin.from("orders")
        .select("id,financial_state,financial_reversed_at")
        .in("id",referralOrderIds)
    : {data:[],error:null};
  if(referralOrderStates.error)throw referralOrderStates.error;
  const referralStateByOrder=new Map((referralOrderStates.data??[]).map((x:any)=>[x.id,x]));

  const byMerchant=new Map((compliance.data??[]).map((x:any)=>[x.merchant_id,x]));
  const capabilitiesByMerchant=new Map<string,any[]>();
  for(const cap of capabilities.data??[]){
    if(!capabilitiesByMerchant.has(cap.merchant_id))capabilitiesByMerchant.set(cap.merchant_id,[]);
    capabilitiesByMerchant.get(cap.merchant_id)!.push(cap);
  }
  return {
    applications:apps.data??[],
    merchants:(merchants.data??[]).map((m:any)=>({
      ...m,
      compliance:byMerchant.get(m.id)??null,
      deliveryCapabilities:capabilitiesByMerchant.get(m.id)??[]
    })),
    finance:{
      receivables:receivables.data??[],
      cashbackReimbursements:reimbursements.data??[],
      adjustments:adjustments.data??[]
    },
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
      return json(await summary(admin),200,origin);
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
        reference:body.reference==null?null:(cleanText(body.reference,{min:0,max:240,name:"referência"})||null)
      };
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
    }else if(action==="retry-accounting"){
      rpcName="admin_settlement_accounting_retry_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_order_id:payload.orderId,
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
    if(message.includes("CNPJ_VERIFICATION_REQUIRED")){
      return json({error:"CNPJ_VERIFICATION_REQUIRED",message:"Valide o CNPJ antes de ativar a revenda."},409,origin);
    }
    if(
      message.includes("ANP_VERIFICATION_REQUIRED")
      || message.includes("GLP_REGULATORY_VERIFICATION_REQUIRED")
      || message.includes("P13_REGULATORY_VERIFICATION_REQUIRED")
    ){
      return json({error:"ANP_VERIFICATION_REQUIRED",message:"Revenda com produto GLP ativo exige validação ANP antes da operação."},409,origin);
    }
    if(message.includes("FINANCIAL_ITEM_NOT_OPEN")){
      return json({error:"FINANCIAL_ITEM_NOT_OPEN",message:"Este item financeiro já foi processado."},409,origin);
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
