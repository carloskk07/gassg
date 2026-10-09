import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  readJsonBody,
  enforceApiQuota,
  requestFingerprint,
  sha256Hex
} from "../_shared/domain.js";
import { cancelProviderChargesForPaymentRequest } from "../_shared/provider-charge-cancel.js";
import { paymentEncryptionConfigured } from "../_shared/payment-secrets.js";

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
const PAYMENT_INGRESS_CONTRACT="tamao_normalized_hmac_v1";
const LIVE_PAYMENT_PROVIDER_ADAPTERS=new Set<string>(["mercadopago","woovi"]);
const BILLING_PIX_PROVIDER=String(Deno.env.get("BILLING_PIX_PROVIDER")??"mercadopago").trim().toLowerCase();

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
    .select("user_id,active,admin_role")
    .eq("user_id",userId)
    .eq("active",true)
    .maybeSingle();
  if(error)throw error;
  if(!data)throw new DomainError("ADMIN_ACCESS_DENIED","Esta conta não possui acesso administrativo.",403);
  return data;
}
const ADMIN_READ_ACTIONS=new Set(["summary","search","entity-detail","system-health","billing-provider-health","audit-search","incident-list"]);
const ADMIN_ROLE_ACTIONS:Record<string,Set<string>>={
  superadmin:new Set(["*"]),
  operations:new Set([
    "approve-application","reject-application","verify-merchant","activate-merchant","suspend-merchant",
    "set-delivery-capability","order-control","support-case-status","lead-status","public-request-status",
    "pilot-invite","assisted-merchant-onboarding","product-registry","verify-launch-portals","incident-action"
  ]),
  finance:new Set([
    "financial-action","review-referral","retry-reward","retry-accounting","reverse-order",
    "commercial-policy","merchant-billing-plan","merchant-billing-action","merchant-billing-payment-request","merchant-billing-payment-event","merchant-billing-refund","merchant-billing-provider-cancel-retry","merchant-payment-capability","create-billing-webhook-probe","incident-action"
  ]),
  support:new Set(["order-control","support-case-status","incident-action"]),
  compliance:new Set([
    "approve-application","reject-application","verify-merchant","activate-merchant","suspend-merchant",
    "set-delivery-capability","incident-action"
  ]),
  readonly:new Set()
};
function requireAdminAction(role:string,action:string){
  if(ADMIN_READ_ACTIONS.has(action))return;
  const allowed=ADMIN_ROLE_ACTIONS[role]??new Set<string>();
  if(allowed.has("*")||allowed.has(action))return;
  throw new DomainError("ADMIN_PERMISSION_DENIED","Seu perfil administrativo não possui permissão para esta ação.",403);
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

function billingPaymentIngressReadiness(){
  const providers=new Set<string>();
  let configValid=true;
  const providerRe=/^[a-z0-9][a-z0-9._-]{1,39}$/;
  const rawMap=String(Deno.env.get("BILLING_PAYMENT_WEBHOOK_SECRETS")??"").trim();

  if(rawMap){
    try{
      const parsed=JSON.parse(rawMap);
      if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
        configValid=false;
      }else{
        for(const [provider,value] of Object.entries(parsed)){
          const name=String(provider||"").trim().toLowerCase();
          const secret=String(value??"");
          if(providerRe.test(name)&&secret.length>=24)providers.add(name);
        }
      }
    }catch{
      configValid=false;
    }
  }

  const genericSecret=String(Deno.env.get("BILLING_PAYMENT_WEBHOOK_SECRET")??"");
  if(genericSecret.length>=24)providers.add("generic");

  const configuredProviders=[...providers].sort();
  const normalizedIngressConfigured=configValid&&configuredProviders.length>0;

  const mercadoPagoAccessToken=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
  const mercadoPagoWebhookSecret=String(Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")??"");
  const mercadoPagoChargeReady=
    LIVE_PAYMENT_PROVIDER_ADAPTERS.has("mercadopago")
    &&mercadoPagoAccessToken.length>=20
    &&!/[\u0000-\u001f\u007f\s]/.test(mercadoPagoAccessToken);
  const mercadoPagoWebhookReady=
    LIVE_PAYMENT_PROVIDER_ADAPTERS.has("mercadopago")
    &&mercadoPagoWebhookSecret.length>=16;
  const mercadoPagoReady=mercadoPagoChargeReady&&mercadoPagoWebhookReady;

  const wooviAuthorization=String(Deno.env.get("WOOVI_WEBHOOK_AUTHORIZATION")??"");
  const wooviCompanyId=String(Deno.env.get("WOOVI_COMPANY_ID")??"").trim();
  const wooviAppId=String(Deno.env.get("WOOVI_APP_ID")??"").trim();
  const wooviApiBase=String(
    Deno.env.get("WOOVI_API_BASE_URL")??"https://api.woovi.com"
  ).trim().replace(/\/$/,"");
  const wooviApiBaseValid=[
    "https://api.woovi.com",
    "https://api.woovi-sandbox.com"
  ].includes(wooviApiBase);
  const wooviWebhookReady=
    LIVE_PAYMENT_PROVIDER_ADAPTERS.has("woovi")
    &&wooviAuthorization.length>=24
    &&wooviCompanyId.length>=6
    &&wooviCompanyId.length<=160;
  const wooviChargeReady=
    LIVE_PAYMENT_PROVIDER_ADAPTERS.has("woovi")
    &&wooviAppId.length>=12
    &&wooviApiBaseValid;
  const wooviReady=wooviWebhookReady&&wooviChargeReady;

  const liveProviders=[
    ...(mercadoPagoReady?["mercadopago"]:[]),
    ...(wooviReady?["woovi"]:[])
  ].sort();
  const activeProviderReady=
    BILLING_PIX_PROVIDER==="mercadopago"
      ?mercadoPagoReady
      :BILLING_PIX_PROVIDER==="woovi"
        ?wooviReady
        :false;

  return {
    configured:normalizedIngressConfigured,
    normalizedIngressConfigured,
    livePspReady:configValid&&activeProviderReady,
    activeBillingProvider:BILLING_PIX_PROVIDER,
    configValid,
    contract:PAYMENT_INGRESS_CONTRACT,
    providerCount:configuredProviders.length,
    providers:configuredProviders,
    liveProviderCount:liveProviders.length,
    liveProviders,
    adapterReadiness:{
      mercadopago:{
        implemented:LIVE_PAYMENT_PROVIDER_ADAPTERS.has("mercadopago"),
        accessTokenConfigured:mercadoPagoChargeReady,
        webhookSecretConfigured:mercadoPagoWebhookReady,
        receiveReady:mercadoPagoWebhookReady,
        chargeReady:mercadoPagoChargeReady,
        ready:mercadoPagoReady,
        events:["order"],
        signature:"HMAC-SHA256",
        authoritativeLookup:"GET /v1/orders/{id}"
      },
      woovi:{
        implemented:LIVE_PAYMENT_PROVIDER_ADAPTERS.has("woovi"),
        webhookAuthorizationConfigured:wooviAuthorization.length>=24,
        companyBound:wooviCompanyId.length>=6&&wooviCompanyId.length<=160,
        appIdConfigured:wooviAppId.length>=12,
        apiBaseValid:wooviApiBaseValid,
        environment:wooviApiBase==="https://api.woovi-sandbox.com"?"sandbox":"production",
        receiveReady:wooviWebhookReady,
        chargeReady:wooviChargeReady,
        ready:wooviReady,
        events:["OPENPIX:TRANSACTION_RECEIVED","OPENPIX:CHARGE_COMPLETED","OPENPIX:CHARGE_EXPIRED","PIX_TRANSACTION_REFUND_SENT_CONFIRMED"],
        signature:"RSA-SHA256"
      }
    },
    endpoint:SUPABASE_URL
      ?SUPABASE_URL.replace(/\/$/,"")+"/functions/v1/billing-payment-webhook"
      :null,
    liveEndpoints:{
      mercadopago:SUPABASE_URL
        ?SUPABASE_URL.replace(/\/$/,"")+"/functions/v1/billing-payment-webhook-mercadopago"
        :null,
      woovi:SUPABASE_URL
        ?SUPABASE_URL.replace(/\/$/,"")+"/functions/v1/billing-payment-webhook-woovi"
        :null,
      merchantPix:SUPABASE_URL
        ?SUPABASE_URL.replace(/\/$/,"")+"/functions/v1/merchant-billing-pix"
        :null
    }
  };
}

async function latestVerifiedWebhookProbe(admin:any,provider:string){
  const freshSince=new Date(Date.now()-24*60*60*1000).toISOString();
  const {data,error}=await admin
    .from("payment_webhook_probes")
    .select("id,provider,status,verified_at,expires_at,requested_at")
    .eq("provider",provider)
    .eq("status","verified")
    .gte("verified_at",freshSince)
    .order("verified_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  return data??null;
}

async function mercadoPagoBillingProviderHealth(admin:any){
  const readiness=billingPaymentIngressReadiness();
  const endpoint=String(readiness?.liveEndpoints?.mercadopago??"").trim();
  const accessToken=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
  const webhookSecret=String(Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")??"");
  const checkedAt=new Date().toISOString();
  const tokenShapeValid=
    accessToken.length>=20&&!/[\u0000-\u001f\u007f\s]/.test(accessToken);
  const webhookSecretConfigured=webhookSecret.length>=16;

  if(!tokenShapeValid||!webhookSecretConfigured||!endpoint){
    return {
      ok:false,
      provider:"mercadopago",
      status:"not_configured",
      checkedAt,
      credentialValid:false,
      chargeReady:tokenShapeValid,
      receiveReady:webhookSecretConfigured,
      webhookSecretConfigured,
      endpoint,
      reason:
        !tokenShapeValid?"MERCADOPAGO_ACCESS_TOKEN_MISSING":
        !webhookSecretConfigured?"MERCADOPAGO_WEBHOOK_SECRET_MISSING":
        "MERCADOPAGO_WEBHOOK_ENDPOINT_MISSING"
    };
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  try{
    const response=await fetch("https://api.mercadolibre.com/users/me",{
      method:"GET",
      headers:{
        "Accept":"application/json",
        "Authorization":"Bearer "+accessToken
      },
      signal:controller.signal
    });
    const raw=await response.text();
    if(raw.length>200000){
      return {
        ok:false,provider:"mercadopago",status:"provider_invalid_response",
        checkedAt,credentialValid:response.status!==401,
        chargeReady:false,receiveReady:webhookSecretConfigured,
        webhookSecretConfigured,endpoint,apiStatus:response.status,
        reason:"MERCADOPAGO_RESPONSE_TOO_LARGE"
      };
    }
    if(response.status===401){
      return {
        ok:false,provider:"mercadopago",status:"invalid_credentials",
        checkedAt,credentialValid:false,chargeReady:false,
        receiveReady:webhookSecretConfigured,webhookSecretConfigured,
        endpoint,apiStatus:401,reason:"MERCADOPAGO_ACCESS_TOKEN_REJECTED"
      };
    }
    if(!response.ok){
      return {
        ok:false,provider:"mercadopago",
        status:response.status===429?"rate_limited":"provider_unavailable",
        checkedAt,credentialValid:null,chargeReady:false,
        receiveReady:webhookSecretConfigured,webhookSecretConfigured,
        endpoint,apiStatus:response.status,
        reason:"MERCADOPAGO_CREDENTIAL_HEALTH_HTTP_"+response.status
      };
    }
    let accountId:null|string=null;
    try{
      const payload=raw?JSON.parse(raw):{};
      const id=String(payload?.id??"").trim();
      accountId=id||null;
    }catch{
      return {
        ok:false,provider:"mercadopago",status:"provider_invalid_response",
        checkedAt,credentialValid:true,chargeReady:false,
        receiveReady:webhookSecretConfigured,webhookSecretConfigured,
        endpoint,apiStatus:response.status,reason:"MERCADOPAGO_INVALID_JSON"
      };
    }
    return {
      ok:true,
      provider:"mercadopago",
      status:"healthy",
      checkedAt,
      credentialValid:true,
      chargeReady:true,
      receiveReady:true,
      webhookSecretConfigured:true,
      endpoint,
      endpointConfiguredLocally:true,
      remoteWebhookRegistrationVerified:Boolean(await latestVerifiedWebhookProbe(admin,"mercadopago")),
      remoteWebhookVerifiedAt:(await latestVerifiedWebhookProbe(admin,"mercadopago"))?.verified_at??null,
      remoteWebhookProofFreshHours:24,
      accountBound:accountId!=null,
      apiStatus:response.status,
      reason:null
    };
  }catch(error){
    return {
      ok:false,provider:"mercadopago",status:"provider_unavailable",
      checkedAt,credentialValid:null,chargeReady:false,
      receiveReady:webhookSecretConfigured,webhookSecretConfigured,
      endpoint,
      reason:error instanceof DOMException&&error.name==="AbortError"
        ?"MERCADOPAGO_HEALTH_TIMEOUT"
        :"MERCADOPAGO_HEALTH_FETCH_FAILED"
    };
  }finally{
    clearTimeout(timer);
  }
}

async function billingProviderHealth(admin:any){
  if(BILLING_PIX_PROVIDER==="mercadopago"){
    return await mercadoPagoBillingProviderHealth(admin);
  }
  if(BILLING_PIX_PROVIDER==="woovi"){
    return await wooviBillingProviderHealth();
  }
  return {
    ok:false,
    provider:BILLING_PIX_PROVIDER,
    status:"invalid_config",
    checkedAt:new Date().toISOString(),
    reason:"BILLING_PIX_PROVIDER_INVALID"
  };
}

async function wooviBillingProviderHealth(){
  const readiness=billingPaymentIngressReadiness();
  const woovi=readiness?.adapterReadiness?.woovi??{};
  const endpoint=String(readiness?.liveEndpoints?.woovi??"").trim();
  const appId=String(Deno.env.get("WOOVI_APP_ID")??"").trim();
  const expectedAuthorization=String(Deno.env.get("WOOVI_WEBHOOK_AUTHORIZATION")??"");
  const companyId=String(Deno.env.get("WOOVI_COMPANY_ID")??"").trim();
  const base=String(
    Deno.env.get("WOOVI_API_BASE_URL")??"https://api.woovi.com"
  ).trim().replace(/\/$/,"");
  const allowedBases=new Set([
    "https://api.woovi.com",
    "https://api.woovi-sandbox.com"
  ]);
  const checkedAt=new Date().toISOString();
  const environment=base==="https://api.woovi-sandbox.com"?"sandbox":"production";

  if(!allowedBases.has(base)){
    return {
      ok:false,status:"invalid_config",checkedAt,environment,
      credentialValid:false,chargeWebhookReady:false,chargeExpiredWebhookReady:false,refundWebhookReady:false,
      transactionWebhookActive:false,companyBound:companyId.length>=6,
      reason:"WOOVI_API_BASE_INVALID"
    };
  }
  if(appId.length<12){
    return {
      ok:false,status:"not_configured",checkedAt,environment,
      credentialValid:false,chargeWebhookReady:false,chargeExpiredWebhookReady:false,refundWebhookReady:false,
      transactionWebhookActive:false,companyBound:companyId.length>=6,
      reason:"WOOVI_APP_ID_MISSING"
    };
  }
  if(!endpoint){
    return {
      ok:false,status:"invalid_config",checkedAt,environment,
      credentialValid:false,chargeWebhookReady:false,chargeExpiredWebhookReady:false,refundWebhookReady:false,
      transactionWebhookActive:false,companyBound:companyId.length>=6,
      reason:"WOOVI_WEBHOOK_ENDPOINT_MISSING"
    };
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  try{
    const url=base+"/api/v1/webhook?url="+encodeURIComponent(endpoint);
    const response=await fetch(url,{
      method:"GET",
      headers:{
        "Accept":"application/json",
        "Authorization":appId
      },
      signal:controller.signal
    });
    const raw=await response.text();
    if(raw.length>300000){
      return {
        ok:false,status:"provider_invalid_response",checkedAt,environment,
        credentialValid:response.status!==401,
        chargeWebhookReady:false,chargeExpiredWebhookReady:false,refundWebhookReady:false,transactionWebhookActive:false,
        companyBound:companyId.length>=6,
        apiStatus:response.status,
        reason:"WOOVI_RESPONSE_TOO_LARGE"
      };
    }

    if(response.status===401){
      return {
        ok:false,status:"invalid_credentials",checkedAt,environment,
        credentialValid:false,chargeWebhookReady:false,
        transactionWebhookActive:false,companyBound:companyId.length>=6,
        apiStatus:401,reason:"WOOVI_APP_ID_REJECTED"
      };
    }
    if(!response.ok){
      return {
        ok:false,
        status:
          response.status===403?"permission_denied":
          response.status===429?"rate_limited":
          "provider_unavailable",
        checkedAt,environment,
        credentialValid:response.status!==401,
        chargeWebhookReady:false,chargeExpiredWebhookReady:false,refundWebhookReady:false,transactionWebhookActive:false,
        companyBound:companyId.length>=6,
        apiStatus:response.status,
        reason:
          response.status===403
            ?"WOOVI_APP_ID_PERMISSION_DENIED"
            :"WOOVI_WEBHOOK_LIST_HTTP_"+response.status
      };
    }

    let payload:any={};
    try{payload=raw?JSON.parse(raw):{}}
    catch{
      return {
        ok:false,status:"provider_invalid_response",checkedAt,environment,
        credentialValid:true,chargeWebhookReady:false,
        transactionWebhookActive:false,companyBound:companyId.length>=6,
        apiStatus:response.status,reason:"WOOVI_INVALID_JSON"
      };
    }
    const webhooks=Array.isArray(payload?.webhooks)?payload.webhooks:[];
    const matching=webhooks.filter((item:any)=>
      String(item?.url??"").trim()===endpoint
    );
    const webhookState=(event:string)=>{
      const candidates=matching.filter((item:any)=>
        String(item?.event??"").trim()===event
      );
      const active=candidates.filter((item:any)=>item?.isActive===true);
      const authorizationMatch=active.some((item:any)=>
        expectedAuthorization.length>=24
        &&String(item?.authorization??"")===expectedAuthorization
      );
      return {
        registered:candidates.length>0,
        active:active.length>0,
        authorizationMatch
      };
    };
    const chargeCompleted=webhookState("OPENPIX:CHARGE_COMPLETED");
    const chargeExpired=webhookState("OPENPIX:CHARGE_EXPIRED");
    const refundSent=webhookState("PIX_TRANSACTION_REFUND_SENT_CONFIRMED");
    const transactionReceived=webhookState("OPENPIX:TRANSACTION_RECEIVED");
    const companyBound=companyId.length>=6&&companyId.length<=160;
    const chargeWebhookReady=
      chargeCompleted.active&&chargeCompleted.authorizationMatch;
    const chargeExpiredWebhookReady=
      chargeExpired.active&&chargeExpired.authorizationMatch;
    const refundWebhookReady=
      refundSent.active&&refundSent.authorizationMatch;
    const ok=chargeWebhookReady
      &&chargeExpiredWebhookReady
      &&refundWebhookReady
      &&companyBound;

    return {
      ok,
      status:ok?"healthy":"misconfigured",
      checkedAt,
      environment,
      apiStatus:response.status,
      credentialValid:true,
      companyBound,
      endpointRegistered:matching.length>0,
      chargeWebhookReady,
      chargeExpiredWebhookReady,
      refundWebhookReady,
      transactionWebhookActive:
        transactionReceived.active&&transactionReceived.authorizationMatch,
      webhooks:{
        chargeCompleted,
        chargeExpired,
        refundSent,
        transactionReceived
      },
      reason:ok?null:
        !companyBound?"WOOVI_COMPANY_ID_MISSING":
        !chargeCompleted.registered?"WOOVI_CHARGE_WEBHOOK_MISSING":
        !chargeCompleted.active?"WOOVI_CHARGE_WEBHOOK_INACTIVE":
        !chargeCompleted.authorizationMatch?"WOOVI_CHARGE_WEBHOOK_AUTH_MISMATCH":
        !chargeExpired.registered?"WOOVI_CHARGE_EXPIRED_WEBHOOK_MISSING":
        !chargeExpired.active?"WOOVI_CHARGE_EXPIRED_WEBHOOK_INACTIVE":
        !chargeExpired.authorizationMatch?"WOOVI_CHARGE_EXPIRED_WEBHOOK_AUTH_MISMATCH":
        !refundSent.registered?"WOOVI_REFUND_WEBHOOK_MISSING":
        !refundSent.active?"WOOVI_REFUND_WEBHOOK_INACTIVE":
        !refundSent.authorizationMatch?"WOOVI_REFUND_WEBHOOK_AUTH_MISMATCH":
        "WOOVI_HEALTH_UNKNOWN"
    };
  }catch(error){
    return {
      ok:false,status:"provider_unavailable",checkedAt,environment,
      credentialValid:null,chargeWebhookReady:false,chargeExpiredWebhookReady:false,refundWebhookReady:false,
      transactionWebhookActive:false,companyBound:companyId.length>=6,
      reason:error instanceof DOMException&&error.name==="AbortError"
        ?"WOOVI_HEALTH_TIMEOUT"
        :"WOOVI_HEALTH_FETCH_FAILED"
    };
  }finally{
    clearTimeout(timer);
  }
}

function adminRoleCanViewEntity(role:string,type:string){
  if(["superadmin","readonly","operations","finance","support"].includes(role)){
    return ["order","merchant","customer"].includes(type);
  }
  if(role==="compliance")return type==="merchant";
  return false;
}
function redactOrderForFinance(order:any){
  if(!order||typeof order!=="object")return order;
  const copy={...order};
  for(const key of ["customer_phone_digits","postal_code","address_text","delivery_reference"]){
    if(key in copy)copy[key]=null;
  }
  return copy;
}
function scopeEntityDetail(role:string,result:any){
  if(["superadmin","readonly"].includes(role))return result;
  if(result?.type==="order"){
    if(role==="finance"){
      return {...result,order:redactOrderForFinance(result.order),support:[],audit:[]};
    }
    if(role==="support"){
      return {...result,finance:{receivable:null,reimbursement:null,adjustments:[]},audit:[]};
    }
    if(role==="operations"){
      return {...result,finance:{receivable:null,reimbursement:null,adjustments:[]}};
    }
  }
  if(result?.type==="merchant"){
    if(role==="finance"){
      return {...result,business:null,compliance:null,capabilities:[],payments:[],members:[],catalog:[],support:[],audit:[]};
    }
    if(role==="support"){
      return {...result,business:null,compliance:null,payments:[],members:[],finance:{receivables:[],reimbursements:[],adjustments:[]},audit:[]};
    }
    if(role==="compliance"){
      return {...result,orders:[],support:[],finance:{receivables:[],reimbursements:[],adjustments:[]}};
    }
    if(role==="operations"){
      return {...result,finance:{receivables:[],reimbursements:[],adjustments:[]}};
    }
  }
  if(result?.type==="customer"&&role==="finance"){
    return {...result,orders:(result.orders??[]).map(redactOrderForFinance),support:[],feedback:[]};
  }
  return result;
}
function scopeAdminSummary(role:string,data:any){
  if(["superadmin","readonly"].includes(role))return data;
  const current=data.currentAdmin??null;
  const adminSelf=current?[current]:[];
  if(role==="operations"){
    return {
      ...data,
      merchants:(data.merchants??[]).map((m:any)=>({...m,paymentAccount:null,paymentAccounts:[],paymentRoutes:[]})),
      merchantPayments:{
        globalDirectPaymentsEnabled:data.merchantPayments?.globalDirectPaymentsEnabled===true,
        fundsOwner:"merchant",tamaoReceivesSaleProceeds:false,
        providerCatalog:[],routes:[],verifications:[]
      },
      finance:{receivables:[],cashbackReimbursements:[],adjustments:[]},
      merchantBilling:{
        plans:[],
        accounts:(data.merchantBilling?.accounts??[]).map((x:any)=>({
          merchant_id:x.merchant_id,sales_hold:x.sales_hold,sales_hold_reason:x.sales_hold_reason,sales_hold_at:x.sales_hold_at
        })),
        statements:[],
        paymentRequests:[],
        paymentEvents:[],
        refunds:[],
        refundRecoveries:[],
        providerCharges:[],
        webhookProbes:[],
        paymentIngress:null,
        metrics:null,
        reconciliation:null
      },
      rewardFailures:[],accountingFailures:[],referralReviews:[],
      platformAdmins:adminSelf,
      recentAudit:(data.recentAudit??[]).filter((x:any)=>!String(x.action||"").match(/financial|reward|referral|admin_access|platform_admin/))
    };
  }
  if(role==="finance"){
    return {
      ...data,
      applications:[],pilotPartners:[],
      merchants:(data.merchants??[]).map((m:any)=>({
        id:m.id,name:m.name,cnpj:m.cnpj,status:m.status,online:m.online,trust_score:m.trust_score,
        delivery_fee_cents:m.delivery_fee_cents,price_confirmed_at:m.price_confirmed_at,last_seen_at:m.last_seen_at,
        paymentAccount:m.paymentAccount??null,
        paymentAccounts:m.paymentAccounts??[],
        paymentRoutes:m.paymentRoutes??[]
      })),
      productRegistry:{categories:[],products:[]},
      supportCases:[],
      controlOrders:(data.controlOrders??[]).map(redactOrderForFinance),
      platformAdmins:adminSelf,
      prelaunchLeads:[],acquisitionMetrics:{},publicRequests:[],
      recentAudit:(data.recentAudit??[]).filter((x:any)=>String(x.action||"").match(/financial|billing|reward|referral|reverse|settlement|commercial/))
    };
  }
  if(role==="support"){
    return {
      ...data,
      applications:[],pilotPartners:[],
      merchants:(data.merchants??[]).map((m:any)=>({
        id:m.id,name:m.name,status:m.status,online:m.online,trust_score:m.trust_score,
        delivery_fee_cents:m.delivery_fee_cents,base_eta_minutes:m.base_eta_minutes,
        price_confirmed_at:m.price_confirmed_at,last_seen_at:m.last_seen_at,
        paymentAccounts:[],paymentRoutes:[]
      })),
      merchantPayments:{globalDirectPaymentsEnabled:false,fundsOwner:"merchant",tamaoReceivesSaleProceeds:false,providerCatalog:[],routes:[],verifications:[]},
      commercialPolicy:null,
      merchantBilling:{plans:[],accounts:[],statements:[],paymentRequests:[],paymentEvents:[],refunds:[],refundRecoveries:[],providerCharges:[],webhookProbes:[],paymentAccounts:[],paymentIngress:null,metrics:null,reconciliation:null},
      productRegistry:{categories:[],products:[]},
      finance:{receivables:[],cashbackReimbursements:[],adjustments:[]},
      rewardFailures:[],accountingFailures:[],referralReviews:[],
      platformAdmins:adminSelf,
      prelaunchLeads:[],acquisitionMetrics:{},
      recentAudit:[]
    };
  }
  if(role==="compliance"){
    return {
      ...data,
      merchants:(data.merchants??[]).map((m:any)=>({...m,paymentAccount:null,paymentAccounts:[],paymentRoutes:[]})),
      merchantPayments:{globalDirectPaymentsEnabled:false,fundsOwner:"merchant",tamaoReceivesSaleProceeds:false,providerCatalog:[],routes:[],verifications:[]},
      businessMetrics:{},commercialPolicy:null,
      merchantBilling:{plans:[],accounts:[],statements:[],paymentRequests:[],paymentEvents:[],refunds:[],refundRecoveries:[],providerCharges:[],webhookProbes:[],paymentAccounts:[],paymentIngress:null,metrics:null,reconciliation:null},
      productRegistry:{categories:[],products:[]},
      supportCases:[],controlOrders:[],
      finance:{receivables:[],cashbackReimbursements:[],adjustments:[]},
      rewardFailures:[],accountingFailures:[],referralReviews:[],
      platformAdmins:adminSelf,publicRequests:[],
      recentAudit:(data.recentAudit??[]).filter((x:any)=>String(x.action||"").match(/merchant|application|compliance|delivery_capability|pilot/))
    };
  }
  return {...data,platformAdmins:adminSelf};
}

function lookupText(value:unknown){
  const raw=String(value??"").trim().replace(/\s+/g," ");
  if(raw.length<2||raw.length>120){
    throw new DomainError("INVALID_ADMIN_SEARCH","Digite ao menos 2 caracteres para pesquisar.",400);
  }
  return raw.replace(/[,%()]/g," ").replace(/\s+/g," ").trim();
}
function pushUniqueResult(target:any[],seen:Set<string>,item:any){
  const key=String(item.type)+":"+String(item.id);
  if(seen.has(key))return;
  seen.add(key);
  target.push(item);
}
async function adminSearch(admin:any,rawQuery:unknown,role:string){
  const query=lookupText(rawQuery);
  const like="%"+query+"%";
  const digits=query.replace(/\D/g,"");
  const isUuid=UUID_RE.test(query);
  const tasks:any[]=[
    admin.from("orders").select("id,public_code,status,customer_id,merchant_id,total_cents,customer_phone_digits,updated_at").ilike("public_code",like).order("updated_at",{ascending:false}).limit(12),
    admin.from("merchants").select("id,name,cnpj,status,online,trust_score,last_seen_at").ilike("name",like).order("updated_at",{ascending:false}).limit(12),
    admin.from("merchants").select("id,name,cnpj,status,online,trust_score,last_seen_at").ilike("cnpj",like).order("updated_at",{ascending:false}).limit(12),
    admin.from("merchant_applications").select("id,company_name,cnpj,responsible_name,phone,status,updated_at").ilike("company_name",like).order("updated_at",{ascending:false}).limit(10),
    admin.from("merchant_applications").select("id,company_name,cnpj,responsible_name,phone,status,updated_at").ilike("responsible_name",like).order("updated_at",{ascending:false}).limit(10),
    admin.from("prelaunch_leads").select("id,lead_type,contact_name,business_name,phone,status,updated_at").ilike("contact_name",like).order("updated_at",{ascending:false}).limit(10),
    admin.from("prelaunch_leads").select("id,lead_type,contact_name,business_name,phone,status,updated_at").ilike("business_name",like).order("updated_at",{ascending:false}).limit(10),
    admin.from("public_requests").select("id,request_kind,contact_name,contact_channel,contact_value,status,updated_at").ilike("contact_name",like).order("updated_at",{ascending:false}).limit(10)
  ];
  if(digits.length>=4){
    const phoneLike="%"+digits+"%";
    tasks.push(
      admin.from("orders").select("id,public_code,status,customer_id,merchant_id,total_cents,customer_phone_digits,updated_at").ilike("customer_phone_digits",phoneLike).order("updated_at",{ascending:false}).limit(15),
      admin.from("merchant_applications").select("id,company_name,cnpj,responsible_name,phone,status,updated_at").ilike("phone",phoneLike).order("updated_at",{ascending:false}).limit(10),
      admin.from("prelaunch_leads").select("id,lead_type,contact_name,business_name,phone,status,updated_at").ilike("phone",phoneLike).order("updated_at",{ascending:false}).limit(10),
      admin.from("public_requests").select("id,request_kind,contact_name,contact_channel,contact_value,status,updated_at").ilike("contact_value",phoneLike).order("updated_at",{ascending:false}).limit(10)
    );
  }
  if(isUuid){
    tasks.push(
      admin.from("orders").select("id,public_code,status,customer_id,merchant_id,total_cents,customer_phone_digits,updated_at").eq("id",query).limit(1),
      admin.from("orders").select("id,public_code,status,customer_id,merchant_id,total_cents,customer_phone_digits,updated_at").eq("customer_id",query).order("updated_at",{ascending:false}).limit(12),
      admin.from("merchants").select("id,name,cnpj,status,online,trust_score,last_seen_at").eq("id",query).limit(1)
    );
  }

  const responses=await Promise.all(tasks);
  for(const response of responses){
    if(response.error)throw response.error;
  }

  const results:any[]=[];
  const seen=new Set<string>();
  const customerSeen=new Set<string>();
  for(const response of responses){
    for(const row of response.data??[]){
      if(row.public_code){
        pushUniqueResult(results,seen,{
          type:"order",id:row.id,title:row.public_code,
          subtitle:"Pedido • "+String(row.status||"—")+" • "+String(row.customer_phone_digits||"sem telefone"),
          status:row.status,updatedAt:row.updated_at
        });
        if(row.customer_id&&!customerSeen.has(row.customer_id)){
          customerSeen.add(row.customer_id);
          pushUniqueResult(results,seen,{
            type:"customer",id:row.customer_id,title:row.customer_phone_digits||"Cliente",
            subtitle:"Cliente • pedido recente "+row.public_code,
            status:"customer",updatedAt:row.updated_at
          });
        }
      }else if(row.name&&row.cnpj){
        pushUniqueResult(results,seen,{
          type:"merchant",id:row.id,title:row.name,
          subtitle:"Revenda • "+row.cnpj+" • "+String(row.status||"—"),
          status:row.status,updatedAt:row.last_seen_at
        });
      }else if(row.company_name){
        pushUniqueResult(results,seen,{
          type:"application",id:row.id,title:row.company_name,
          subtitle:"Cadastro de parceiro • "+String(row.responsible_name||"—")+" • "+String(row.phone||""),
          status:row.status,updatedAt:row.updated_at
        });
      }else if(row.lead_type){
        pushUniqueResult(results,seen,{
          type:"lead",id:row.id,title:row.business_name||row.contact_name||"Lead",
          subtitle:"Lead • "+String(row.contact_name||"")+" • "+String(row.phone||""),
          status:row.status,updatedAt:row.updated_at
        });
      }else if(row.request_kind){
        pushUniqueResult(results,seen,{
          type:"request",id:row.id,title:row.contact_name||"Solicitação pública",
          subtitle:String(row.request_kind||"Solicitação")+" • "+String(row.contact_value||""),
          status:row.status,updatedAt:row.updated_at
        });
      }
    }
  }
  const allowedTypes=role==="compliance"
    ? new Set(["merchant","application","lead"])
    : ["finance","support"].includes(role)
      ? new Set(["order","merchant","customer"])
      : new Set(["order","merchant","customer","application","lead","request"]);
  return {query,results:results.filter((x:any)=>allowedTypes.has(x.type)).slice(0,40)};
}
async function adminEntityDetail(admin:any,entityType:unknown,rawId:unknown,role:string){
  const type=String(entityType??"").trim().toLowerCase();
  if(!["order","merchant","customer"].includes(type)){
    throw new DomainError("INVALID_ADMIN_ENTITY","Tipo de detalhe administrativo inválido.",400);
  }
  if(!adminRoleCanViewEntity(role,type)){
    throw new DomainError("ADMIN_PERMISSION_DENIED","Seu perfil administrativo não possui acesso a este tipo de detalhe.",403);
  }
  const id=String(rawId??"").trim();
  if(type!=="order")uuid(id,type);

  if(type==="order"){
    let orderQuery=admin.from("orders").select("id,public_code,status,customer_id,merchant_id,proposed_merchant_id,supplier_name_snapshot,payment_method,gross_total_cents,total_cents,cashback_reserved_cents,financial_state,financial_reversed_at,offer_expires_at,accepted_at,dispatch_due_at,dispatched_at,arriving_at,promised_by,delivered_at,settled_at,address_text,postal_code,address_number,address_complement,delivery_reference,customer_phone_digits,delivery_pii_redacted_at,created_at,updated_at,version");
    orderQuery=UUID_RE.test(id)?orderQuery.eq("id",id):orderQuery.eq("public_code",cleanText(id,{min:6,max:32,name:"pedido"}));
    const orderResult=await orderQuery.maybeSingle();
    if(orderResult.error)throw orderResult.error;
    if(!orderResult.data)throw new DomainError("ORDER_NOT_FOUND","Pedido não encontrado.",404);
    const order=orderResult.data;
    const [items,support,feedback,receivable,reimbursement,adjustments,audit,merchant]=await Promise.all([
      admin.from("order_items").select("product_code,product_name,quantity,unit_price_cents,line_total_cents").eq("order_id",order.id).order("product_code"),
      admin.from("support_cases").select("id,category,status,message,resolution_note,resolved_at,created_at,updated_at").eq("order_id",order.id).order("created_at",{ascending:false}).limit(50),
      admin.from("order_feedback").select("rating,tags,note,created_at,updated_at").eq("order_id",order.id).maybeSingle(),
      admin.from("platform_receivables").select("*").eq("order_id",order.id).maybeSingle(),
      admin.from("merchant_cashback_reimbursements").select("*").eq("order_id",order.id).maybeSingle(),
      admin.from("platform_settlement_adjustments").select("*").eq("order_id",order.id).order("created_at",{ascending:false}).limit(50),
      admin.from("platform_admin_audit").select("actor_user_id,action,target_type,target_id,metadata,created_at").eq("target_id",order.id).order("created_at",{ascending:false}).limit(50),
      order.merchant_id?admin.from("merchants").select("id,name,cnpj,status,online,trust_score,last_seen_at").eq("id",order.merchant_id).maybeSingle():Promise.resolve({data:null,error:null})
    ]);
    for(const result of [items,support,feedback,receivable,reimbursement,adjustments,audit,merchant])if(result.error)throw result.error;
    return scopeEntityDetail(role,{type,id:order.id,order,items:items.data??[],support:support.data??[],feedback:feedback.data??null,merchant:merchant.data??null,finance:{receivable:receivable.data??null,reimbursement:reimbursement.data??null,adjustments:adjustments.data??[]},audit:audit.data??[]});
  }

  if(type==="merchant"){
    const merchantResult=await admin.from("merchants").select("*").eq("id",id).maybeSingle();
    if(merchantResult.error)throw merchantResult.error;
    if(!merchantResult.data)throw new DomainError("MERCHANT_NOT_FOUND","Revenda não encontrada.",404);
    const [business,compliance,capabilities,payments,members,catalog,orders,support,receivables,reimbursements,adjustments,audit]=await Promise.all([
      admin.from("merchant_business_details").select("*").eq("merchant_id",id).maybeSingle(),
      admin.from("merchant_compliance").select("*").eq("merchant_id",id).maybeSingle(),
      admin.from("merchant_delivery_capabilities").select("*").eq("merchant_id",id).order("capability_code"),
      admin.from("merchant_payment_methods").select("*").eq("merchant_id",id).order("payment_method"),
      admin.from("merchant_members").select("user_id,member_role,active,display_name,created_at").eq("merchant_id",id).order("created_at"),
      admin.from("catalog_items").select("product_code,product_name,price_cents,min_price_cents,max_price_cents,pricing_mode,pricing_strategy,available_stock,active,price_confirmed_at,updated_at").eq("merchant_id",id).order("product_name"),
      admin.from("orders").select("id,public_code,status,customer_id,total_cents,payment_method,created_at,updated_at,accepted_at,dispatched_at,delivered_at,settled_at").eq("merchant_id",id).order("created_at",{ascending:false}).limit(80),
      admin.from("support_cases").select("id,order_id,category,status,message,resolution_note,created_at,updated_at").eq("merchant_id",id).order("created_at",{ascending:false}).limit(50),
      admin.from("platform_receivables").select("*").eq("merchant_id",id).order("created_at",{ascending:false}).limit(100),
      admin.from("merchant_cashback_reimbursements").select("*").eq("merchant_id",id).order("created_at",{ascending:false}).limit(100),
      admin.from("platform_settlement_adjustments").select("*").eq("merchant_id",id).order("created_at",{ascending:false}).limit(100),
      admin.from("platform_admin_audit").select("actor_user_id,action,target_type,target_id,metadata,created_at").eq("target_id",id).order("created_at",{ascending:false}).limit(50)
    ]);
    for(const result of [business,compliance,capabilities,payments,members,catalog,orders,support,receivables,reimbursements,adjustments,audit])if(result.error)throw result.error;
    const history=orders.data??[];
    const terminal=history.filter((x:any)=>["SETTLED","CANCELLED"].includes(x.status));
    const settled=terminal.filter((x:any)=>x.status==="SETTLED");
    const cancelled=terminal.filter((x:any)=>x.status==="CANCELLED");
    const delivered=history.filter((x:any)=>x.delivered_at);
    const onTime=delivered.filter((x:any)=>x.delivered_at&&x.updated_at&&new Date(x.delivered_at).getTime()<=new Date(x.updated_at).getTime());
    return scopeEntityDetail(role,{
      type,id,merchant:merchantResult.data,business:business.data??null,compliance:compliance.data??null,
      capabilities:capabilities.data??[],payments:payments.data??[],members:members.data??[],catalog:catalog.data??[],
      orders:history,support:support.data??[],finance:{receivables:receivables.data??[],reimbursements:reimbursements.data??[],adjustments:adjustments.data??[]},
      metrics:{orders:history.length,settled:settled.length,cancelled:cancelled.length,cancellationRate:terminal.length?cancelled.length/terminal.length:null,onTimeKnown:delivered.length,onTimeCount:onTime.length},
      audit:audit.data??[]
    });
  }

  const customerId=uuid(id,"customer");
  const [profile,orders,support,feedback]=await Promise.all([
    admin.from("profiles").select("user_id,referral_code,created_at,updated_at").eq("user_id",customerId).maybeSingle(),
    admin.from("orders").select("id,public_code,status,merchant_id,supplier_name_snapshot,total_cents,gross_total_cents,cashback_reserved_cents,payment_method,customer_phone_digits,postal_code,created_at,updated_at,delivered_at,settled_at,financial_state").eq("customer_id",customerId).order("created_at",{ascending:false}).limit(100),
    admin.from("support_cases").select("id,order_id,merchant_id,category,status,message,resolution_note,created_at,updated_at").eq("customer_id",customerId).order("created_at",{ascending:false}).limit(80),
    admin.from("order_feedback").select("order_id,merchant_id,rating,tags,note,created_at").eq("customer_id",customerId).order("created_at",{ascending:false}).limit(80)
  ]);
  for(const result of [profile,orders,support,feedback])if(result.error)throw result.error;
  const history=orders.data??[];
  const settled=history.filter((x:any)=>x.status==="SETTLED");
  const cancelled=history.filter((x:any)=>x.status==="CANCELLED");
  const spend=settled.reduce((sum:number,x:any)=>sum+Number(x.total_cents||0),0);
  const cashback=settled.reduce((sum:number,x:any)=>sum+Number(x.cashback_reserved_cents||0),0);
  return scopeEntityDetail(role,{type,id:customerId,profile:profile.data??null,orders:history,support:support.data??[],feedback:feedback.data??[],metrics:{orders:history.length,settled:settled.length,cancelled:cancelled.length,spendCents:spend,cashbackCents:cashback}});
}
function adminRoleAuditMatch(role:string,row:any){
  if(["superadmin","readonly"].includes(role))return true;
  const action=String(row?.action||"").toLowerCase();
  if(role==="finance")return /financial|reward|referral|reverse|settlement|commercial|incident/.test(action);
  if(role==="support")return /order|support|incident/.test(action);
  if(role==="compliance")return /merchant|application|compliance|delivery_capability|pilot|incident/.test(action);
  if(role==="operations")return !/financial|reward|referral|platform_admin|admin_access/.test(action);
  return false;
}
async function adminAuditSearch(admin:any,body:any,role:string){
  const limit=Math.min(200,Math.max(1,Number(body.limit||100)));
  let query=admin.from("platform_admin_audit")
    .select("id,actor_user_id,action,target_type,target_id,metadata,created_at")
    .order("created_at",{ascending:false})
    .limit(limit);
  if(body.actorUserId)query=query.eq("actor_user_id",uuid(body.actorUserId,"actor"));
  if(body.action)query=query.eq("action",cleanText(body.action,{min:2,max:80,name:"ação"}));
  if(body.targetType)query=query.eq("target_type",cleanText(body.targetType,{min:2,max:80,name:"tipo de alvo"}));
  if(body.from){
    const from=new Date(String(body.from));
    if(!Number.isFinite(from.getTime()))throw new DomainError("INVALID_AUDIT_RANGE","Data inicial inválida.",400);
    query=query.gte("created_at",from.toISOString());
  }
  if(body.to){
    const to=new Date(String(body.to));
    if(!Number.isFinite(to.getTime()))throw new DomainError("INVALID_AUDIT_RANGE","Data final inválida.",400);
    query=query.lte("created_at",to.toISOString());
  }
  const result=await query;
  if(result.error)throw result.error;
  const q=String(body.query||"").trim().toLowerCase();
  const rows=(result.data??[]).filter((row:any)=>{
    if(!adminRoleAuditMatch(role,row))return false;
    if(!q)return true;
    return [row.action,row.target_type,row.target_id,row.actor_user_id,JSON.stringify(row.metadata||{})]
      .some(v=>String(v||"").toLowerCase().includes(q));
  });
  return {results:rows,limit};
}
async function adminIncidentList(admin:any){
  const result=await admin.from("platform_incidents")
    .select("id,title,description,severity,status,source,entity_type,entity_id,assigned_admin_id,created_by,acknowledged_at,acknowledged_by,resolved_at,resolved_by,resolution_note,created_at,updated_at")
    .order("updated_at",{ascending:false})
    .limit(200);
  if(result.error)throw result.error;
  return {incidents:result.data??[]};
}

async function adminSystemHealth(admin:any){
  const started=Date.now();
  const now=new Date();
  const heartbeatCutoff=now.getTime()-15*60*1000;
  const priceCutoff=now.getTime()-24*60*60*1000;
  const [portals,readiness,paymentProvider,openSupport,rewardDebt,accountingDebt,overdueReceivables,overdueCashback,activeMerchants]=await Promise.all([
    verifyLivePortals(),
    admin.rpc("platform_launch_readiness"),
    billingProviderHealth(),
    admin.from("support_cases").select("id",{count:"exact",head:true}).in("status",["open","in_review"]),
    admin.from("reward_processing_failures").select("order_id",{count:"exact",head:true}).is("resolved_at",null),
    admin.from("settlement_accounting_failures").select("order_id",{count:"exact",head:true}).is("resolved_at",null),
    admin.from("platform_receivables").select("order_id",{count:"exact",head:true}).eq("status","open").lt("due_at",now.toISOString()),
    admin.from("merchant_cashback_reimbursements").select("order_id",{count:"exact",head:true}).eq("status","open").lt("due_at",now.toISOString()),
    admin.from("merchants").select("id,last_seen_at,price_confirmed_at").eq("status","active").limit(1000)
  ]);
  for(const result of [readiness,openSupport,rewardDebt,accountingDebt,overdueReceivables,overdueCashback,activeMerchants]){
    if(result.error)throw result.error;
  }
  const activeMerchantRows=activeMerchants.data??[];
  const staleMerchantHeartbeat=activeMerchantRows.filter((m:any)=>{
    const ts=Date.parse(String(m.last_seen_at??""));
    return !Number.isFinite(ts)||ts<heartbeatCutoff;
  }).length;
  const staleMerchantPrice=activeMerchantRows.filter((m:any)=>{
    const ts=Date.parse(String(m.price_confirmed_at??""));
    return !Number.isFinite(ts)||ts<priceCutoff;
  }).length;
  const queues={
    openSupport:Number(openSupport.count||0),
    rewardFailures:Number(rewardDebt.count||0),
    accountingFailures:Number(accountingDebt.count||0),
    overdueReceivables:Number(overdueReceivables.count||0),
    overdueCashback:Number(overdueCashback.count||0),
    staleMerchantHeartbeat,
    staleMerchantPrice
  };
  const critical=
    (!portals.ok)
    ||(Array.isArray(readiness.data?.securityBlockers)&&readiness.data.securityBlockers.length>0);
  const operationalQueueDegraded=
    Object.values(queues).some((x:any)=>Number(x)>0);
  // The marketplace remains operable through the manual Finance fallback if
  // the PSP is unavailable, so provider health degrades the control plane but
  // never silently disables commerce or promotes itself to a security blocker.
  const paymentProviderDegraded=paymentProvider?.ok!==true;
  const degraded=operationalQueueDegraded||paymentProviderDegraded;
  return {
    checkedAt:now.toISOString(),
    latencyMs:Date.now()-started,
    status:critical?"critical":degraded?"degraded":"healthy",
    edge:{ok:true,service:"admin-ops"},
    database:{ok:true,operationMode:readiness.data?.operationMode??null,commerceEnabled:readiness.data?.commerceEnabled===true},
    portals,
    paymentProvider,
    queues,
    readiness:readiness.data??{}
  };
}

async function summary(admin:any,actorUserId:string){
  const [apps,merchants,compliance,capabilities,referralReviews,rewardFailures,accountingFailures,receivables,reimbursements,adjustments,platformAdmins,prelaunchLeads,publicRequests,audit,incidents]=await Promise.all([
    admin.from("merchant_applications")
      .select("id,applicant_user_id,pilot_partner_draft_id,cnpj,company_name,responsible_name,phone,address_text,status,created_at,updated_at")
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
      .select("user_id,active,admin_role,created_by,created_at")
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
      .limit(50),
    admin.from("platform_incidents")
      .select("id,title,description,severity,status,source,entity_type,entity_id,assigned_admin_id,created_by,acknowledged_at,acknowledged_by,resolved_at,resolved_by,resolution_note,created_at,updated_at")
      .order("updated_at",{ascending:false})
      .limit(100)
  ]);
  for(const result of [apps,merchants,compliance,capabilities,referralReviews,rewardFailures,accountingFailures,receivables,reimbursements,adjustments,platformAdmins,prelaunchLeads,publicRequests,audit,incidents]){
    if(result.error)throw result.error;
  }
  const currentAdmin=(platformAdmins.data??[]).find((x:any)=>x.user_id===actorUserId)??null;
  const actorRole=String(currentAdmin?.admin_role||"superadmin");
  const pilotPartners=await admin
    .from("pilot_partner_drafts")
    .select("id,display_name,proposed_product_code,proposed_delivered_price_cents,delivery_included,price_status,onboarding_status,merchant_id,pricing_mode,min_delivered_price_cents,preferred_delivered_price_cents,max_delivered_price_cents,pricing_strategy,notes,created_at,updated_at")
    .order("created_at",{ascending:true})
    .limit(50);
  if(pilotPartners.error)throw pilotPartners.error;
  const pilotPartnerInvites=await admin
    .from("pilot_partner_invites")
    .select("id,draft_id,expires_at,claimed_at,claimed_user_id,application_id,revoked_at,created_at")
    .order("created_at",{ascending:false})
    .limit(200);
  if(pilotPartnerInvites.error)throw pilotPartnerInvites.error;
  const invitesByDraft=new Map<string,any[]>();
  for(const invite of pilotPartnerInvites.data??[]){
    if(!invitesByDraft.has(invite.draft_id))invitesByDraft.set(invite.draft_id,[]);
    invitesByDraft.get(invite.draft_id)!.push(invite);
  }
  const applicationByDraft=new Map<string,any>();
  for(const application of apps.data??[]){
    if(!application.pilot_partner_draft_id||applicationByDraft.has(application.pilot_partner_draft_id))continue;
    applicationByDraft.set(application.pilot_partner_draft_id,application);
  }
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

  const billingMetricsPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.rpc("admin_merchant_billing_metrics",{p_actor_user_id:actorUserId})
    : Promise.resolve({data:null,error:null});
  const billingReconciliationPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.rpc("admin_merchant_billing_reconciliation",{p_actor_user_id:actorUserId})
    : Promise.resolve({data:null,error:null});
  const billingPaymentEventsPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("merchant_billing_payment_events")
        .select("id,provider,provider_event_id,reconciliation_key,provider_correlation_id,payment_method,amount_cents,currency,occurred_at,received_at,payer_reference,status,payment_request_id,merchant_id,match_reason,applied_at,applied_by,ignored_at,ignored_by,ignore_reason,updated_at")
        .order("received_at",{ascending:false})
        .limit(200)
    : Promise.resolve({data:[],error:null});
  const billingProviderChargesPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("merchant_billing_provider_charges")
        .select("id,payment_request_id,merchant_id,provider,correlation_id,amount_cents,currency,status,provider_charge_id,provider_transaction_id,expires_at,expired_at,completed_at,paid_amount_cents,end_to_end_id,last_error_code,last_error_at,created_at,updated_at")
        .order("created_at",{ascending:false})
        .limit(200)
    : Promise.resolve({data:[],error:null});
  const billingWebhookProbesPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("payment_webhook_probes")
        .select("id,provider,resource_id,status,requested_at,expires_at,verified_at")
        .order("requested_at",{ascending:false})
        .limit(20)
    : Promise.resolve({data:[],error:null});
  const merchantPaymentAccountsPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("merchant_payment_provider_accounts")
        .select("id,merchant_id,provider,provider_account_id,status,connection_mode,verification_level,credential_kind,capabilities,metadata,token_expires_at,connected_at,refreshed_at,revoked_at,last_error_code,last_error_at,updated_at")
        .order("updated_at",{ascending:false})
        .limit(1000)
    : Promise.resolve({data:[],error:null});
  const merchantPaymentProvidersPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("payment_provider_catalog")
        .select("provider_key,display_name,connection_mode,verification_level,adapter_status,supported_methods,supports_webhook,supports_lookup,requires_platform_credentials,funds_flow,sort_order,notes")
        .order("sort_order",{ascending:true})
    : Promise.resolve({data:[],error:null});
  const merchantPaymentRoutesPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("merchant_payment_routes")
        .select("id,merchant_id,payment_method,provider,connection_id,channel,verification_mode,active,priority,customer_label,confirmed_at,updated_at")
        .order("merchant_id",{ascending:true})
        .order("priority",{ascending:true})
        .limit(2000)
    : Promise.resolve({data:[],error:null});
  const merchantSaleVerificationsPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("merchant_sale_payment_verifications")
        .select("id,order_id,payment_attempt_id,merchant_id,provider,verification_level,evidence_type,provider_transaction_id,amount_cents,currency,status,funds_owner,occurred_at,verified_at,created_at")
        .order("created_at",{ascending:false})
        .limit(500)
    : Promise.resolve({data:[],error:null});
  const billingRefundsPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("merchant_billing_payment_refunds")
        .select("id,provider,provider_event_id,original_reconciliation_key,refund_reconciliation_key,amount_cents,recoverable_amount_cents,excess_amount_cents,currency,occurred_at,received_at,status,payment_event_id,payment_request_id,merchant_id,original_payment_amount_cents,cumulative_refunded_cents,match_reason,reopened_refund_recovery_id,resolved_by,resolved_at,resolution_reference,created_at,updated_at")
        .order("occurred_at",{ascending:false})
        .limit(200)
    : Promise.resolve({data:[],error:null});
  const billingRefundRecoveriesPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("merchant_billing_refund_recoveries")
        .select("id,refund_id,merchant_id,original_payment_request_id,amount_cents,outstanding_cents,currency,status,recovery_payment_request_id,recovered_by,recovered_at,created_at,updated_at")
        .order("created_at",{ascending:false})
        .limit(200)
    : Promise.resolve({data:[],error:null});
  const [billingPlans,billingAccounts,dailyStatements,billingPaymentRequests,billingMetrics,billingReconciliation,billingPaymentEvents,billingProviderCharges,billingWebhookProbes,merchantPaymentAccounts,merchantPaymentProviders,merchantPaymentRoutes,merchantSaleVerifications,billingRefunds,billingRefundRecoveries]=await Promise.all([
    admin.from("merchant_billing_plans")
      .select("plan_key,display_name,billing_mode,platform_fee_bps,purchase_amount_cents,credit_grant_cents,active,sort_order,policy_version,updated_by,last_change_reason,updated_at")
      .order("sort_order",{ascending:true}),
    admin.from("merchant_billing_accounts")
      .select("merchant_id,plan_key,credit_balance_cents,credit_reserved_cents,sales_hold,sales_hold_reason,sales_hold_at,last_daily_close_date,updated_at")
      .order("updated_at",{ascending:false})
      .limit(200),
    admin.from("merchant_daily_statements")
      .select("id,merchant_id,business_date,gross_sales_cents,gross_fee_cents,prepaid_credit_applied_cents,amount_due_cents,status,due_at,closed_at,paid_at,waived_at,resolution_reference,created_at,updated_at")
      .order("business_date",{ascending:false})
      .limit(300),
    admin.from("merchant_billing_payment_requests")
      .select("id,merchant_id,request_kind,plan_key,statement_id,refund_recovery_id,expected_amount_cents,platform_fee_bps_snapshot,credit_grant_cents_snapshot,merchant_reference,status,requested_by,requested_at,resolved_by,resolved_at,admin_reference,received_amount_cents,payment_method,reconciliation_key,approval_source,provider_payment_event_id,updated_at")
      .order("requested_at",{ascending:false})
      .limit(300),
    billingMetricsPromise,
    billingReconciliationPromise,
    billingPaymentEventsPromise,
    billingProviderChargesPromise,
    billingWebhookProbesPromise,
    merchantPaymentAccountsPromise,
    merchantPaymentProvidersPromise,
    merchantPaymentRoutesPromise,
    merchantSaleVerificationsPromise,
    billingRefundsPromise,
    billingRefundRecoveriesPromise
  ]);
  for(const result of [billingPlans,billingAccounts,dailyStatements,billingPaymentRequests,billingMetrics,billingReconciliation,billingPaymentEvents,billingProviderCharges,billingWebhookProbes,merchantPaymentAccounts,merchantPaymentProviders,merchantPaymentRoutes,merchantSaleVerifications,billingRefunds,billingRefundRecoveries]){
    if(result.error)throw result.error;
  }

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

  const [supportCases,businessMetrics,launchReadiness,acquisitionMetrics,merchantReadiness]=await Promise.all([
    admin.from("support_cases")
      .select("id,order_id,customer_id,merchant_id,category,status,message,resolution_note,resolved_at,created_at,updated_at")
      .in("status",["open","in_review","resolved"])
      .order("updated_at",{ascending:false})
      .limit(100),
    admin.rpc("platform_business_metrics"),
    admin.rpc("platform_launch_readiness"),
    admin.rpc("admin_prelaunch_acquisition_metrics",{p_actor_user_id:actorUserId}),
    admin.rpc("admin_merchant_readiness_snapshot",{p_actor_user_id:actorUserId})
  ]);
  if(supportCases.error)throw supportCases.error;
  if(businessMetrics.error)throw businessMetrics.error;
  if(launchReadiness.error)throw launchReadiness.error;
  if(acquisitionMetrics.error)throw acquisitionMetrics.error;
  if(merchantReadiness.error)throw merchantReadiness.error;

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
  const merchantReadinessById=new Map<string,any>(
    (merchantReadiness.data??[]).map((x:any)=>[String(x.merchantId),x] as [string,any])
  );
  const paymentAccountsByMerchant=new Map<string,any[]>();
  for(const account of merchantPaymentAccounts.data??[]){
    const key=String(account.merchant_id);
    if(!paymentAccountsByMerchant.has(key))paymentAccountsByMerchant.set(key,[]);
    paymentAccountsByMerchant.get(key)!.push(account);
  }
  const paymentRoutesByMerchant=new Map<string,any[]>();
  for(const route of merchantPaymentRoutes.data??[]){
    const key=String(route.merchant_id);
    if(!paymentRoutesByMerchant.has(key))paymentRoutesByMerchant.set(key,[]);
    paymentRoutesByMerchant.get(key)!.push(route);
  }
  const capabilitiesByMerchant=new Map<string,any[]>();
  for(const cap of capabilities.data??[]){
    if(!capabilitiesByMerchant.has(cap.merchant_id))capabilitiesByMerchant.set(cap.merchant_id,[]);
    capabilitiesByMerchant.get(cap.merchant_id)!.push(cap);
  }
  const summaryResult={
    applications:apps.data??[],
    pilotPartners:(pilotPartners.data??[]).map((p:any)=>{
      const inviteHistory=invitesByDraft.get(p.id)??[];
      const now=Date.now();
      const activeInvite=inviteHistory.find((invite:any)=>
        !invite.claimed_at&&!invite.revoked_at&&Date.parse(invite.expires_at)>now
      )??null;
      const claimedInvite=inviteHistory.find((invite:any)=>Boolean(invite.claimed_at))??null;
      const latestInvite=inviteHistory[0]??null;
      const application=applicationByDraft.get(p.id)??null;
      const converted=p.onboarding_status==="converted"||Boolean(p.merchant_id);
      const readiness:any=p.merchant_id?merchantReadinessById.get(String(p.merchant_id))??null:null;
      const cancelled=p.onboarding_status==="cancelled";
      let inviteStatus="none";
      if(claimedInvite||application)inviteStatus="claimed";
      else if(activeInvite)inviteStatus="active";
      else if(latestInvite?.revoked_at)inviteStatus="revoked";
      else if(latestInvite&&Date.parse(latestInvite.expires_at)<=now)inviteStatus="expired";
      let nextAction="issue_invite";
      if(cancelled)nextAction="none";
      else if(converted)nextAction=String(readiness?.nextAction||"merchant_setup_review");
      else if(application?.status==="rejected")nextAction="partner_resubmit";
      else if(application||claimedInvite)nextAction="review_and_convert";
      else if(activeInvite)nextAction="partner_claim_invite";
      else if(latestInvite)nextAction="issue_new_invite";
      return {
        ...p,
        activeInvite:activeInvite?{
          id:activeInvite.id,
          expiresAt:activeInvite.expires_at,
          createdAt:activeInvite.created_at
        }:null,
        onboarding:{
          inviteStatus,
          inviteExpiresAt:activeInvite?.expires_at??latestInvite?.expires_at??null,
          inviteClaimedAt:claimedInvite?.claimed_at??null,
          ownerClaimed:Boolean(claimedInvite?.claimed_user_id||application?.applicant_user_id||readiness?.ownerReady),
          application:application?{
            id:application.id,
            status:application.status,
            companyName:application.company_name,
            cnpj:application.cnpj,
            responsibleName:application.responsible_name,
            phone:application.phone,
            addressText:application.address_text,
            updatedAt:application.updated_at
          }:null,
          merchantCreated:converted,
          readiness,
          nextAction,
          steps:[
            {key:"invite",done:Boolean(activeInvite||claimedInvite||application||converted),status:inviteStatus},
            {key:"claim",done:Boolean(claimedInvite||application||converted),status:(claimedInvite||application||converted)?"done":"pending"},
            {key:"application",done:Boolean((application&&["pending","approved"].includes(application.status))||converted),status:application?.status??(converted?"converted":"pending")},
            {key:"merchant",done:converted,status:converted?"done":"pending"},
            {key:"owner",done:Boolean(readiness?.ownerReady),status:readiness?.ownerReady?"done":"pending"},
            {key:"compliance",done:Boolean(readiness?.complianceReady),status:readiness?.complianceReady?"done":"pending"},
            {key:"payment",done:Boolean(readiness?.paymentReady),status:readiness?.paymentReady?"done":"pending"},
            {key:"offer",done:Boolean(readiness?.commercialReady),status:readiness?.commercialReady?"done":"pending"},
            {key:"online",done:Boolean(readiness?.offerReady),status:readiness?.offerReady?"done":"pending"}
          ]
        }
      };
    }),
    merchants:(merchants.data??[]).map((m:any)=>({
      ...m,
      compliance:byMerchant.get(m.id)??null,
      businessDetails:businessByMerchant.get(m.id)??null,
      deliveryCapabilities:capabilitiesByMerchant.get(m.id)??[],
      readiness:merchantReadinessById.get(m.id)??null,
      paymentAccounts:paymentAccountsByMerchant.get(String(m.id))??[],
      paymentAccount:(paymentAccountsByMerchant.get(String(m.id))??[]).find((x:any)=>x.provider==="mercadopago")??null,
      paymentRoutes:paymentRoutesByMerchant.get(String(m.id))??[]
    })),
    merchantReadiness:merchantReadiness.data??[],
    businessMetrics:businessMetrics.data??{},
    launchReadiness:launchReadiness.data??{},
    commercialPolicy:commercialPolicy.data??null,
    merchantPayments:{
      globalDirectPaymentsEnabled:
        String(Deno.env.get("MERCHANT_DIRECT_PAYMENTS_ENABLED")??"").trim()==="1",
      fundsOwner:"merchant",
      tamaoReceivesSaleProceeds:false,
      providerCatalog:merchantPaymentProviders.data??[],
      routes:merchantPaymentRoutes.data??[],
      verifications:merchantSaleVerifications.data??[]
    },
    merchantBilling:{
      plans:billingPlans.data??[],
      accounts:billingAccounts.data??[],
      statements:dailyStatements.data??[],
      paymentRequests:billingPaymentRequests.data??[],
      paymentEvents:billingPaymentEvents.data??[],
      refunds:billingRefunds.data??[],
      refundRecoveries:billingRefundRecoveries.data??[],
      providerCharges:billingProviderCharges.data??[],
      webhookProbes:billingWebhookProbes.data??[],
      paymentAccounts:merchantPaymentAccounts.data??[],
      paymentIngress:billingPaymentIngressReadiness(),
      metrics:billingMetrics.data??null,
      reconciliation:billingReconciliation.data??null
    },
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
    currentAdmin,
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
    incidents:incidents.data??[],
    recentAudit:audit.data??[]
  };
  return scopeAdminSummary(actorRole,summaryResult);
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
    const adminAccess=await requireAdmin(admin,user.id);
    requireAdminAction(String(adminAccess.admin_role||"superadmin"),action);

    if(action==="summary"){
      return json(await summary(admin,user.id),200,origin);
    }
    if(action==="search"){
      return json(await adminSearch(admin,body.query,String(adminAccess.admin_role||"superadmin")),200,origin);
    }
    if(action==="entity-detail"){
      return json(await adminEntityDetail(admin,body.entityType,body.entityId,String(adminAccess.admin_role||"superadmin")),200,origin);
    }
    if(action==="system-health"){
      return json(await adminSystemHealth(admin),200,origin);
    }
    if(action==="billing-provider-health"){
      return json(await billingProviderHealth(admin),200,origin);
    }
    if(action==="audit-search"){
      return json(await adminAuditSearch(admin,body,String(adminAccess.admin_role||"superadmin")),200,origin);
    }
    if(action==="incident-list"){
      return json(await adminIncidentList(admin),200,origin);
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
      const anpReference=body.anpReference==null?null:(cleanText(body.anpReference,{min:0,max:240,name:"referência ANP"})||null);
      const notes=body.notes==null?null:(cleanText(body.notes,{min:0,max:1000,name:"evidência de compliance"})||null);
      if(cnpjStatus==="verified"&&(!notes||notes.length<5)){
        throw new DomainError("CNPJ_EVIDENCE_REQUIRED","Registre a fonte/evidência usada para verificar o CNPJ.",400);
      }
      if(anpStatus==="verified"&&(!anpReference||anpReference.length<3)){
        throw new DomainError("ANP_REFERENCE_REQUIRED","Informe a referência da consulta ANP.",400);
      }
      if((cnpjStatus==="rejected"||anpStatus==="rejected")&&(!notes||notes.length<5)){
        throw new DomainError("COMPLIANCE_REJECTION_EVIDENCE_REQUIRED","Documente a evidência da rejeição de compliance.",400);
      }
      payload={
        merchantId:uuid(body.merchantId,"merchant"),
        cnpjStatus,
        anpStatus,
        anpReference,
        notes
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
      let targetUserId=body.targetUserId==null||String(body.targetUserId).trim()===""?null:uuid(body.targetUserId,"targetUser");
      if(targetUserId==null){
        const targetEmail=String(body.targetEmail??"").trim().toLowerCase();
        if(targetEmail.length<3||targetEmail.length>160||!/^\\S+@\\S+\\.\\S+$/.test(targetEmail)){
          throw new DomainError("INVALID_ADMIN_EMAIL","Informe um e-mail válido de conta permanente.",400);
        }
        let targetUser:any=null;
        for(let page=1;page<=10&&!targetUser;page++){
          const {data:listData,error:listError}=await admin.auth.admin.listUsers({page,perPage:1000});
          if(listError)throw listError;
          targetUser=(listData?.users??[]).find((candidate:any)=>
            candidate?.is_anonymous!==true
            &&String(candidate?.email??"").trim().toLowerCase()===targetEmail
          )??null;
          if((listData?.users??[]).length<1000)break;
        }
        if(!targetUser?.id){
          throw new DomainError(
            "ADMIN_USER_NOT_FOUND",
            "Esta conta permanente ainda não existe. Peça para a pessoa acessar o TAMÃO com esse e-mail antes de conceder acesso administrativo.",
            404
          );
        }
        targetUserId=uuid(targetUser.id,"targetUser");
      }
      const existingAccess=await admin
        .from("platform_admins")
        .select("admin_role")
        .eq("user_id",targetUserId)
        .maybeSingle();
      if(existingAccess.error)throw existingAccess.error;
      const adminRole=String(body.adminRole??existingAccess.data?.admin_role??"readonly").trim().toLowerCase();
      if(!["superadmin","operations","finance","support","compliance","readonly"].includes(adminRole)){
        throw new DomainError("INVALID_ADMIN_ROLE","Perfil administrativo inválido.",400);
      }
      payload={
        targetUserId,
        active:body.active===true,
        adminRole
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
    }else if(action==="merchant-billing-plan"){
      const planKey=String(body.planKey??"").trim().toLowerCase();
      const expectedVersion=Number(body.expectedVersion);
      const platformFeeBps=Number(body.platformFeeBps);
      if(!/^[a-z][a-z0-9_]{1,63}$/.test(planKey)){
        throw new DomainError("INVALID_BILLING_PLAN_KEY","Plano de cobrança inválido.",400);
      }
      if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1){
        throw new DomainError("INVALID_BILLING_PLAN_VERSION","Versão do plano inválida.",400);
      }
      if(!Number.isSafeInteger(platformFeeBps)||platformFeeBps<1||platformFeeBps>10000){
        throw new DomainError("INVALID_BILLING_PLAN_FEE","Taxa do plano inválida.",400);
      }
      payload={
        planKey,
        expectedVersion,
        platformFeeBps,
        active:body.active===true,
        reason:cleanText(body.reason,{min:3,max:1000,name:"motivo da alteração do plano"})
      };
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
      if(!["note","rescue","cancel","cancel-after-dispatch"].includes(controlAction)){
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
    }else if(action==="pilot-invite"){
      const inviteAction=String(body.inviteAction??"").trim().toLowerCase();
      if(!["issue","revoke"].includes(inviteAction)){
        throw new DomainError("INVALID_PILOT_INVITE_ACTION","Ação de convite piloto inválida.",400);
      }
      const draftId=uuid(body.pilotPartnerId,"pilotPartner");
      let tokenHash:null|string=null;
      let expiresAt:null|string=null;
      if(inviteAction==="issue"){
        const token=String(body.token??"").trim();
        if(token.length<20||token.length>240||!/^[A-Za-z0-9_-]+$/.test(token)){
          throw new DomainError("INVALID_PILOT_INVITE","Token de convite inválido.",400);
        }
        tokenHash=await sha256Hex(token);
        const parsed=new Date(String(body.expiresAt??""));
        const now=Date.now();
        if(!Number.isFinite(parsed.getTime())
           ||parsed.getTime()<=now+5*60*1000
           ||parsed.getTime()>now+90*24*60*60*1000){
          throw new DomainError("INVALID_PILOT_INVITE_EXPIRY","Validade do convite precisa ficar entre 5 minutos e 90 dias.",400);
        }
        expiresAt=parsed.toISOString();
      }
      payload={draftId,inviteAction,tokenHash,expiresAt};
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
      let ownerUserId=body.ownerUserId==null||String(body.ownerUserId).trim()===""?null:uuid(body.ownerUserId,"owner");
      if(draftId&&ownerUserId==null){
        const {data:claimedApplication,error:claimedApplicationError}=await admin
          .from("merchant_applications")
          .select("applicant_user_id,status")
          .eq("pilot_partner_draft_id",draftId)
          .in("status",["pending","approved"])
          .order("updated_at",{ascending:false})
          .limit(1)
          .maybeSingle();
        if(claimedApplicationError)throw claimedApplicationError;
        if(!claimedApplication?.applicant_user_id){
          throw new DomainError(
            "PILOT_OWNER_REQUIRED",
            "O parceiro precisa reivindicar o convite e concluir o cadastro antes da conversão.",
            409
          );
        }
        ownerUserId=uuid(claimedApplication.applicant_user_id,"owner");
      }
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
      let sourceSha=body.sourceSha==null?null:String(body.sourceSha).trim().toLowerCase()||null;
      if(["PILOT","LIVE"].includes(mode)){
        const verification=await verifyLivePortals();
        if(!verification.ok||!verification.sourceSha){
          return json({
            error:"LIVE_PORTALS_NOT_READY",
            message:"Os três portais oficiais precisam passar na verificação imediatamente antes de ativar PILOT/LIVE.",
            verification
          },409,origin);
        }
        sourceSha=verification.sourceSha;
      }
      payload={
        mode,
        reason:cleanText(body.reason,{min:3,max:1000,name:"motivo da mudança de modo"}),
        sourceSha
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
    }else if(action==="enable-commerce"){
      const verification=await verifyLivePortals();
      if(!verification.ok||!verification.sourceSha){
        return json({
          error:"LIVE_PORTALS_NOT_READY",
          message:"Os três portais oficiais precisam passar na verificação imediatamente antes de ativar PILOT.",
          verification
        },409,origin);
      }
      payload={
        mode:"PILOT",
        reason:"Abertura pelo fluxo legado redirecionada para a autoridade moderna em modo PILOT.",
        sourceSha:verification.sourceSha
      };
    }else if(action==="disable-commerce"){
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
    }else if(action==="merchant-billing-action"){
      const billingAction=String(body.billingAction??"").trim().toLowerCase();
      if(billingAction==="confirm-package"){
        throw new DomainError(
          "PACKAGE_PAYMENT_REQUEST_REQUIRED",
          "Pacotes só podem ser creditados a partir de uma solicitação financeira da revenda.",
          409
        );
      }
      if(billingAction==="mark-statement-paid"){
        throw new DomainError(
          "STATEMENT_PAYMENT_REQUEST_REQUIRED",
          "A quitação de D+1 só pode ocorrer pela solicitação de pagamento informada pela revenda e conciliada pelo Financeiro.",
          409
        );
      }
      if(!["set-flex","waive-statement"].includes(billingAction)){
        throw new DomainError("INVALID_BILLING_ACTION","Ação de cobrança da revenda inválida.",400);
      }
      const statementId=body.statementId==null||String(body.statementId).trim()===""?null:uuid(body.statementId,"statement");
      payload={
        merchantId:uuid(body.merchantId,"merchant"),
        billingAction,
        planKey:null,
        statementId,
        reference:cleanText(body.reference,{min:3,max:240,name:"referência financeira"})
      };
    }else if(action==="merchant-payment-capability"){
      const enabled=body.enabled===true;
      const provider=String(body.provider??"mercadopago").trim().toLowerCase();
      if(!/^[a-z][a-z0-9_]{1,39}$/.test(provider)||provider==="manual"){
        throw new DomainError("PAYMENT_PROVIDER_INVALID","Provedor de pagamento inválido.",400);
      }
      const reference=cleanText(body.reference,{
        min:3,max:240,name:"referência da homologação de pagamento"
      });
      if(enabled){
        if(provider!=="mercadopago"){
          throw new DomainError(
            "MERCHANT_PAYMENT_ADAPTER_NOT_IMPLEMENTED",
            "Este provedor já existe na camada multi-PSP, mas ainda não possui o ciclo completo de venda automática homologado.",
            409
          );
        }
        const oauthClientId=String(Deno.env.get("MERCADOPAGO_CLIENT_ID")??"").trim();
        const oauthClientSecret=String(Deno.env.get("MERCADOPAGO_CLIENT_SECRET")??"").trim();
        const oauthRedirect=String(Deno.env.get("MERCADOPAGO_OAUTH_REDIRECT_URI")??"").trim();
        const webhookSecret=String(Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")??"").trim();
        const encryptionKey=String(Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??"").trim();
        let redirectValid=false;
        try{
          const parsed=new URL(oauthRedirect);
          redirectValid=parsed.protocol==="https:"&&!parsed.username&&!parsed.password;
        }catch{}
        if(
          oauthClientId.length<5
          ||oauthClientSecret.length<10
          ||!redirectValid
          ||webhookSecret.length<16
          ||!paymentEncryptionConfigured(encryptionKey)
        ){
          throw new DomainError(
            "MERCHANT_PAYMENT_RUNTIME_NOT_READY",
            "OAuth, webhook e criptografia precisam estar configurados antes de homologar pagamentos diretos.",
            503
          );
        }
      }
      payload={
        merchantId:uuid(body.merchantId,"merchant"),
        provider,
        enabled,
        reference
      };
    }else if(action==="merchant-billing-payment-request"){
      const requestAction=String(body.requestAction??"").trim().toLowerCase();
      if(!["approve","reject"].includes(requestAction)){
        throw new DomainError("INVALID_PAYMENT_REQUEST_ACTION","Ação de solicitação financeira inválida.",400);
      }
      const receivedAmountCents=requestAction==="approve"?Number(body.receivedAmountCents):null;
      if(requestAction==="approve"&&(!Number.isSafeInteger(receivedAmountCents)||Number(receivedAmountCents)<=0)){
        throw new DomainError("RECEIVED_AMOUNT_REQUIRED","Informe o valor efetivamente recebido em centavos.",400);
      }
      const paymentMethod=requestAction==="approve"
        ?String(body.paymentMethod??"").trim().toLowerCase()
        :null;
      if(paymentMethod!=null&&!["pix","bank_transfer","cash","card","other"].includes(paymentMethod)){
        throw new DomainError("INVALID_PAYMENT_METHOD","Forma de pagamento confirmada inválida.",400);
      }
      const reconciliationKey=requestAction==="approve"
        ?cleanText(body.reconciliationKey,{min:6,max:160,name:"identificador único da transação"})
        :null;
      const paymentEventId=requestAction==="approve"
        &&body.paymentEventId!=null
        &&String(body.paymentEventId).trim()!==""
          ?uuid(body.paymentEventId,"payment event")
          :null;
      payload={
        paymentRequestId:uuid(body.paymentRequestId,"payment request"),
        requestAction,
        reference:cleanText(body.reference,{min:3,max:240,name:"referência financeira"}),
        receivedAmountCents,
        paymentMethod,
        reconciliationKey,
        paymentEventId
      };
    }else if(action==="merchant-billing-provider-cancel-retry"){
      payload={
        paymentRequestId:uuid(body.paymentRequestId,"payment request")
      };
    }else if(action==="create-billing-webhook-probe"){
      const provider=String(body.provider??"mercadopago").trim().toLowerCase();
      if(provider!=="mercadopago"){
        throw new DomainError(
          "WEBHOOK_PROBE_PROVIDER_UNSUPPORTED",
          "A prova automática de webhook está disponível apenas para Mercado Pago nesta versão.",
          400
        );
      }
      payload={provider};
    }else if(action==="merchant-billing-refund"){
      const refundAction=String(body.refundAction??"").trim().toLowerCase();
      if(!["mark-recovered","dismiss-unrelated","dismiss-excess"].includes(refundAction)){
        throw new DomainError("INVALID_PAYMENT_REFUND_ACTION","Ação de reembolso financeiro inválida.",400);
      }
      payload={
        refundId:uuid(body.refundId,"refund"),
        refundAction,
        reference:cleanText(body.reference,{min:3,max:240,name:"referência da resolução"})
      };
    }else if(action==="merchant-billing-payment-event"){
      const eventAction=String(body.eventAction??"").trim().toLowerCase();
      if(!["recheck","ignore"].includes(eventAction)){
        throw new DomainError("INVALID_PAYMENT_EVENT_ACTION","Ação de evento financeiro inválida.",400);
      }
      const reason=eventAction==="ignore"
        ?cleanText(body.reason,{min:3,max:240,name:"motivo para ignorar o evento"})
        :null;
      payload={
        paymentEventId:uuid(body.paymentEventId,"payment event"),
        eventAction,
        reason
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
    }else if(action==="incident-action"){
      const incidentAction=String(body.incidentAction??"").trim().toLowerCase();
      if(!["create","acknowledge","assign","set-status","resolve","reopen"].includes(incidentAction)){
        throw new DomainError("INVALID_INCIDENT_ACTION","Ação de incidente inválida.",400);
      }
      const incidentId=body.incidentId==null||String(body.incidentId).trim()===""?null:uuid(body.incidentId,"incident");
      const severity=body.severity==null?null:String(body.severity).trim().toLowerCase();
      if(severity!=null&&!["critical","high","medium","low"].includes(severity)){
        throw new DomainError("INVALID_INCIDENT_SEVERITY","Severidade de incidente inválida.",400);
      }
      const incidentStatus=body.incidentStatus==null?null:String(body.incidentStatus).trim().toLowerCase();
      if(incidentStatus!=null&&!["open","investigating","monitoring"].includes(incidentStatus)){
        throw new DomainError("INVALID_INCIDENT_STATUS","Status de incidente inválido.",400);
      }
      payload={
        incidentAction,
        incidentId,
        title:body.title==null?null:(cleanText(body.title,{min:3,max:160,name:"título do incidente"})||null),
        description:body.description==null?null:(cleanText(body.description,{min:0,max:4000,name:"descrição"})||null),
        severity,
        source:body.source==null?"admin":cleanText(body.source,{min:2,max:80,name:"origem"}),
        entityType:body.entityType==null?null:(cleanText(body.entityType,{min:0,max:80,name:"tipo de entidade"})||null),
        entityId:body.entityId==null?null:(cleanText(body.entityId,{min:0,max:160,name:"entidade"})||null),
        assignedAdminId:body.assignedAdminId==null||String(body.assignedAdminId).trim()===""?null:uuid(body.assignedAdminId,"assignedAdmin"),
        incidentStatus,
        resolutionNote:body.resolutionNote==null?null:(cleanText(body.resolutionNote,{min:0,max:4000,name:"resolução"})||null)
      };
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

    if(action==="merchant-billing-provider-cancel-retry"){
      const providerCancellation=await cancelProviderChargesForPaymentRequest(
        admin,String(payload.paymentRequestId)
      );
      return json({
        ok:providerCancellation.failed===0,
        paymentRequestId:payload.paymentRequestId,
        providerCancellation
      },200,origin);
    }

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
    }else if(action==="merchant-billing-action"){
      rpcName="admin_merchant_billing_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_merchant_id:payload.merchantId,
        p_action:payload.billingAction,
        p_plan_key:payload.planKey,
        p_statement_id:payload.statementId,
        p_reference:payload.reference,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="merchant-payment-capability"){
      rpcName="admin_merchant_provider_payment_capability_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_merchant_id:payload.merchantId,
        p_provider:payload.provider,
        p_enabled:payload.enabled,
        p_reference:payload.reference,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="create-billing-webhook-probe"){
      rpcName="admin_create_payment_webhook_probe";
      rpcArgs={
        p_actor_user_id:user.id,
        p_provider:payload.provider,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="merchant-billing-payment-request"){
      rpcName="admin_merchant_billing_payment_request_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_payment_request_id:payload.paymentRequestId,
        p_action:payload.requestAction,
        p_reference:payload.reference,
        p_received_amount_cents:payload.receivedAmountCents,
        p_payment_method:payload.paymentMethod,
        p_reconciliation_key:payload.reconciliationKey,
        p_payment_event_id:payload.paymentEventId,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="merchant-billing-payment-event"){
      rpcName="admin_merchant_billing_payment_event_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_event_id:payload.paymentEventId,
        p_action:payload.eventAction,
        p_reason:payload.reason,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="merchant-billing-refund"){
      rpcName="admin_merchant_billing_refund_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_refund_id:payload.refundId,
        p_action:payload.refundAction,
        p_reference:payload.reference,
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
    else if(action==="merchant-billing-plan"){
      rpcName="admin_merchant_billing_plan_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_plan_key:payload.planKey,
        p_expected_version:payload.expectedVersion,
        p_platform_fee_bps:payload.platformFeeBps,
        p_active:payload.active,
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
      if(payload.controlAction==="cancel-after-dispatch"){
        rpcName="admin_cancel_dispatched_order";
        rpcArgs={
          p_actor_user_id:user.id,
          p_order_id:payload.orderId,
          p_expected_version:payload.expectedVersion,
          p_reason:payload.reason,
          p_idempotency_key:idempotencyKey,
          p_request_hash:requestHash
        };
      }else{
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
    }
    else if(action==="pilot-invite"){
      rpcName="admin_pilot_partner_invite_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_draft_id:payload.draftId,
        p_action:payload.inviteAction,
        p_token_hash:payload.tokenHash,
        p_expires_at:payload.expiresAt,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="assisted-merchant-onboarding"){
      rpcName="admin_assisted_merchant_onboarding_v2";
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
      rpcName="admin_platform_admin_access_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_target_user_id:payload.targetUserId,
        p_active:payload.active,
        p_admin_role:payload.adminRole,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="incident-action"){
      rpcName="admin_incident_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_action:payload.incidentAction,
        p_incident_id:payload.incidentId,
        p_title:payload.title,
        p_description:payload.description,
        p_severity:payload.severity,
        p_source:payload.source,
        p_entity_type:payload.entityType,
        p_entity_id:payload.entityId,
        p_assigned_admin_id:payload.assignedAdminId,
        p_status:payload.incidentStatus,
        p_resolution_note:payload.resolutionNote,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(action==="enable-commerce"){
      rpcName="admin_operation_mode_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_mode:"PILOT",
        p_reason:payload.reason,
        p_source_sha:payload.sourceSha,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }
    else if(["verify-launch-portals","disable-commerce"].includes(action)){
      rpcName="admin_launch_control_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_action:action==="verify-launch-portals"?"record-portals":"disable-commerce",
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

    if(action==="merchant-billing-payment-request"
       &&payload.requestAction==="reject"
       &&payload.paymentRequestId){
      let providerCancellation={attempted:0,cancelled:0,failed:0,deferred:false};
      try{
        providerCancellation={
          ...(await cancelProviderChargesForPaymentRequest(
            admin,payload.paymentRequestId
          )),
          deferred:false
        };
      }catch(cancelError){
        console.error("provider cancellation handoff failed",String(cancelError));
        providerCancellation={attempted:0,cancelled:0,failed:1,deferred:true};
      }
      return json({...data,providerCancellation},200,origin);
    }

    if(action==="merchant-payment-capability"){
      return json({
        ...data,
        directPaymentsGlobalEnabled:
          String(Deno.env.get("MERCHANT_DIRECT_PAYMENTS_ENABLED")??"").trim()==="1"
      },200,origin);
    }

    return json(data,200,origin);


  }catch(error){
    if(error instanceof DomainError){
      return json({error:error.code,message:error.message},error.status,origin);
    }

    const message=error instanceof Error?error.message:String(error);
    if(message.includes("ADMIN_ACCESS_DENIED")){
      return json({error:"ADMIN_ACCESS_DENIED",message:"Esta conta não possui acesso administrativo."},403,origin);
    }
    if(message.includes("ADMIN_PERMISSION_DENIED")){
      return json({error:"ADMIN_PERMISSION_DENIED",message:"Seu perfil administrativo não possui permissão para esta ação."},403,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_ACCOUNT_NOT_CONNECTED")){
      return json({error:"MERCHANT_PAYMENT_ACCOUNT_NOT_CONNECTED",message:"A revenda precisa conectar a própria conta deste provedor antes da homologação."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_ACCOUNT_NOT_READY")){
      return json({error:"MERCHANT_PAYMENT_ACCOUNT_NOT_READY",message:"A conexão da revenda com este provedor ainda não está pronta para confirmação automática."},409,origin);
    }
    if(message.includes("INVALID_MERCHANT_PAYMENT_CAPABILITY")){
      return json({error:"INVALID_MERCHANT_PAYMENT_CAPABILITY",message:"Este provedor ainda não possui um adaptador de venda direta homologado no TAMÃO."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_REVIEW_REQUIRED")){
      return json({error:"MERCHANT_PAYMENT_REVIEW_REQUIRED",message:"Existe uma transação da revenda em revisão; resolva-a antes de reativar pagamentos diretos."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_CAPABILITY_REFERENCE_REQUIRED")){
      return json({error:"MERCHANT_PAYMENT_CAPABILITY_REFERENCE_REQUIRED",message:"Informe a referência da homologação ou desativação."},400,origin);
    }
    if(message.includes("LAST_SUPERADMIN_CANNOT_BE_REMOVED")){
      return json({error:"LAST_SUPERADMIN_CANNOT_BE_REMOVED",message:"O último Superadmin ativo não pode ser removido nem rebaixado."},409,origin);
    }
    if(message.includes("INVALID_ADMIN_ROLE")){
      return json({error:"INVALID_ADMIN_ROLE",message:"Perfil administrativo inválido."},400,origin);
    }
    if(message.includes("BILLING_PLAN_VERSION_CONFLICT")){
      return json({error:"BILLING_PLAN_VERSION_CONFLICT",message:"Este plano de cobrança mudou em outra sessão. Atualize o painel antes de salvar novamente."},409,origin);
    }
    if(message.includes("BILLING_PLAN_BELOW_ECONOMIC_FLOOR")){
      return json({error:"BILLING_PLAN_BELOW_ECONOMIC_FLOOR",message:"A taxa do plano não cobre o piso econômico atual de custos, contribuição e incentivos."},409,origin);
    }
    if(message.includes("FLEX_BILLING_PLAN_MUST_REMAIN_ACTIVE")){
      return json({error:"FLEX_BILLING_PLAN_MUST_REMAIN_ACTIVE",message:"O Flex Diário é o fallback financeiro obrigatório e não pode ser desativado."},409,origin);
    }
    if(message.includes("INCIDENT_NOT_FOUND")){
      return json({error:"INCIDENT_NOT_FOUND",message:"Incidente não encontrado."},404,origin);
    }
    if(message.includes("INVALID_INCIDENT_")||message.includes("INCIDENT_RESOLUTION_REQUIRED")||message.includes("INCIDENT_ASSIGNEE_NOT_ACTIVE_ADMIN")){
      return json({error:"INVALID_INCIDENT",message:"Revise os dados, responsável, status e resolução do incidente."},400,origin);
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
    if(message.includes("PAYMENT_REFUND_REVIEW_REQUIRED")){
      return json({error:"PAYMENT_REFUND_REVIEW_REQUIRED",message:"Existe um reembolso confirmado ligado a esta cobrança. Resolva a revisão antes de aprovar."},409,origin);
    }
    if(message.includes("PAYMENT_REFUND_ALREADY_RESOLVED")){
      return json({error:"PAYMENT_REFUND_ALREADY_RESOLVED",message:"Este reembolso já foi resolvido no Financeiro."},409,origin);
    }
    if(message.includes("PAYMENT_REFUND_NOT_LINKED")){
      return json({error:"PAYMENT_REFUND_NOT_LINKED",message:"Este reembolso não está ligado a uma cobrança TAMÃO; use a resolução de item não relacionado."},409,origin);
    }
    if(message.includes("PAYMENT_REFUND_LINKED_CANNOT_DISMISS")){
      return json({error:"PAYMENT_REFUND_LINKED_CANNOT_DISMISS",message:"Este reembolso pertence a uma cobrança TAMÃO e não pode ser descartado como não relacionado."},409,origin);
    }
    if(message.includes("PAYMENT_REFUND_NOT_FOUND")){
      return json({error:"PAYMENT_REFUND_NOT_FOUND",message:"Reembolso financeiro não encontrado."},404,origin);
    }
    if(message.includes("PAYMENT_EVENT_MATCHED_CANNOT_IGNORE")){
      return json({error:"PAYMENT_EVENT_MATCHED_CANNOT_IGNORE",message:"Este evento já corresponde exatamente a uma cobrança pendente. Resolva ou rejeite a cobrança antes de ignorar o evento."},409,origin);
    }
    if(message.includes("PAYMENT_EVENT_NOT_REVIEWABLE")){
      return json({error:"PAYMENT_EVENT_NOT_REVIEWABLE",message:"Este evento já foi encerrado ou não está mais em revisão."},409,origin);
    }
    if(message.includes("PAYMENT_EVENT_IGNORE_REASON_REQUIRED")){
      return json({error:"PAYMENT_EVENT_IGNORE_REASON_REQUIRED",message:"Informe por que este evento financeiro deve ser ignorado."},400,origin);
    }
    if(message.includes("PAYMENT_EVENT_MATCHED_REQUIRES_PROVIDER_APPROVAL")){
      return json({error:"PAYMENT_EVENT_MATCHED_REQUIRES_PROVIDER_APPROVAL",message:"Existe uma confirmação exata do PSP para esta cobrança. Use “Confirmar evento conciliado” para preservar a prova do provedor."},409,origin);
    }
    if(message.includes("PAYMENT_EVENT_NOT_MATCHED_TO_REQUEST")||message.includes("PAYMENT_EVENT_APPROVAL_MISMATCH")||message.includes("PROVIDER_PAYMENT_EVENT_APPROVAL_INCONSISTENT")){
      return json({error:"PAYMENT_EVENT_APPROVAL_MISMATCH",message:"O evento do provedor não corresponde mais exatamente a esta cobrança. Atualize a fila financeira antes de aprovar."},409,origin);
    }
    if(message.includes("PAYMENT_RECONCILIATION_KEY_ALREADY_USED")){
      return json({error:"PAYMENT_RECONCILIATION_KEY_ALREADY_USED",message:"Este identificador de pagamento já foi usado em outra cobrança. Confira a transação antes de aprovar."},409,origin);
    }
    if(message.includes("INVALID_RECONCILIATION_KEY")){
      return json({error:"INVALID_RECONCILIATION_KEY",message:"Informe um identificador único válido da transação ou recibo."},400,origin);
    }
    if(message.includes("FINANCIAL_POLICY_MISSING")){
      return json({error:"FINANCIAL_POLICY_MISSING",message:"A política financeira padrão não está disponível."},503,origin);
    }
    if(message.includes("ORDER_NOT_DISPATCHED_INCIDENT")){
      return json({error:"ORDER_NOT_DISPATCHED_INCIDENT",message:"Esta resolução é exclusiva para pedidos que já saíram e ainda não foram concluídos."},409,origin);
    }
    if(message.includes("ORDER_FINANCIAL_STATE_NOT_CANCELLABLE")){
      return json({error:"ORDER_FINANCIAL_STATE_NOT_CANCELLABLE",message:"O pedido já possui confirmação financeira ou entrega concluída e precisa ser tratado pelo fluxo de reversão."},409,origin);
    }
    if(message.includes("ORDER_ALREADY_DISPATCHED")){
      return json({error:"ORDER_ALREADY_DISPATCHED",message:"O pedido já saiu para entrega. Use a resolução de incidente pós-saída se a entrega falhou definitivamente."},409,origin);
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
    if(message.includes("PILOT_PARTNER_INVITE_NOT_ALLOWED")){
      return json({error:"PILOT_PARTNER_INVITE_NOT_ALLOWED",message:"Este parceiro piloto já foi convertido/cancelado e não pode receber novo convite."},409,origin);
    }
    if(message.includes("INVALID_PILOT_INVITE_EXPIRY")){
      return json({error:"INVALID_PILOT_INVITE_EXPIRY",message:"Validade do convite inválida."},400,origin);
    }
    if(message.includes("INVALID_PILOT_INVITE_ACTION")||message.includes("INVALID_PILOT_INVITE_TOKEN_HASH")){
      return json({error:"INVALID_PILOT_INVITE_ACTION",message:"Não foi possível validar a operação de convite piloto."},400,origin);
    }
    if(message.includes("OWNER_USER_NOT_FOUND")){
      return json({error:"OWNER_USER_NOT_FOUND",message:"A conta owner informada não existe ou ainda é anônima."},404,origin);
    }
    if(message.includes("PILOT_OWNER_MISMATCH")){
      return json({error:"PILOT_OWNER_MISMATCH",message:"O owner precisa ser a mesma conta permanente que reivindicou o convite deste parceiro."},409,origin);
    }
    if(message.includes("PILOT_OWNER_REQUIRED")){
      return json({error:"PILOT_OWNER_REQUIRED",message:"O parceiro precisa reivindicar o convite e concluir o cadastro antes da conversão."},409,origin);
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
    if(message.includes("INVALID_OPERATION_MODE_TRANSITION")){
      return json({error:"INVALID_OPERATION_MODE_TRANSITION",message:"A mudança de modo não é válida para o estado operacional atual. Atualize a Central de Produção."},409,origin);
    }
    if(message.includes("platform_launch_control_mode_source_consistency")){
      return json({error:"PORTAL_SOURCE_SHA_MISMATCH",message:"Os portais mudaram depois da última verificação. Verifique os três portais novamente antes de ativar PILOT/LIVE."},409,origin);
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
