import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
  asNonNegativeCents,
  asPositiveInt,
  readJsonBody,
  enforceApiQuota,
  requestFingerprint
} from "../_shared/domain.js";
import { cancelProviderChargesForPaymentRequest } from "../_shared/provider-charge-cancel.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"").trim();
const MERCHANT_PRIMARY_ORIGINS=new Set([
  "https://tamao-sg-revenda.pages.dev",
  "https://parceiro.tamao.com.br",
  MERCHANT_ALLOWED_ORIGIN
].filter(Boolean));
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return MERCHANT_PRIMARY_ORIGINS.has(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:("https://tamao-sg-revenda.pages.dev");
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
  return assertPermanentMerchantUser(data.user);
}
function canOperate(role:string){return ["owner","manager","operator"].includes(role)}
function canManage(role:string){return ["owner","manager"].includes(role)}
function configExpectedAt(value:unknown){
  const raw=String(value??"").trim();
  if(!raw||!Number.isFinite(Date.parse(raw))){
    throw new DomainError("CONFIG_VERSION_REQUIRED","Atualize o painel antes de salvar esta configuração.",409);
  }
  return raw;
}
function mutationIdempotencyKey(req:Request){
  const key=String(req.headers.get("Idempotency-Key")??"").trim();
  if(key.length<12||key.length>120||!/^[A-Za-z0-9._:-]+$/.test(key)){
    throw new DomainError("INVALID_IDEMPOTENCY_KEY","Chave idempotente obrigatória para salvar configuração.",400);
  }
  return key;
}
async function applyMerchantConfig(admin:any,{
  req,userId,merchantId,action,expectedUpdatedAt,payload
}:{
  req:Request,userId:string,merchantId:string,action:string,expectedUpdatedAt:string,payload:Record<string,unknown>
}){
  const idempotencyKey=mutationIdempotencyKey(req);
  const requestHash=await requestFingerprint(action,{merchantId,expectedUpdatedAt,payload});
  const {data,error}=await admin.rpc("merchant_config_action",{
    p_user_id:userId,
    p_merchant_id:merchantId,
    p_action:action,
    p_expected_updated_at:expectedUpdatedAt,
    p_payload:payload,
    p_idempotency_key:idempotencyKey,
    p_request_hash:requestHash
  });
  if(error){
    const message=String(error.message??error);
    if(message.includes("CONFIG_VERSION_REQUIRED")){
      throw new DomainError("CONFIG_VERSION_REQUIRED","Atualize o painel antes de salvar esta configuração.",409);
    }
    if(message.includes("CONFIG_VERSION_CONFLICT")){
      throw new DomainError("CONFIG_VERSION_CONFLICT","A configuração mudou em outra aba. O painel foi atualizado; revise antes de salvar novamente.",409);
    }
    if(message.includes("IDEMPOTENCY_CONFLICT")){
      throw new DomainError("IDEMPOTENCY_CONFLICT","Esta tentativa já foi usada com outro conteúdo.",409);
    }
    if(message.includes("IDEMPOTENCY_STATE_INVALID")){
      throw new DomainError("IDEMPOTENCY_STATE_INVALID","Não foi possível confirmar a gravação idempotente.",409);
    }
    throw error;
  }
  return data;
}

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
    if(!["ads-campaign","ads-interest","clube-interest","business-pulse","growth-network","enablement","heartbeat","set-online","update-product","update-logistics","update-capacity","update-scheduling","update-payment-methods","update-payment-routes","update-member-profile","request-billing-package","notify-billing-payment","notify-refund-recovery-payment","cancel-billing-request"].includes(action)){
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
    if(action==="ads-campaign"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED",
        "Somente proprietário ou gerente pode revisar campanhas.",403);
      const operation=String(body.operation??"view");
      if(!["view","save","submit","withdraw"].includes(operation))
        throw new DomainError("ADS_CAMPAIGN_ACTION_INVALID","Ação de campanha inválida.",400);
      const title=operation==="save"?String(body.title??"").trim():"";
      const description=operation==="save"?String(body.description??"").trim():"";
      const category=operation==="save"?String(body.category??"all"):"all";
      if(operation==="save"&&(
        title.length<12||title.length>80||description.length<30||description.length>240
        ||!/^(all|[a-z][a-z0-9_]{1,39})$/.test(category)
        ||/[\u0000-\u001f\u007f]/.test(title+description))){
        throw new DomainError("ADS_CAMPAIGN_CREATIVE_INVALID",
          "Informe título (12–80) e apresentação (30–240) válidos.",400);
      }
      const version=body.version===null||body.version===undefined?0:Number(body.version);
      if(!Number.isSafeInteger(version)||version<0||version>2147483646)
        throw new DomainError("ADS_CAMPAIGN_VERSION_INVALID","Atualize a proposta antes de salvar.",409);
      const requestId=String(body.requestId??"");
      if(operation!=="view"&&!UUID_RE.test(requestId))
        throw new DomainError("ADS_CAMPAIGN_REQUEST_INVALID","Identificação da ação inválida.",400);
      const {data,error}=await admin.rpc("merchant_ads_campaign_v1_233",{
        p_actor:user.id,p_merchant:merchantId,p_action:operation,
        p_request:operation==="view"?null:requestId,p_title:title,p_description:description,
        p_category:category,p_version:version
      });
      if(error)throw error;
      const c=data?.campaign;
      if(data?.source!=="merchant_ads_campaign_v1_233"
        ||data?.merchantId!==merchantId||data?.adsLive!==false||data?.noCharge!==true
        ||(operation==="view"&&data?.readOnly!==true)
        ||(c!==null&&c!==undefined&&(
          c.merchant_id!==merchantId||
          !["draft","submitted","approved_creative","needs_changes","withdrawn"].includes(c.status)
          ||!Number.isSafeInteger(c.version)||c.version<1||
          typeof c.title!=="string"||c.title.length>80||
          typeof c.description!=="string"||c.description.length>240||
          c.ads_live!==false||c.no_charge!==true))){
        throw new DomainError("ADS_CAMPAIGN_RESPONSE_INVALID",
          "Proposta de campanha não confirmada pelo servidor.",503);
      }
      return json(data,200,origin);
    }
    if(action==="clube-interest"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED",
        "Somente proprietário ou gerente pode registrar interesse no Clube.",403);
      const operation=String(body.operation??"view");
      const packageKey=String(body.packageKey??"");
      if(!["view","register","withdraw"].includes(operation)||
         !["gas_3x5","water_5x2"].includes(packageKey)){
        throw new DomainError("CLUBE_ACTION_INVALID","Selecione um pacote válido.",400);
      }
      const shareBps=operation==="register"?body.merchantShareBps:null;
      const budgetCents=operation==="register"?body.budgetCents:null;
      const expectedVersion=operation==="view"?null:body.expectedVersion;
      const requestId=operation==="view"?null:String(body.requestId??"");
      if(operation==="register"&&(
          body.consent!==true||
          !Number.isSafeInteger(shareBps)||shareBps<100||shareBps>10000||
          !Number.isSafeInteger(budgetCents)||budgetCents<500||budgetCents>1000000)){
        throw new DomainError("CLUBE_PROPOSAL_INVALID",
          "Confira percentual, orçamento de estudo e consentimento.",400);
      }
      if(operation!=="view"&&(
        !Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion>2147483645||
        !UUID_RE.test(requestId))){
        throw new DomainError("CLUBE_EXPECTED_VERSION_REQUIRED",
          "Atualize a proposta antes de alterá-la.",409);
      }
      const {data,error}=await admin.rpc("merchant_clube_interest_v1_240",{
        p_actor:user.id,p_merchant:merchantId,p_package_key:packageKey,p_operation:operation,
        p_merchant_share_bps:shareBps,p_budget_cents:budgetCents,
        p_consent:body.consent===true,p_expected_version:expectedVersion,
        p_request_id:requestId
      });
      if(error)throw error;
      if(data?.source!=="merchant_clube_interest_v1_240"||
        data?.merchantId!==merchantId||data?.packageKey!==packageKey||
        data?.readOnly!==(operation==="view")||
        data?.noCharge!==true||data?.noContract!==true||
        data?.fundingVerified!==false||data?.discountEnabled!==false||
        data?.couponSalesEnabled!==false||data?.noFinancialObligation!==true||
        typeof data?.interested!=="boolean"||
        !Number.isSafeInteger(data?.version)||data.version<0||
        !Number.isSafeInteger(data?.proposedBudgetCents)||
        !Number.isSafeInteger(data?.merchantShareBps)||
        (data?.interested&&(data.merchantShareBps<100||data.merchantShareBps>10000||
            data.proposedBudgetCents<500||data.proposedBudgetCents>1000000))){
        throw new DomainError("CLUBE_INTEREST_UNVERIFIED",
          "Não foi possível validar a proposta com o servidor.",503);
      }
      return json(data,200,origin);
    }
    if(action==="ads-interest"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED",
        "Somente proprietário ou gerente pode consultar a divulgação da revenda.",403);
      const operation=String(body.operation??"view");
      if(!["view","register","withdraw"].includes(operation))
        throw new DomainError("ADS_INTEREST_INVALID_ACTION","Operação inválida.",400);
      const goal=operation==="register"?String(body.goal??""):null;
      const budgetBand=operation==="register"?String(body.budgetBand??""):null;
      if(operation==="register"&&(
        !["new_customers","local_visibility","new_area","unsure"].includes(goal||"")
        ||!["unsure","upto_99","100_299","300_999","1000_plus"].includes(budgetBand||"")
        ||body.consent!==true)){
        throw new DomainError("ADS_INTEREST_CONSENT_REQUIRED",
          "Escolha a finalidade, a faixa opcional de investimento e confirme seu interesse.",400);
      }
      const {data,error}=await admin.rpc("merchant_ads_interest_v1_232",{
        p_actor_user_id:user.id,p_merchant_id:merchantId,p_operation:operation,
        p_goal:goal,p_budget_band:budgetBand,p_consent:body.consent===true
      });
      if(error)throw error;
      if(data?.source!=="merchant_ads_interest_v1_232"
        ||data.merchantId!==merchantId
        ||typeof data.interested!=="boolean"
        ||data.noCharge!==true||data.adsLive!==false
        ||data.readOnly!==(operation==="view")
        ||(data.interested&&
           (!["new_customers","local_visibility","new_area","unsure"].includes(data.goal)
           ||!["unsure","upto_99","100_299","300_999","1000_plus"].includes(data.budgetBand)))){
        throw new DomainError("ADS_INTEREST_UNVERIFIED","Interesse não confirmado pelo servidor.",503);
      }
      return json(data,200,origin);
    }
    if(action==="business-pulse"){
      if(!canManage(role)){
        throw new DomainError("MERCHANT_ACCESS_DENIED",
          "Somente proprietário ou gerente pode consultar os indicadores comerciais.",403);
      }
      const {data,error}=await admin.rpc("merchant_business_pulse_v1_231",{
        p_actor_user_id:user.id,p_merchant_id:merchantId
      });
      if(error)throw error;
      const counts=["ordersCreated","settledOrders","cancelledOrders",
        "reversedOrders","activeOrders","settledSalesCents"];
      const metrics=data?.metrics;
      const verified= data?.source==="merchant_business_pulse_v1_231"
        &&data?.merchantId===merchantId
        &&data?.periodDays===30
        &&data?.readOnly===true
        &&data?.salesNotPlatformRevenue===true
        &&data?.adsBillingEnabled===false
        &&data?.proBillingEnabled===false
        &&Number.isFinite(Date.parse(data?.generatedAt||""))
        &&metrics&&counts.every(k=>Number.isSafeInteger(metrics[k])&&metrics[k]>=0)
        &&metrics.ordersCreated===metrics.settledOrders+metrics.cancelledOrders+
          metrics.reversedOrders+metrics.activeOrders
        &&Array.isArray(data.topProducts)&&data.topProducts.length<=5
        &&data.topProducts.every((p:any)=>p&&typeof p.name==="string"
          &&p.name.length<=100
          &&Number.isSafeInteger(p.quantity)&&p.quantity>=0
          &&Number.isSafeInteger(p.salesCents)&&p.salesCents>=0);
      if(!verified){
        throw new DomainError("BUSINESS_PULSE_INVALID",
          "Indicadores comerciais indisponíveis ou inconsistentes.",503);
      }
      return json(data,200,origin);
    }
    if(action==="growth-network"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED",
        "Somente proprietário ou gerente pode consultar a rede de indicações.",403);
      const {data,error}=await admin.rpc("merchant_growth_network_v1_226",{
        p_actor_user_id:user.id,p_merchant_id:merchantId
      });
      if(error)throw error;
      if(data?.source!=="merchant_network_v1_226"||
         data?.merchantId!==merchantId||
         data?.rewardEnabled!==false||
         !/^TMR[A-F0-9]{24}$/.test(String(data?.inviteCode||""))){
        throw new DomainError("GROWTH_NETWORK_UNVERIFIED",
          "Não foi possível comprovar seu código de indicação.",503);
      }
      return json(data,200,origin);
    }
    if(action==="enablement"){
      if(!canManage(role)){
        throw new DomainError("MERCHANT_ACCESS_DENIED",
          "Somente proprietário ou gerente pode consultar os requisitos da revenda.",403);
      }
      const {data,error}=await admin.rpc("merchant_enablement_diagnostic_v1_158",{
        p_actor_user_id:user.id,p_merchant_id:merchantId
      });
      if(error)throw error;
      const diagnostic=Array.isArray(data)?data.find((x:any)=>x.merchant_id===merchantId):null;
      if(!diagnostic){
        throw new DomainError("MERCHANT_ACCESS_DENIED",
          "Não foi possível confirmar os requisitos desta revenda.",403);
      }
      return json({merchantId,diagnostic,readOnly:true,source:"market_city_offer_scope"},
        200,origin);
    }
    const now=new Date().toISOString();

    if(["request-billing-package","notify-billing-payment","notify-refund-recovery-payment","cancel-billing-request"].includes(action)){
      if(!canManage(role)){
        throw new DomainError("MERCHANT_FINANCE_PERMISSION_DENIED","Somente owner ou gerente pode operar cobranças e pacotes.",403);
      }
      const idempotencyKey=mutationIdempotencyKey(req);
      const planKey=action==="request-billing-package"?String(body.planKey??"").trim().toLowerCase():null;
      const statementId=action==="notify-billing-payment"?String(body.statementId??"").trim():null;
      const refundRecoveryId=action==="notify-refund-recovery-payment"
        ?String(body.refundRecoveryId??"").trim()
        :null;
      const paymentRequestId=action==="cancel-billing-request"?String(body.paymentRequestId??"").trim():null;
      const merchantReference=action==="cancel-billing-request"?null:String(body.reference??"").trim().replace(/\s+/g," ");
      if(planKey!=null&&!/^[a-z][a-z0-9_]{1,39}$/.test(planKey)){
        throw new DomainError("INVALID_BILLING_PLAN","Pacote de crédito inválido.",400);
      }
      if(statementId!=null&&!UUID_RE.test(statementId)){
        throw new DomainError("INVALID_STATEMENT","Fechamento diário inválido.",400);
      }
      if(refundRecoveryId!=null&&!UUID_RE.test(refundRecoveryId)){
        throw new DomainError(
          "INVALID_REFUND_RECOVERY",
          "Obrigação de recuperação inválida.",
          400
        );
      }
      if(paymentRequestId!=null&&!UUID_RE.test(paymentRequestId)){
        throw new DomainError("INVALID_PAYMENT_REQUEST","Solicitação financeira inválida.",400);
      }
      if(merchantReference!=null&&(merchantReference.length<3||merchantReference.length>240||/[\u0000-\u001F\u007F]/.test(merchantReference))){
        throw new DomainError("PAYMENT_REFERENCE_REQUIRED","Informe uma referência de pagamento válida.",400);
      }
      const rpcAction=action==="request-billing-package"
        ?"submit-package"
        :action==="notify-billing-payment"
          ?"submit-statement-payment"
          :action==="notify-refund-recovery-payment"
            ?"submit-refund-recovery"
            :"cancel-request";
      const requestPayload={
        merchantId,rpcAction,planKey,statementId,refundRecoveryId,
        paymentRequestId,merchantReference
      };
      const requestHash=await requestFingerprint("merchant-billing-request",requestPayload);
      const {data,error}=await admin.rpc("merchant_billing_request_action",{
        p_actor_user_id:user.id,
        p_merchant_id:merchantId,
        p_action:rpcAction,
        p_plan_key:planKey,
        p_statement_id:statementId,
        p_refund_recovery_id:refundRecoveryId,
        p_payment_request_id:paymentRequestId,
        p_merchant_reference:merchantReference,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      });
      if(error){
        const message=String(error.message??error);
        if(message.includes("PACKAGE_REQUEST_ALREADY_PENDING")){
          throw new DomainError("PACKAGE_REQUEST_ALREADY_PENDING","Já existe uma solicitação de pacote aguardando confirmação.",409);
        }
        if(message.includes("PREPAID_PLAN_DOWNGRADE_WITH_ACTIVE_CREDIT")){
          throw new DomainError(
            "PREPAID_PLAN_DOWNGRADE_WITH_ACTIVE_CREDIT",
            "Enquanto houver crédito ou reserva do pacote atual, você pode recarregar o mesmo pacote ou migrar apenas para uma taxa menor. Aguarde o saldo terminar para escolher uma taxa maior.",
            409
          );
        }
        if(message.includes("STATEMENT_NOT_PAYABLE")){
          throw new DomainError("STATEMENT_NOT_PAYABLE","Este fechamento já foi resolvido ou não possui saldo a pagar.",409);
        }
        if(message.includes("REFUND_RECOVERY_NOT_FOUND")){
          throw new DomainError(
            "REFUND_RECOVERY_NOT_FOUND",
            "A obrigação de recuperação não foi encontrada.",
            404
          );
        }
        if(message.includes("REFUND_RECOVERY_NOT_PAYABLE")){
          throw new DomainError(
            "REFUND_RECOVERY_NOT_PAYABLE",
            "Esta recuperação já foi resolvida ou não está mais disponível.",
            409
          );
        }
        if(message.includes("INVALID_REFUND_RECOVERY_REQUEST")){
          throw new DomainError(
            "INVALID_REFUND_RECOVERY_REQUEST",
            "A recuperação não corresponde ao refund em revisão.",
            409
          );
        }
        if(message.includes("PAYMENT_REQUEST_ALREADY_RESOLVED")){
          throw new DomainError("PAYMENT_REQUEST_ALREADY_RESOLVED","Esta solicitação financeira já foi resolvida.",409);
        }
        if(message.includes("PAYMENT_REQUEST_PAYMENT_ALREADY_RECEIVED")){
          throw new DomainError(
            "PAYMENT_REQUEST_PAYMENT_ALREADY_RECEIVED",
            "Este Pix já foi recebido pelo provedor e não pode mais ser cancelado pela revenda. Aguarde a conferência do Financeiro.",
            409
          );
        }
        if(message.includes("IDEMPOTENCY_CONFLICT")){
          throw new DomainError("IDEMPOTENCY_CONFLICT","Esta tentativa já foi usada com outro conteúdo.",409);
        }
        throw error;
      }
      if(action==="cancel-billing-request"&&paymentRequestId&&data?.status==="cancelled"){
        let providerCancellation={attempted:0,cancelled:0,failed:0,deferred:false};
        try{
          providerCancellation={
            ...(await cancelProviderChargesForPaymentRequest(admin,paymentRequestId)),
            deferred:false
          };
        }catch(cancelError){
          console.error("provider cancellation handoff failed",String(cancelError));
          providerCancellation={attempted:0,cancelled:0,failed:1,deferred:true};
        }
        return json({...data,providerCancellation},200,origin);
      }
      return json(data,200,origin);
    }

    if(action==="update-member-profile"){
      const displayName=String(body.displayName??"").trim().replace(/\s+/g," ");
      if(displayName.length<2||displayName.length>60||/[\u0000-\u001F\u007F]/.test(displayName)){
        throw new DomainError("INVALID_DISPLAY_NAME","Informe um nome operacional entre 2 e 60 caracteres.",400);
      }
      const {data,error}=await admin
        .from("merchant_members")
        .update({display_name:displayName})
        .eq("merchant_id",merchantId)
        .eq("user_id",user.id)
        .eq("active",true)
        .select("member_role,display_name")
        .single();
      if(error)throw error;
      return json({
        ok:true,
        memberRole:data.member_role,
        displayName:data.display_name
      },200,origin);
    }

    if(action==="update-payment-routes"){
      if(!canManage(role)){
        throw new DomainError(
          "MERCHANT_PAYMENT_PERMISSION_DENIED",
          "Somente owner ou gerente pode configurar recebimentos.",
          403
        );
      }
      const expectedVersion=Number(body.expectedVersion);
      const routes=Array.isArray(body.routes)?body.routes:null;
      const reason=String(body.reason??"Atualização das formas de recebimento da revenda.")
        .trim().replace(/\s+/g," ");
      if(!Number.isInteger(expectedVersion)||expectedVersion<1){
        throw new DomainError(
          "PAYMENT_ROUTE_VERSION_REQUIRED",
          "Atualize o painel antes de salvar as formas de recebimento.",
          409
        );
      }
      if(!routes||routes.length<1||routes.length>30){
        throw new DomainError(
          "PAYMENT_ROUTES_ARRAY_REQUIRED",
          "Configure ao menos uma rota de pagamento válida.",
          400
        );
      }
      if(reason.length<3||reason.length>1000){
        throw new DomainError("PAYMENT_ROUTE_REASON_REQUIRED","Informe o motivo da alteração.",400);
      }
      const idempotencyKey=mutationIdempotencyKey(req);
      const requestHash=await requestFingerprint("merchant-payment-routes",{
        merchantId,expectedVersion,routes,reason
      });
      const {data,error}=await admin.rpc("merchant_payment_routes_action",{
        p_actor_user_id:user.id,
        p_merchant_id:merchantId,
        p_expected_version:expectedVersion,
        p_routes:routes,
        p_reason:reason,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      });
      if(error){
        const message=String(error.message??error);
        if(message.includes("PAYMENT_ROUTE_VERSION_CONFLICT")){
          throw new DomainError(
            "PAYMENT_ROUTE_VERSION_CONFLICT",
            "As formas de recebimento mudaram em outra sessão. Atualize o painel antes de salvar.",
            409
          );
        }
        if(message.includes("PAYMENT_PROVIDER_METHOD_UNSUPPORTED")){
          throw new DomainError(
            "PAYMENT_PROVIDER_METHOD_UNSUPPORTED",
            "O provedor escolhido não suporta este meio de pagamento.",
            409
          );
        }
        if(message.includes("PAYMENT_ROUTE_CONNECTION_REQUIRED")
           ||message.includes("PAYMENT_ROUTE_CONNECTION_MISMATCH")){
          throw new DomainError(
            "PAYMENT_ROUTE_CONNECTION_REQUIRED",
            "Esta confirmação automática exige uma conexão ativa com o provedor.",
            409
          );
        }
        if(message.includes("PAYMENT_ROUTE_DUPLICATE")){
          throw new DomainError(
            "PAYMENT_ROUTE_DUPLICATE",
            "Há uma forma de recebimento duplicada.",
            409
          );
        }
        if(message.includes("IDEMPOTENCY_CONFLICT")){
          throw new DomainError("IDEMPOTENCY_CONFLICT","Esta tentativa já foi usada com outro conteúdo.",409);
        }
        throw error;
      }
      return json(data,200,origin);
    }

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
        const {data:financialAllowed,error:financialAllowedError}=await admin.rpc(
          "merchant_financial_sales_allowed",
          {p_merchant_id:merchantId}
        );
        if(financialAllowedError)throw financialAllowedError;
        if(financialAllowed!==true){
          throw new DomainError(
            "MERCHANT_FINANCIAL_SALES_HOLD",
            "Há um fechamento financeiro vencido. Regularize o débito antes de voltar a receber novas vendas.",
            409
          );
        }

        const {data:merchant,error:merchantError}=await admin
          .from("merchants")
          .select("status,delivery_fee_confirmed_at,accepts_citywide")
          .eq("id",merchantId)
          .maybeSingle();
        if(merchantError)throw merchantError;
        if(!merchant||merchant.status!=="active"){
          throw new DomainError("MERCHANT_NOT_ACTIVE","A revenda ainda não está ativa.",409);
        }
        const feeConfirmedAt=Date.parse(merchant.delivery_fee_confirmed_at??"");
        if(!Number.isFinite(feeConfirmedAt)||Date.now()-feeConfirmedAt>24*60*60*1000){
          throw new DomainError("DELIVERY_FEE_CONFIRMATION_REQUIRED","Confirme a taxa de entrega antes de ficar online.",409);
        }
        if(merchant.accepts_citywide!==true){
          throw new DomainError(
            "DELIVERY_AREA_REQUIRED",
            "Ative o atendimento no município cadastrado antes de colocar a revenda online.",
            409
          );
        }

        const {count:paymentRouteCount,error:paymentRouteError}=await admin
          .from("merchant_payment_routes")
          .select("*",{count:"exact",head:true})
          .eq("merchant_id",merchantId)
          .eq("active",true);
        if(paymentRouteError)throw paymentRouteError;
        if(!paymentRouteCount){
          throw new DomainError(
            "PAYMENT_METHOD_REQUIRED",
            "Ative pelo menos uma forma de recebimento antes de ficar online.",
            409
          );
        }

        const {data:available,error:availableError}=await admin
          .from("catalog_items")
          .select("product_code,price_confirmed_at")
          .eq("merchant_id",merchantId)
          .eq("active",true)
          .gt("available_stock",0);
        if(availableError)throw availableError;
        if(!available?.length)throw new DomainError("NO_AVAILABLE_STOCK","Nenhum produto possui estoque disponível.",409);
        const stale=available.filter((item)=>{
          const ts=Date.parse(item.price_confirmed_at??"");
          return !Number.isFinite(ts)||Date.now()-ts>24*60*60*1000;
        });
        if(stale.length){
          throw new DomainError(
            "PRICE_CONFIRMATION_REQUIRED",
            "Confirme o preço de todos os produtos com estoque antes de ficar online.",
            409
          );
        }
      }

      let onlineUpdate=admin
        .from("merchants")
        .update({online,last_seen_at:now})
        .eq("id",merchantId);
      if(online)onlineUpdate=onlineUpdate.eq("accepts_citywide",true);
      const {data,error}=await onlineUpdate
        .select("online,last_seen_at")
        .maybeSingle();
      if(error)throw error;
      if(!data&&online){
        throw new DomainError(
          "DELIVERY_AREA_REQUIRED",
          "A área de entrega mudou em outra ação. Atualize o painel antes de ficar online.",
          409
        );
      }
      if(!data)throw new DomainError("MERCHANT_NOT_FOUND","Revenda não encontrada.",404);
      return json({ok:true,...data},200,origin);
    }

    if(action==="update-product"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar catálogo.",403);
      const productCode=String(body.productCode??"").trim().toUpperCase();
      if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(productCode)){
        throw new DomainError("INVALID_PRODUCT","Produto inválido.",400);
      }
      const {data:productProfile,error:productProfileError}=await admin
        .from("product_delivery_profiles")
        .select("product_code,product_name,category_key,active,merchant_add_allowed")
        .eq("product_code",productCode)
        .eq("active",true)
        .eq("merchant_add_allowed",true)
        .maybeSingle();
      if(productProfileError)throw productProfileError;
      if(!productProfile){
        throw new DomainError("INVALID_PRODUCT","Este produto não está disponível para inclusão no catálogo.",400);
      }
      const {data:productCategory,error:productCategoryError}=await admin
        .from("product_categories")
        .select("category_key,active")
        .eq("category_key",productProfile.category_key)
        .eq("active",true)
        .maybeSingle();
      if(productCategoryError)throw productCategoryError;
      if(!productCategory){
        throw new DomainError("INVALID_PRODUCT","A categoria deste produto está pausada.",400);
      }
      const productName=String(productProfile.product_name);
      const priceCents=asPositiveInt(body.priceCents,"priceCents",{min:1,max:1000000});
      const availableStock=asPositiveInt(body.availableStock,"availableStock",{min:0,max:100000});
      const active=body.active!==false;

      const {data:existingCatalog,error:existingCatalogError}=await admin
        .from("catalog_items")
        .select("price_cents,pricing_mode,min_price_cents,max_price_cents,pricing_strategy,available_stock,active,price_confirmed_at,updated_at")
        .eq("merchant_id",merchantId)
        .eq("product_code",productCode)
        .maybeSingle();
      if(existingCatalogError)throw existingCatalogError;

      const pricingMode=body.pricingMode==null
        ? String(existingCatalog?.pricing_mode??"fixed")
        : String(body.pricingMode).trim().toLowerCase();
      if(!["fixed","range"].includes(pricingMode)){
        throw new DomainError("INVALID_PRICING_MODE","Modo de preço inválido.",400);
      }

      const pricingStrategy=body.pricingStrategy==null
        ? String(existingCatalog?.pricing_strategy??"balanced")
        : String(body.pricingStrategy).trim().toLowerCase();
      if(!["volume","balanced","margin"].includes(pricingStrategy)){
        throw new DomainError("INVALID_PRICING_STRATEGY","Estratégia de preço inválida.",400);
      }

      let minPriceCents=priceCents;
      let maxPriceCents=priceCents;
      if(pricingMode==="range"){
        minPriceCents=body.minPriceCents==null
          ? asPositiveInt(existingCatalog?.min_price_cents??priceCents,"minPriceCents",{min:1,max:1000000})
          : asPositiveInt(body.minPriceCents,"minPriceCents",{min:1,max:1000000});
        maxPriceCents=body.maxPriceCents==null
          ? asPositiveInt(existingCatalog?.max_price_cents??priceCents,"maxPriceCents",{min:1,max:1000000})
          : asPositiveInt(body.maxPriceCents,"maxPriceCents",{min:1,max:1000000});
        if(minPriceCents>priceCents||priceCents>maxPriceCents){
          throw new DomainError(
            "INVALID_PRICE_RANGE",
            "O preço normal precisa ficar entre o mínimo e o máximo autorizados.",
            400
          );
        }
      }

      const expectedUpdatedAt=existingCatalog
        ? String(body.expectedUpdatedAt??"").trim()
        : null;
      if(existingCatalog&&(!expectedUpdatedAt||!Number.isFinite(Date.parse(expectedUpdatedAt)))){
        throw new DomainError(
          "CATALOG_VERSION_REQUIRED",
          "Atualize o painel antes de salvar este produto.",
          409
        );
      }

      const catalogPayload={
        productCode,
        priceCents,
        pricingMode,
        minPriceCents,
        maxPriceCents,
        pricingStrategy,
        availableStock,
        active
      };
      const idempotencyKey=mutationIdempotencyKey(req);
      const requestHash=await requestFingerprint("update-product",{
        merchantId,
        expectedUpdatedAt,
        ...catalogPayload
      });
      const {data,error}=await admin.rpc("merchant_catalog_action",{
        p_user_id:user.id,
        p_merchant_id:merchantId,
        p_product_code:productCode,
        p_expected_updated_at:expectedUpdatedAt,
        p_price_cents:priceCents,
        p_pricing_mode:pricingMode,
        p_min_price_cents:minPriceCents,
        p_max_price_cents:maxPriceCents,
        p_pricing_strategy:pricingStrategy,
        p_available_stock:availableStock,
        p_active:active,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      });
      if(error){
        const message=String(error.message??error);
        if(message.includes("CATALOG_VERSION_REQUIRED")){
          throw new DomainError("CATALOG_VERSION_REQUIRED","Atualize o painel antes de salvar este produto.",409);
        }
        if(message.includes("CATALOG_VERSION_CONFLICT")){
          throw new DomainError("CATALOG_VERSION_CONFLICT","O estoque ou preço mudou em outra ação. Atualize o painel antes de salvar novamente.",409);
        }
        if(message.includes("IDEMPOTENCY_CONFLICT")){
          throw new DomainError("IDEMPOTENCY_CONFLICT","Esta tentativa já foi usada com outro conteúdo.",409);
        }
        if(message.includes("IDEMPOTENCY_STATE_INVALID")){
          throw new DomainError("IDEMPOTENCY_STATE_INVALID","Não foi possível confirmar a gravação idempotente.",409);
        }
        if(message.includes("INVALID_PRODUCT")){
          throw new DomainError("INVALID_PRODUCT","Este produto ou categoria não está disponível para alteração.",409);
        }
        throw error;
      }
      if(!data?.product)throw new DomainError("CATALOG_UPDATE_FAILED","Não foi possível confirmar a atualização do catálogo.",500);
      return json(data,200,origin);
    }

    if(action==="update-payment-methods"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar formas de pagamento.",403);
      const methods={
        pix:body.pix===true,
        card:body.card===true,
        cash:body.cash===true
      };
      if(!Object.values(methods).some(Boolean)){
        throw new DomainError("PAYMENT_METHOD_REQUIRED","Ative pelo menos uma forma de pagamento.",400);
      }
      const data=await applyMerchantConfig(admin,{
        req,userId:user.id,merchantId,action,
        expectedUpdatedAt:configExpectedAt(body.expectedUpdatedAt),
        payload:methods
      });
      return json(data,200,origin);
    }

    if(action==="update-scheduling"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar agendamento.",403);
      const payload={acceptsScheduledOrders:body.acceptsScheduledOrders===true};
      const data=await applyMerchantConfig(admin,{
        req,userId:user.id,merchantId,action,
        expectedUpdatedAt:configExpectedAt(body.expectedUpdatedAt),
        payload
      });
      return json(data,200,origin);
    }

    if(action==="update-capacity"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar capacidade.",403);
      const payload={
        maxActiveOrders:asPositiveInt(body.maxActiveOrders,"maxActiveOrders",{min:1,max:100})
      };
      const data=await applyMerchantConfig(admin,{
        req,userId:user.id,merchantId,action,
        expectedUpdatedAt:configExpectedAt(body.expectedUpdatedAt),
        payload
      });
      return json(data,200,origin);
    }

    if(action==="update-logistics"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar logística.",403);
      const deliveryFeeCents=asNonNegativeCents(body.deliveryFeeCents,"deliveryFeeCents");
      if(deliveryFeeCents>100000)throw new DomainError("INVALID_DELIVERY_FEE","Taxa de entrega inválida.",400);
      const payload={
        deliveryFeeCents,
        baseEtaMinutes:asPositiveInt(body.baseEtaMinutes,"baseEtaMinutes",{min:5,max:180}),
        acceptsCitywide:body.acceptsCitywide===true
      };
      const data=await applyMerchantConfig(admin,{
        req,userId:user.id,merchantId,action,
        expectedUpdatedAt:configExpectedAt(body.expectedUpdatedAt),
        payload
      });
      return json(data,200,origin);
    }

    return json({error:"INVALID_ACTION"},400,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    const message=error instanceof Error?error.message:String(error);
    if(message.includes("CNPJ_REVERIFICATION_REQUIRED")){
      return json({error:"CNPJ_REVERIFICATION_REQUIRED",message:"A verificação de CNPJ venceu. Solicite nova validação antes de ficar online."},409,origin);
    }
    if(message.includes("ANP_REVERIFICATION_REQUIRED")){
      return json({error:"ANP_REVERIFICATION_REQUIRED",message:"A verificação ANP do GLP venceu. Solicite nova validação antes de ficar online."},409,origin);
    }
    if(message.includes("GLP_REGULATORY_VERIFICATION_REQUIRED")){
      return json({error:"ANP_VERIFICATION_REQUIRED",message:"Este produto GLP exige validação ANP válida."},409,origin);
    }
    console.error("merchant-ops failed",message);
    return json({error:"INTERNAL_ERROR",message:"Não foi possível atualizar a operação."},500,origin);
  }
});
