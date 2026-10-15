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
import { mercadoPagoFetch,readMercadoPagoJson,safeMercadoPagoUrl,moneyToCents } from "../_shared/mercadopago.js";
import {refreshAnpProspects,cityKey as marketCityKey} from "../_shared/anp-prospects.js";
import {publicationSummary,publicationAlertInsight} from "./publication-health.js";

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
const ADMIN_READ_ACTIONS=new Set(["governance-gates","commercial-intake-read","ads-sales-plans","ads-offers-read","ads-dossiers-read","ads-instruments-read","ads-receivables-read","ads-psp-read","summary","search","entity-detail","system-health","billing-provider-health","audit-search","incident-list","merchant-payment-preflight","prospect-intelligence","expansion-notifications","expansion-radar","merchant-enablement","sale-payment-history","finance-receipts-history","commercial-history-list","operational-alerts","ads-demand","clube-interest-queue","clube-campaign-queue","clube-terms-queue","owner-funding-read","owner-funding-pulse","owner-evidence-queue","owner-budget-queue","owner-finance-history","owner-campaign-signals","owner-campaign-orders","owner-campaign-fee-receipts","owner-campaign-batch-ledger","owner-campaign-financial-summary","owner-campaign-benefit-costs","owner-wallet-reconciliation","owner-cashback-source-lots","owner-referral-lifecycle","owner-benefit-payout-read","owner-benefit-proofs-read","owner-benefit-proof-view","owner-benefit-proof-verify","owner-payout-provider-read","owner-recipient-proof-readiness","owner-multi-psp-hub","owner-campaign-orphan-audit","owner-orphan-cleanup-candidates","owner-campaign-cost-read","owner-campaign-receipts-read","owner-campaign-receipt-view","ads-audience-readiness","ads-preview-summary","ads-placement-readiness","ads-pilot-preflight","commercial-activation","ads-campaign-queue","growth-referral-review-queue"]);
const ADMIN_ROLE_ACTIONS:Record<string,Set<string>>={
  superadmin:new Set(["*"]),
  operations:new Set([
    "approve-application","reject-application","verify-merchant","activate-merchant","suspend-merchant",
    "set-delivery-capability","merchant-representation-review","order-control","support-case-status","lead-status","public-request-status",
    "pilot-invite","assisted-merchant-onboarding","product-registry","verify-launch-portals","incident-action","market-city-pause","city-notification-status","prospect-crm","prospect-invite","commercial-history-capture","operational-alert-ack","clube-campaign-review"
  ]),
  finance:new Set([
    "financial-action","review-referral","retry-reward","retry-accounting","reverse-order",
    "growth-benefit-preview","commercial-policy","clube-coupon-preview",
    "clube-campaign-review","clube-terms-save","owner-evidence-submit","owner-evidence-review","merchant-billing-plan","merchant-billing-action","merchant-billing-payment-request","merchant-billing-payment-event","merchant-billing-refund","merchant-billing-provider-cancel-retry","merchant-payment-capability","create-billing-webhook-probe","incident-action","operational-alert-ack"
  ]),
  support:new Set(["order-control","support-case-status","incident-action","operational-alert-ack"]),
  compliance:new Set(["clube-campaign-review",
    "growth-referral-review","ads-campaign-review","ads-preview-issue","ads-preview-confirm","approve-application","reject-application","verify-merchant","activate-merchant","suspend-merchant",
    "set-delivery-capability","merchant-representation-review","incident-action","prospect-crm","prospect-invite"
  ]),
  readonly:new Set()
};
function requireAdminAction(role:string,action:string){
  if(ADMIN_READ_ACTIONS.has(action))return;
  const allowed=ADMIN_ROLE_ACTIONS[role]??new Set<string>();
  if(allowed.has("*")||allowed.has(action))return;
  throw new DomainError("ADMIN_PERMISSION_DENIED","Seu perfil administrativo não possui permissão para esta ação.",403);
}

/* V1.184 — finance-only read pagination beyond the 500-attempt summary.
   A validated keyset avoids offset drift when new payments are created. */
/* V1.304: A governance dossier from the actual server state, not client-side
   assumptions. This is read-only. No key values or contact details are returned. */
async function adminGovernanceGates(admin:any,role:string){
  if(!["superadmin","operations","readonly"].includes(role)){
    throw new DomainError("ADMIN_PERMISSION_DENIED",
      "Perfil sem autorização para consultar liberações da plataforma.",403);
  }
  const [cities,merchants,applications]=await Promise.all([
    admin.from("market_cities").select(
      "state,city_name,city_key,commerce_enabled,admin_paused,activated_at,updated_at"
    ).order("updated_at",{ascending:false}).limit(201),
    admin.from("merchants").select("status").limit(501),
    admin.from("merchant_applications").select("status").limit(501)
  ]);
  if(cities.error||merchants.error||applications.error){
    throw new DomainError("GOVERNANCE_EVIDENCE_UNAVAILABLE",
      "Não foi possível confirmar o estado das liberações no banco.",503);
  }
  const cityRows=(cities.data||[]).slice(0,200);
  const merchantRows=(merchants.data||[]).slice(0,500);
  const applicationRows=(applications.data||[]).slice(0,500);
  const tally=(rows:any[])=>rows.reduce((out:Record<string,number>,row:any)=>{
    const status=String(row?.status||"unknown");
    out[status]=(out[status]||0)+1;
    return out;
  },{} as Record<string,number>);
  return {
    source:"admin_governance_gates_v1_304",
    readOnly:true,
    checkedAt:new Date().toISOString(),
    cities:cityRows.map((c:any)=>({
      city:String(c.city_name||""),
      state:String(c.state||""),
      cityKey:String(c.city_key||""),
      commerceEnabled:c.commerce_enabled===true,
      adminPaused:c.admin_paused===true,
      activatedAt:c.activated_at||null,
      updatedAt:c.updated_at||null
    })),
    counts:{
      citiesChecked:cityRows.length,merchantsByStatus:tally(merchantRows),
      applicationsByStatus:tally(applicationRows)
    },
    truncated:{
      cities:(cities.data||[]).length>200,
      merchants:(merchants.data||[]).length>500,
      applications:(applications.data||[]).length>500
    },
    runtime:{merchantDirectPaymentsEnabled:
      String(Deno.env.get("MERCHANT_DIRECT_PAYMENTS_ENABLED")??"").trim()==="1"},
    controls:{
      cityPause:["superadmin","operations"].includes(role),
      cityCommerce:role==="superadmin",
      merchantAuthorization:["superadmin","operations"].includes(role),
      commerceMode:role==="superadmin",
      financialPolicies:role==="superadmin"
    },
    noAutomaticActivation:true
  };
}

async function financeSalePaymentHistory(admin:any,body:any){
  const cursor=body?.cursor;
  const createdAt=String(cursor?.createdAt||"");
  const cursorId=String(cursor?.id||"");
  if(!/^20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(createdAt)
    ||!Number.isFinite(Date.parse(createdAt))
    ||Date.parse(createdAt)>Date.now()+5*60*1000
    ||!UUID_RE.test(cursorId)){
    throw new DomainError("INVALID_FINANCE_CURSOR","Atualize os dados financeiros antes de consultar o histórico.",400);
  }
  const pageSize=200;
  const {data:attempts,error}=await admin.from("merchant_sale_payment_attempts")
    .select("id,order_id,merchant_id,provider,amount_cents,status,approved_at,refunded_at,last_error_at,created_at,updated_at")
    .or("created_at.lt."+createdAt+",and(created_at.eq."+createdAt+",id.lt."+cursorId+")")
    .order("created_at",{ascending:false})
    .order("id",{ascending:false})
    .limit(pageSize);
  if(error)throw error;
  const found=attempts||[];
  const ids=[...new Set(found.map((r:any)=>String(r.order_id||"")).filter((id:string)=>UUID_RE.test(id)))];
  const orders=ids.length?await admin.from("orders")
    .select("id,public_code,status,financial_state,financial_reversed_at,updated_at")
    .in("id",ids).in("status",["CANCELLED","REASSIGNING"]).limit(pageSize)
    :{data:[],error:null};
  if(orders.error)throw orders.error;
  const last=found[found.length-1];
  const eligible=new Set((orders.data||[]).map((o:any)=>String(o.id)));
  return {
    attempts:found.filter((a:any)=>eligible.has(String(a.order_id||""))),
    interruptedOrders:orders.data||[],
    nextCursor:last&&found.length===pageSize
      ?{createdAt:last.created_at,id:last.id}:null,
    hasMore:found.length===pageSize,
    batchSize:found.length,
    readOnly:true,
    source:"historic_sale_attempts_keyset"
  };
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
function merchantPaymentRuntimeReadiness(provider:string){
  const key=String(provider||"").trim().toLowerCase();
  const globalDirectPaymentsEnabled=
    String(Deno.env.get("MERCHANT_DIRECT_PAYMENTS_ENABLED")??"").trim()==="1";
  if(key!=="mercadopago"){
    return {
      ok:false,
      provider:key,
      globalDirectPaymentsEnabled,
      gates:[{
        key:"runtime-adapter",
        ok:false,
        label:"Adaptador runtime publicado",
        detail:"Checkout automático ainda não publicado para este PSP."
      }]
    };
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
  const gates=[
    {key:"runtime-client-id",ok:oauthClientId.length>=5,label:"OAuth Client ID",detail:oauthClientId.length>=5?"configurado":"ausente"},
    {key:"runtime-client-secret",ok:oauthClientSecret.length>=10,label:"OAuth Client Secret",detail:oauthClientSecret.length>=10?"configurado":"ausente"},
    {key:"runtime-oauth-redirect",ok:redirectValid,label:"OAuth redirect HTTPS",detail:redirectValid?"válido":"inválido ou ausente"},
    {key:"runtime-webhook-secret",ok:webhookSecret.length>=16,label:"Webhook HMAC",detail:webhookSecret.length>=16?"configurado":"ausente"},
    {key:"runtime-encryption",ok:paymentEncryptionConfigured(encryptionKey),label:"Criptografia de credenciais",detail:paymentEncryptionConfigured(encryptionKey)?"configurada":"ausente"},
    {key:"global-kill-switch",ok:globalDirectPaymentsEnabled,label:"Controle global de pagamentos",detail:globalDirectPaymentsEnabled?"tráfego automático permitido":"tráfego automático bloqueado"}
  ];
  return {
    ok:gates.every(g=>g.ok),
    provider:key,
    globalDirectPaymentsEnabled,
    gates
  };
}
async function merchantPaymentPreflight(admin:any,actorUserId:string,merchantId:string,provider:string){
  const {data,error}=await admin.rpc("admin_merchant_provider_payment_preflight",{
    p_actor_user_id:actorUserId,
    p_merchant_id:merchantId,
    p_provider:provider
  });
  if(error)throw error;
  const runtime=merchantPaymentRuntimeReadiness(provider);
  const dbGates=Array.isArray(data?.gates)?data.gates:[];
  const gates=[...dbGates,...runtime.gates];
  return {
    ...data,
    runtimeReady:runtime.ok,
    globalDirectPaymentsEnabled:runtime.globalDirectPaymentsEnabled,
    readyForActivation:data?.readyForCapabilityActivation===true&&runtime.ok,
    readyForTraffic:data?.readyForCapabilityActivation===true&&runtime.ok,
    gates,
    blockingGates:gates.filter((g:any)=>g?.ok!==true).map((g:any)=>String(g?.key||"unknown"))
  };
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
    const remoteWebhookProof=await latestVerifiedWebhookProbe(admin,"mercadopago");
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
      remoteWebhookRegistrationVerified:Boolean(remoteWebhookProof),
      remoteWebhookVerifiedAt:remoteWebhookProof?.verified_at??null,
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
        providerCatalog:[],routes:[],verifications:[],attempts:[],interruptedOrders:[],reviewSampleLimited:false
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
      prelaunchLeads:[],acquisitionMetrics:{},growthNetwork:{available:false,valid:false},growthApplicationFunnel:{available:false,valid:false},publicRequests:[],
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
      merchantPayments:{globalDirectPaymentsEnabled:false,fundsOwner:"merchant",tamaoReceivesSaleProceeds:false,providerCatalog:[],routes:[],verifications:[],attempts:[],interruptedOrders:[],reviewSampleLimited:false},
      commercialPolicy:null,
      merchantBilling:{plans:[],accounts:[],statements:[],paymentRequests:[],paymentEvents:[],refunds:[],refundRecoveries:[],providerCharges:[],webhookProbes:[],paymentAccounts:[],paymentIngress:null,metrics:null,reconciliation:null},
      productRegistry:{categories:[],products:[]},
      finance:{receivables:[],cashbackReimbursements:[],adjustments:[]},
      rewardFailures:[],accountingFailures:[],referralReviews:[],
      platformAdmins:adminSelf,
      prelaunchLeads:[],acquisitionMetrics:{},growthNetwork:{available:false,valid:false},growthApplicationFunnel:{available:false,valid:false},
      recentAudit:[]
    };
  }
  if(role==="compliance"){
    return {
      ...data,
      merchants:(data.merchants??[]).map((m:any)=>({...m,paymentAccount:null,paymentAccounts:[],paymentRoutes:[]})),
      merchantPayments:{globalDirectPaymentsEnabled:false,fundsOwner:"merchant",tamaoReceivesSaleProceeds:false,providerCatalog:[],routes:[],verifications:[],attempts:[],interruptedOrders:[],reviewSampleLimited:false},
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
/* V1.208 — all groups are checked from the service-role database per request.
   No incident text, identifiers or customer data leave this diagnostic endpoint. */
async function adminOperationalAlerts(admin:any,role:string,actorId:string){
  const checkedAt=new Date().toISOString();
  const fetchCount=async(makeQuery:()=>any)=>{
    try{
      const result=await makeQuery();
      if(result.error||!Number.isSafeInteger(result.count)||result.count<0)
        return {valid:false,count:null};
      return {valid:true,count:result.count};
    }catch{return {valid:false,count:null};}
  };
  const [all,critical,high]=await Promise.all([
    fetchCount(()=>admin.from("platform_incidents").select("id",{count:"exact",head:true}).neq("status","resolved")),
    fetchCount(()=>admin.from("platform_incidents").select("id",{count:"exact",head:true}).neq("status","resolved").eq("severity","critical")),
    fetchCount(()=>admin.from("platform_incidents").select("id",{count:"exact",head:true}).neq("status","resolved").eq("severity","high"))
  ]);
  const incidents=all.valid&&critical.valid&&high.valid&&
    all.count>=critical.count+high.count
      ?{valid:true,open:all.count,critical:critical.count,high:high.count}
      :{valid:false,open:null,critical:null,high:null};
  const operationalRole=["superadmin","operations","support"].includes(role);
  const financeRole=["superadmin","finance"].includes(role);
  const captureRole=["superadmin","operations","compliance","readonly"].includes(role);
  const portalRole=["superadmin","operations","readonly"].includes(role);
  let support={available:operationalRole,valid:false,open:null};
  let finance={available:financeRole,valid:false,rewardFailures:null,accountingFailures:null};
  let capture={available:captureRole,valid:false,health:null};
  let portals={available:portalRole,valid:false,verified:false};
  let publication:any={available:portalRole,valid:false};
  const tasks=[];
  if(operationalRole)tasks.push((async()=>{
    const r=await fetchCount(()=>admin.from("support_cases").select("id",{count:"exact",head:true}).in("status",["open","in_review"]));
    support={available:true,valid:r.valid,open:r.count};
  })());
  if(financeRole)tasks.push((async()=>{
    const [rewards,accounting]=await Promise.all([
      fetchCount(()=>admin.from("reward_processing_failures").select("order_id",{count:"exact",head:true}).is("resolved_at",null)),
      fetchCount(()=>admin.from("settlement_accounting_failures").select("order_id",{count:"exact",head:true}).is("resolved_at",null))
    ]);
    finance={available:true,valid:rewards.valid&&accounting.valid,
      rewardFailures:rewards.valid?rewards.count:null,
      accountingFailures:accounting.valid?accounting.count:null};
  })());
  if(captureRole)tasks.push((async()=>{
    try{
      const {data,error}=await admin.rpc("admin_list_city_commercial_history_v1_205",{
        p_actor_user_id:actorId
      });
      if(!error&&data?.source==="database_authoritative"&&data?.health&&
        typeof data.health.status==="string"){
        capture={available:true,valid:true,health:data.health};
      }
    }catch{}
  })());
  if(portalRole)tasks.push((async()=>{
    try{
      // Share the same live portal probe with the legacy gate. No second
      // counter/alert is created if detailed publication evidence is present.
      const [verification,github,readiness,lastAttestation]=await Promise.all([
        verifyLivePortals(),
        publicationGithubEvidence(),
        admin.rpc("platform_launch_readiness"),
        admin.from("platform_portal_attestations")
          .select("source_sha,attestation_source,run_id,run_attempt,verified_at")
          .order("verified_at",{ascending:false}).limit(1).maybeSingle()
      ]);
      if(typeof verification?.ok==="boolean")
        portals={available:true,valid:true,verified:verification.ok===true};
      const current=publicationSummary({
        headSha:github.headSha,runs:github.runs,portals:verification,
        readiness:readiness.error?null:readiness.data,
        attestation:lastAttestation.error?null:lastAttestation.data,
        githubError:github.error,checkedAt
      });
      const history=publicationAlertInsight(current,github.runs,checkedAt);
      // System health remains the detailed drill-down. The alert only exposes
      // an allowlisted summary, not the underlying private attestation row.
      publication={available:true,valid:true,status:current.status,
        checkedAt,sourceSha:current.headSha,
        recurrence:history,
        guidance:current.guidance.slice(0,8).map((g:any)=>({
          code:g.code,level:g.level,problem:g.problem,impact:g.impact,
          action:g.action,recoveryCriteria:g.recoveryCriteria
        })),
        recovery:{verified:current.recovery.verified===true,
          historicalRestorationProven:false}};
    }catch{
      // An unavailable source must never silently clear a current warning.
      publication={available:true,valid:false};
    }
  })());
  await Promise.all(tasks);
  // V1.223: separate hourly historical evidence. Never infer an outage from a
  // missed OIDC proof or a healthy browser probe from an old SQL episode.
  let publicationHistory:any={available:false,valid:false};
  if(portalRole){
    try{
      const {data,error}=await admin.rpc("admin_portal_attestation_history_v1_223",{
        p_actor_user_id:actorId
      });
      const allowed=['current','stale','awaiting_first','job_missing',
        'job_disabled','job_changed','unverified'];
      if(!error&&data?.source==='postgres_authoritative_v1_223'&&
        data?.readOnly===true&&data?.noOutageClaim===true&&
        data?.noPersonalData===true&&
        Array.isArray(data?.episodes)&&data.episodes.length<=12&&
        allowed.includes(data?.monitor?.status)){
        publicationHistory={available:true,valid:true,monitor:data.monitor,
          state:data.state,episodes:data.episodes,
          recurrenceScope:data.recurrenceScope,noOutageClaim:true};
      }else{
        publicationHistory={available:true,valid:false};
      }
    }catch{
      publicationHistory={available:true,valid:false};
    }
  }
  // V1.224: independent cron proof + conservative trends; unavailable SQL
  // must never be interpreted as zero failures or healthy scheduling.
  let publicationTrends:any={available:false,valid:false};
  if(portalRole){
    try{
      const {data,error}=await admin.rpc("admin_portal_attestation_trends_v1_224",{
        p_actor_user_id:actorId
      });
      const monitorStates=['current','stale','awaiting_first','job_missing',
        'job_disabled','job_changed','unverified','run_failed'];
      const trendStates=['monitor_unverified','insufficient_evidence',
        'persistent_attestation_issue','recurrent_attestation_issue',
        'attestation_attention','no_recent_attestation_issue_observed'];
      const validCount=(n:any)=>Number.isSafeInteger(n)&&n>=0;
      if(!error&&data?.source==='postgres_authoritative_trends_v1_224'&&
        data?.readOnly===true&&data?.noOutageClaim===true&&
        data?.noPersonalData===true&&
        monitorStates.includes(data?.monitor?.status)&&
        trendStates.includes(data?.trend?.status)&&
        data?.trend?.scope==='OIDC_evidence_only_not_portal_uptime'&&
        data?.trend?.coveragePercentage===null&&
        validCount(data?.last24h?.scheduledSuccesses)&&
        validCount(data?.last24h?.scheduledFailures)&&
        validCount(data?.last24h?.observedSlots)&&
        validCount(data?.last24h?.clearObservations)&&
        validCount(data?.last24h?.activeObservations)&&
        validCount(data?.last24h?.unknownObservations)&&
        validCount(data?.last30d?.episodes)&&
        validCount(data?.last30d?.resolved)&&
        validCount(data?.last30d?.open)&&
        validCount(data?.last30d?.persistentOpen)){
        publicationTrends={available:true,valid:true,
          monitor:data.monitor,trend:data.trend,
          last24h:data.last24h,last30d:data.last30d,asOf:data.asOf,
          noOutageClaim:true};
      }else publicationTrends={available:true,valid:false};
    }catch{publicationTrends={available:true,valid:false};}
  }
  // V1.225: evaluate pg_cron's expected :53 UTC slot with a five-minute grace.
  // Returned guidance is strictly read-only and restricted to portal admin roles.
  let publicationMonitor:any={available:false,valid:false};
  if(portalRole){
    try{
      const {data,error}=await admin.rpc("admin_portal_attestation_monitor_v1_225",{
        p_actor_user_id:actorId
      });
      const statuses=['healthy','job_missing','job_disabled','job_changed',
        'awaiting_first','missed_run','interrupted','run_failed','run_stalled',
        'run_processing','missing_observation','evidence_unverified','unverified'];
      const severities=['none','info','warning','high'];
      const validTime=(value:any)=>value===null||typeof value==='string'&&
        Number.isFinite(Date.parse(value));
      if(!error&&data?.source==='postgres_cron_monitor_v1_225'&&
        data?.readOnly===true&&data?.noPersonalData===true&&
        data?.noOutageClaim===true&&data?.automaticRemediation===false&&
        data?.scope==='postgres_oidc_monitor_not_portal_uptime'&&
        statuses.includes(data?.status)&&severities.includes(data?.severity)&&
        Number.isSafeInteger(data?.missingSlots)&&data.missingSlots>=0&&
        data.missingSlots<=168&&
        ['cause','impact','action','recoveryCriteria'].every(key=>
          typeof data[key]==='string'&&data[key].length>=20&&
          data[key].length<=550)&&
        validTime(data?.checkedAt)&&data?.checkedAt!==null&&
        validTime(data?.expectedSlotAt)&&data?.expectedSlotAt!==null&&
        validTime(data?.graceUntil)&&data?.graceUntil!==null&&
        validTime(data?.nextDueAt)&&data?.nextDueAt!==null&&
        validTime(data?.lastRunAt)&&validTime(data?.lastSuccessAt)){
        publicationMonitor={available:true,valid:true,
          status:data.status,severity:data.severity,checkedAt:data.checkedAt,
          expectedSlotAt:data.expectedSlotAt,graceUntil:data.graceUntil,
          nextDueAt:data.nextDueAt,lastRunAt:data.lastRunAt,
          lastRunStatus:data.lastRunStatus,lastSuccessAt:data.lastSuccessAt,
          missingSlots:data.missingSlots,cause:data.cause,
          impact:data.impact,action:data.action,
          recoveryCriteria:data.recoveryCriteria,noOutageClaim:true};
      }else publicationMonitor={available:true,valid:false};
    }catch{publicationMonitor={available:true,valid:false};}
  }
  // V1.211: durable human follow-ups are returned only after PostgreSQL role scoping.
  // An unavailable RPC is explicitly marked unverified, never an empty task list.
  let followups={available:false,checkedAt:null,items:[],owners:[],events:[]};
  try{
    const {data,error}=await admin.rpc("admin_list_alert_followups_v1_211",{
      p_actor_id:actorId
    });
    if(!error&&data?.source==="database_authoritative"&&data?.readOnly===true&&
      Array.isArray(data?.followups)&&Array.isArray(data?.owners)&&
      Array.isArray(data?.events)&&typeof data?.checkedAt==="string"){
      followups={available:true,checkedAt:data.checkedAt,
        items:data.followups,owners:data.owners,events:data.events};
    }
  }catch{}
  // V1.209: hourly database provenance; unknown on any RPC error (never fake a cleared alert).
  let lifecycle={available:false,monitor:null,states:[],events:[]};
  try{
    const {data,error}=await admin.rpc("admin_operational_alert_lifecycle_v1_209",{
      p_actor_user_id:actorId
    });
    if(!error&&data?.source==="database_authoritative"&&data?.readOnly===true&&
      Array.isArray(data?.states)&&Array.isArray(data?.events)&&data?.monitor){
      lifecycle={available:true,monitor:data.monitor,
        states:data.states,events:data.events};
    }
  }catch{}
  return {source:"operational_alerts_v1_208",checkedAt,
    groups:{incidents,support,finance,capture,portals,publication,publicationHistory,publicationTrends,publicationMonitor},lifecycle,followups,readOnly:true,
    noExternalNotifications:true};
}

async function adminIncidentList(admin:any){
  const result=await admin.from("platform_incidents")
    .select("id,title,description,severity,status,source,entity_type,entity_id,assigned_admin_id,created_by,acknowledged_at,acknowledged_by,resolved_at,resolved_by,resolution_note,created_at,updated_at")
    .order("updated_at",{ascending:false})
    .limit(200);
  if(result.error)throw result.error;
  return {incidents:result.data??[]};
}

// GitHub is a public, read-only source of deployment evidence. No token is
// needed; a rate limit or outage is reported as unknown, never as healthy.
async function publicationGithubEvidence(){
  const read=async(path:string)=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    try{
      const response=await fetch("https://api.github.com/repos/carloskk07/gassg"+path,{
        headers:{"Accept":"application/vnd.github+json","User-Agent":"TAMAO-Admin-Health/1.0"},
        signal:controller.signal
      });
      if(!response.ok)throw new Error("GITHUB_HTTP_"+response.status);
      return await response.json();
    }finally{clearTimeout(timer);}
  };
  try{
    const [main,runs]=await Promise.all([
      read("/git/ref/heads/main"),
      read("/actions/runs?branch=main&per_page=60")
    ]);
    const headSha=String(main?.object?.sha||"").toLowerCase();
    if(main?.ref!=="refs/heads/main"||main?.object?.type!=="commit"||
      !/^[a-f0-9]{40}$/.test(headSha)||!Array.isArray(runs?.workflow_runs))
      throw new Error("GITHUB_EVIDENCE_INVALID");
    return {headSha,runs:runs.workflow_runs.slice(0,60),error:null};
  }catch{
    return {headSha:null,runs:[],error:"GITHUB_EVIDENCE_UNAVAILABLE"};
  }
}

async function adminSystemHealth(admin:any){
  const started=Date.now();
  const now=new Date();
  const heartbeatCutoff=now.getTime()-15*60*1000;
  const priceCutoff=now.getTime()-24*60*60*1000;
  const [portals,readiness,paymentProvider,openSupport,rewardDebt,accountingDebt,overdueReceivables,overdueCashback,activeMerchants,githubPublication,latestPortalAttestation]=await Promise.all([
    verifyLivePortals(),
    admin.rpc("platform_launch_readiness"),
    billingProviderHealth(admin),
    admin.from("support_cases").select("id",{count:"exact",head:true}).in("status",["open","in_review"]),
    admin.from("reward_processing_failures").select("order_id",{count:"exact",head:true}).is("resolved_at",null),
    admin.from("settlement_accounting_failures").select("order_id",{count:"exact",head:true}).is("resolved_at",null),
    admin.from("platform_receivables").select("order_id",{count:"exact",head:true}).eq("status","open").lt("due_at",now.toISOString()),
    admin.from("merchant_cashback_reimbursements").select("order_id",{count:"exact",head:true}).eq("status","open").lt("due_at",now.toISOString()),
    admin.from("merchants").select("id,last_seen_at,price_confirmed_at").eq("status","active").limit(1000),
    publicationGithubEvidence(),
    admin.from("platform_portal_attestations")
      .select("source_sha,attestation_source,run_id,run_attempt,verified_at")
      .order("verified_at",{ascending:false}).limit(1).maybeSingle()
  ]);
  for(const result of [readiness,openSupport,rewardDebt,accountingDebt,overdueReceivables,overdueCashback,activeMerchants]){
    if(result.error)throw result.error;
  }
  const publication=publicationSummary({
    headSha:githubPublication.headSha,runs:githubPublication.runs,
    githubError:githubPublication.error,portals,readiness:readiness.data,
    attestation:latestPortalAttestation.error?null:latestPortalAttestation.data,
    checkedAt:now.toISOString()
  });
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
    publication,
    paymentProvider,
    queues,
    readiness:readiness.data??{}
  };
}


async function prospectIntelligence(admin:any,cityInput:unknown,stateInput:unknown,force=false){
  const city=cleanText(cityInput,{min:2,max:120,name:"município"});
  const state=String(stateInput||"").trim().toUpperCase();
  const validUF=new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);
  const cityKey=marketCityKey(city);
  if(!validUF.has(state)||!(/^[A-Z0-9 ]{2,120}$/.test(cityKey))){
    throw new DomainError("INVALID_PROSPECT_CITY","Informe cidade e UF válidas.",400);
  }
  const sync=await refreshAnpProspects(admin,city,state,{force});
  const warning=sync.status==="unavailable"?"Não foi possível atualizar a ANP. Último resultado conhecido preservado.":null;
  const updated=sync.updated===true;
  const [{data:prospects,error:prospectError},{data:refresh,error:refreshError},{count:interestCount,error:interestError}]=await Promise.all([
    admin.from("anp_glp_prospects")
      .select("cnpj,legal_name,address_text,distributor,anp_authorization,sigaf_status,prospect_status,notes,follow_up_at,last_contacted_at,contact_attempts,crm_version,source_checked_at")
      .eq("state",state).eq("city_key",cityKey).order("legal_name",{ascending:true}).limit(200),
    admin.from("anp_prospect_refreshes").select("last_checked_at,last_count,status").eq("state",state).eq("city_key",cityKey).maybeSingle(),
    admin.from("market_city_interests").select("lead_id",{count:"exact",head:true}).eq("state",state).ilike("city",city)
  ]);
  if(prospectError||refreshError||interestError)throw prospectError||refreshError||interestError;
  const prospectCnpjs=(prospects||[]).map((p:any)=>String(p.cnpj)).filter((x:string)=>/^[0-9]{14}$/.test(x));
  const [invites,applications]=prospectCnpjs.length?await Promise.all([
    admin.from("anp_prospect_invites")
      .select("id,cnpj,expires_at,claimed_at,application_id,revoked_at,created_at")
      .in("cnpj",prospectCnpjs).order("created_at",{ascending:false}).limit(500),
    admin.from("merchant_applications")
      .select("id,cnpj,status,created_at")
      .in("cnpj",prospectCnpjs).order("created_at",{ascending:false}).limit(500)
  ]):[{data:[],error:null},{data:[],error:null}];
  if(invites.error||applications.error)throw invites.error||applications.error;
  const latestInvites=new Map<string,any>();
  for(const item of invites.data||[])if(!latestInvites.has(item.cnpj))latestInvites.set(item.cnpj,item);
  const latestApps=new Map<string,any>();
  for(const item of applications.data||[])if(!latestApps.has(item.cnpj))latestApps.set(item.cnpj,item);
  // A merchant must match BOTH the prospect CNPJ and the registered municipality.
  // Company registration in another city must not be reported as local supply.
  const {data:merchantRows,error:merchantLookupError}=prospectCnpjs.length
    ?await admin.from("merchants")
      .select("id,cnpj,status,online")
      .in("cnpj",prospectCnpjs).limit(300)
    :{data:[],error:null};
  if(merchantLookupError)throw merchantLookupError;
  const merchantIds=(merchantRows||[]).map((m:any)=>m.id);
  const {data:merchantCities,error:merchantCityError}=merchantIds.length
    ?await admin.from("merchant_business_details").select("merchant_id,city,state")
      .in("merchant_id",merchantIds).limit(300)
    :{data:[],error:null};
  if(merchantCityError)throw merchantCityError;
  const cityByMerchant=new Map<string,any>();
  for(const cityRow of merchantCities||[])cityByMerchant.set(String(cityRow.merchant_id),cityRow);
  const localMerchantByCnpj=new Map<string,any>();
  for(const m of merchantRows||[]){
    const companyCnpj=String(m.cnpj||"").replace(/\D/g,"");
    const location=cityByMerchant.get(String(m.id));
    if(!location||String(location.state||"").toUpperCase()!==state
      ||marketCityKey(location.city)!==cityKey)continue;
    const existing=localMerchantByCnpj.get(companyCnpj);
    if(!existing||String(existing.status)!=="active")localMerchantByCnpj.set(companyCnpj,m);
  }
  const enrichedProspects=(prospects||[]).map((p:any)=>{
    const invite=latestInvites.get(p.cnpj)||null;
    const app=latestApps.get(p.cnpj)||null;
    let inviteStatus="none";
    if(invite?.claimed_at)inviteStatus="claimed";
    else if(invite?.revoked_at)inviteStatus="revoked";
    else if(invite?.expires_at&&Date.parse(invite.expires_at)<=Date.now())inviteStatus="expired";
    else if(invite)inviteStatus="active";
    const merchant=localMerchantByCnpj.get(String(p.cnpj))||null;
    return {...p,merchant:merchant?{id:merchant.id,status:merchant.status,online:merchant.online}:null,invitation:invite?{
      status:inviteStatus,expiresAt:invite.expires_at,claimedAt:invite.claimed_at,createdAt:invite.created_at
    }:{status:"none"},application:app?{id:app.id,status:app.status}:null};
  });
  const [{data:merchantScope,error:scopeError},{data:citySetting,error:citySettingError}]=await Promise.all([
    admin.rpc("market_city_offer_scope",{p_city:city,p_state:state}),
    admin.from("market_cities").select("admin_paused").eq("state",state).eq("city_key",cityKey).maybeSingle()
  ]);
  if(scopeError||citySettingError)throw scopeError||citySettingError;
  const eligibleIds=new Set(Array.isArray(merchantScope)?merchantScope.map((id:any)=>String(id)):[]);
  const commercialProspects=enrichedProspects.map((p:any)=>{
    const app=String(p.application?.status||"");
    const inv=String(p.invitation?.status||"none");
    const merchant=String(p.merchant?.status||"");
    const ready=Boolean(p.merchant?.id&&eligibleIds.has(String(p.merchant.id)));
    const dormantInvite=inv==="active"
      &&Date.now()-Date.parse(String(p.invitation?.createdAt||""))>3*24*60*60*1000;
    let nextStep=ready?"Revenda disponível para receber cotações":
      merchant==="active"?"Revisar requisitos operacionais de venda e cobertura":
      merchant?"Concluir habilitação operacional da revenda":
      app==="approved"?"Vincular empresa aprovada a uma revenda operacional":
      app==="pending"?"Analisar cadastro enviado pela empresa":
      app==="rejected"?"Solicitar correção do cadastro ao responsável":
      inv==="claimed"?"Conferir vínculo do convite com o cadastro":
      inv==="active"?(dormantInvite?"Acompanhar convite enviado sem cadastro concluído":"Aguardar cadastro do responsável"):
      "Qualificar empresa e gerar convite";
    return {...p,onboarding:{
      step:ready?"ready":merchant?"merchant":app?"application":inv==="active"?"invited":"prospect",
      hasContact:Boolean(p.last_contacted_at),inviteState:inv,applicationState:app||null,
      merchantState:merchant||null,ready,reminderRecommended:dormantInvite,
      nextStep
    }};
  });
  return {city,state,cityKey,interestCount:interestCount||0,prospects:commercialProspects,
    eligibleMerchantCount:Array.isArray(merchantScope)?merchantScope.length:0,
    cityPaused:citySetting?.admin_paused===true,
    availableCount:Number(refresh?.last_count||0),updated,checkedAt:refresh?.last_checked_at||null,
    sourceStatus:refresh?.status||"unavailable",warning,source:"ANP API Revendedores GLP",
    commerceAutomaticallyActivated:false};
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
      .select("id,lead_type,contact_name,business_name,phone,postal_code,city,state,city_ibge_code,interests,note,admin_note,status,submission_count,source,medium,campaign,content,term,referrer,landing_path,contacted_at,qualified_at,converted_at,closed_at,created_at,updated_at")
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
  const {data:marketCityInterests,error:marketCityInterestError}=await admin
    .from("market_city_interests").select("city,state,last_seen_at")
    .not("city","is",null).order("last_seen_at",{ascending:false}).limit(1000);
  if(marketCityInterestError)throw marketCityInterestError;
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
  const [ownerMembers,representationReviews]=await Promise.all([
    admin.from("merchant_members")
      .select("merchant_id,user_id,member_role,active")
      .eq("member_role","owner").eq("active",true)
      .in("merchant_id",(merchants.data??[]).map((m:any)=>m.id))
      .limit(400),
    admin.from("merchant_representation_reviews")
      .select("merchant_id,owner_user_id,authority_kind,merchant_cnpj,verified_at,expires_at,revoked_at")
      .in("merchant_id",(merchants.data??[]).map((m:any)=>m.id))
      .limit(150)
  ]);
  if(ownerMembers.error||representationReviews.error)throw ownerMembers.error||representationReviews.error;

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
  const merchantSaleAttemptsPromise=["superadmin","finance","readonly"].includes(actorRole)
    ? admin.from("merchant_sale_payment_attempts")
        .select("id,order_id,merchant_id,provider,checkout_mode,amount_cents,currency,status,payment_route_id,payment_method_snapshot,verification_level,funds_owner,provider_order_id,provider_payment_id,provider_status,expires_at,approved_at,rejected_at,cancelled_at,refunded_at,last_error_code,last_error_at,pilot_guard,created_at,updated_at")
        .order("created_at",{ascending:false})
        .order("id",{ascending:false})
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
  const [billingPlans,billingAccounts,dailyStatements,billingPaymentRequests,billingMetrics,billingReconciliation,billingPaymentEvents,billingProviderCharges,billingWebhookProbes,merchantPaymentAccounts,merchantPaymentProviders,merchantPaymentRoutes,merchantSaleVerifications,merchantSaleAttempts,billingRefunds,billingRefundRecoveries]=await Promise.all([
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
    merchantSaleAttemptsPromise,
    billingRefundsPromise,
    billingRefundRecoveriesPromise
  ]);
  for(const result of [billingPlans,billingAccounts,dailyStatements,billingPaymentRequests,billingMetrics,billingReconciliation,billingPaymentEvents,billingProviderCharges,billingWebhookProbes,merchantPaymentAccounts,merchantPaymentProviders,merchantPaymentRoutes,merchantSaleVerifications,merchantSaleAttempts,billingRefunds,billingRefundRecoveries]){
    if(result.error)throw result.error;
  }

  // V1.182: bounded, read-only financial review for interrupted buyer payments.
  // Access is inherited from the privileged summary; never expose to operational roles.
  const saleAttemptIds=[...new Set((merchantSaleAttempts.data??[])
    .map((a:any)=>String(a.order_id||""))
    .filter((id:string)=>UUID_RE.test(id)))];
  const interruptedSaleOrders=saleAttemptIds.length
    ? await admin.from("orders")
        .select("id,public_code,status,financial_state,financial_reversed_at,updated_at")
        .in("id",saleAttemptIds)
        .in("status",["CANCELLED","REASSIGNING"])
        .limit(500)
    : {data:[],error:null};
  if(interruptedSaleOrders.error)throw interruptedSaleOrders.error;

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
  const activeOwnerByMerchant=new Map((ownerMembers.data??[]).map((x:any)=>[x.merchant_id,x.user_id]));
  const representationByMerchant=new Map((representationReviews.data??[]).map((x:any)=>[x.merchant_id,x]));
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
  // V1.227: aggregate only; a CRM stage is not a verified paid order.
  // Missing proof stays unavailable, never as an invented zero-count result.
  let growthNetwork:any={available:false,valid:false};
  if(['superadmin','operations','readonly','compliance'].includes(actorRole)){
    try{
      const {data,error}=await admin.rpc("admin_growth_network_overview_v1_227",{
        p_actor_user_id:actorUserId
      });
      const fields=['attributedLeads','customerInvitedLeads','merchantInvitedLeads',
        'customerInterests','merchantInterests','crmConvertedLeads','last30d',
        'merchantsWithInviteCode'];
      if(!error&&data?.source==='growth_network_server_v1_227'&&
        data?.readOnly===true&&data?.noPayout===true&&
        data?.noPersonalData===true&&
        data?.crmConversionIsNotOrderSettlement===true&&
        data?.leadScope==='consented_prelaunch_leads_only'&&
        fields.every(k=>Number.isSafeInteger(data[k])&&data[k]>=0)&&
        Array.isArray(data?.merchantBreakdown)&&data.merchantBreakdown.length<=12){
        growthNetwork={available:true,valid:true,...data};
      }else growthNetwork={available:true,valid:false};
    }catch{growthNetwork={available:true,valid:false};}
  }
  // V1.229: a merchant's CNPJ and authentic applicant are linked to a
  // first-touch invite only after the application is submitted. Approval
  // remains separate, and no lead contact match is financial evidence.
  let growthApplicationFunnel:any={available:false,valid:false};
  if(['superadmin','operations','readonly','compliance'].includes(actorRole)){
    try{
      const {data,error}=await admin.rpc("admin_growth_application_funnel_v1_229",{
        p_actor_user_id:actorUserId
      });
      const counters=['applicationsAttributed','contactCandidatesUnverified',
        'applicationsApproved','approvedCnpjOwnerMatches','activeMatchedMerchants',
        'invitedByMerchants','invitedByCustomers'];
      const validRows=Array.isArray(data?.rows)&&data.rows.length<=12&&
        data.rows.every((r:any)=>r&&
          /^[0-9a-f-]{36}$/i.test(String(r.applicationId||''))&&
          typeof r.companyName==='string'&&r.companyName.length>=2&&
          r.companyName.length<=120&&
          /^[0-9A-Z]{4}$/.test(String(r.cnpjSuffix||''))&&
          ['customer','merchant'].includes(r.inviterKind)&&
          ['pending','approved','rejected'].includes(r.applicationStatus)&&
          typeof r.merchantLinked==='boolean'&&
          typeof r.activeMerchant==='boolean'&&
          typeof r.leadCandidate==='boolean'&&
          r.verified===false&&r.rewardEligible===false);
      if(!error&&data?.source==='growth_cnpj_application_funnel_v1_229'&&
        data?.readOnly===true&&data?.noPayout===true&&
        data?.noPersonalContactData===true&&
        data?.attributionNeverFinancialProof===true&&
        data?.firstLevelOnly===true&&
        counters.every(k=>Number.isSafeInteger(data[k])&&data[k]>=0)&&
        data.invitedByMerchants+data.invitedByCustomers===data.applicationsAttributed&&
        data.activeMatchedMerchants<=data.approvedCnpjOwnerMatches&&
        data.approvedCnpjOwnerMatches<=data.applicationsApproved&&
        data.contactCandidatesUnverified<=data.applicationsAttributed&&
        validRows){
        growthApplicationFunnel={available:true,valid:true,...data};
      }else growthApplicationFunnel={available:true,valid:false};
    }catch{growthApplicationFunnel={available:true,valid:false};}
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
      activeOwnerUserId:activeOwnerByMerchant.get(m.id)??null,
      representationReview:representationByMerchant.get(m.id)??null,
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
      verifications:merchantSaleVerifications.data??[],
      attempts:merchantSaleAttempts.data??[],
      interruptedOrders:interruptedSaleOrders.data??[],
      reviewSampleLimited:(merchantSaleAttempts.data??[]).length>=500
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
    marketCityInterests:marketCityInterests??[],
    acquisitionMetrics:acquisitionMetrics.data??{},
    growthNetwork,
    growthApplicationFunnel,
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

    if(action==="clube-coupon-preview"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","A simulação exige perfil financeiro.",403);
      }
      const keys=["orderValueCents","feeBps","merchantSponsorBps","brandSponsorBps",
        "paymentCostCents","variableCostCents","cashbackCostCents","referralCostCents",
        "minimumContributionCents"] as const;
      const values=keys.map(key=>body[key]);
      if(!["gas_3x5","water_5x2"].includes(String(body.packageKey||""))||
        values.some((value:any)=>!Number.isSafeInteger(value)||value<0||value>100000000)||
        values[1]>1500||values[2]>10000||values[3]>10000||
        values[2]+values[3]>10000){
        throw new DomainError("CLUBE_PREVIEW_INVALID_INPUT",
          "Revise as premissas do cenário do Clube TAMÃO.",400);
      }
      const {data,error}=await admin.rpc("admin_clube_coupon_preview_v1_239",{
        p_actor:user.id,p_package_key:body.packageKey,
        p_order_value_cents:values[0],p_fee_bps:values[1],
        p_merchant_sponsor_bps:values[2],p_brand_sponsor_bps:values[3],
        p_payment_cost_cents:values[4],p_variable_cost_cents:values[5],
        p_cashback_cost_cents:values[6],p_referral_cost_cents:values[7],
        p_minimum_contribution_cents:values[8]
      });
      if(error)throw error;
      if(data?.source!=="clube_coupon_finance_preview_v1_239"||
        data?.readOnly!==true||data?.salesEnabled!==false||
        data?.redemptionEnabled!==false||data?.noCharge!==true||
        data?.noCouponIssued!==true||data?.noMerchantSaleProceeds!==true||
        data?.sponsorVerified!==false||data?.scenariosAreNotForecasts!==true||
        data?.isScenarioNotRealPayment!==true||
        data?.packageKey!==body.packageKey||
        !Number.isSafeInteger(data?.scenarioZeroIncrementalAfterMinCents)||
        !Number.isSafeInteger(data?.scenarioAllIncrementalAfterMinCents)||
        !Number.isSafeInteger(data?.totalTamaoSubsidyCents)||
        !Array.isArray(data?.activationRequirements)||
        data.activationRequirements.length<5){
        throw new DomainError("CLUBE_PREVIEW_UNVERIFIED",
          "Não foi possível verificar as premissas financeiras do Clube.",503);
      }
      return json(data,200,origin);
    }
    if(action==="growth-benefit-preview"){
      // The financial role (or superadmin) explicitly authorizes this action.
      // All values are *illustrative inputs*, never accounting authority.
      const names=["receivedFeeCents","existingRewardsCents","variableCostCents",
        "minimumContributionCents","priorCreditsCents"];
      const scenario=names.map(key=>body[key]);
      if(scenario.some((value:any)=>!Number.isSafeInteger(value)||
         value<0||value>100000000)){
        throw new DomainError("INVALID_GROWTH_FINANCE_SCENARIO",
          "Informe valores inteiros válidos em centavos.",400);
      }
      const {data,error}=await admin.rpc("admin_growth_merchant_benefit_preview_v1_228",{
        p_actor_user_id:user.id,
        p_received_fee_cents:scenario[0],
        p_existing_rewards_cents:scenario[1],
        p_variable_cost_cents:scenario[2],
        p_minimum_contribution_cents:scenario[3],
        p_prior_merchant_referral_credits_cents:scenario[4]
      });
      if(error)throw error;
      const good=data?.source==="merchant_referral_finance_preview_v1_228"&&
        data?.readOnly===true&&data?.rewardEnabled===false&&
        data?.grantableCents===0&&data?.noPayout===true&&
        data?.noMerchantSaleProceeds===true&&data?.singleLevel===true&&
        data?.isScenarioNotRealPayment===true&&
        data?.feeBasis==="actual_tamao_fee_received_only"&&
        Number.isSafeInteger(data?.illustrativeBenefitCents)&&
        data.illustrativeBenefitCents>=0&&
        data.illustrativeBenefitCents<=scenario[0]&&
        data?.shareBps>=0&&data?.shareBps<=500&&
        data?.days>=1&&data?.days<=90&&
        Array.isArray(data?.activationRequirements)&&
        data.activationRequirements.length>=5;
      if(!good)throw new DomainError("GROWTH_PREVIEW_UNVERIFIED",
        "Não foi possível validar a simulação financeira.",503);
      return json(data,200,origin);
    }
    if(action==="merchant-enablement"){
      if(!["superadmin","operations","compliance","readonly"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Perfil sem autorização para consultar habilitação.",403);
      }
      // Admin-only diagnostic, never a mutation or an alternate authority for checkout.
      const {data,error}=await admin.rpc("admin_merchant_enablement_v1_157",{p_limit:80});
      if(error)throw error;
      return json({merchants:data||[],asOf:new Date().toISOString(),
        source:"market_city_offer_scope",readOnly:true},200,origin);
    }
    if(action==="operational-alerts"){
      const role=String(adminAccess.admin_role||"");
      if(!["superadmin","operations","finance","support","compliance","readonly"].includes(role)){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Perfil sem acesso à central de alertas.",403);
      }
      return json(await adminOperationalAlerts(admin,role,user.id),200,origin);
    }
    if(action==="commercial-history-list"){
      if(!["superadmin","operations","compliance","readonly"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Perfil sem acesso ao histórico comercial.",403);
      }
      const {data,error}=await admin.rpc("admin_list_city_commercial_history_v1_205",{
        p_actor_user_id:user.id
      });
      if(error)throw error;
      if(data?.source!=="database_authoritative"||!Array.isArray(data?.snapshots)){
        throw new DomainError("COMMERCIAL_HISTORY_NOT_READY","Histórico comercial ainda não está disponível.",503);
      }
      return json(data,200,origin);
    }
    if(action==="expansion-radar"){
      if(!["superadmin","operations","compliance","readonly"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Seu perfil não pode consultar cidades.",403);
      }
      const {data,error}=await admin.rpc("admin_expansion_radar",{p_limit:60});
      if(error)throw error;
      return json({cities:data||[],criterion:"operational_priority_v1",automatedMarketActivation:false},200,origin);
    }
    if(action==="prospect-intelligence"){
      if(!["superadmin","operations","compliance","readonly"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Seu perfil não pode consultar prospectos.",403);
      }
      return json(await prospectIntelligence(admin,body.city,body.state,body.force===true),200,origin);
    }
    if(action==="expansion-notifications"){
      if(!["superadmin","operations"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Seu perfil não pode consultar avisos.",403);
      }
      const city=cleanText(body.city,{min:2,max:120,name:"cidade"});
      const state=String(body.state||"").trim().toUpperCase();
      const key=marketCityKey(city);
      if(!/^[A-Z]{2}$/.test(state)||!key)throw new DomainError("INVALID_PROSPECT_CITY","Região inválida.",400);
      const {data:coverageReady,error:coverageError}=await admin.rpc("market_city_ready",{
        p_city:city,p_state:state
      });
      if(coverageError)throw coverageError;
      if(coverageReady!==true)return json({notifications:[],coverageReady:false},200,origin);
      const {data,error}=await admin.from("city_opening_notifications")
        .select("id,lead_id,postal_code,city,state,status,queued_at,handled_at,prelaunch_leads(contact_name,phone,status,consent_at)")
        .eq("state",state).eq("status","queued").order("queued_at",{ascending:true}).limit(100);
      if(error)throw error;
      return json({notifications:(data||[]).filter((n:any)=>marketCityKey(n.city)===key
        &&n.prelaunch_leads?.consent_at&&n.prelaunch_leads?.status!=="closed")},200,origin);
    }
    if(action==="commercial-activation"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Perfil sem acesso à ativação comercial.",403);
      const {data,error}=await admin.rpc("admin_commercial_activation_v1_238",{
        p_actor:user.id
      });
      if(error)throw error;
      const counts=data?.counts;
      const keys=[
        "anpProspects","anpUncontacted","anpContacted","anpInterested",
        "anpOnboarding","invitationsPending","invitationsClaimed",
        "merchantLeads","merchantNewLeads","merchantApplications",
        "merchantPendingApplications","merchantsRegistered","merchantsActive",
        "merchantsActiveOnline","adsOptedIn","adsCreativesReviewed"
      ];
      const actions=[
        "review_applications","respond_merchant_leads","contact_anp_prospects",
        "followup_prospects","acquire_first_merchant","enable_partner_operation",
        "collect_voluntary_ads_interest","review_creative","validate_first_campaign"
      ];
      const valid=data?.source==="admin_commercial_activation_v1_238"
        &&data?.readOnly===true
        &&data?.stage==="commercial_merchant_activation"
        &&data?.dataMeaning==="independent_operational_populations"
        &&data?.noContactsExposed===true&&data?.noMessagesSent===true
        &&data?.noSyntheticMerchants===true
        &&data?.adsLive===false&&data?.adsRevenueCents===0
        &&data?.noCharge===true
        &&Number.isFinite(Date.parse(String(data?.generatedAt||"")))
        &&counts&&keys.every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0)
        &&counts.anpUncontacted+counts.anpContacted+
            counts.anpInterested+counts.anpOnboarding<=counts.anpProspects
        &&counts.merchantNewLeads<=counts.merchantLeads
        &&counts.merchantPendingApplications<=counts.merchantApplications
        &&counts.merchantsActive<=counts.merchantsRegistered
        &&counts.merchantsActiveOnline<=counts.merchantsActive
        &&actions.includes(data?.nextAction)
        &&Array.isArray(data?.prospectCities)&&data.prospectCities.length<=20
        &&data.prospectCities.every((c:any)=>c&&typeof c.city==="string"
          &&c.city.length>=2&&c.city.length<=100
          &&/^[A-Z]{2}$/.test(String(c.state))
          &&["prospects","uncontacted","interested","onboarding"]
            .every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)
          &&c.uncontacted+c.interested+c.onboarding<=c.prospects);
      if(!valid)throw new DomainError("COMMERCIAL_ACTIVATION_INVALID",
        "A ativação comercial não pôde ser verificada.",503);
      return json(data,200,origin);
    }
    if(action==="ads-pilot-preflight"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Perfil sem acesso ao diagnóstico do piloto.",403);
      }
      const merchantId=uuid(body.merchantId,"merchantId");
      const {data,error}=await admin.rpc("admin_ads_pilot_preflight_v1_237",{
        p_actor:user.id,p_merchant:merchantId
      });
      if(error)throw error;
      const checks=data?.checks;
      const evidence=data?.evidence;
      const commercial=data?.commercial;
      const checkNames=[
        "creativeExists","creativeReviewed","advertiserOptedIn","merchantActiveOnline",
        "campaignCityMatchesMerchant","merchantEligibleForRealOffers",
        "eligibleCategoryProductExists","internalPreviewClientReported",
        "publicPlacementLocked","billingLocked","verifiedDeliveryLocked"
      ];
      const evidenceNames=[
        "visitorCityVerified","clientPreviewIndependentlyVerified",
        "endToEndCustomerAdDeliveryVerified","adFraudDefenseVerified",
        "customerBasketAvailabilityProven"
      ];
      const valid=data?.source==="admin_ads_pilot_preflight_v1_237"
        &&data?.merchantId===merchantId
        &&data?.readOnly===true
        &&Number.isFinite(Date.parse(String(data?.checkedAt||"")))
        &&checks&&checkNames.every(k=>typeof checks[k]==="boolean")
        &&data.internalPrerequisitesMet===checkNames.every(k=>checks[k]===true)
        &&evidence&&evidenceNames.every(k=>evidence[k]===false)
        &&commercial?.publicAdsLive===false
        &&commercial?.readyToSell===false
        &&commercial?.noCharge===true
        &&commercial?.billableImpressions===0
        &&commercial?.verifiedAdImpressions===0
        &&commercial?.adsRevenueCents===0
        &&(data.campaignVersion===null||
           (Number.isSafeInteger(data.campaignVersion)&&data.campaignVersion>=1))
        &&(data.campaignStatus===null||
           ["draft","submitted","approved_creative","needs_changes","withdrawn"].includes(data.campaignStatus))
        &&(data.city===null||(typeof data.city==="string"&&data.city.length<=100))
        &&(data.state===null||/^[A-Z]{2}$/.test(String(data.state)));
      if(!valid)throw new DomainError("ADS_PILOT_PREFLIGHT_UNVERIFIED",
        "Requisitos do piloto não puderam ser confirmados.",503);
      return json(data,200,origin);
    }
    if(action==="ads-placement-readiness"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta de publicidade não autorizada.",403);
      const {data,error}=await admin.rpc("admin_ads_placement_readiness_v1_236",{
        p_actor:user.id
      });
      if(error)throw error;
      if(data?.source!=="admin_ads_placement_readiness_v1_236"
         ||data?.publicEnabled!==false
         ||data?.billingEnabled!==false
         ||data?.verifiedDeliveryEnabled!==false
         ||data?.organicRankingUnaffected!==true
         ||data?.readOnly!==true||data?.noCharge!==true
         ||data?.readyToSell!==false
         ||data?.verifiedAdImpressions!==0
         ||data?.billableImpressions!==0
         ||data?.adsRevenueCents!==0
         ||!Number.isSafeInteger(data.approvedCreatives)||data.approvedCreatives<0
         ||!Number.isSafeInteger(data.potentialMerchantCreatives)
         ||data.potentialMerchantCreatives<0
         ||data.potentialMerchantCreatives>data.approvedCreatives)
        throw new DomainError("ADS_PLACEMENT_STATE_INVALID",
          "Controle de publicidade não confirmado pelo servidor.",503);
      return json(data,200,origin);
    }
    if(action==="ads-preview-summary"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Perfil sem acesso ao diagnóstico de publicidade.",403);
      const {data,error}=await admin.rpc("admin_ads_preview_summary_v1_235",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_ads_preview_summary_v1_235"
        ||data?.windowDays!==30
        ||!Number.isSafeInteger(data.previewChallenges)||data.previewChallenges<0
        ||!Number.isSafeInteger(data.clientReportedPreviews)||data.clientReportedPreviews<0
        ||data.clientReportedPreviews>data.previewChallenges
        ||data.previewOnly!==true||data.independentlyVerified!==false
        ||data.verifiedAdImpressions!==0||data.billableImpressions!==0
        ||data.adsRevenueCents!==0||data.adsLive!==false
        ||data.noCharge!==true||data.readyToSell!==false){
        throw new DomainError("ADS_PREVIEW_SUMMARY_INVALID","Diagnóstico da publicidade inválido.",503);
      }
      return json(data,200,origin);
    }
    if(action==="ads-preview-issue"||action==="ads-preview-confirm"){
      if(!["superadmin","compliance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente conformidade pode testar peças publicitárias.",403);
      const merchantId=uuid(body.merchantId,"merchantId");
      const operation=action==="ads-preview-issue"?"issue":"confirm";
      let requestId:null|string=null;
      let challengeId:null|string=null;
      let visibleMs:null|number=null;
      let visiblePercent:null|number=null;
      if(operation==="issue")requestId=uuid(body.requestId,"requestId");
      else {
        challengeId=uuid(body.challengeId,"challengeId");
        visibleMs=Number(body.visibleMs);
        visiblePercent=Number(body.visiblePercent);
        if(!Number.isSafeInteger(visibleMs)||visibleMs<1500||visibleMs>15000
          ||!Number.isSafeInteger(visiblePercent)||visiblePercent<50||visiblePercent>100)
          throw new DomainError("ADS_PREVIEW_METRIC_INVALID","Tempo ou visibilidade fora dos limites.",400);
      }
      const {data,error}=await admin.rpc("admin_ads_preview_proof_v1_235",{
        p_actor:user.id,p_merchant:merchantId,p_operation:operation,
        p_request:requestId,p_challenge:challengeId,
        p_visible_ms:visibleMs,p_visible_percent:visiblePercent
      });
      if(error)throw error;
      const common=data?.source==="ads_preview_proof_v1_235"
        &&data?.operation===operation&&data?.previewOnly===true
        &&data?.clientReported===true&&data?.independentlyVerified===false
        &&data?.billable===false&&data?.adsLive===false&&data?.noCharge===true;
      if(!common||(operation==="issue"&&(
        !UUID_RE.test(String(data?.challengeId||""))
        ||data?.merchantId!==merchantId
        ||!Number.isSafeInteger(data.creativeVersion)||data.creativeVersion<1
        ||typeof data.title!=="string"||data.title.length>80
        ||typeof data.description!=="string"||data.description.length>240
        ||!Number.isFinite(Date.parse(String(data.expiresAt||"")))))
       ||(operation==="confirm"&&(data.recorded!==true||typeof data.idempotent!=="boolean")))
        throw new DomainError("ADS_PREVIEW_UNVERIFIED","Registro experimental não confirmado.",503);
      return json(data,200,origin);
    }
    if(action==="ads-audience-readiness"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Perfil sem acesso aos indicadores de audiência.",403);
      }
      const {data,error}=await admin.rpc("admin_ads_audience_readiness_v1_234",{
        p_actor_user_id:user.id
      });
      if(error)throw error;
      const ints=["landingCustomerEvents","landingMerchantEvents","customerFormEvents",
        "merchantFormEvents","last7dEvents","activeDays"];
      const quality=data?.evidence;
      const commercial=data?.commercial;
      const valid=data?.source==="admin_ads_audience_readiness_v1_234"
        &&data?.readOnly===true&&data?.periodDays===30&&data?.timezone==="UTC"
        &&data?.metricType==="unverified_anonymous_site_events"
        &&data?.marketingEventSource==="prelaunch_marketing_event_daily"
        &&Number.isFinite(Date.parse(String(data?.generatedAt||"")))
        &&ints.every(k=>Number.isSafeInteger(data?.[k])&&data[k]>=0)
        &&data.activeDays<=30
        &&(data.lastEventDate===null||
          /^20\d{2}-\d{2}-\d{2}$/.test(String(data.lastEventDate)))
        &&quality&&
          ["uniqueVisitorsVerified","cityOfVisitorVerified","invalidTrafficFiltered",
           "actualAdDeliveryImplemented","trackingConsentVerifiedForAds",
           "eventDedupAcrossClientsVerified"].every(k=>quality[k]===false)
        &&quality.sourceCanBeSpoofed===true
        &&commercial?.adsLive===false&&commercial?.noCharge===true
        &&commercial?.readyToSell===false
        &&commercial?.verifiedAdImpressions===0
        &&commercial?.billableImpressions===0
        &&commercial?.verifiedAdClicks===0
        &&commercial?.adsRevenueCents===0
        &&Array.isArray(data?.daily)&&data.daily.length===14
        &&data.daily.every((d:any)=>/^20\d{2}-\d{2}-\d{2}$/.test(String(d.date))
          &&Number.isSafeInteger(d.landingEvents)&&d.landingEvents>=0
          &&Number.isSafeInteger(d.formEvents)&&d.formEvents>=0)
        &&Array.isArray(data?.cityDemand)&&data.cityDemand.length<=20
        &&data.cityDemand.every((c:any)=>c&&typeof c.city==="string"
          &&c.city.length>=2&&c.city.length<=100
          &&/^[A-Z]{2}$/.test(String(c.state))
          &&["interestedMerchants","submittedCreatives","approvedCreatives"]
            .every(k=>Number.isSafeInteger(c[k])&&c[k]>=0));
      if(!valid)throw new DomainError("ADS_AUDIENCE_EVIDENCE_INVALID",
        "Não foi possível validar a origem e os limites da audiência.",503);
      return json(data,200,origin);
    }
    if(action==="ads-campaign-queue"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Perfil sem acesso às propostas de anúncios.",403);
      const {data,error}=await admin.rpc("admin_ads_campaign_queue_v1_233",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_ads_campaign_queue_v1_233"
        ||data.noCharge!==true||data.adsLive!==false
        ||!Number.isSafeInteger(data.submittedCount)||data.submittedCount<0
        ||!Array.isArray(data.rows)||data.rows.length>50
        ||data.rows.some((r:any)=>!r||!UUID_RE.test(String(r.merchantId||""))
          ||!Number.isSafeInteger(r.version)||r.version<1
          ||!["draft","submitted","approved_creative","needs_changes","withdrawn"].includes(r.status)
          ||typeof r.title!=="string"||r.title.length>80
          ||typeof r.description!=="string"||r.description.length>240)){
        throw new DomainError("ADS_CAMPAIGN_QUEUE_INVALID","Fila de campanhas não validada.",503);
      }
      return json(data,200,origin);
    }
    if(action==="ads-campaign-review"){
      if(!["superadmin","compliance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Apenas conformidade pode revisar peças.",403);
      const decision=String(body.decision??"");
      const note=String(body.note??"").trim();
      const version=Number(body.version);
      if(!["approved_creative","needs_changes"].includes(decision)
        ||note.length<12||note.length>500
        ||!Number.isSafeInteger(version)||version<1)
        throw new DomainError("ADS_CAMPAIGN_REVIEW_INVALID","Justificativa, decisão ou versão inválida.",400);
      const {data,error}=await admin.rpc("admin_ads_campaign_review_v1_233",{
        p_actor:user.id,p_merchant:uuid(body.merchantId,"merchantId"),
        p_request:uuid(body.requestId,"requestId"),p_version:version,
        p_decision:decision,p_note:note
      });
      if(error)throw error;
      if(data?.recorded!==true||data.noCharge!==true||data.adsLive!==false)
        throw new DomainError("ADS_CAMPAIGN_REVIEW_UNVERIFIED","Revisão não confirmada.",503);
      return json(data,200,origin);
    }
    // V1.250 — paginated, read-only founder financing decision history.
    // V1.251 — first-party UTM signals, not financial return or paid orders.
    // V1.252 — bound real orders: settled/reversed and merchant order values, not TAMÃO receipts.
    // V1.253 — PSP-confirmed platform fee evidence for single-order daily statements.
    // No prorating, pooled credits, manual-only approvals, bank balance or ROI.
    // V1.254 — read-only, exact statement-balanced per-order fee evidence for batches.
    // V1.255 — marketing expense statements are founder attested, NOT bank-verified.
    // The marketing cost ledger is separate from incentive funding budgets.
    // V1.256 — documentary receipts. Storage bucket is PRIVATE.
    // Signed upload tokens are scoped to a random single-use object path;
    // no service-role key reaches the browser.
    if(action==="owner-campaign-receipt-prepare"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal envia comprovantes.",403);
      const expense=String(body.expenseId??"");
      const mime=String(body.mimeType??"");
      const size=body.sizeBytes;
      const allowed:{[key:string]:string}={
        "application/pdf":"pdf","image/png":"png","image/jpeg":"jpg"
      };
      if(!UUID_RE.test(expense)||!allowed[mime]||
        !Number.isSafeInteger(size)||size<64||size>3145728)
        throw new DomainError("OWNER_RECEIPT_INVALID","Use PDF, PNG ou JPEG de até 3 MB.",400);
      const {data:eligible,error:eligibleError}=await admin.rpc(
        "admin_owner_campaign_receipt_eligible_v1_256",{
          p_actor:user.id,p_expense:expense
        });
      if(eligibleError)throw eligibleError;
      if(eligible?.source!=="admin_owner_campaign_receipt_eligible_v1_256"||
         eligible?.eligible!==true||eligible?.alreadyAttached!==false||
         eligible?.bankVerified!==false||eligible?.cashMoved!==false)
        throw new DomainError("OWNER_RECEIPT_ALREADY_ATTACHED","O gasto já possui comprovante.",409);
      const path=expense+"/"+crypto.randomUUID()+"."+allowed[mime];
      const {data:token,error:signError}=await admin.storage
        .from("tamao-owner-campaign-receipts-v1-256")
        .createSignedUploadUrl(path,{upsert:false});
      if(signError||!token?.token||token.path!==path)
        throw new DomainError("OWNER_RECEIPT_SIGN_FAILED","Não foi possível preparar envio privado.",503);
      return json({source:"admin_owner_campaign_receipt_prepare_v1_256",
        bucket:"tamao-owner-campaign-receipts-v1-256",
        path,token:token.token,mimeType:mime,maxBytes:3145728,
        privateBucket:true,bankVerified:false},200,origin);
    }
    if(action==="owner-campaign-receipt-finalize"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal finaliza comprovantes.",403);
      const expense=String(body.expenseId??"");
      const path=String(body.path??"");
      const mime=String(body.mimeType??"");
      const hash=String(body.sha256??"");
      const match={
        "application/pdf":"pdf","image/png":"png","image/jpeg":"jpg"
      } as Record<string,string>;
      if(!UUID_RE.test(expense)||!match[mime]||
         !(path.startsWith(expense+"/")&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$/i.test(path.slice(37))&&path.endsWith("."+match[mime]))||
         !/^[0-9a-f]{64}$/.test(hash))
        throw new DomainError("OWNER_RECEIPT_FINALIZE_INVALID","Metadados do comprovante inválidos.",400);
      const {data:eligibility,error:eligibilityError}=await admin.rpc(
        "admin_owner_campaign_receipt_eligible_v1_256",{
          p_actor:user.id,p_expense:expense
        });
      if(eligibilityError)throw eligibilityError;
      if(eligibility?.source!=="admin_owner_campaign_receipt_eligible_v1_256"||
         eligibility?.bankVerified!==false||eligibility?.cashMoved!==false)
        throw new DomainError("OWNER_RECEIPT_NOT_ELIGIBLE","Despesa indisponível.",403);
      if(eligibility.alreadyAttached===true){
        const {data:existing,error:existingError}=await admin.rpc(
          "admin_owner_campaign_receipt_path_v1_256",{
            p_actor:user.id,p_expense:expense
          });
        if(existingError||existing?.objectPath!==path||existing?.sha256!==hash||
           existing?.mimeType!==mime)
          throw new DomainError("OWNER_RECEIPT_ALREADY_ATTACHED","Já existe outro comprovante.",409);
        return json({source:"admin_owner_campaign_receipt_attach_v1_256",
          attached:true,replayed:true,bankVerified:false,
          cashMoved:false,newBenefitsEnabled:false},200,origin);
      }
      const {data:blob,error:downloadError}=await admin.storage
        .from("tamao-owner-campaign-receipts-v1-256").download(path);
      if(downloadError||!blob)
        throw new DomainError("OWNER_RECEIPT_FILE_MISSING","Envio não encontrado no armazenamento.",409);
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(bytes.length<64||bytes.length>3145728)
        throw new DomainError("OWNER_RECEIPT_FILE_SIZE","Tamanho do arquivo incompatível.",400);
      const pdf=mime==="application/pdf"&&
        bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70&&bytes[4]===45;
      const png=mime==="image/png"&&
        [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
      const jpeg=mime==="image/jpeg"&&
        bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      if(!pdf&&!png&&!jpeg)
        throw new DomainError("OWNER_RECEIPT_FILE_TYPE","Conteúdo não corresponde ao formato informado.",400);
      const actualHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
        .map(x=>x.toString(16).padStart(2,"0")).join("");
      if(actualHash!==hash)
        throw new DomainError("OWNER_RECEIPT_HASH_MISMATCH","Arquivo enviado não corresponde ao escolhido.",409);
      const {data:attached,error:attachedError}=await admin.rpc(
        "admin_owner_campaign_receipt_attach_v1_256",{
          p_actor:user.id,p_expense:expense,p_path:path,p_mime:mime,
          p_size:bytes.length,p_sha:actualHash
        });
      if(attachedError)throw attachedError;
      if(attached?.source!=="admin_owner_campaign_receipt_attach_v1_256"||
         attached?.attached!==true||typeof attached.replayed!=="boolean"||
         attached?.bankVerified!==false||attached?.cashMoved!==false||
         attached?.newBenefitsEnabled!==false)
        throw new DomainError("OWNER_RECEIPT_ATTACH_UNVERIFIED","Vínculo documental não confirmado.",503);
      return json(attached,200,origin);
    }
    if(action==="owner-campaign-receipts-read"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta documental restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("OWNER_RECEIPT_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_receipts_read_v1_256",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_campaign_receipts_read_v1_256"||
         data?.readOnly!==true||data?.privateBucket!==true||
         data?.bankVerified!==false||data?.noPublicUrls!==true||
         !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
         (month!==""&&data.month!==month)||
         !Number.isSafeInteger(data.total)||data.total<0||
         data.limit!==100||data.truncated!==(data.total>100)||
         !Array.isArray(data.rows)||data.rows.length>100||
         data.rows.length>data.total||
         data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.expenseId||""))||
           !Number.isSafeInteger(x.sizeBytes)||x.sizeBytes<64||x.sizeBytes>3145728||
           !["application/pdf","image/png","image/jpeg"].includes(x.mimeType)||
           !/^[0-9a-f]{64}$/.test(String(x.sha256||""))||
           !Number.isFinite(Date.parse(String(x.uploadedAt||"")))||
           typeof x.voided!=="boolean"))
        throw new DomainError("OWNER_RECEIPTS_UNVERIFIED","Metadados documentais não verificados.",503);
      return json(data,200,origin);
    }
    if(action==="owner-campaign-receipt-view"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta documental restrita.",403);
      const expense=String(body.expenseId??"");
      if(!UUID_RE.test(expense))
        throw new DomainError("OWNER_RECEIPT_INVALID_EXPENSE","Despesa inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_receipt_path_v1_256",{
        p_actor:user.id,p_expense:expense
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_campaign_receipt_path_v1_256"||
         typeof data?.objectPath!=="string"||
         !data.objectPath.startsWith(expense+"/")||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$/i.test(data.objectPath)||
         !/^[0-9a-f]{64}$/.test(String(data.sha256||""))||
         !Number.isSafeInteger(data.sizeBytes)||data.sizeBytes<64||data.sizeBytes>3145728||
         !["application/pdf","image/png","image/jpeg"].includes(data.mimeType))
        throw new DomainError("OWNER_RECEIPT_PATH_UNVERIFIED","Arquivo não verificado.",503);
      const {data:signed,error:signedError}=await admin.storage
        .from("tamao-owner-campaign-receipts-v1-256")
        .createSignedUrl(data.objectPath,60,{download:true});
      if(signedError||typeof signed?.signedUrl!=="string"||
         !signed.signedUrl.startsWith(SUPABASE_URL+"/storage/v1/object/sign/"))
        throw new DomainError("OWNER_RECEIPT_SIGN_FAILED","Não foi possível gerar acesso temporário.",503);
      return json({source:"admin_owner_campaign_receipt_view_v1_256",
        url:signed.signedUrl,expiresInSeconds:60,
        temporaryDownload:true,bankVerified:false},200,origin);
    }


    // V1.267 — segregated multi-PSP hub: merchant receipts != founder benefits.
    if(action==="owner-multi-psp-hub"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Central financeira restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("MULTI_PSP_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_multi_psp_hub_v1_267",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const integer=(x:any)=>Number.isSafeInteger(x)&&x>=0;
      const merchantCounters=["paymentAttempts","evidenceRecords","providerVerifiedOrders"];
      const outgoingCounters=["claims","activeClaims","voidedClaims",
        "withDocument","officiallyQueried","officialStatusMatched",
        "ownerDeclaredActiveCents","verifiedBeneficiaryClaims","bankVerifiedClaims"];
      const outgoingKeys=["mercado_pago","pix","bank_transfer","other"];
      if(data?.source!=="admin_owner_multi_psp_hub_v1_267"||
        data?.timezone!=="America/Sao_Paulo"||
        data?.providerCatalogIsRuntimeVerification!==false||
        data?.merchantReceiptsProvePlatformPayouts!==false||
        data?.merchantAndPlatformFundsNettingAllowed!==false||
        data?.bankSettlementVerified!==false||data?.recipientVerified!==false||
        data?.externalPaidBenefitsCents!==null||
        data?.noTransfers!==true||data?.noIdentityCollection!==true||
        data?.newBenefitsEnabled!==false||data?.readOnly!==true||
        !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
        (month!==""&&data.month!==month)||
        !integer(data.merchantCatalogProviders)||
        !integer(data.merchantEvidenceRecords)||
        !integer(data.merchantProviderVerifiedOrders)||
        !integer(data.outgoingClaims)||!integer(data.outgoingClaimsQueried)||
        data.outgoingProviderCategories!==4||
        !Array.isArray(data.merchantProviders)||
        data.merchantProviders.length!==data.merchantCatalogProviders||
        data.merchantProviders.length>50||
        !Array.isArray(data.outgoingProviders)||
        data.outgoingProviders.length!==4||
        data.merchantProviders.some((x:any)=>!x||
          !/^[a-z][a-z0-9_]{1,31}$/.test(String(x.providerKey||""))||
          typeof x.displayName!=="string"||x.displayName.length<2||
          x.displayName.length>120||
          typeof x.catalogAdapterStatus!=="string"||
          typeof x.catalogConnectionMode!=="string"||
          typeof x.catalogVerificationLevel!=="string"||
          x.catalogFundsFlow!=="merchant_direct"||
          typeof x.catalogSupportsLookup!=="boolean"||
          typeof x.catalogSupportsWebhook!=="boolean"||
          x.ownerOfFunds!=="merchant"||x.outgoingPayoutVerified!==false||
          !merchantCounters.every(k=>integer(x[k]))||
          x.providerVerifiedOrders>x.evidenceRecords)||
        new Set(data.merchantProviders.map((x:any)=>x.providerKey)).size!==
          data.merchantProviders.length||
        data.outgoingProviders.some((x:any)=>!x||
          !outgoingKeys.includes(x.providerKey)||
          typeof x.displayName!=="string"||x.displayName.length>120||
          typeof x.officialOutgoingLookupImplemented!=="boolean"||
          x.officialOutgoingLookupImplemented!==(x.providerKey==="mercado_pago")||
          x.ownerOfFunds!=="platform_owner_reported"||
          x.realTransferProven!==false||
          !outgoingCounters.every(k=>integer(x[k]))||
          x.claims!==x.activeClaims+x.voidedClaims||
          x.officialStatusMatched>x.officiallyQueried||
          x.officiallyQueried>x.claims||
          x.withDocument>x.claims||
          x.verifiedBeneficiaryClaims!==0||x.bankVerifiedClaims!==0)||
        new Set(data.outgoingProviders.map((x:any)=>x.providerKey)).size!==4||
        data.outgoingProviders.reduce((s:number,x:any)=>s+x.claims,0)!==
          data.outgoingClaims||
        data.outgoingProviders.reduce((s:number,x:any)=>s+x.officiallyQueried,0)!==
          data.outgoingClaimsQueried||
        data.merchantProviders.reduce((s:number,x:any)=>s+x.evidenceRecords,0)!==
          data.merchantEvidenceRecords||
        data.merchantProviders.reduce((s:number,x:any)=>s+x.providerVerifiedOrders,0)<
          data.merchantProviderVerifiedOrders)
        throw new DomainError("MULTI_PSP_HUB_UNVERIFIED",
          "Central multibanco sem conciliação validada.",503);
      const token=(Deno.env.get("MERCADOPAGO_PAYOUTS_READ_ACCESS_TOKEN")||"").trim();
      return json({...data,
        outgoingPayoutsCredentialConfigured:token.length>=20,
        outgoingPayoutsCredentialScope:"dedicated_mp_payouts_read_only",
        outgoingPayoutsCredentialProvesApiAuthorization:false,
        incomingMerchantCredentialsReused:false
      },200,origin);
    }
    // V1.266 — privacy-preserving, read-only beneficiary evidence gaps.
    if(action==="owner-recipient-proof-readiness"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Fila de beneficiários restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("RECIPIENT_EVIDENCE_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_recipient_evidence_gaps_v1_266",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const countFields=["totalClaims","activeClaims","voidedClaims",
        "eligibleClaims","walletReconciledClaims","internalIdentityMatches",
        "documentedClaims","providerObservedClaims","providerReconciledClaims",
        "readyForRecipientProof","beneficiaryVerifiedClaims",
        "bankSettlementVerifiedClaims"];
      const allowedReasons=new Set([
        "claim_voided","recipient_grant_identity_mismatch",
        "commission_not_currently_eligible","commission_wallet_not_reconciled",
        "outgoing_provider_not_supported","official_outgoing_transaction_not_queried",
        "outgoing_transaction_status_or_reference_mismatch","payout_document_missing",
        "recipient_destination_not_independently_verified"
      ]);
      const t=data?.totals;
      if(data?.source!=="admin_owner_recipient_evidence_gaps_v1_266"||
         data?.scope!=="owner_reported_referral_outgoing_claims"||
         data?.timezone!=="America/Sao_Paulo"||
         data?.destinationIdentityAvailableFromProvider!==false||
         data?.recipientVerified!==false||data?.bankSettlementVerified!==false||
         data?.externalPaidBenefitsCents!==null||data?.noIdentityCollection!==true||
         data?.readOnly!==true||data?.noTransfers!==true||
         data?.newBenefitsEnabled!==false||
         !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
         (month!==""&&data.month!==month)||
         !t||countFields.some(k=>!Number.isSafeInteger(t[k])||t[k]<0)||
         t.totalClaims!==t.activeClaims+t.voidedClaims||
         t.beneficiaryVerifiedClaims!==0||t.bankSettlementVerifiedClaims!==0||
         t.readyForRecipientProof>t.providerReconciledClaims||
         t.readyForRecipientProof>t.documentedClaims||
         t.providerReconciledClaims>t.providerObservedClaims||
         t.providerObservedClaims>t.totalClaims||
         t.walletReconciledClaims>t.totalClaims||
         t.internalIdentityMatches>t.totalClaims||
         t.eligibleClaims>t.activeClaims||
         data.limit!==50||data.truncated!==(t.totalClaims>50)||
         !Array.isArray(data.rows)||data.rows.length>50||
         data.rows.length>t.totalClaims||
         data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.claimId||""))||
           !Number.isSafeInteger(x.amountCents)||x.amountCents<1||
           !["pix","bank_transfer","mercado_pago","other"].includes(x.provider)||
           !/^\d{4}-\d{2}-\d{2}$/.test(String(x.paidOn||""))||
           !["voided","grantEligibleNow","internalRecipientMatchesGrant",
             "walletVerified","proofAttached","providerObserved",
             "providerMatchedNow","readyForRecipientProof",
             "beneficiaryVerified","bankSettlementVerified"].every(k=>
               typeof x[k]==="boolean")||
           x.beneficiaryVerified!==false||x.bankSettlementVerified!==false||
           (x.readyForRecipientProof&&(
             x.voided||!x.grantEligibleNow||!x.walletVerified||
             !x.proofAttached||!x.providerMatchedNow||
             x.provider!=="mercado_pago"))||
           x.providerMatchedNow&&!x.providerObserved||
           (x.lastProviderCheckAt!==null&&
             !Number.isFinite(Date.parse(String(x.lastProviderCheckAt))))||
           !Array.isArray(x.missingEvidence)||
           !x.missingEvidence.includes("recipient_destination_not_independently_verified")||
           x.missingEvidence.some((reason:any)=>
             typeof reason!=="string"||!allowedReasons.has(reason))))
        throw new DomainError("RECIPIENT_EVIDENCE_UNVERIFIED",
          "Fila de conferência de beneficiários não validada.",503);
      return json(data,200,origin);
    }
    // V1.265 — read-only lookup of *outgoing* MP Payouts. Never use incoming
    // Payments API tokens as evidence of outgoing referral transfers.
    if(action==="owner-payout-provider-check"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta externa reservada ao fundador.",403);
      const claimId=String(body.claimId||"");
      const payoutId=String(body.payoutId||"").trim();
      const transactionId=String(body.transactionId||"").trim();
      if(!UUID_RE.test(claimId)||
        !/^POP[0-9A-Z]{10,45}$/.test(payoutId)||
        !/^TOP[0-9A-Z]{10,45}$/.test(transactionId))
        throw new DomainError("PAYOUT_PROVIDER_IDS_INVALID","IDs oficiais de lote e transação inválidos.",400);
      const {data:target,error:targetErr}=await admin.rpc(
        "admin_owner_payout_provider_target_v1_265",{p_actor:user.id,p_claim:claimId});
      if(targetErr)throw targetErr;
      if(target?.source!=="owner_payout_provider_target_v1_265"||
         target.claimId!==claimId||target.bankVerified!==false||
         target.recipientVerified!==false||
         !Number.isSafeInteger(target.amountCents)||target.amountCents<1||
         typeof target.reference!=="string"||target.reference.length<8||
         typeof target.active!=="boolean"||typeof target.eligible!=="boolean")
        throw new DomainError("PAYOUT_PROVIDER_TARGET_INVALID","Declaração inválida.",503);
      if(target.provider!=="mercado_pago"||!target.active||!target.eligible)
        throw new DomainError("PAYOUT_PROVIDER_NOT_ELIGIBLE","Somente declarações ativas e elegíveis do Mercado Pago.",409);
      // Dedicated outgoing Payouts token; intentionally NEVER fall back to
      // merchant billing / online payment credentials or an anon key.
      const token=(Deno.env.get("MERCADOPAGO_PAYOUTS_READ_ACCESS_TOKEN")||"").trim();
      if(!token)
        return json({source:"owner_payout_provider_check_v1_265",
          configured:false,checked:false,reason:"outgoing_payouts_credentials_missing",
          bankSettlementVerified:false,recipientVerified:false,
          transferExecuted:false},200,origin);
      if(token.length<20)
        throw new DomainError("PAYOUT_PROVIDER_CONFIG_INVALID","Credencial da API Payouts inválida.",503);
      const endpoint="https://api.mercadopago.com/v1/payouts/"+
        payoutId+"/transactions/"+transactionId;
      let response:Response;
      try{
        response=await fetch(endpoint,{
          method:"GET",redirect:"error",
          headers:{Authorization:"Bearer "+token,Accept:"application/json"},
          signal:AbortSignal.timeout(9000)
        });
      }catch{
        throw new DomainError("PAYOUT_PROVIDER_NETWORK_ERROR","Consulta ao provedor indisponível.",503);
      }
      if(!response.ok)
        throw new DomainError("PAYOUT_PROVIDER_HTTP_ERROR",
          response.status===403||response.status===401
            ?"Credencial sem acesso à API de repasses."
            :"Transação não consultável no provedor.",503);
      if((Number(response.headers.get("content-length"))||0)>65536)
        throw new DomainError("PAYOUT_PROVIDER_RESPONSE_TOO_LARGE","Resposta inesperada.",503);
      const raw=await response.text();
      if(raw.length>65536)
        throw new DomainError("PAYOUT_PROVIDER_RESPONSE_TOO_LARGE","Resposta inesperada.",503);
      let v:any;
      try{v=JSON.parse(raw);}catch{
        throw new DomainError("PAYOUT_PROVIDER_INVALID_JSON","Resposta do provedor inválida.",503);
      }
      const amountValue=v?.amount?.value;
      const amountText=typeof amountValue==="string"?amountValue:
        (typeof amountValue==="number"&&Number.isFinite(amountValue)?String(amountValue):"");
      const amountMatch=amountText.match(/^(\d{1,8})(?:\.(\d{1,2}))?$/);
      const amountCents=amountMatch?
        Number(amountMatch[1])*100+Number((amountMatch[2]||"").padEnd(2,"0")):NaN;
      const timestamp=String(v?.last_update_date||v?.created_date||"");
      const status=String(v?.status||"");
      const detail=String(v?.status_detail??"");
      const allowedStatuses=["created","approved","pending","in_process",
        "success","error","canceled"];
      if(v?.id!==transactionId||v?.amount?.currency!=="BRL"||
        !Number.isSafeInteger(amountCents)||amountCents<0||
        typeof v?.external_reference!=="string"||
        v.external_reference.length<8||v.external_reference.length>120||
        !Number.isFinite(Date.parse(timestamp))||
        Date.parse(timestamp)>Date.now()+300000||
        typeof detail!=="string"||detail.length>100)
        throw new DomainError("PAYOUT_PROVIDER_RESPONSE_INVALID","Identidade ou valor inválido no retorno.",503);
      const mappedStatus=allowedStatuses.includes(status)?status:"unknown";
      const digest=await sha256Hex(raw);
      const {data:observation,error:writeErr}=await admin.rpc(
        "admin_owner_payout_provider_record_v1_265",{
        p_actor:user.id,p_claim:claimId,p_payout:payoutId,
        p_transaction:transactionId,p_reference:v.external_reference,
        p_amount:amountCents,p_status:mappedStatus,p_detail:detail,
        p_updated:timestamp,p_digest:digest
      });
      if(writeErr)throw writeErr;
      if(observation?.source!=="owner_payout_provider_observation_v1_265"||
        observation.claimId!==claimId||
        !UUID_RE.test(String(observation.observationId||""))||
        observation.status!==mappedStatus||observation.statusDetail!==detail||
        typeof observation.referenceMatches!=="boolean"||
        typeof observation.amountMatches!=="boolean"||
        typeof observation.eligibleNow!=="boolean"||
        typeof observation.providerTransactionSuccess!=="boolean"||
        observation.recipientVerified!==false||
        observation.bankSettlementVerified!==false||
        observation.transferExecuted!==false||
        observation.referenceMatches!==(v.external_reference===target.reference)||
        observation.amountMatches!==(amountCents===target.amountCents))
        throw new DomainError("PAYOUT_PROVIDER_OBSERVATION_INVALID","Resposta não validada.",503);
      return json({...observation,
        configured:true,checked:true,
        provider:"mercado_pago_payouts_get",
        amountCents,reportedAmountCents:target.amountCents,
        settlementBankConfirmed:false},200,origin);
    }
    if(action==="owner-payout-provider-read"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Histórico externo restrito.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("PAYOUT_PROVIDER_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_payout_provider_read_v1_265",{
        p_actor:user.id,p_month:month||null});
      if(error)throw error;
      const counters=["totalClaims","checkedClaims","providerSuccessClaims",
        "checkedUnmatchedClaims","unqueriedClaims"];
      if(data?.source!=="owner_payout_provider_reconciliation_v1_265"||
        data?.provider!=="mercado_pago_payouts_get"||
        data?.timezone!=="America/Sao_Paulo"||
        data?.bankSettlementVerified!==false||data?.recipientVerified!==false||
        data?.providerTransactionIsBeneficiaryProof!==false||
        data?.externalPaidBenefitsCents!==null||data?.readOnly!==true||
        data?.noTransfers!==true||
        !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
        (month!==""&&data.month!==month)||
        counters.some(k=>!Number.isSafeInteger(data?.[k])||data[k]<0)||
        data.totalClaims!==data.checkedClaims+data.unqueriedClaims||
        data.checkedClaims!==data.providerSuccessClaims+data.checkedUnmatchedClaims||
        data.limit!==30||data.truncated!==(data.totalClaims>30)||
        !Array.isArray(data.rows)||data.rows.length>30||
        data.rows.length>data.totalClaims||
        data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.claimId||""))||
          typeof x.successNow!=="boolean"||typeof x.proofPresent!=="boolean"||
          typeof x.voided!=="boolean"||
          (x.checkedAt!==null&&(
            !Number.isFinite(Date.parse(x.checkedAt))||
            typeof x.referenceMatches!=="boolean"||
            typeof x.amountMatches!=="boolean"||
            typeof x.providerTransactionSuccess!=="boolean"||
            typeof x.status!=="string"||typeof x.detail!=="string"||
            !/^POP[0-9A-Z]{10,45}$/.test(String(x.payoutId||""))||
            !/^TOP[0-9A-Z]{10,45}$/.test(String(x.transactionId||""))))||
          (x.checkedAt===null&&(
            x.status!==null||x.detail!==null||
            x.payoutId!==null||x.transactionId!==null||
            x.referenceMatches!==null||x.amountMatches!==null||
            x.providerTransactionSuccess!==null))))
        throw new DomainError("PAYOUT_PROVIDER_HISTORY_INVALID","Histórico externo não validado.",503);
      return json(data,200,origin);
    }
    // V1.264 — owner-authenticated private proof upload, byte-checked on server.
    if(action==="owner-benefit-proof-prepare"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Envio restrito ao administrador principal.",403);
      const claim=String(body.claimId??""),mime=String(body.mimeType??""),size=body.sizeBytes;
      const types:Record<string,string>={"application/pdf":"pdf","image/png":"png","image/jpeg":"jpg"};
      if(!UUID_RE.test(claim)||!types[mime]||!Number.isSafeInteger(size)||
         size<64||size>3145728)
        throw new DomainError("PAYOUT_PROOF_INVALID","Use PDF, PNG ou JPEG de até 3 MB.",400);
      const {data:elig,error:eligErr}=await admin.rpc(
        "admin_owner_payout_proof_eligible_v1_264",{p_actor:user.id,p_claim:claim});
      if(eligErr)throw eligErr;
      if(elig?.source!=="admin_owner_payout_proof_eligible_v1_264"||
         elig.eligible!==true||elig.alreadyAttached!==false||
         elig.bankVerified!==false||elig.cashMoved!==false||
         (elig.expectedHash!==null&&!/^[0-9a-f]{64}$/.test(String(elig.expectedHash))))
        throw new DomainError("PAYOUT_PROOF_NOT_ELIGIBLE","Declaração indisponível para anexo.",409);
      const path=claim+"/"+crypto.randomUUID()+"."+types[mime];
      const {data:token,error:signError}=await admin.storage
        .from("tamao-owner-referral-payout-proofs-v1-264")
        .createSignedUploadUrl(path,{upsert:false});
      if(signError||typeof token?.token!=="string"||token.path!==path)
        throw new DomainError("PAYOUT_PROOF_SIGN_FAILED","Não foi possível preparar envio privado.",503);
      return json({source:"admin_owner_payout_proof_prepare_v1_264",
        bucket:"tamao-owner-referral-payout-proofs-v1-264",
        path,token:token.token,mimeType:mime,maxBytes:3145728,
        expectedHash:elig.expectedHash,privateBucket:true,bankVerified:false},200,origin);
    }
    if(action==="owner-benefit-proof-finalize"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Vínculo restrito ao administrador principal.",403);
      const claim=String(body.claimId??""),path=String(body.path??"");
      const mime=String(body.mimeType??""),sha=String(body.sha256??"");
      const types:Record<string,string>={"application/pdf":"pdf","image/png":"png","image/jpeg":"jpg"};
      if(!UUID_RE.test(claim)||!types[mime]||
        !new RegExp("^"+claim+"/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\."+types[mime]+"$","i").test(path)||
        !/^[0-9a-f]{64}$/.test(sha))
        throw new DomainError("PAYOUT_PROOF_FINALIZE_INVALID","Dados do arquivo inválidos.",400);
      const {data:elig,error:eligError}=await admin.rpc(
        "admin_owner_payout_proof_eligible_v1_264",{p_actor:user.id,p_claim:claim});
      if(eligError)throw eligError;
      if(elig?.source!=="admin_owner_payout_proof_eligible_v1_264"||
         elig.bankVerified!==false||elig.cashMoved!==false||
         (elig.eligible!==true&&elig.alreadyAttached!==true)||
         (elig.expectedHash!==null&&elig.expectedHash!==sha))
        throw new DomainError("PAYOUT_PROOF_NOT_ELIGIBLE","Declaração não elegível.",409);
      const {data:blob,error:downError}=await admin.storage
        .from("tamao-owner-referral-payout-proofs-v1-264").download(path);
      if(downError||!blob)
        throw new DomainError("PAYOUT_PROOF_MISSING","Comprovante não encontrado.",409);
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(bytes.length<64||bytes.length>3145728)
        throw new DomainError("PAYOUT_PROOF_SIZE","Arquivo fora do limite.",400);
      const validMime=
        (mime==="application/pdf"&&[37,80,68,70,45].every((v,i)=>bytes[i]===v))||
        (mime==="image/png"&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))||
        (mime==="image/jpeg"&&[255,216,255].every((v,i)=>bytes[i]===v));
      if(!validMime)throw new DomainError("PAYOUT_PROOF_TYPE","Formato incompatível.",400);
      const actual=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
        .map(x=>x.toString(16).padStart(2,"0")).join("");
      if(actual!==sha)
        throw new DomainError("PAYOUT_PROOF_HASH","Arquivo diferente do escolhido.",409);
      const {data:attached,error:attachErr}=await admin.rpc(
        "admin_owner_payout_proof_attach_v1_264",{
          p_actor:user.id,p_claim:claim,p_path:path,p_mime:mime,
          p_size:bytes.length,p_sha:actual});
      if(attachErr)throw attachErr;
      if(attached?.source!=="admin_owner_payout_proof_attach_v1_264"||
        attached.attached!==true||typeof attached.replayed!=="boolean"||
        attached.bankVerified!==false||attached.cashMoved!==false)
        throw new DomainError("PAYOUT_PROOF_ATTACH_UNVERIFIED","Vínculo não confirmado.",503);
      return json(attached,200,origin);
    }
    if(action==="owner-benefit-proofs-read"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Documentos restritos.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("PAYOUT_PROOF_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_payout_proofs_read_v1_264",{
        p_actor:user.id,p_month:month||null});
      if(error)throw error;
      if(data?.source!=="admin_owner_payout_proofs_read_v1_264"||
         data?.timezone!=="America/Sao_Paulo"||data.privateBucket!==true||
         data.readOnly!==true||data.verifiedBytesAtUpload!==true||
         data.bankVerified!==false||data.providerConfirmed!==false||
         data.paidBenefitsCents!==null||data.transferExecuted!==false||
         !/^\d{4}-\d{2}-01$/.test(String(data.month||""))||
         (month!==""&&data.month!==month)||
         !Number.isSafeInteger(data.totalClaims)||data.totalClaims<0||
         !Number.isSafeInteger(data.withProof)||data.withProof<0||
         !Number.isSafeInteger(data.withoutProof)||data.withoutProof<0||
         data.totalClaims!==data.withProof+data.withoutProof||
         data.limit!==30||data.truncated!==(data.totalClaims>30)||
         !Array.isArray(data.rows)||data.rows.length>30||
         data.rows.length>data.totalClaims||
         data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.claimId||""))||
           typeof x.attached!=="boolean"||typeof x.voided!=="boolean"||
           (x.attached&&(
             !["application/pdf","image/png","image/jpeg"].includes(x.mimeType)||
             !Number.isSafeInteger(x.sizeBytes)||x.sizeBytes<64||x.sizeBytes>3145728||
             !/^[0-9a-f]{64}$/.test(String(x.sha256||""))||
             !Number.isFinite(Date.parse(String(x.uploadedAt||"")))))||
           (!x.attached&&(x.mimeType!==null||x.sizeBytes!==null||
              x.sha256!==null||x.uploadedAt!==null))))
        throw new DomainError("PAYOUT_PROOFS_READ_UNVERIFIED","Documentos não validados.",503);
      return json(data,200,origin);
    }
    if(action==="owner-benefit-proof-verify"||action==="owner-benefit-proof-view"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Documento restrito.",403);
      const claim=String(body.claimId??"");
      if(!UUID_RE.test(claim))
        throw new DomainError("PAYOUT_PROOF_INVALID_CLAIM","Identificador inválido.",400);
      const {data:proof,error:proofErr}=await admin.rpc(
        "admin_owner_payout_proof_path_v1_264",{p_actor:user.id,p_claim:claim});
      if(proofErr)throw proofErr;
      const mime=String(proof?.mimeType||""),path=String(proof?.objectPath||"");
      const types:Record<string,string>={"application/pdf":"pdf","image/png":"png","image/jpeg":"jpg"};
      if(proof?.source!=="admin_owner_payout_proof_path_v1_264"||
         proof.claimId!==claim||!types[mime]||
         !new RegExp("^"+claim+"/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\."+types[mime]+"$","i").test(path)||
         !Number.isSafeInteger(proof.sizeBytes)||proof.sizeBytes<64||proof.sizeBytes>3145728||
         !/^[0-9a-f]{64}$/.test(String(proof.sha256||""))||
         proof.bankVerified!==false)
        throw new DomainError("PAYOUT_PROOF_PATH_UNVERIFIED","Metadados inválidos.",503);
      const {data:blob,error:downloadErr}=await admin.storage
        .from("tamao-owner-referral-payout-proofs-v1-264").download(path);
      if(downloadErr||!blob)throw new DomainError("PAYOUT_PROOF_FILE_MISSING","Arquivo não encontrado.",409);
      const bytes=new Uint8Array(await blob.arrayBuffer());
      const magic=(mime==="application/pdf"&&[37,80,68,70,45].every((v,i)=>bytes[i]===v))||
        (mime==="image/png"&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))||
        (mime==="image/jpeg"&&[255,216,255].every((v,i)=>bytes[i]===v));
      const actual=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
        .map(x=>x.toString(16).padStart(2,"0")).join("");
      if(bytes.length!==proof.sizeBytes||!magic||actual!==proof.sha256)
        throw new DomainError("PAYOUT_PROOF_INTEGRITY_MISMATCH",
          "Integridade do documento divergente.",409);
      if(action==="owner-benefit-proof-verify")
        return json({source:"admin_owner_payout_proof_verify_v1_264",
          claimId:claim,integrityVerified:true,bankVerified:false,
          providerConfirmed:false,transferExecuted:false},200,origin);
      const {data:signed,error:signErr}=await admin.storage
        .from("tamao-owner-referral-payout-proofs-v1-264")
        .createSignedUrl(path,60,{download:true});
      if(signErr||typeof signed?.signedUrl!=="string"||
         !signed.signedUrl.startsWith(SUPABASE_URL+"/storage/v1/object/sign/"))
        throw new DomainError("PAYOUT_PROOF_VIEW_FAILED","Não foi possível abrir documento.",503);
      return json({source:"admin_owner_payout_proof_view_v1_264",
        url:signed.signedUrl,expiresInSeconds:60,integrityVerified:true,
        temporaryDownload:true,bankVerified:false,providerConfirmed:false},200,origin);
    }
    // V1.263 — owner-reported external payout evidence, never bank confirmation.
    if(action==="owner-benefit-payout-read"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta financeira restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("PAYOUT_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_referral_payout_claims_v1_263",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const m=data?.metrics;
      const fields=["totalClaims","activeClaims","voidedClaims","reportedActiveCents",
       "reportedEligibleNowCents","reportedNowIneligibleCents","reportedVoidedCents",
       "activeWithoutProofFingerprint"];
      const providers=["pix","bank_transfer","mercado_pago","other"];
      if(data?.source!=="admin_owner_referral_payout_claims_v1_263"||
        data?.timezone!=="America/Sao_Paulo"||
        data?.reportedByOwnerOnly!==true||data?.providerSettlementConfirmed!==false||
        data?.reportMetricMeaning!=="owner_reported_external_claims_not_bank_verified"||
        data?.externalPaidBenefitsCents!==null||data?.externalPayoutMeasured!==false||
        data?.bankSettlementVerified!==false||data?.profitMeasured!==false||
        data?.roiMeasured!==false||data?.readOnly!==true||
        data?.noTransfers!==true||data?.newBenefitsEnabled!==false||
        !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
        (month!==""&&data.month!==month)||
        !m||fields.some(k=>!Number.isSafeInteger(m[k])||m[k]<0)||
        m.totalClaims!==m.activeClaims+m.voidedClaims||
        m.reportedActiveCents!==m.reportedEligibleNowCents+m.reportedNowIneligibleCents||
        m.activeWithoutProofFingerprint>m.activeClaims||
        !Number.isSafeInteger(data.totalRecords)||data.totalRecords<0||
        data.totalRecords!==m.totalClaims||data.limit!==30||
        data.truncated!==(data.totalRecords>30)||
        !Array.isArray(data.rows)||data.rows.length>30||
        data.rows.length>data.totalRecords||
        data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.claimId||""))||
          !UUID_RE.test(String(x.orderId||""))||
          !Number.isSafeInteger(x.amountCents)||x.amountCents<1||
          !providers.includes(x.provider)||typeof x.referenceMasked!=="string"||
          !/^[A-Za-z0-9._:/-]{4}…[A-Za-z0-9._:/-]{4}$/.test(x.referenceMasked)||
          !/^\d{4}-\d{2}-\d{2}$/.test(String(x.paidOn||""))||
          x.proofFingerprintPresent!==true&&x.proofFingerprintPresent!==false||
          typeof x.voided!=="boolean"||typeof x.eligibleNow!=="boolean"))
        throw new DomainError("PAYOUT_REPORT_UNVERIFIED","Conciliação de repasses não validada.",503);
      return json(data,200,origin);
    }
    if(action==="owner-benefit-payout-record"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Registro reservado ao administrador principal.",403);
      const provider=String(body.provider||"");
      const reference=String(body.reference||"").trim();
      const paidOn=String(body.paidOn||"");
      const proof=String(body.proofSha256||"").toLowerCase().trim();
      const amount=body.amountCents;
      if(!UUID_RE.test(String(body.orderId||""))||
        !Number.isSafeInteger(amount)||amount<1||amount>100000000||
        !["pix","bank_transfer","mercado_pago","other"].includes(provider)||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$/.test(reference)||
        !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)||
        (proof!==""&&!/^[0-9a-f]{64}$/.test(proof)))
        throw new DomainError("PAYOUT_CLAIM_INVALID","Confira pedido, valor e evidência.",400);
      const {data,error}=await admin.rpc("admin_owner_referral_payout_record_v1_263",{
        p_actor:user.id,p_order_id:body.orderId,p_amount_cents:amount,
        p_provider:provider,p_reference:reference,p_paid_on:paidOn,
        p_proof_sha256:proof||null
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_referral_payout_claim_v1_263"||
        !UUID_RE.test(String(data?.claimId||""))||
        typeof data.alreadyRecorded!=="boolean"||
        data.bankVerified!==false||data.transferExecuted!==false)
        throw new DomainError("PAYOUT_CLAIM_UNVERIFIED","Registro não validado.",503);
      return json(data,200,origin);
    }
    if(action==="owner-benefit-payout-void"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Retificação reservada ao administrador principal.",403);
      const reason=String(body.reason||"").trim();
      if(!UUID_RE.test(String(body.claimId||""))||reason.length<12||reason.length>300)
        throw new DomainError("PAYOUT_VOID_INVALID","Informe uma justificativa de 12 a 300 caracteres.",400);
      const {data,error}=await admin.rpc("admin_owner_referral_payout_void_v1_263",{
        p_actor:user.id,p_claim_id:body.claimId,p_reason:reason
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_referral_payout_void_v1_263"||
        !UUID_RE.test(String(data.claimId||""))||data.claimId!==body.claimId||
        typeof data.alreadyVoided!=="boolean"||data.transferExecuted!==false)
        throw new DomainError("PAYOUT_VOID_UNVERIFIED","Retificação não validada.",503);
      return json(data,200,origin);
    }
    // V1.262 — referral grant lifecycle, not an external commission payout.
    if(action==="owner-referral-lifecycle"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Conciliação de indicações restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("REFERRAL_TRACE_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_referral_lifecycle_v1_262",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const nonneg=(x:any,fields:string[])=>x&&fields.every(
        k=>Number.isSafeInteger(x[k])&&x[k]>=0);
      const co=data?.cohort,flow=data?.walletEventFlows;
      const states=["grantOrders","issuedCents","verifiedLifecycleCents",
        "unverifiedLifecycleCents","verifiedOrders","unverifiedOrders",
        "pendingCents","availableCents","verifiedAvailableCents",
        "reversedBeforeMaturityCents","reversedAfterMaturityCents",
        "pendingOrders","availableOrders","reversedBeforeMaturityOrders",
        "reversedAfterMaturityOrders"];
      const events=["totalEvents","pendingCreatedCents","pendingReleasedCents",
        "availableCreatedCents","availableReversedCents","eventsWithoutValidGrant"];
      const campaigns=["customer_cashback","customer_referral",
        "merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_referral_lifecycle_v1_262"||
        data?.timezone!=="America/Sao_Paulo"||
        data?.issuerOrderTraceAvailable!==true||
        data?.pendingReleaseIsAmbiguousWithoutGrantState!==true||
        data?.cohortStagesCurrentNotHistorical!==true||
        data?.walletFlowsAreCashPayments!==false||
        data?.externalPaidReferralCents!==null||data?.externalPayoutMeasured!==false||
        data?.campaignAttributionIsCausal!==false||data?.bankSettlementVerified!==false||
        data?.profitMeasured!==false||data?.roiMeasured!==false||
        data?.readOnly!==true||data?.noTransfers!==true||data?.newBenefitsEnabled!==false||
        !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
        (month!==""&&data.month!==month)||
        !nonneg(co,states)||!nonneg(flow,events)||
        co.issuedCents!==co.verifiedLifecycleCents+co.unverifiedLifecycleCents||
        co.grantOrders!==co.verifiedOrders+co.unverifiedOrders||
        co.issuedCents!==co.pendingCents+co.availableCents+
          co.reversedBeforeMaturityCents+co.reversedAfterMaturityCents||
        co.grantOrders!==co.pendingOrders+co.availableOrders+
          co.reversedBeforeMaturityOrders+co.reversedAfterMaturityOrders||
        co.verifiedAvailableCents>co.availableCents||
        flow.eventsWithoutValidGrant>flow.totalEvents||
        !Number.isSafeInteger(data.totalCampaigns)||data.totalCampaigns<0||
        data.limit!==50||data.truncated!==(data.totalCampaigns>50)||
        !Array.isArray(data.rows)||data.rows.length>50||
        data.rows.length>data.totalCampaigns||
        data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.allocationId||""))||
          typeof x.campaignTag!=="string"||
          !campaigns.some(k=>x.campaignTag.startsWith(
            "tam-"+k+"-"+data.month.slice(0,4)+data.month.slice(5,7)+"-"))||
          typeof x.campaignLabel!=="string"||x.campaignLabel.length>180||
          !nonneg(x,["referralGrantOrders","referralIssuedCents",
            "referralPendingCents","referralAvailableCents","referralReversedCents"])||
          x.referralIssuedCents!==x.referralPendingCents+
            x.referralAvailableCents+x.referralReversedCents))
        throw new DomainError("REFERRAL_TRACE_UNVERIFIED",
          "Conciliação de indicações não validada.",503);
      return json(data,200,origin);
    }
    // V1.261 — private, forward-only source-lot attribution summary.
    if(action==="owner-cashback-source-lots"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Origem de créditos restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("SOURCE_LOTS_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_cashback_source_lots_v1_261",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const nonneg=(x:any,fields:string[])=>x&&fields.every(
        k=>Number.isSafeInteger(x[k])&&x[k]>=0);
      const ev=data?.events,issuance=data?.issuance,use=data?.settledUse;
      const keys=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_cashback_source_lots_v1_261"||
        data?.timezone!=="America/Sao_Paulo"||
        data?.captureMode!=="forward_only_after_wallet_insert"||
        data?.lotAllocationMethod!=="fifo_bookkeeping_convention"||
        data?.walletIsAuthoritative!==true||data?.legacyBackfillPerformed!==false||
        data?.readOnly!==true||data?.noTransfers!==true||data?.newBenefitsEnabled!==false||
        data?.externalPaidBenefitsCents!==null||data?.externalPayoutMeasured!==false||
        data?.bankSettlementVerified!==false||data?.profitMeasured!==false||
        data?.roiMeasured!==false||
        !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
        (month!==""&&data.month!==month)||
        !nonneg(ev,["walletEntries","capturedEntries","untrackedEntries",
          "partialEntries","matchedCents","unmatchedCents"])||
        ev.walletEntries!==ev.capturedEntries+ev.untrackedEntries||
        ev.partialEntries>ev.capturedEntries||
        !nonneg(issuance,["newLots","issuedCents","remainingCents",
          "seedIssuedCents","earnedIssuedCents"])||
        issuance.issuedCents!==issuance.seedIssuedCents+issuance.earnedIssuedCents||
        issuance.remainingCents>issuance.issuedCents||
        !nonneg(use,["settledAssignedCents","settledPartiallyAssignedCents",
          "settledUnassignedCents","fullyAssignedOrders","partiallyAssignedOrders"])||
        !Number.isSafeInteger(data.totalCampaigns)||data.totalCampaigns<0||
        data.limit!==50||data.truncated!==(data.totalCampaigns>50)||
        !Array.isArray(data.rows)||data.rows.length>50||
        data.rows.length>data.totalCampaigns||
        data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.allocationId||""))||
          typeof x.campaignTag!=="string"||
          !keys.some(k=>x.campaignTag.startsWith(
            "tam-"+k+"-"+data.month.slice(0,4)+data.month.slice(5,7)+"-"))||
          typeof x.campaignLabel!=="string"||x.campaignLabel.length>180||
          !nonneg(x,["earnedIssuedCents","earnedRemainingCents"])||
          x.earnedRemainingCents>x.earnedIssuedCents))
        throw new DomainError("SOURCE_LOTS_UNVERIFIED","Origem de créditos não validada.",503);
      return json(data,200,origin);
    }
    // V1.260 — source-of-truth reconciliation of wallet events vs rewards/orders.
    if(action==="owner-wallet-reconciliation"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Conciliação de recompensas restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("WALLET_RECON_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_wallet_reconciliation_v1_260",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const grant=data?.grantCohort,use=data?.settledUse,flows=data?.walletEventFlows;
      const keys=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      const nonnegative=(x:any,fields:string[])=>x&&fields.every(k=>Number.isSafeInteger(x[k])&&x[k]>=0);
      const grantKeys=["grantOrders","cashbackExpectedCents","cashbackMatchedCents",
        "cashbackUnmatchedCents","referralExpectedCents","referralMatchedCents",
        "referralUnmatchedCents","cashbackMismatchOrders","referralMismatchOrders"];
      const useKeys=["settledOrdersWithCashback","reservedInSettledOrdersCents",
        "verifiedUseCents","unverifiedUseCents","verifiedOrders","unverifiedOrders"];
      const flowKeys=["seedIssuedCents","cashbackEarnedEntriesCents",
        "cashbackReservedEntriesCents","cashbackReleasedEntriesCents",
        "cashbackReversedEntriesCents","referralPendingEntriesCents",
        "referralPendingReleasedEntriesCents","referralAvailableEntriesCents",
        "referralReversedEntriesCents"];
      if(data?.source!=="admin_owner_wallet_reconciliation_v1_260"||
         data?.timezone!=="America/Sao_Paulo"||data?.readOnly!==true||
         data?.noTransfers!==true||data?.newBenefitsEnabled!==false||
         data?.spentCreditLotAttribution!=="unavailable_fungible_wallet"||
         data?.settledOrderMatchBasis!=="wallet_reservation_and_unreversed_settlement"||
         data?.walletFlowsAreCashPayments!==false||
         data?.externalPaidBenefitsCents!==null||data?.externalPayoutMeasured!==false||
         data?.campaignAttributionIsCausal!==false||data?.bankSettlementVerified!==false||
         data?.profitMeasured!==false||data?.roiMeasured!==false||
         !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
         (month!==""&&data.month!==month)||
         !Number.isSafeInteger(data.totalCampaigns)||data.totalCampaigns<0||
         data.limit!==50||data.truncated!==(data.totalCampaigns>50)||
         !Array.isArray(data.rows)||data.rows.length>50||data.rows.length>data.totalCampaigns||
         !nonnegative(grant,grantKeys)||!nonnegative(use,useKeys)||
         !nonnegative(flows,flowKeys)||
         grant.cashbackExpectedCents!==grant.cashbackMatchedCents+grant.cashbackUnmatchedCents||
         grant.referralExpectedCents!==grant.referralMatchedCents+grant.referralUnmatchedCents||
         grant.cashbackMismatchOrders>grant.grantOrders||
         grant.referralMismatchOrders>grant.grantOrders||
         use.reservedInSettledOrdersCents!==use.verifiedUseCents+use.unverifiedUseCents||
         use.settledOrdersWithCashback!==use.verifiedOrders+use.unverifiedOrders||
         data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.allocationId||""))||
           typeof x.campaignTag!=="string"||!keys.some(k=>x.campaignTag.startsWith(
             "tam-"+k+"-"+data.month.slice(0,4)+data.month.slice(5,7)+"-"))||
           typeof x.campaignLabel!=="string"||x.campaignLabel.length>180||
           !nonnegative(x,["tracedGrantOrders","matchedCashbackIssueCents",
             "unmatchedCashbackIssueCents","matchedReferralIssueCents",
             "unmatchedReferralIssueCents","mismatchOrders"])||
           x.mismatchOrders>x.tracedGrantOrders))
        throw new DomainError("WALLET_RECON_UNVERIFIED",
          "Conciliação de carteira não validada.",503);
      return json(data,200,origin);
    }
    // V1.259 — read-only issued reward cohort and independently measured usage.
    if(action==="owner-campaign-benefit-costs"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Custos de benefícios restritos.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("BENEFIT_COSTS_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_benefit_costs_v1_259",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const cents=["cashbackGrantedCents","cashbackReversedCents","cashbackNetGrantedCents",
        "referralGrantedCents","referralReversedCents","referralNetGrantedCents",
        "cashbackUsedInSettledOrdersCents","referralMovedToAvailableCents",
        "referralAvailableReversedCents"];
      const moneyValid=(x:any)=>cents.every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)&&
        x.cashbackGrantedCents===x.cashbackReversedCents+x.cashbackNetGrantedCents&&
        x.referralGrantedCents===x.referralReversedCents+x.referralNetGrantedCents;
      const keys=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_campaign_benefit_costs_v1_259"||
         data?.readOnly!==true||data?.noTransfers!==true||
         data?.newBenefitsEnabled!==false||data?.timezone!=="America/Sao_Paulo"||
         data?.metricMeaning!=="grant_cohort_vs_settlement_activity_non_causal"||
         data?.benefitsUsedAreIssuanceCohort!==false||
         data?.campaignAttributionIsCausal!==false||data?.externalPayoutMeasured!==false||
         data?.externalPaidBenefitsCents!==null||data?.merchantReferralPaidCents!==null||
         data?.clubeCouponPaidCents!==null||data?.bankSettlementVerified!==false||
         data?.profitMeasured!==false||data?.roiMeasured!==false||
         !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
         (month!==""&&data.month!==month)||
         !Number.isSafeInteger(data.totalCampaigns)||data.totalCampaigns<0||
         data.limit!==50||data.truncated!==(data.totalCampaigns>50)||
         !Array.isArray(data.rows)||data.rows.length>50||
         data.rows.length>data.totalCampaigns||!moneyValid(data)||
         data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.allocationId||""))||
           !keys.includes(x.benefitKey)||
           typeof x.campaignTag!=="string"||
           !x.campaignTag.startsWith("tam-"+x.benefitKey+"-"+
             data.month.slice(0,4)+data.month.slice(5,7)+"-")||
           typeof x.campaignLabel!=="string"||x.campaignLabel.length>180||
           !Number.isSafeInteger(x.plannedIncentiveBudgetCents)||
           x.plannedIncentiveBudgetCents<0||
           !Number.isSafeInteger(x.attributedGrantOrders)||x.attributedGrantOrders<0||
           !["cashbackGrantedCents","cashbackReversedCents","cashbackNetGrantedCents",
             "referralGrantedCents","referralReversedCents","referralNetGrantedCents"]
             .every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
           x.cashbackGrantedCents!==x.cashbackNetGrantedCents+x.cashbackReversedCents||
           x.referralGrantedCents!==x.referralNetGrantedCents+x.referralReversedCents))
        throw new DomainError("BENEFIT_COSTS_UNVERIFIED",
          "Valores de benefícios não verificados.",503);
      return json(data,200,origin);
    }
    // V1.257: conservative financial evidence bridge, not net profit or ROI.
    if(action==="owner-campaign-financial-summary"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta financeira restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("CAMPAIGN_BRIDGE_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_financial_bridge_v1_257",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const benefits=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_campaign_financial_bridge_v1_257"||
         data?.readOnly!==true||data?.noTransfers!==true||
         data?.newBenefitsEnabled!==false||data?.cashAvailableCents!==0||
         data?.bankSettlementVerified!==false||data?.profitMeasured!==false||
         data?.roiMeasured!==false||data?.revenueAttributionIsCausal!==false||
         data?.comparisonMeaning!=="partial_difference_not_profit_not_roi"||
         data?.expenseSource!=="v1_255_owner_attested_with_v1_256_optional_document"||
         !Array.isArray(data.receiptSources)||
         data.receiptSources.length!==2||
         data.receiptSources[0]!=="v1_253_single_order_psp"||
         data.receiptSources[1]!=="v1_254_batch_order_psp"||
         !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
         (month!==""&&data.month!==month)||
         !Number.isSafeInteger(data.totalCampaigns)||data.totalCampaigns<0||
         data.limit!==50||data.truncated!==(data.totalCampaigns>50)||
         !Array.isArray(data.rows)||data.rows.length>50||
         data.rows.length>data.totalCampaigns||
         data.rows.some((x:any)=>!x||
           !UUID_RE.test(String(x.allocationId||""))||
           !benefits.some(k=>typeof x.campaignTag==="string"&&
             x.campaignTag.startsWith("tam-"+k+"-"+data.month.slice(0,4)+data.month.slice(5,7)+"-"))||
           typeof x.campaignLabel!=="string"||x.campaignLabel.length>180||
           !["plannedIncentiveBudgetCents","soloProviderFeeCents","batchProviderFeeCents",
             "providerFeeEvidenceCents","providerFeeEvidenceOrders",
             "ownerReportedMarketingSpendCents","marketingSpendWithStoredReceiptCents",
             "marketingSpendWithoutStoredReceiptCents","activeExpenseCount","storedReceiptCount"]
              .every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
           x.providerFeeEvidenceCents!==x.soloProviderFeeCents+x.batchProviderFeeCents||
           x.marketingSpendWithStoredReceiptCents+
             x.marketingSpendWithoutStoredReceiptCents!==x.ownerReportedMarketingSpendCents||
           x.storedReceiptCount>x.activeExpenseCount||
           (x.partialEvidenceDifferenceCents===null?(
             x.providerFeeEvidenceCents>0&&x.ownerReportedMarketingSpendCents>0
           ):(
             !Number.isSafeInteger(x.partialEvidenceDifferenceCents)||
             x.partialEvidenceDifferenceCents!==
               x.providerFeeEvidenceCents-x.ownerReportedMarketingSpendCents||
             x.providerFeeEvidenceCents===0||x.ownerReportedMarketingSpendCents===0
           ))||
           x.profitMeasured!==false||x.roiMeasured!==false||
           x.bankSettlementVerified!==false))
        throw new DomainError("CAMPAIGN_BRIDGE_UNVERIFIED",
          "Resumo financeiro não verificado.",503);
      return json(data,200,origin);
    }
    // V1.258 — one-object-at-a-time, founder-confirmed cleanup, append-only audit.
    if(action==="owner-orphan-cleanup-candidates"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Auditoria documental restrita.",403);
      const {data,error}=await admin.rpc("admin_owner_cleanup_candidates_v1_258",{
        p_actor:user.id
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_cleanup_candidates_v1_258"||
         data?.readOnly!==true||data?.privateBucket!==true||
         data?.noObjectPaths!==true||data?.deletionPerformed!==false||
         data?.automaticDeletionEnabled!==false||data?.minAgeHours!==24||
         !Number.isSafeInteger(data.totalCandidates)||data.totalCandidates<0||
         data.limit!==20||data.truncated!==(data.totalCandidates>20)||
         !Array.isArray(data.rows)||data.rows.length>20||
         data.rows.length>data.totalCandidates||
         data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.objectId||""))||
            !Number.isFinite(Date.parse(String(x.createdAt||"")))))
        throw new DomainError("ORPHAN_CANDIDATES_UNVERIFIED",
          "Candidatos não validados.",503);
      return json(data,200,origin);
    }
    if(action==="owner-orphan-cleanup-delete"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal remove órfãos.",403);
      const objectId=String(body.objectId??"");
      const requestId=String(body.requestId??"");
      if(!UUID_RE.test(objectId)||!UUID_RE.test(requestId)||
        body.confirm!=="EXCLUIR"){
        throw new DomainError("ORPHAN_CLEANUP_CONFIRM_REQUIRED",
          "Confirme a exclusão individual do comprovante órfão.",400);
      }
      const {data:reserved,error:reserveError}=await admin.rpc(
        "admin_owner_cleanup_reserve_v1_258",{
          p_actor:user.id,p_object:objectId,p_request:requestId
        });
      if(reserveError)throw reserveError;
      if(reserved?.source!=="admin_owner_cleanup_reserved_v1_258"||
         reserved?.reserved!==true||typeof reserved?.replayed!=="boolean"||
         reserved?.requestId!==requestId||
         typeof reserved?.objectPath!=="string"||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$/.test(reserved.objectPath))
        throw new DomainError("ORPHAN_CLEANUP_RESERVATION_INVALID",
          "Reserva de limpeza inválida.",503);
      // ONLY the Storage API removes the bytes; never delete storage.objects with SQL.
      const {error:storageError}=await admin.storage
        .from("tamao-owner-campaign-receipts-v1-256")
        .remove([reserved.objectPath]);
      if(storageError){
        // A failed removal gets a permanent outcome record. The original remains.
        try{await admin.rpc("admin_owner_cleanup_finish_v1_258",{
          p_actor:user.id,p_request:requestId,p_outcome:"failed"
        });}catch{ /* The reservation remains in audit for reconciliation. */ }
        throw new DomainError("ORPHAN_CLEANUP_STORAGE_FAILED",
          "Storage não confirmou a remoção. Arquivo preservado para conferência.",503);
      }
      const {data:finished,error:finishedError}=await admin.rpc(
        "admin_owner_cleanup_finish_v1_258",{
          p_actor:user.id,p_request:requestId,p_outcome:"absent_confirmed"
        });
      if(finishedError)throw finishedError;
      if(finished?.source!=="admin_owner_cleanup_finished_v1_258"||
         finished?.outcome!=="absent_confirmed"||
         finished?.recorded!==true||typeof finished?.replayed!=="boolean")
        throw new DomainError("ORPHAN_CLEANUP_AUDIT_UNVERIFIED",
          "A remoção não foi comprovada no registro de auditoria.",503);
      return json({
        source:"admin_owner_cleanup_deleted_v1_258",
        objectAbsentConfirmed:true,oneObjectOnly:true,
        automaticDeletionEnabled:false,auditRecorded:true,
        linkedReceiptDeleted:false,objectPathsExposed:false
      },200,origin);
    }
    if(action==="owner-campaign-orphan-audit"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Auditoria de documentos restrita.",403);
      const {data,error}=await admin.rpc("admin_owner_campaign_receipt_orphans_v1_257",{
        p_actor:user.id
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_campaign_receipt_orphans_v1_257"||
         data?.readOnly!==true||data?.deletionPerformed!==false||
         data?.automaticDeletionEnabled!==false||data?.privateBucket!==true||
         data?.bankVerified!==false||data?.noObjectPaths!==true||
         data?.minAgeHours!==24||
         !["bucketObjects","linkedObjects","recentUnlinkedObjects",
           "reviewCandidatesAfter24h","unexpectedPathObjects"]
           .every(k=>Number.isSafeInteger(data[k])&&data[k]>=0)||
         data.linkedObjects+data.recentUnlinkedObjects+
           data.reviewCandidatesAfter24h!==data.bucketObjects||
         data.unexpectedPathObjects>data.bucketObjects)
        throw new DomainError("RECEIPT_ORPHAN_AUDIT_UNVERIFIED",
          "Auditoria privada não validada.",503);
      return json(data,200,origin);
    }
    if(action==="owner-campaign-cost-read"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta financeira restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("OWNER_COST_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_cost_read_v1_255",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const keys=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_campaign_cost_read_v1_255"||
         data?.evidenceLevel!=="owner_attested_proof_reference_not_bank_verified"||
         data?.readOnly!==true||data?.bankVerified!==false||
         data?.receiptFileUploaded!==false||data?.roiMeasured!==false||
         data?.cashMoved!==false||data?.incentiveBudgetDebited!==false||
         data?.newBenefitsEnabled!==false||
         !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
         (month!==""&&month!==data.month)||
         !Number.isSafeInteger(data.totalCampaigns)||data.totalCampaigns<0||
         data.campaignLimit!==50||typeof data.campaignTruncated!=="boolean"||
         data.campaignTruncated!==(data.totalCampaigns>50)||
         !Array.isArray(data.campaigns)||data.campaigns.length>50||
         data.campaigns.length>data.totalCampaigns||
         !Number.isSafeInteger(data.totalExpenses)||data.totalExpenses<0||
         data.expenseLimit!==100||typeof data.expenseTruncated!=="boolean"||
         data.expenseTruncated!==(data.totalExpenses>100)||
         !Array.isArray(data.expenses)||data.expenses.length>100||
         data.expenses.length>data.totalExpenses||
         data.campaigns.some((c:any)=>!c||!UUID_RE.test(String(c.allocationId||""))||
           !keys.some(k=>typeof c.campaignTag==="string"&&c.campaignTag.startsWith(
             "tam-"+k+"-"+data.month.slice(0,4)+data.month.slice(5,7)+"-"))||
           typeof c.campaignLabel!=="string"||c.campaignLabel.length>180||
           !["allocated","released"].includes(c.status)||
           !["incentivePlannedCents","ownerReportedPaidMarketingCents","activeExpenses","voidedExpenses"]
             .every(k=>Number.isSafeInteger(c[k])&&c[k]>=0))||
         data.expenses.some((x:any)=>!x||!UUID_RE.test(String(x.expenseId||""))||
           !UUID_RE.test(String(x.allocationId||""))||
           !Number.isSafeInteger(x.amountCents)||x.amountCents<100||x.amountCents>5000000||
           !/^\d{4}-\d{2}-\d{2}$/.test(String(x.paidOn||""))||
           !["pix","bank_transfer","card","cash","other"].includes(x.paymentMethod)||
           typeof x.proofReference!=="string"||x.proofReference.length>120||
           typeof x.description!=="string"||x.description.length>240||
           !Number.isFinite(Date.parse(String(x.recordedAt||"")))||
           !["owner_attested","voided"].includes(x.status)||
           (x.status==="voided"&&(!Number.isFinite(Date.parse(String(x.voidedAt||"")))||
             typeof x.voidReason!=="string"||x.voidReason.length<12))))
        throw new DomainError("OWNER_COST_READ_UNVERIFIED","Gastos de campanha não verificados.",503);
      return json(data,200,origin);
    }
    if(action==="owner-campaign-cost-record"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal registra gastos.",403);
      const expenseId=String(body.expenseId??"");
      const allocationId=String(body.allocationId??"");
      const requestId=String(body.requestId??"");
      const amountCents=body.amountCents;
      const paidOn=String(body.paidOn??"");
      const method=String(body.paymentMethod??"");
      const reference=String(body.proofReference??"").trim();
      const description=String(body.description??"").trim();
      if(![expenseId,allocationId,requestId].every(id=>UUID_RE.test(id))||
         !Number.isSafeInteger(amountCents)||amountCents<100||amountCents>5000000||
         !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)||
         !["pix","bank_transfer","card","cash","other"].includes(method)||
         !/^[A-Za-z0-9 .:/_-]{12,120}$/.test(reference)||
         description.length<12||description.length>240)
        throw new DomainError("OWNER_COST_RECORD_INVALID","Revise os dados do gasto e o comprovante.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_cost_record_v1_255",{
        p_actor:user.id,p_expense:expenseId,p_allocation:allocationId,
        p_amount:amountCents,p_paid_on:paidOn,p_method:method,
        p_reference:reference,p_description:description,p_request:requestId
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_campaign_cost_record_v1_255"||
         data?.recorded!==true||typeof data?.replayed!=="boolean"||
         data?.status!=="owner_attested"||data?.bankVerified!==false||
         data?.receiptFileUploaded!==false||data?.cashMoved!==false||
         data?.incentiveBudgetDebited!==false||data?.newBenefitsEnabled!==false)
        throw new DomainError("OWNER_COST_RECORD_UNVERIFIED","Registro não confirmado pelo banco.",503);
      return json(data,200,origin);
    }
    if(action==="owner-campaign-cost-void"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal corrige lançamentos.",403);
      const expenseId=String(body.expenseId??"");
      const requestId=String(body.requestId??"");
      const reason=String(body.reason??"").trim();
      if(!UUID_RE.test(expenseId)||!UUID_RE.test(requestId)||
         reason.length<12||reason.length>240)
        throw new DomainError("OWNER_COST_VOID_INVALID","Motivo de correção inválido.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_cost_void_v1_255",{
        p_actor:user.id,p_expense:expenseId,p_reason:reason,p_request:requestId
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_campaign_cost_void_v1_255"||
         data?.recorded!==true||typeof data?.replayed!=="boolean"||
         data?.status!=="voided"||data?.cashMoved!==false||
         data?.bankVerified!==false||data?.incentiveBudgetDebited!==false||
         data?.newBenefitsEnabled!==false)
        throw new DomainError("OWNER_COST_VOID_UNVERIFIED","Correção não confirmada pelo banco.",503);
      return json(data,200,origin);
    }
    if(action==="owner-campaign-batch-ledger"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta financeira restrita.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("OWNER_BATCH_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_batch_ledger_v1_254",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const keys=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_campaign_batch_ledger_v1_254"||
        data?.evidenceLevel!=="psp_paid_statement_balances_exact_all_lines_no_refunds"||
        data?.readOnly!==true||data?.noTransfers!==true||
        data?.batchOnly!==true||data?.noDoubleCountingWithV253!==true||
        data?.cashAvailableCents!==0||data?.newBenefitsEnabled!==false||
        data?.bankSettlementVerified!==false||data?.roiMeasured!==false||
        data?.paidMarketingCostCents!==null||
        !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
        (month!==""&&month!==data.month)||
        !Number.isSafeInteger(data.totalCampaigns)||data.totalCampaigns<0||
        data.limit!==50||typeof data.truncated!=="boolean"||
        data.truncated!==(data.totalCampaigns>50)||
        !Array.isArray(data.rows)||data.rows.length>50||
        data.rows.length>data.totalCampaigns||
        data.rows.some((x:any)=>!x||
          !UUID_RE.test(String(x.allocationId||""))||
          !keys.some(k=>typeof x.campaignTag==="string"&&
            x.campaignTag.startsWith("tam-"+k+"-"+data.month.slice(0,4)+data.month.slice(5,7)+"-"))||
          !["verifiedBatchOrders","verifiedBatchStatements","providerSupportedNetFeeCents"]
            .every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
          x.verifiedBatchStatements>x.verifiedBatchOrders||
          (x.verifiedBatchOrders===0&&x.providerSupportedNetFeeCents!==0)||
          x.entrySource!=="receivable_net_fee_statement_exact_payment_event"||
          x.bankSettlementVerified!==false||x.roiMeasured!==false||
          x.cashAvailableCents!==0||x.paidMarketingCostCents!==null))
        throw new DomainError("OWNER_BATCH_LEDGER_UNVERIFIED","Conciliação por pedido não verificada.",503);
      return json(data,200,origin);
    }
    if(action==="owner-campaign-fee-receipts"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta restrita ao financeiro.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("OWNER_FEE_RECEIPTS_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_fee_receipts_v1_253",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const keys=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_campaign_fee_receipts_v1_253"||
         data?.evidenceLevel!=="provider_event_applied_single_order_statement_no_refund"||
         data?.readOnly!==true||data?.noTransfers!==true||
         data?.spendableCents!==0||data?.newBenefitsEnabled!==false||
         data?.bankSettlementVerified!==false||data?.roiMeasured!==false||
         data?.marketingSpendPaidCents!==null||
         !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
         (month!==""&&data.month!==month)||
         !Number.isSafeInteger(data.totalCampaigns)||data.totalCampaigns<0||
         data.limit!==50||typeof data.truncated!=="boolean"||
         data.truncated!==(data.totalCampaigns>50)||
         !Array.isArray(data.rows)||data.rows.length>50||
         data.rows.length>data.totalCampaigns||
         data.rows.some((x:any)=>!x||
           !UUID_RE.test(String(x.allocationId||""))||
           !keys.some(k=>typeof x.campaignTag==="string"&&
             x.campaignTag.startsWith("tam-"+k+"-"+data.month.slice(0,4)+data.month.slice(5,7)+"-"))||
           !["attributedOrders","providerConfirmedOrders","providerConfirmedFeeCents","notIndividuallyProvenOrders"]
             .every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
           x.providerConfirmedOrders+x.notIndividuallyProvenOrders!==x.attributedOrders||
           (x.providerConfirmedOrders===0&&x.providerConfirmedFeeCents!==0)||
           x.bankSettlementVerified!==false||x.roiMeasured!==false||
           x.marketingSpendPaidCents!==null))
        throw new DomainError("OWNER_FEE_RECEIPTS_UNVERIFIED","Conciliação de taxas não verificada.",503);
      return json(data,200,origin);
    }
    if(action==="owner-campaign-orders"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Acesso financeiro restrito.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("CAMPAIGN_ORDER_MONTH_INVALID","Competência inválida.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_orders_v1_252",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const keys=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_campaign_orders_v1_252"||
        data?.metricMeaning!=="first_party_checkout_utm_non_causal_attribution"||
        data?.readOnly!==true||data?.plannedOnly!==true||data?.noCharge!==true||
        data?.spendableCents!==0||data?.newBenefitsEnabled!==false||
        data?.platformReceivedRevenueCents!==null||data?.financialReturnMeasured!==false||
        !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
        (month!==""&&data.month!==month)||
        !Number.isSafeInteger(data.totalCampaigns)||data.totalCampaigns<0||
        data.limit!==50||typeof data.truncated!=="boolean"||
        data.truncated!==(data.totalCampaigns>50)||
        !Array.isArray(data.rows)||data.rows.length>50||
        data.rows.length>data.totalCampaigns||
        data.rows.some((x:any)=>!x||
          !UUID_RE.test(String(x.allocationId||""))||
          !keys.some(k=>typeof x.campaignTag==="string"&&
            x.campaignTag.startsWith("tam-"+k+"-"+data.month.slice(0,4)+data.month.slice(5,7)+"-"))||
          !["createdOrders","settledOrders","reversedOrders","settledMerchantOrderValueCents"]
            .every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
          x.settledOrders+x.reversedOrders>x.createdOrders||
          x.platformReceivedRevenueCents!==null||x.financialReturnMeasured!==false))
        throw new DomainError("CAMPAIGN_ORDERS_UNVERIFIED","Indicadores de pedidos não verificados.",503);
      return json(data,200,origin);
    }
    if(action==="owner-campaign-signals"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Sinais restritos à gestão financeira.",403);
      const month=String(body.month??"");
      if(month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new DomainError("OWNER_CAMPAIGN_MONTH_INVALID","Mês da campanha inválido.",400);
      const {data,error}=await admin.rpc("admin_owner_campaign_signals_v1_251",{
        p_actor:user.id,p_month:month||null
      });
      if(error)throw error;
      const validKeys=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_campaign_signals_v1_251"||
         data?.readOnly!==true||data?.plannedOnly!==true||
         data?.noCharge!==true||data?.bankApiConfirmed!==false||
         data?.spendableCents!==0||data?.newBenefitsEnabled!==false||
         data?.revenueAttributedCents!==null||data?.returnOnInvestmentMeasured!==false||
         data?.measurementUnit!=="first_party_event_counts_not_unique_people"||
         data?.limit!==50||!Number.isSafeInteger(data?.totalCampaigns)||data.totalCampaigns<0||
         typeof data?.truncated!=="boolean"||
         data.truncated!==(data.totalCampaigns>50)||
         !/^\d{4}-\d{2}-01$/.test(String(data?.month||""))||
         (month!==""&&month!==data.month)||
         !Number.isSafeInteger(data?.unattributedLandingViews)||data.unattributedLandingViews<0||
         !Number.isSafeInteger(data?.unattributedFormViews)||data.unattributedFormViews<0||
         !Array.isArray(data.rows)||data.rows.length>50||
         data.rows.length>data.totalCampaigns||
         data.rows.some((x:any)=>!x||
           !UUID_RE.test(String(x.allocationId||""))||
           !validKeys.includes(x.benefitKey)||
           x.month!==data.month||
           !/^[a-z0-9_-]{8,80}$/.test(String(x.campaignReference||""))||
           x.campaignTag!==("tam-"+x.benefitKey+"-"+x.month.slice(0,4)+x.month.slice(5,7)+"-"+x.campaignReference)||
           typeof x.campaignLabel!=="string"||x.campaignLabel.length<12||x.campaignLabel.length>180||
           !["allocated","released"].includes(x.status)||
           !Number.isSafeInteger(x.plannedAllocationCents)||x.plannedAllocationCents<100||
           x.plannedAllocationCents>50000000||
           !Number.isFinite(Date.parse(String(x.createdAt||"")))||
           (x.releasedAt!==null&&!Number.isFinite(Date.parse(String(x.releasedAt))))||
           !["landingViews","formViews","leads","customerLeads","merchantLeads",
             "qualifiedLeads","crmConvertedLeads"].every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
           x.customerLeads+x.merchantLeads!==x.leads||
           x.qualifiedLeads>x.leads||x.crmConvertedLeads>x.leads||
           x.attributionScope!=="first_party_utm_tag_within_month_and_allocation_window"||
           x.returnOnInvestmentMeasured!==false||x.revenueAttributedCents!==null))
        throw new DomainError("OWNER_CAMPAIGN_SIGNALS_UNVERIFIED","Sinais de campanha não validados.",503);
      return json(data,200,origin);
    }
    if(action==="owner-finance-history"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Histórico restrito ao financeiro.",403);
      const month=String(body.month??"");
      const benefit=String(body.benefitKey??"");
      const kind=String(body.kind??"all");
      const event=String(body.eventType??"all");
      const offset=body.offset??0;
      const benefits=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      const types=["all","contribution_submitted","contribution_manual_reconciled",
       "contribution_rejected","contribution_disputed","campaign_allocated","campaign_released"];
      if((month!==""&&!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))||
         (benefit!==""&&!benefits.includes(benefit))||
         !["all","contribution","campaign"].includes(kind)||
         !types.includes(event)||!Number.isSafeInteger(offset)||
         offset<0||offset>10000||offset%20!==0)
        throw new DomainError("OWNER_HISTORY_FILTER_INVALID","Confira os filtros do histórico.",400);
      const {data,error}=await admin.rpc("admin_owner_finance_history_v1_250",{
        p_actor:user.id,p_month:month||null,p_benefit:benefit||null,
        p_kind:kind,p_event:event,p_offset:offset
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_finance_history_v1_250"||
         data?.readOnly!==true||data?.bankApiConfirmed!==false||
         data?.fundsSpendable!==false||data?.spendableCents!==0||
         data?.newBenefitsEnabled!==false||data?.cashMoved!==false||
         data?.month!==(month||null)||data?.benefitKey!==(benefit||null)||
         data?.kind!==kind||data?.eventType!==event||data?.offset!==offset||
         data?.pageSize!==20||!Number.isSafeInteger(data?.total)||data.total<0||
         !Array.isArray(data.rows)||data.rows.length>20||
         data.rows.length>Math.max(0,data.total-offset)||
         data.rows.some((x:any)=>!x||
          !UUID_RE.test(String(x.eventId||""))||
          !UUID_RE.test(String(x.actorId||""))||
          !benefits.includes(x.benefitKey)||
          !["contribution","campaign"].includes(x.kind)||
          !types.slice(1).includes(x.eventType)||
          !Number.isSafeInteger(x.amountCents)||x.amountCents<100||
          !Number.isSafeInteger(x.fromVersion)||x.fromVersion<0||
          !Number.isSafeInteger(x.toVersion)||x.toVersion<=x.fromVersion||
          !Number.isFinite(Date.parse(String(x.createdAt||"")))||
          typeof x.note!=="string"||x.note.length>300||
          (x.campaignLabel!==null&&(typeof x.campaignLabel!=="string"||
             x.campaignLabel.length>180))||
          (x.campaignMonth!==null&&!/^\d{4}-\d{2}-01$/.test(x.campaignMonth))))
        throw new DomainError("OWNER_HISTORY_UNVERIFIED","Histórico financeiro não verificado.",503);
      return json(data,200,origin);
    }
    if(action==="owner-budget-queue"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Acesso apenas ao planejamento financeiro.",403);
      const {data,error}=await admin.rpc("admin_owner_budget_queue_v1_247",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_owner_budget_queue_v1_247"||
        data?.readOnly!==true||data?.plannedOnly!==true||
        data?.verifiedCashCents!==0||data?.spendableCents!==0||
        data?.newBenefitsEnabled!==false||data?.noCharge!==true||
        !Array.isArray(data?.rows)||data.rows.length!==12||
        !Array.isArray(data?.allocations)||data.allocations.length>50||
        !Number.isSafeInteger(data?.totalAllocations)||data.totalAllocations<0||
        data.allocations.length>data.totalAllocations||
        new Set(data.rows.map((x:any)=>x.benefitKey+":"+x.month)).size!==12||
        data.rows.some((x:any)=>!x||
          !["customer_cashback","customer_referral","merchant_referral","clube_coupons"].includes(x.benefitKey)||
          !/^\d{4}-\d{2}-01$/.test(String(x.month||""))||
          !Number.isSafeInteger(x.planVersion)||x.planVersion<0||
          !["planning","internally_committed"].includes(x.planStatus)||
          !Number.isSafeInteger(x.plannedCents)||x.plannedCents<0||x.plannedCents>50000000||
          !Number.isSafeInteger(x.allocatedCents)||x.allocatedCents<0||
          !Number.isSafeInteger(x.unallocatedCents)||x.unallocatedCents<0||
          x.unallocatedCents!==Math.max(0,x.plannedCents-x.allocatedCents)||
          typeof x.coverageExceeded!=="boolean")||
        data.allocations.some((x:any)=>!x||
          !UUID_RE.test(String(x.allocationId||""))||
          !["customer_cashback","customer_referral","merchant_referral","clube_coupons"].includes(x.benefitKey)||
          !/^\d{4}-\d{2}-01$/.test(String(x.month||""))||
          !/^[a-z0-9_-]{8,80}$/.test(String(x.campaignReference||""))||
          typeof x.campaignLabel!=="string"||x.campaignLabel.length>180||
          !["allocated","released"].includes(x.status)||
          !Number.isSafeInteger(x.amountCents)||x.amountCents<100||x.amountCents>50000000||
          !Number.isSafeInteger(x.planVersion)||x.planVersion<1||
          ![1,2].includes(x.version)||
          !Number.isFinite(Date.parse(x.createdAt||""))))
        throw new DomainError("OWNER_BUDGET_QUEUE_UNVERIFIED","Planejamento não confirmado pelo banco.",503);
      return json(data,200,origin);
    }
    if(action==="owner-budget-allocate"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal distribui os orçamentos.",403);
      const key=String(body.benefitKey??"");
      const month=String(body.month??"");
      const reference=String(body.campaignReference??"").trim();
      const label=String(body.campaignLabel??"").trim();
      if(!["customer_cashback","customer_referral","merchant_referral","clube_coupons"].includes(key)||
        !/^\d{4}-\d{2}-01$/.test(month)||
        !/^[a-z0-9_-]{8,80}$/.test(reference)||
        label.length<12||label.length>180||
        !Number.isSafeInteger(body.amountCents)||body.amountCents<100||body.amountCents>50000000||
        !Number.isSafeInteger(body.planVersion)||body.planVersion<1)
        throw new DomainError("OWNER_BUDGET_ALLOCATION_INVALID","Confira valor, mês, campanha e orçamento.",400);
      const {data,error}=await admin.rpc("admin_owner_budget_allocate_v1_247",{
        p_actor:user.id,p_allocation:uuid(body.allocationId,"allocationId"),
        p_benefit:key,p_month:month,p_reference:reference,
        p_label:label,p_amount:body.amountCents,
        p_plan_version:body.planVersion,p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_budget_allocate_v1_247"||
        data?.recorded!==true||typeof data.replayed!=="boolean"||
        data?.plannedOnly!==true||data?.noCharge!==true||
        data?.fundsVerified!==false||data?.spendableCents!==0||
        data?.newBenefitsEnabled!==false)
        throw new DomainError("OWNER_BUDGET_ALLOCATION_UNVERIFIED","Alocação não confirmada.",503);
      return json(data,200,origin);
    }
    if(action==="owner-budget-release"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal libera orçamentos.",403);
      const reason=String(body.reason??"").trim();
      if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion!==1||
        reason.length<12||reason.length>240)
        throw new DomainError("OWNER_BUDGET_RELEASE_INVALID","Informe a justificativa e a versão atual.",400);
      const {data,error}=await admin.rpc("admin_owner_budget_release_v1_247",{
        p_actor:user.id,p_allocation:uuid(body.allocationId,"allocationId"),
        p_version:body.expectedVersion,p_reason:reason,
        p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_budget_release_v1_247"||
        data?.recorded!==true||typeof data.replayed!=="boolean"||
        data?.plannedOnly!==true||data?.noCharge!==true||
        data?.fundsVerified!==false||data?.spendableCents!==0||
        data?.newBenefitsEnabled!==false)
        throw new DomainError("OWNER_BUDGET_RELEASE_UNVERIFIED","Liberação não confirmada.",503);
      return json(data,200,origin);
    }
    if(action==="owner-evidence-queue"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente finanças pode consultar os comprovantes.",403);
      const {data,error}=await admin.rpc("admin_owner_evidence_queue_v1_246",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_owner_evidence_queue_v1_246"||
        data?.bankApiConfirmed!==false||data?.fundsSpendable!==false||
        data?.spendableCents!==0||data?.newBenefitsEnabled!==false||
        data?.cashMoved!==false||data?.readOnly!==true||
        !Number.isSafeInteger(data?.total)||data.total<0||
        !Number.isSafeInteger(data?.pendingCount)||data.pendingCount<0||
        !Number.isSafeInteger(data?.manualReconciledCents)||data.manualReconciledCents<0||
        !Number.isSafeInteger(data?.disputedCents)||data.disputedCents<0||
        !Array.isArray(data?.rows)||data.rows.length>50||data.rows.length>data.total||
        data.rows.some((x:any)=>!x||
         !UUID_RE.test(String(x.contributionId||""))||
         !UUID_RE.test(String(x.submittedBy||""))||
         !["customer_cashback","customer_referral","merchant_referral","clube_coupons"].includes(x.benefitKey)||
         !["pending_review","manual_reconciled","rejected","disputed"].includes(x.status)||
         !Number.isSafeInteger(x.planVersion)||x.planVersion<1||
         !Number.isSafeInteger(x.amountCents)||x.amountCents<100||
         x.amountCents>50000000||
         !Number.isSafeInteger(x.version)||x.version<1||
         typeof x.transferReference!=="string"||x.transferReference.length>100||
         typeof x.note!=="string"||x.note.length>300||
         (x.reviewNote!==null&&(typeof x.reviewNote!=="string"||x.reviewNote.length>300))||
         (x.statementReference!==null&&(typeof x.statementReference!=="string"||x.statementReference.length>100))||
         x.fundsSpendable!==false||x.bankApiConfirmed!==false||
         !Number.isFinite(Date.parse(x.submittedAt||""))||
         (x.reviewedAt!==null&&!Number.isFinite(Date.parse(x.reviewedAt)))))
        throw new DomainError("OWNER_EVIDENCE_QUEUE_INVALID","Conferência de aportes não validada.",503);
      return json(data,200,origin);
    }
    if(action==="owner-evidence-submit"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Acesso reservado a finanças.",403);
      const key=String(body.benefitKey??"");
      const reference=String(body.transferReference??"").trim();
      const note=String(body.note??"").trim();
      const date=String(body.transferDate??"");
      if(!["customer_cashback","customer_referral","merchant_referral","clube_coupons"].includes(key)||
         !Number.isSafeInteger(body.planVersion)||body.planVersion<1||
         !Number.isSafeInteger(body.amountCents)||body.amountCents<100||
         body.amountCents>50000000||
         !/^\d{4}-\d{2}-\d{2}$/.test(date)||
         !/^[a-zA-Z0-9 .:_-]{12,100}$/.test(reference)||
         note.length<12||note.length>300)
         throw new DomainError("OWNER_EVIDENCE_SUBMIT_INVALID","Revise data, valor, referência e justificativa.",400);
      const {data,error}=await admin.rpc("admin_owner_evidence_submit_v1_246",{
        p_actor:user.id,p_contribution:uuid(body.contributionId,"contributionId"),
        p_benefit:key,p_plan_version:body.planVersion,
        p_amount:body.amountCents,p_date:date,
        p_reference:reference,p_note:note,p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_evidence_submit_v1_246"||data.recorded!==true||
         data.status!=="pending_review"||data.bankApiConfirmed!==false||
         data.fundsSpendable!==false||data.newBenefitsEnabled!==false||
         data.cashMoved!==false||typeof data.replayed!=="boolean")
         throw new DomainError("OWNER_EVIDENCE_SUBMIT_UNVERIFIED","Registro não confirmado.",503);
      return json(data,200,origin);
    }
    if(action==="owner-evidence-review"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","A revisão requer perfil financeiro.",403);
      const status=String(body.reviewStatus??"");
      const note=String(body.note??"").trim();
      const ref=String(body.statementReference??"").trim();
      if(!["manual_reconciled","rejected","disputed"].includes(status)||
         !Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1||
         note.length<12||note.length>300||
         (status==="manual_reconciled"&&!/^[a-zA-Z0-9 .:_-]{12,100}$/.test(ref))||
         (status!=="manual_reconciled"&&ref.length>0))
        throw new DomainError("OWNER_EVIDENCE_REVIEW_INVALID","Revise a conferência e sua referência.",400);
      const {data,error}=await admin.rpc("admin_owner_evidence_review_v1_246",{
        p_actor:user.id,p_contribution:uuid(body.contributionId,"contributionId"),
        p_action:status,p_expected_version:body.expectedVersion,
        p_note:note,p_statement_reference:ref||null,
        p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_evidence_review_v1_246"||data.recorded!==true||
         data.reviewStatus!==status||data.bankApiConfirmed!==false||
         data.fundsSpendable!==false||data.newBenefitsEnabled!==false||
         data.cashMoved!==false||typeof data.replayed!=="boolean")
         throw new DomainError("OWNER_EVIDENCE_REVIEW_UNVERIFIED","Revisão não confirmada.",503);
      return json(data,200,origin);
    }
    if(action==="owner-funding-pulse"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Acesso restrito às finanças.",403);
      const {data,error}=await admin.rpc("admin_owner_funding_pulse_v1_245",{p_actor:user.id});
      if(error)throw error;
      const expected=["customer_cashback","customer_referral","merchant_referral","clube_coupons"];
      if(data?.source!=="admin_owner_funding_pulse_v1_245"||
        data?.timezone!=="America/Sao_Paulo"||
        data?.metricMeaning!=="grants_created_this_month_not_bank_spending"||
        data?.budgetMeaning!=="owner_plan_not_funds_deposited"||
        data?.readOnly!==true||data?.noCharge!==true||
        data?.moneyReservedCents!==0||data?.verifiedDepositCents!==0||
        data?.payoutsMeasured!==false||data?.newBenefitsActivated!==false||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(data?.monthStart||""))||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(data?.periodEndExclusive||""))||
        !Number.isSafeInteger(data?.grantsCount)||data.grantsCount<0||
        !Number.isSafeInteger(data?.reversedGrantsCount)||
        data.reversedGrantsCount<0||data.reversedGrantsCount>data.grantsCount||
        !Array.isArray(data?.rows)||data.rows.length!==4||
        new Set(data.rows.map((x:any)=>x.benefitKey)).size!==4||
        data.rows.some((x:any)=>!x||!expected.includes(x.benefitKey)||
          !Number.isSafeInteger(x.planVersion)||x.planVersion<0||
          !["planning","internally_committed"].includes(x.planStatus)||
          !Number.isSafeInteger(x.plannedBudgetCents)||x.plannedBudgetCents<0||
          !Number.isSafeInteger(x.perPersonCapCents)||x.perPersonCapCents<0||
          x.perPersonCapCents>x.plannedBudgetCents||
          !Number.isSafeInteger(x.grossGrantedCents)||x.grossGrantedCents<0||
          !Number.isSafeInteger(x.reversedGrantedCents)||x.reversedGrantedCents<0||
          x.reversedGrantedCents>x.grossGrantedCents||
          !Number.isSafeInteger(x.netGrantedCents)||
          x.netGrantedCents!==x.grossGrantedCents-x.reversedGrantedCents||
          typeof x.policyEnabled!=="boolean"||
          !["budget_not_defined","gross_exceeds_plan","near_planned_limit","within_planned_limit"].includes(x.planningSignal)||
          (x.grossVsPlannedPct!==null&&(!Number.isFinite(x.grossVsPlannedPct)||x.grossVsPlannedPct<0))||
          (["merchant_referral","clube_coupons"].includes(x.benefitKey)&&
           (x.grossGrantedCents!==0||x.reversedGrantedCents!==0))))
        throw new DomainError("OWNER_PULSE_UNVERIFIED",
          "Indicadores de incentivos não confirmados pelo servidor.",503);
      return json(data,200,origin);
    }
    if(action==="owner-funding-read"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Acesso limitado ao financeiro.",403);
      const {data,error}=await admin.rpc("admin_owner_funding_read_v1_244",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_owner_funding_read_v1_244"||
         data?.fundingSource!=="platform_owner"||data?.scope!=="monthly"||
         data?.newBenefitsEnabled!==false||data?.noCharge!==true||
         data?.readOnly!==true||data?.verifiedDepositCents!==0||
         data?.moneyReservedCents!==0||data?.moneyPaidCents!==0||
         !Array.isArray(data?.rows)||data.rows.length!==4||
         new Set(data.rows.map((x:any)=>x.benefitKey)).size!==4||
         data.rows.some((x:any)=>!x||
           !["customer_cashback","customer_referral","merchant_referral","clube_coupons"].includes(x.benefitKey)||
           !Number.isSafeInteger(x.budgetCents)||x.budgetCents<0||x.budgetCents>50000000||
           !Number.isSafeInteger(x.capCents)||x.capCents<0||x.capCents>x.budgetCents||
           !["planning","internally_committed"].includes(x.status)||
           !Number.isSafeInteger(x.version)||x.version<0||
           typeof x.note!=="string"||x.note.length>400))
        throw new DomainError("OWNER_FUNDING_UNVERIFIED","Planejamento financeiro não validado.",503);
      return json(data,200,origin);
    }
    if(action==="owner-funding-save"){
      if(String(adminAccess.admin_role)!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal pode assumir o orçamento.",403);
      const key=String(body.benefitKey??"");
      const status=String(body.status??"");
      const note=String(body.note??"").trim();
      if(!["customer_cashback","customer_referral","merchant_referral","clube_coupons"].includes(key)||
         !["planning","internally_committed"].includes(status)||
         !Number.isSafeInteger(body.budgetCents)||body.budgetCents<0||body.budgetCents>50000000||
         !Number.isSafeInteger(body.capCents)||body.capCents<0||body.capCents>10000000||
         body.capCents>body.budgetCents||
         (status==="internally_committed"&&(body.budgetCents===0||body.capCents===0))||
         note.length<12||note.length>400||
         !Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||
         body.expectedVersion>2147483645)
         throw new DomainError("OWNER_FUNDING_INVALID","Revise os valores e a justificativa.",400);
      const {data,error}=await admin.rpc("admin_owner_funding_save_v1_244",{
         p_actor:user.id,p_benefit:key,p_budget:body.budgetCents,p_cap:body.capCents,
         p_status:status,p_note:note,p_expected_version:body.expectedVersion,
         p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_owner_funding_save_v1_244"||
         data?.recorded!==true||data?.noExternalCommitment!==true||
         data?.newBenefitsEnabled!==false||
         data?.verifiedDepositCents!==0||data?.moneyReservedCents!==0||
         data?.moneyPaidCents!==0||typeof data.changed!=="boolean"||
         typeof data.replayed!=="boolean")
        throw new DomainError("OWNER_FUNDING_SAVE_UNVERIFIED","A reserva planejada não foi registrada.",503);
      return json(data,200,origin);
    }
    if(action==="clube-terms-queue"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Sem acesso às condições do Clube.",403);
      const {data,error}=await admin.rpc("admin_clube_terms_queue_v1_242",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_clube_terms_queue_v1_242"||
         data?.readOnly!==true||data?.noContractsSigned!==true||
         data?.fundingVerifiedCents!==0||data?.couponSalesEnabled!==false||
         data?.noCharge!==true||data?.moneyReservedCents!==0||
         !Number.isSafeInteger(data?.totalReviews)||data.totalReviews<0||
         !Array.isArray(data?.rows)||data.rows.length>50||data.rows.length>data.totalReviews||
         data.rows.some((x:any)=>!x||!UUID_RE.test(String(x.merchantId||""))||
           !["gas_3x5","water_5x2"].includes(x.packageKey)||
           typeof x.companyName!=="string"||x.companyName.length>120||
           typeof x.city!=="string"||x.city.length>100||
           !/^[A-Z]{2}$/.test(String(x.state||""))||
           !Number.isSafeInteger(x.interestVersion)||x.interestVersion<1||
           !Number.isSafeInteger(x.reviewVersion)||x.reviewVersion<1||
           !Number.isSafeInteger(x.termsVersion)||x.termsVersion<0||
           !Number.isSafeInteger(x.merchantShareBps)||x.merchantShareBps<0||
           !Number.isSafeInteger(x.merchantBudgetCents)||x.merchantBudgetCents<0||
           !Number.isSafeInteger(x.brandShareBps)||x.brandShareBps<0||
           (x.currentTerms&&x.brandShareBps+x.merchantShareBps>10000)||
           !Number.isSafeInteger(x.brandBudgetCents)||x.brandBudgetCents<0||
           !Number.isSafeInteger(x.platformBudgetCents)||x.platformBudgetCents<0||
           (x.termsStatus!==null&&!["draft","shared_for_discussion","withdrawn"].includes(x.termsStatus))||
           !["not_requested","requested","supplied_unverified"].includes(x.identityDocumentStatus)||
           !["not_requested","requested","supplied_unverified"].includes(x.agreementDocumentStatus)||
           !["not_requested","requested","supplied_unverified"].includes(x.fundingDocumentStatus)||
           (x.notes!==null&&(typeof x.notes!=="string"||x.notes.length>500))||
           !["none","read_for_discussion","not_interested"].includes(x.merchantResponse)||
           !Number.isSafeInteger(x.merchantResponseVersion)||x.merchantResponseVersion<0||
           typeof x.currentInterest!=="boolean"||typeof x.currentReview!=="boolean"||
           typeof x.currentTerms!=="boolean"||
           (x.capacity!==null&&(!Number.isSafeInteger(x.capacity.maxPackagesIllustrative)||
             x.capacity.maxPackagesIllustrative<0||
             x.capacity.fundingVerified!==false||x.capacity.financiallyReady!==false))))
        throw new DomainError("CLUBE_TERMS_QUEUE_UNVERIFIED","Não foi possível verificar as propostas.",503);
      return json(data,200,origin);
    }
    if(action==="clube-terms-save"){
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Apenas finanças pode preparar as condições.",403);
      const documents=["identityDocumentStatus","agreementDocumentStatus","fundingDocumentStatus"] as const;
      const allowedDocs=["not_requested","requested","supplied_unverified"];
      const packageKey=String(body.packageKey??"");
      const status=String(body.status??"");
      const note=String(body.note??"").trim();
      if(!["gas_3x5","water_5x2"].includes(packageKey)||
        !["draft","shared_for_discussion","withdrawn"].includes(status)||
        documents.some(k=>!allowedDocs.includes(body[k]))||
        note.length<12||note.length>500||
        ![body.brandShareBps,body.brandBudgetCents,body.platformBudgetCents,
          body.expectedVersion,body.expectedInterestVersion,body.expectedReviewVersion]
          .every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000)||
        body.brandShareBps>10000||body.expectedVersion>2147483645||
        body.expectedInterestVersion<1||body.expectedReviewVersion<1)
        throw new DomainError("CLUBE_TERMS_INVALID","Revise condições, documentos e versões.",400);
      const {data,error}=await admin.rpc("admin_clube_terms_save_v1_242",{
        p_actor:user.id,p_merchant:uuid(body.merchantId,"merchantId"),
        p_package:packageKey,p_status:status,
        p_brand_bps:body.brandShareBps,p_brand_budget:body.brandBudgetCents,
        p_platform_budget:body.platformBudgetCents,
        p_identity:body.identityDocumentStatus,p_agreement:body.agreementDocumentStatus,
        p_funding:body.fundingDocumentStatus,p_notes:note,
        p_expected_version:body.expectedVersion,
        p_expected_interest_version:body.expectedInterestVersion,
        p_expected_review_version:body.expectedReviewVersion,
        p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_clube_terms_save_v1_242"||data?.recorded!==true||
        data?.noContract!==true||data?.noCharge!==true||
        data?.fundingVerified!==false||data?.couponSalesEnabled!==false||
        data?.budgetReservedCents!==0||typeof data?.changed!=="boolean"||
        typeof data?.replayed!=="boolean")
        throw new DomainError("CLUBE_TERMS_SAVE_UNVERIFIED","Condições não confirmadas.",503);
      return json(data,200,origin);
    }
    if(action==="clube-campaign-queue"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Sem acesso às negociações.",403);
      const {data,error}=await admin.rpc("admin_clube_campaign_queue_v1_241",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_clube_campaign_queue_v1_241"||
        data?.readOnly!==true||data?.noContractsApproved!==true||
        data?.sponsorFundingConfirmedCents!==0||
        data?.couponSalesEnabled!==false||data?.noCharge!==true||
        data?.campaignsActive!==0||data?.noMerchantSaleProceeds!==true||
        !Number.isSafeInteger(data?.totalProposals)||data.totalProposals<0||
        !Number.isSafeInteger(data?.activeInterests)||data.activeInterests<0||
        data.activeInterests>data.totalProposals||
        !Array.isArray(data?.rows)||data.rows.length>50||
        data.rows.length>data.totalProposals||
        data.rows.some((r:any)=>!r||!UUID_RE.test(String(r.merchantId||""))||
          !["gas_3x5","water_5x2"].includes(r.packageKey)||
          typeof r.companyName!=="string"||r.companyName.length>120||
          typeof r.city!=="string"||r.city.length>100||
          !/^[A-Z]{2}$/.test(String(r.state||""))||
          typeof r.interestActive!=="boolean"||
          !Number.isSafeInteger(r.interestVersion)||r.interestVersion<1||
          !Number.isSafeInteger(r.reviewVersion)||r.reviewVersion<0||
          (r.reviewStatus!==null&&!["under_review","request_documents","economic_prechecked","declined"].includes(r.reviewStatus))||
          typeof r.reviewCurrent!=="boolean"||
          !Number.isSafeInteger(r.shareBps)||r.shareBps<0||r.shareBps>10000||
          !Number.isSafeInteger(r.budgetCents)||r.budgetCents<0||r.budgetCents>1000000||
          !Number.isSafeInteger(r.sponsoredPerCouponCents)||r.sponsoredPerCouponCents<0||
          !Number.isSafeInteger(r.maxCouponUsesIllustrative)||r.maxCouponUsesIllustrative<0||
          !Number.isSafeInteger(r.maxPackagesIllustrative)||r.maxPackagesIllustrative<0||
          (r.reviewNote!==null&&(typeof r.reviewNote!=="string"||r.reviewNote.length>500))||
          !Number.isFinite(Date.parse(r.updatedAt||""))))
        throw new DomainError("CLUBE_CAMPAIGN_QUEUE_UNVERIFIED",
          "Negociações não validadas pelo servidor.",503);
      return json(data,200,origin);
    }
    if(action==="clube-campaign-review"){
      if(!["superadmin","operations","compliance","finance"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","A revisão exige perfil autorizado.",403);
      const status=String(body.status??"");
      const note=String(body.note??"").trim();
      const packageKey=String(body.packageKey??"");
      if(!["gas_3x5","water_5x2"].includes(packageKey)||
        !["under_review","request_documents","economic_prechecked","declined"].includes(status)||
        (status==="economic_prechecked"&&!["superadmin","finance"].includes(String(adminAccess.admin_role)))||
        note.length<12||note.length>500||
        !Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||
        body.expectedVersion>2147483645||
        !Number.isSafeInteger(body.expectedInterestVersion)||
        body.expectedInterestVersion<1){
        throw new DomainError("CLUBE_REVIEW_INVALID","Confira etapa, justificativa e versão.",400);
      }
      const {data,error}=await admin.rpc("admin_clube_campaign_review_v1_241",{
        p_actor:user.id,p_merchant:uuid(body.merchantId,"merchantId"),
        p_package_key:packageKey,p_status:status,p_note:note,
        p_expected_version:body.expectedVersion,
        p_expected_interest_version:body.expectedInterestVersion,
        p_request_id:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_clube_campaign_review_v1_241"||
        data?.recorded!==true||data?.noCharge!==true||
        data?.noContract!==true||data?.fundingVerified!==false||
        data?.campaignEnabled!==false||data?.couponSalesEnabled!==false||
        typeof data?.replayed!=="boolean"||typeof data?.changed!=="boolean")
        throw new DomainError("CLUBE_REVIEW_UNVERIFIED","Revisão não confirmada.",503);
      return json(data,200,origin);
    }
    if(action==="clube-interest-queue"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED",
          "Acesso à fila do Clube não autorizado.",403);
      }
      const {data,error}=await admin.rpc("admin_clube_interest_queue_v1_240",{
        p_actor:user.id
      });
      if(error)throw error;
      if(data?.source!=="admin_clube_interest_queue_v1_240"||
        data?.readOnly!==true||data?.noContactsExposed!==true||
        data?.sponsorFundingConfirmedCents!==0||
        data?.couponSalesEnabled!==false||data?.noCharge!==true||
        data?.noContractsApproved!==true||
        !Number.isSafeInteger(data?.totalProposals)||data.totalProposals<0||
        !Array.isArray(data?.rows)||data.rows.length>50||
        data.rows.length>data.totalProposals||
        data.rows.some((r:any)=>!r||!UUID_RE.test(String(r.merchantId||""))||
          !["gas_3x5","water_5x2"].includes(r.packageKey)||
          !["gas","water"].includes(r.category)||
          typeof r.companyName!=="string"||r.companyName.length>120||
          typeof r.city!=="string"||r.city.length>100||
          !/^[A-Z]{2}$/.test(String(r.state||""))||
          !Number.isSafeInteger(r.shareBps)||r.shareBps<100||r.shareBps>10000||
          !Number.isSafeInteger(r.budgetCents)||r.budgetCents<500||r.budgetCents>1000000||
          r.fundingVerified!==false||r.contractApproved!==false||
          !Number.isFinite(Date.parse(r.updatedAt||"")))){
        throw new DomainError("CLUBE_QUEUE_UNVERIFIED",
          "A fila de propostas do Clube não pôde ser confirmada.",503);
      }
      return json(data,200,origin);
    }
    if(action==="ads-demand"){
      if(!["superadmin","operations","compliance","finance","readonly"].includes(String(adminAccess.admin_role)))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Sem autorização para consultar demanda de anúncios.",403);
      const {data,error}=await admin.rpc("admin_ads_demand_v1_232",{
        p_actor_user_id:user.id
      });
      if(error)throw error;
      const safe=data?.source==="admin_ads_demand_v1_232"
        &&data?.adsLive===false&&data?.noRevenue===true&&data?.noCharge===true
        &&Number.isSafeInteger(data?.totalInterested)&&data.totalInterested>=0
        &&Number.isSafeInteger(data?.recent30d)&&data.recent30d>=0
        &&data.recent30d<=data.totalInterested
        &&Array.isArray(data?.rows)&&data.rows.length<=50
        &&data.rows.length<=data.totalInterested
        &&data.rows.every((r:any)=>r&&UUID_RE.test(String(r.merchantId||""))
          &&typeof r.companyName==="string"&&r.companyName.length<=120
          &&typeof r.city==="string"&&r.city.length<=100
          &&typeof r.state==="string"&&r.state.length<=2
          &&["new_customers","local_visibility","new_area","unsure"].includes(r.goal)
          &&["unsure","upto_99","100_299","300_999","1000_plus"].includes(r.budgetBand)
          &&Number.isFinite(Date.parse(r.updatedAt||"")));
      if(!safe)throw new DomainError("ADS_DEMAND_INVALID",
        "A demanda de publicidade não pôde ser confirmada.",503);
      return json(data,200,origin);
    }
    if(action==="growth-referral-review-queue"){
      const {data,error}=await admin.rpc("admin_growth_referral_review_queue_v1_230",{
        p_actor_user_id:user.id
      });
      if(error)throw error;
      if(data?.source!=="growth_referral_review_queue_v1_230"
        ||data.readOnly!==true||data.noPayout!==true
        ||data.rewardEligible!==false||!Array.isArray(data.rows)
        ||data.rows.length>50){
        throw new DomainError("GROWTH_REFERRAL_QUEUE_INVALID","Fila indisponível.",503);
      }
      return json(data,200,origin);
    }
    if(action==="growth-referral-review"){
      if(!["superadmin","compliance"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente conformidade pode revisar indicações.",403);
      }
      const decision=String(body.decision??"");
      const reason=cleanText(body.reason,{min:12,max:800,name:"justificativa"});
      const evidenceReference=cleanText(body.evidenceReference,{max:160,name:"referência"});
      if(!["verified_identity","rejected","needs_evidence"].includes(decision)
        ||(decision==="verified_identity"&&evidenceReference.length<8)){
        throw new DomainError("INVALID_REFERRAL_REVIEW","Decisão ou comprovação inválida.",400);
      }
      // No identity/evidence booleans from the browser. SQL recomputes every
      // company, owner, code and inviter check from canonical database records.
      const {data,error}=await admin.rpc("admin_review_growth_referral_v1_230",{
        p_actor_user_id:user.id,
        p_application_id:uuid(body.applicationId,"application_id"),
        p_request_id:uuid(body.reviewRequestId,"review_request_id"),
        p_decision:decision,
        p_reason:reason,
        p_evidence_reference:evidenceReference||null
      });
      if(error)throw error;
      if(data?.recorded!==true||data.noPayout!==true||data.rewardEligible!==false){
        throw new DomainError("GROWTH_REFERRAL_REVIEW_INVALID","Resultado de revisão inválido.",503);
      }
      return json(data,200,origin);
    }
    if(action==="summary"){
      return json(await summary(admin,user.id),200,origin);
    }
    if(action==="finance-receipts-history"){
      // The RPC is service-role only; the authenticated actor comes from the JWT.
      // Finance-only allowlist is checked again inside PostgreSQL.
      if(!["superadmin","finance"].includes(String(adminAccess.admin_role||""))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Este perfil não pode consultar o histórico consolidado.",403);
      }
      const {data,error}=await admin.rpc("admin_finance_receipts_history_v1_188",{
        p_actor_user_id:user.id
      });
      if(error)throw error;
      if(data?.source!=="database_complete"||!Array.isArray(data?.monthly)||!data?.kindTotals){
        throw new DomainError("FINANCE_HISTORY_NOT_READY","Histórico financeiro não disponível. Atualize e confira a migração.",503);
      }
      return json(data,200,origin);
    }
    if(action==="sale-payment-history"){
      if(!["superadmin","finance","readonly"].includes(String(adminAccess.admin_role||""))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Este perfil não pode consultar pagamentos de vendas.",403);
      }
      return json(await financeSalePaymentHistory(admin,body),200,origin);
    }
    if(action==="search"){
      return json(await adminSearch(admin,body.query,String(adminAccess.admin_role||"superadmin")),200,origin);
    }
    if(action==="entity-detail"){
      return json(await adminEntityDetail(admin,body.entityType,body.entityId,String(adminAccess.admin_role||"superadmin")),200,origin);
    }
    if(action==="ads-psp-read"){
      if(!["superadmin","operations","readonly"].includes(String(adminAccess.admin_role||"")))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Acesso ao financeiro Ads negado.",403);
      const {data,error}=await admin.rpc("admin_ads_psp_read_v1_314",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_ads_psp_v1_314"||data.readOnly!==true||
        data.adsLive!==false||data.merchantBillingSeparate!==true||
        data.refundReviewRequired!==true||
        !Number.isSafeInteger(data.totalCheckouts)||data.totalCheckouts<0||
        !Number.isSafeInteger(data.providerApprovedCount)||data.providerApprovedCount<0||
        !Number.isSafeInteger(data.providerApprovedGrossCents)||data.providerApprovedGrossCents<0||
        !Array.isArray(data.rows)||data.rows.length>50||
        data.rows.some((x:any)=>!UUID_RE.test(String(x.merchantId||""))||
          !/^[a-f0-9]{64}$/.test(String(x.documentSha256||""))||
          (x.checkout!==null&&(!["reserved","checkout_ready","payment_approved","payment_reversed"].includes(x.checkout?.status)||
          !Number.isSafeInteger(x.checkout.version)||x.checkout.version<1||
          !Number.isSafeInteger(x.checkout.amountCents)||x.checkout.amountCents<1000))))
        throw new DomainError("ADS_PSP_EVIDENCE_UNVERIFIED","Livro do provedor não confirmado.",503);
      return json({...data,platformPspConfigured:
        Deno.env.get("ADS_MP_CHECKOUT_ENABLED")==="true"&&
        /^APP_USR-\S{20,}$/.test(String(Deno.env.get("ADS_MP_ACCESS_TOKEN")||"").trim())&&
        /^[0-9]{4,20}$/.test(String(Deno.env.get("ADS_MP_SELLER_ID")||""))
      },200,origin);
    }
    if(action==="ads-receivables-read"){
      if(!["superadmin","operations","readonly"].includes(String(adminAccess.admin_role||"")))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Leitura de cobranças Ads não autorizada.",403);
      const {data,error}=await admin.rpc("admin_ads_receivables_read_v1_313",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_ads_receivables_v1_313"||data.readOnly!==true||
        data.verifiedPayments!==0||data.collectedRevenueCents!==0||
        data.pspChargeCreated!==false||data.adsLive!==false||
        data.merchantBillingSeparate!==true||
        !Number.isSafeInteger(data.totalReceivables)||data.totalReceivables<0||
        !Number.isSafeInteger(data.issuedReceivables)||data.issuedReceivables<0||
        !Number.isSafeInteger(data.unverifiedReports)||data.unverifiedReports<0||
        !Array.isArray(data.rows)||data.rows.length>50||
        data.rows.some((r:any)=>!r||!UUID_RE.test(String(r.merchantId||""))||
         r.instrumentStatus!=="bilateral_accepted"||
         !/^[a-f0-9]{64}$/.test(String(r.sha256||""))||
         !Number.isSafeInteger(r.instrumentVersion)||r.instrumentVersion<3||
         !Number.isSafeInteger(r.amountCents)||r.amountCents<1000||
         !Number.isSafeInteger(r.dueDays)||r.dueDays<1||r.dueDays>30||
         !Number.isSafeInteger(r.paymentReportsUnverified)||r.paymentReportsUnverified<0||
         (r.receivable!==null&&(!["draft","issued","canceled"].includes(r.receivable?.status)||
           !Number.isSafeInteger(r.receivable.version)||r.receivable.version<1||
           !Number.isSafeInteger(r.receivable.amountCents)||
           r.receivable.currency!=="BRL"))))
        throw new DomainError("ADS_RECEIVABLE_EVIDENCE_INVALID","Cobranças não confirmadas no servidor.",503);
      return json(data,200,origin);
    }
    if(action==="ads-instruments-read"){
      if(!["superadmin","operations","readonly"].includes(String(adminAccess.admin_role||"")))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta de instrumentos não autorizada.",403);
      const {data,error}=await admin.rpc("admin_ads_instruments_read_v1_312",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_ads_instruments_v1_312"||data.readOnly!==true||
        data.noCharge!==true||data.adsLive!==false||data.paymentRequestsCreated!==0||
        data.deliveryVerified!==false||data.notIcpCertified!==true||
        !Number.isSafeInteger(data.totalInstruments)||data.totalInstruments<0||
        !Array.isArray(data.rows)||data.rows.length>50||
        data.rows.some((r:any)=>!r||!UUID_RE.test(String(r.merchantId||""))||
          !Number.isSafeInteger(r.version)||r.version<1||
          typeof r.sha256!=="string"||!/^[a-f0-9]{64}$/.test(r.sha256)||
          !["offered","merchant_accepted","bilateral_accepted"].includes(r.status)||
          r.document?.schema!=="ads-electronic-instrument-v1.312"||
          typeof r.document?.platformLegalName!=="string"||
          typeof r.document?.merchantLegalName!=="string"||
          !Number.isSafeInteger(r.document?.priceCents)))
        throw new DomainError("ADS_INSTRUMENT_EVIDENCE_INVALID","Instrumentos não confirmados pelo servidor.",503);
      return json(data,200,origin);
    }
    if(action==="ads-dossiers-read"){
      if(!["superadmin","operations","readonly"].includes(String(adminAccess.admin_role||"")))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Acesso ao dossiê comercial não autorizado.",403);
      const {data,error}=await admin.rpc("admin_ads_dossiers_read_v1_311",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_ads_dossiers_v1_311"||data.readOnly!==true||
         data.noCharge!==true||data.adsLive!==false||data.contractsSigned!==0||
         data.revenueCents!==0||data.paymentRequestsCreated!==0||
         !Number.isSafeInteger(data.totalDossiers)||data.totalDossiers<0||
         !Array.isArray(data.rows)||data.rows.length>50||
         data.rows.some((r:any)=>!r||!UUID_RE.test(String(r.merchantId||""))||
          !Number.isSafeInteger(r.version)||r.version<1||
          !Number.isSafeInteger(r.offerVersion)||r.offerVersion<1||
          !Number.isSafeInteger(r.priceCents)||r.priceCents<1000||r.priceCents>5000000||
          !Number.isSafeInteger(r.durationDays)||r.durationDays<7||r.durationDays>90||
          !Number.isSafeInteger(r.dueDays)||r.dueDays<1||r.dueDays>30||
          typeof r.serviceScope!=="string"||r.serviceScope.length<60||r.serviceScope.length>700||
          typeof r.cancellationTerms!=="string"||r.cancellationTerms.length<40||r.cancellationTerms.length>700||
          !["draft","shared_for_review","changes_requested","reviewed","withdrawn"].includes(r.status)))
        throw new DomainError("ADS_DOSSIER_READ_UNVERIFIED","Dossiês comerciais não confirmados.",503);
      return json(data,200,origin);
    }
    if(action==="ads-offers-read"){
      if(!["superadmin","operations","readonly"].includes(String(adminAccess.admin_role||"")))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Leitura comercial não autorizada.",403);
      const {data,error}=await admin.rpc("admin_ads_offers_read_v1_310",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_ads_offers_v1_310"||data.readOnly!==true||
        data.noCharge!==true||data.adsLive!==false||data.contractsSigned!==0||
        data.revenueCents!==0||data.notifiedExternally!==false||
        !Number.isSafeInteger(data.totalOffers)||data.totalOffers<0||
        !Number.isSafeInteger(data.interestedResponses)||data.interestedResponses<0||
        data.interestedResponses>data.totalOffers||
        !Array.isArray(data.rows)||data.rows.length>50||
        data.rows.some((r:any)=>!r||!UUID_RE.test(String(r.merchantId||""))||
          !["shared","interested","declined","withdrawn"].includes(r.status)||
          !Number.isSafeInteger(r.version)||r.version<1||
          !Number.isSafeInteger(r.planVersion)||r.planVersion<1||
          !Number.isSafeInteger(r.priceCents)||r.priceCents<1000||r.priceCents>5000000||
          !Number.isSafeInteger(r.durationDays)||r.durationDays<7||r.durationDays>90||
          typeof r.expired!=="boolean"))
        throw new DomainError("ADS_OFFERS_UNVERIFIED","Ofertas não confirmadas.",503);
      return json(data,200,origin);
    }
    if(action==="ads-sales-plans"){
      if(!["superadmin","operations","readonly"].includes(String(adminAccess.admin_role||"")))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta de planos comerciais não autorizada.",403);
      const {data,error}=await admin.rpc("admin_ads_sales_plans_read_v1_309",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_ads_sales_plans_v1_309"||data.readOnly!==true||
        data.noCharge!==true||data.adsLive!==false||data.revenueCents!==0||
        data.contractsSigned!==0||data.independentlyMeasuredImpressions!==0||
        !Number.isSafeInteger(data.totalPlans)||data.totalPlans<0||
        !Number.isSafeInteger(data.approvedCreatives)||data.approvedCreatives<0||
        !Array.isArray(data.rows)||data.rows.length>50||
        data.rows.some((r:any)=>!r||!UUID_RE.test(String(r.merchantId||""))||
          typeof r.companyName!=="string"||r.companyName.length>120||
          typeof r.title!=="string"||r.title.length>80||
          typeof r.creativeEligible!=="boolean"||
          (r.creativeVersion!==null&&(!Number.isSafeInteger(r.creativeVersion)||r.creativeVersion<1))||
          !Number.isSafeInteger(r.version)||r.version<0||
          (r.stage!==null&&!["draft","ready_for_contact","paused","closed_lost"].includes(r.stage))||
          (r.priceCents!==null&&(!Number.isSafeInteger(r.priceCents)||r.priceCents<1000||r.priceCents>5000000))||
          (r.durationDays!==null&&(!Number.isSafeInteger(r.durationDays)||r.durationDays<7||r.durationDays>90))))
        throw new DomainError("ADS_SALES_PLANS_UNVERIFIED","Planos comerciais não confirmados.",503);
      return json(data,200,origin);
    }
    if(action==="commercial-intake-read"){
      if(!["superadmin","operations","readonly"].includes(String(adminAccess.admin_role||"")))
        throw new DomainError("ADMIN_PERMISSION_DENIED","Consulta comercial não autorizada.",403);
      const {data,error}=await admin.rpc("admin_marketing_intake_read_v1_308",{p_actor:user.id});
      if(error)throw error;
      if(data?.source!=="admin_marketing_intake_v1_308"||data.readOnly!==true||
        data.adsPublicationEnabled!==false||data.couponSalesEnabled!==false||
        data.noMoneyMovement!==true||!Array.isArray(data.controls)||data.controls.length!==2||
        data.controls.some((r:any)=>!["ads_proposals","clube_proposals"].includes(r?.moduleKey)||
          typeof r.enabled!=="boolean"||!Number.isSafeInteger(r.version)||r.version<1))
        throw new DomainError("MARKETING_INTAKE_UNVERIFIED","Controle comercial não confirmado.",503);
      return json(data,200,origin);
    }
    if(action==="governance-gates"){
      // Explicit role guard even though the action is in the read-only allowlist.
      return json(await adminGovernanceGates(admin,String(adminAccess.admin_role||"")),200,origin);
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
    if(action==="merchant-payment-preflight"){
      const merchantId=uuid(body.merchantId,"merchant");
      const provider=String(body.provider??"mercadopago").trim().toLowerCase();
      if(!/^[a-z][a-z0-9_]{1,39}$/.test(provider)||provider==="manual"){
        throw new DomainError("PAYMENT_PROVIDER_INVALID","Provedor de pagamento inválido.",400);
      }
      return json(
        await merchantPaymentPreflight(admin,user.id,merchantId,provider),
        200,
        origin
      );
    }

    const idempotencyKey=String(req.headers.get("Idempotency-Key")??"").trim();
    if(idempotencyKey.length<12||idempotencyKey.length>120){
      throw new DomainError("INVALID_IDEMPOTENCY_KEY","Chave de idempotência obrigatória para mutações administrativas.",400);
    }

    if(action==="operational-alert-ack"){
      const source=String(body.source||"");
      const revision=Number(body.expectedRevision);
      if(!["incidents","support","finance","capture"].includes(source)||
         !Number.isSafeInteger(revision)||revision<1||revision>100000){
        throw new DomainError("INVALID_ALERT_ACK","Atribuição ou revisão inválida.",400);
      }
      // Postgres revalidates active admin, current revision, source role and ownership.
      const {data,error}=await admin.rpc("admin_ack_alert_followup_v1_214",{
        p_actor_id:user.id,p_source:source,p_expected_revision:revision
      });
      if(error)throw error;
      if(data?.source!=="server_authoritative"||
         !Number.isSafeInteger(data?.revision)||
         !Number.isFinite(Date.parse(String(data?.acknowledgedAt||"")))){
        throw new DomainError("ALERT_ACK_WRITE_FAILED","Ciência da atribuição não confirmada.",503);
      }
      return json(data,200,origin);
    }
    if(action==="operational-alert-followup"){
      const source=String(body.source||"");
      if(!["incidents","support","finance","capture"].includes(source)){
        throw new DomainError("INVALID_ALERT_SOURCE","Grupo operacional inválido.",400);
      }
      const ownerId=uuid(body.ownerId,"administrador responsável");
      const dueAt=new Date(String(body.dueAt||""));
      const status=String(body.followupStatus||"");
      const note=String(body.note||"").trim();
      const revision=Number(body.expectedRevision);
      if(!Number.isFinite(dueAt.getTime())||!["open","monitoring","closed"].includes(status)||
         note.length<6||note.length>240||!Number.isSafeInteger(revision)||
         revision<0||revision>100000){
        throw new DomainError("INVALID_ALERT_FOLLOWUP","Informe responsável, prazo e justificativa válidos.",400);
      }
      const {data,error}=await admin.rpc("admin_set_alert_followup_v1_211",{
        p_actor_id:user.id,p_source:source,p_owner_id:ownerId,
        p_due_at:dueAt.toISOString(),p_status:status,
        p_note:note,p_expected_revision:revision
      });
      if(error)throw error;
      if(data?.source!=="server_authoritative"||!Number.isSafeInteger(data?.revision)){
        throw new DomainError("ALERT_FOLLOWUP_WRITE_FAILED","Acompanhamento não confirmado.",503);
      }
      return json(data,200,origin);
    }
    if(action==="commercial-history-capture"){
      if(!["superadmin","operations"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente a administração comercial pode registrar o histórico.",403);
      }
      // One immutable server-computed snapshot per UTC hour across admins.
      // The idempotency header and DB uniqueness protect repeated taps.
      const {data,error}=await admin.rpc("admin_capture_city_commercial_history_v1_205",{
        p_actor_user_id:user.id
      });
      if(error)throw error;
      if(!data?.id||data?.source!=="server_authoritative"){
        throw new DomainError("COMMERCIAL_HISTORY_WRITE_FAILED","Histórico comercial não confirmado.",503);
      }
      return json(data,200,origin);
    }
    if(action==="prospect-crm"){
      const cnpj=String(body.cnpj||"").replace(/\D/g,"");
      if(!/^[0-9]{14}$/.test(cnpj))throw new DomainError("INVALID_PROSPECT_CNPJ","CNPJ inválido.",400);
      const version=Number(body.expectedVersion);
      if(!Number.isSafeInteger(version)||version<0)throw new DomainError("INVALID_PROSPECT_VERSION","Atualize a lista antes de salvar.",400);
      const status=String(body.status||"");
      if(!["uncontacted","contacted","interested","onboarding","partner","dismissed"].includes(status))
        throw new DomainError("INVALID_PROSPECT_STATUS","Etapa inválida.",400);
      const note=cleanText(body.note,{min:5,max:1000,name:"histórico da negociação"});
      const channel=String(body.contactChannel||"");
      if(channel&&!["phone","whatsapp","email","in_person"].includes(channel))
        throw new DomainError("INVALID_CONTACT_CHANNEL","Canal inválido.",400);
      let followUpDate:string|null=null;
      if(body.followUpDate!=null&&String(body.followUpDate).trim()){
        const day=String(body.followUpDate).trim();
        if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+"T15:00:00Z")))
          throw new DomainError("INVALID_FOLLOW_UP_DATE","Data inválida.",400);
        followUpDate=day+"T15:00:00Z";
      }
      const {data,error}=await admin.rpc("admin_update_anp_prospect",{
        p_actor_user_id:user.id,p_cnpj:cnpj,p_expected_version:version,
        p_next_status:status,p_note:note,p_follow_up_at:followUpDate,
        p_contact_channel:channel||null
      });
      if(error)throw error;
      return json(data,200,origin);
    }
    if(action==="prospect-invite"){
      if(!["superadmin","operations","compliance"].includes(String(adminAccess.admin_role))){
        throw new DomainError("ADMIN_PERMISSION_DENIED","Perfil não autorizado a convidar revendas.",403);
      }
      const cnpj=String(body.cnpj||"").replace(/\D/g,"");
      const inviteAction=String(body.inviteAction||"");
      if(!/^[0-9]{14}$/.test(cnpj)||!["issue","revoke"].includes(inviteAction)){
        throw new DomainError("INVALID_PROSPECT_INVITE_ACTION","Convite inválido.",400);
      }
      let tokenHash:string|null=null;
      let expiresAt:string|null=null;
      if(inviteAction==="issue"){
        const token=String(body.token||"").trim();
        if(!/^[A-Za-z0-9_-]{32,128}$/.test(token)){
          throw new DomainError("INVALID_PROSPECT_INVITE_TOKEN","Token inválido.",400);
        }
        tokenHash=await sha256Hex(token);
        const expiration=new Date(String(body.expiresAt||""));
        if(!Number.isFinite(expiration.getTime())||expiration.getTime()<=Date.now()+5*60*1000
           ||expiration.getTime()>Date.now()+30*24*60*60*1000){
          throw new DomainError("INVALID_PROSPECT_INVITE_EXPIRY","Validade inválida.",400);
        }
        expiresAt=expiration.toISOString();
      }
      const {data,error}=await admin.rpc("admin_anp_prospect_invite_action",{
        p_actor_user_id:user.id,p_cnpj:cnpj,p_action:inviteAction,
        p_token_hash:tokenHash,p_expires_at:expiresAt,p_rotate:body.rotate===true
      });
      if(error)throw error;
      return json(data,200,origin);
    }
    if(action==="city-notification-status"){
      const status=String(body.status||"");
      if(!["sent","skipped"].includes(status))throw new DomainError("INVALID_NOTIFICATION_ACTION","Status inválido.",400);
      const {data,error}=await admin.rpc("admin_handle_city_notification",{
        p_actor_user_id:user.id,
        p_notification_id:uuid(body.notificationId,"notification"),
        p_status:status,
        p_note:cleanText(body.note,{min:5,max:240,name:"justificativa"})
      });
      if(error)throw error;
      return json(data,200,origin);
    }
    if(action==="ads-psp-action"){
      if(String(adminAccess.admin_role||"")!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal pode gerar ou conferir checkout Ads.",403);
      const merchantId=uuid(body.merchantId,"merchantId"),operation=String(body.operation||"");
      if(!["create","reconcile"].includes(operation))
        throw new DomainError("ADS_PSP_OPERATION_INVALID","Operação PSP não autorizada.",400);
      const token=String(Deno.env.get("ADS_MP_ACCESS_TOKEN")||"").trim();
      const sellerId=String(Deno.env.get("ADS_MP_SELLER_ID")||"").trim();
      if(Deno.env.get("ADS_MP_CHECKOUT_ENABLED")!=="true"||
        !/^APP_USR-\S{20,}$/.test(token)||!/^[0-9]{4,20}$/.test(sellerId))
        throw new DomainError("ADS_PSP_NOT_CONFIGURED",
          "A conta recebedora TAMÃO Ads não foi habilitada ou homologada. Nenhuma cobrança foi iniciada.",503);
      // Confirm that the platform account owns the credentials, never merchant OAuth tokens.
      let identity:any;
      try{
        const account=await fetch("https://api.mercadolibre.com/users/me",{
          headers:{"Accept":"application/json","Authorization":"Bearer "+token},
          signal:AbortSignal.timeout(7000)
        });
        if(!account.ok)throw new Error("ACCOUNT_CHECK_FAILED");
        const raw=await account.text();
        if(raw.length>20000)throw new Error("ACCOUNT_RESPONSE_OVERSIZE");
        identity=JSON.parse(raw);
      }catch{
        throw new DomainError("ADS_PSP_ACCOUNT_UNVERIFIED","Conta recebedora indisponível para validação.",503);
      }
      if(String(identity?.id||"")!==sellerId)
        throw new DomainError("ADS_PSP_SELLER_MISMATCH","A conta recebedora não corresponde à conta TAMÃO Ads autorizada.",403);
      if(operation==="create"){
        const read=await admin.rpc("admin_ads_psp_read_v1_314",{p_actor:user.id});
        if(read.error)throw read.error;
        const item=read.data?.rows?.find((x:any)=>x.merchantId===merchantId);
        if(item?.checkout){
          throw new DomainError("ADS_PSP_ALREADY_RESERVED",
           "Esta cobrança possui uma tentativa existente. Verifique o estado antes de prosseguir.",409);
        }
        if(item?.receivable?.status!=="issued"||
          !Number.isSafeInteger(item.receivable.version)||!Number.isSafeInteger(item.amountCents)||
          item.amountCents<1000)
          throw new DomainError("ADS_PSP_STATEMENT_NOT_ISSUED","Emita primeiro o demonstrativo comercial.",409);
        // Expire the external payment preference at the contracted local due date.
        // A stale checkout must never remain indefinitely payable via a copied link.
        const expiresAt=new Date(String(item.receivable.dueDate||"")+"T23:59:59-03:00");
        if(!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=Date.now()){
          throw new DomainError("ADS_PSP_DUE_DATE_INVALID",
            "Vencimento do demonstrativo incompatível com a criação do checkout.",409);
        }
        const requestId=uuid(body.requestId,"requestId");
        const reserved=await admin.rpc("admin_ads_psp_action_v1_314",{
          p_actor:user.id,p_merchant:merchantId,p_operation:"reserve",
          p_expected_version:0,p_preference_id:null,p_checkout_url:null,
          p_collector_id:null,p_payment_data:null,p_request:requestId
        });
        if(reserved.error)throw reserved.error;
        if(reserved.data?.source!=="admin_ads_psp_action_v1_314"||
          reserved.data.status!=="reserved"||reserved.data.version!==1||
          !/^tamao-ads-[0-9a-f]{32}-v[0-9]+$/.test(reserved.data.externalReference))
          throw new DomainError("ADS_PSP_RESERVATION_UNVERIFIED","Reserva não confirmada.",503);
        // Persist reservation BEFORE calling PSP to prevent concurrent duplicate preferences.
        const next=await admin.rpc("admin_ads_psp_read_v1_314",{p_actor:user.id});
        const snapshot=next.data?.rows?.find((x:any)=>x.merchantId===merchantId);
        if(next.error||snapshot?.checkout?.status!=="reserved"||
          snapshot.checkout.externalReference!==reserved.data.externalReference||
          snapshot.checkout.amountCents!==item.amountCents)
          throw new DomainError("ADS_PSP_RESERVATION_READBACK_FAILED","Reserva gravada, sem autorização para envio ao provedor.",503);
        let preference:any;
        try{
          const response=await mercadoPagoFetch("/checkout/preferences",{
            accessToken:token,method:"POST",
            idempotencyKey:"ads-"+reserved.data.externalReference,
            body:{
              items:[{id:"tamao-ads-"+merchantId,title:"Publicidade TAMÃO Ads",
                quantity:1,currency_id:"BRL",unit_price:item.amountCents/100}],
              external_reference:reserved.data.externalReference,
              expires:true,
              expiration_date_from:new Date().toISOString(),
              expiration_date_to:expiresAt.toISOString(),
              back_urls:{success:"https://parceiro.tamao.com.br/",
                failure:"https://parceiro.tamao.com.br/",pending:"https://parceiro.tamao.com.br/"},
              auto_return:"approved"
            }
          });
          preference=await readMercadoPagoJson(response);
          if(!response.ok)throw new Error("PREFERENCE_HTTP_"+response.status);
        }catch{
          throw new DomainError("ADS_PSP_PREFERENCE_UNCONFIRMED",
            "Reserva mantida. O provedor não confirmou o checkout; a operação não será repetida automaticamente.",503);
        }
        const checkoutUrl=safeMercadoPagoUrl(preference?.init_point);
        const preferenceId=String(preference?.id||"");
        if(!checkoutUrl||!/^[A-Za-z0-9_-]{6,150}$/.test(preferenceId)||
          preference.external_reference!==reserved.data.externalReference||
          String(preference?.collector_id??"")!==sellerId||
          !Array.isArray(preference.items)||preference.items.length!==1||
          preference.items[0]?.currency_id!=="BRL"||
          preference.items[0]?.quantity!==1||
          moneyToCents(preference.items[0]?.unit_price)!==item.amountCents)
          throw new DomainError("ADS_PSP_PREFERENCE_EVIDENCE_INVALID",
            "Resposta do provedor não coincide com a reserva, que permanece bloqueada.",503);
        const saved=await admin.rpc("admin_ads_psp_action_v1_314",{
          p_actor:user.id,p_merchant:merchantId,p_operation:"attach",p_expected_version:1,
          p_preference_id:preferenceId,p_checkout_url:checkoutUrl,
          p_collector_id:sellerId,p_payment_data:null,p_request:crypto.randomUUID()
        });
        if(saved.error)throw saved.error;
        if(saved.data?.status!=="checkout_ready"||saved.data.version!==2)
          throw new DomainError("ADS_PSP_CHECKOUT_NOT_PERSISTED","Checkout criado, mas não confirmado no banco.",503);
        return json({source:"admin_ads_psp_create_v1_314",merchantId,status:"checkout_ready",
          externalReference:reserved.data.externalReference,noAdsPublication:true,
          paymentVerified:false,provider:"mercadopago"},200,origin);
      }
      const paymentId=String(body.paymentId||"").trim();
      if(!/^[0-9]{5,30}$/.test(paymentId))
        throw new DomainError("ADS_PSP_PAYMENT_ID_INVALID","Informe um identificador de pagamento válido.",400);
      const read=await admin.rpc("admin_ads_psp_read_v1_314",{p_actor:user.id});
      if(read.error)throw read.error;
      const entry=read.data?.rows?.find((x:any)=>x.merchantId===merchantId);
      const checkout=entry?.checkout;
      if(!checkout||!["checkout_ready","payment_approved","payment_reversed"].includes(checkout.status))
        throw new DomainError("ADS_PSP_CHECKOUT_NOT_READY","Checkout ainda não existe.",409);
      let payment:any;
      try{
        const response=await mercadoPagoFetch("/v1/payments/"+paymentId,{accessToken:token});
        payment=await readMercadoPagoJson(response);
        if(!response.ok)throw new Error("PAYMENT_LOOKUP_"+response.status);
      }catch{throw new DomainError("ADS_PSP_PROVIDER_LOOKUP_FAILED","Não foi possível confirmar o pagamento diretamente no provedor.",503);}
      const status=String(payment?.status||"");
      const detail=String(payment?.status_detail||"");
      const cents=moneyToCents(payment?.transaction_amount);
      if(String(payment?.id||"")!==paymentId||
        String(payment?.collector_id??payment?.collector?.id??"")!==sellerId||
        payment?.external_reference!==checkout.externalReference||
        payment?.currency_id!=="BRL"||cents!==checkout.amountCents)
        throw new DomainError("ADS_PSP_PAYMENT_MISMATCH","O pagamento não pertence a este checkout de publicidade.",403);
      const operationDb=status==="approved"&&detail==="accredited"&&checkout.status==="checkout_ready"
        ?"verify":((["refunded","charged_back"].includes(status)||
            (status==="approved"&&detail==="partially_refunded"))&&
            checkout.status==="payment_approved"?"reverse":null);
      if(!operationDb)throw new DomainError("ADS_PSP_PAYMENT_NOT_CONFIRMABLE",
        "O provedor não confirmou um novo pagamento integral aprovado ou um estorno correspondente.",409);
      const payload={payment_id:paymentId,status,status_detail:detail,
        external_reference:checkout.externalReference,
        collector_id:sellerId,currency_id:"BRL",amount_cents:String(cents)};
      const saved=await admin.rpc("admin_ads_psp_action_v1_314",{
        p_actor:user.id,p_merchant:merchantId,p_operation:operationDb,
        p_expected_version:checkout.version,
        p_preference_id:null,p_checkout_url:null,p_collector_id:null,
        p_payment_data:payload,p_request:uuid(body.requestId,"requestId")
      });
      if(saved.error)throw saved.error;
      if(saved.data?.source!=="admin_ads_psp_action_v1_314"||
        saved.data.status!==(operationDb==="verify"?"payment_approved":"payment_reversed"))
        throw new DomainError("ADS_PSP_PAYMENT_NOT_PERSISTED","Prova do pagamento não foi persistida.",503);
      return json({source:"admin_ads_psp_reconcile_v1_314",merchantId,
        status:saved.data.status,paymentId,verifiedFromProvider:true,adsLive:false,
        refundReviewRequired:true},200,origin);
    }
    if(action==="ads-receivable-action"){
      if(String(adminAccess.admin_role||"")!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal emite cobranças Ads.",403);
      const merchantId=uuid(body.merchantId,"merchantId"),operation=String(body.operation||"");
      if(!["prepare","issue","cancel"].includes(operation)||
        !Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||
        !/^[a-f0-9]{64}$/.test(String(body.documentSha256||"")))
        throw new DomainError("ADS_RECEIVABLE_ACTION_INVALID","Versão ou identificador do contrato inválido.",400);
      const reason=cleanText(body.reason,{min:12,max:240,name:"justificativa"});
      const {data,error}=await admin.rpc("admin_ads_receivable_action_v1_313",{
        p_actor:user.id,p_merchant:merchantId,p_operation:operation,
        p_instrument_sha256:body.documentSha256,p_expected_version:body.expectedVersion,
        p_reason:reason,p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      const expected=operation==="prepare"?"draft":operation==="issue"?"issued":"canceled";
      if(data?.source!=="admin_ads_receivable_action_v1_313"||
        data.merchantId!==merchantId||data.status!==expected||
        !Number.isSafeInteger(data.version)||data.version<1||
        data.recorded!==true||data.verifiedPaid!==false||
        data.pspChargeCreated!==false||data.adsLive!==false||
        data.merchantBillingSeparate!==true)
        throw new DomainError("ADS_RECEIVABLE_WRITE_UNVERIFIED","Cobrança não confirmada no servidor.",503);
      return json(data,200,origin);
    }
    if(action==="ads-instrument-action"){
      if(String(adminAccess.admin_role||"")!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal emite e confirma instrumentos.",403);
      const merchantId=uuid(body.merchantId,"merchantId"),operation=String(body.operation||"");
      if(!["issue","founder_accept"].includes(operation)||
        !Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)
        throw new DomainError("ADS_INSTRUMENT_ACTION_INVALID","Versão ou ação inválida.",400);
      const platformLegalName=operation==="issue"
        ?cleanText(body.platformLegalName,{min:5,max:160,name:"razão social do TAMÃO"}):null;
      const platformCnpj=operation==="issue"?String(body.platformCnpj||""):null;
      const sha256=operation==="founder_accept"?String(body.sha256||""):null;
      if(operation==="issue"&&!/^[0-9]{14}$/.test(platformCnpj||"")||
        operation==="founder_accept"&&!/^[a-f0-9]{64}$/.test(sha256||""))
        throw new DomainError("ADS_INSTRUMENT_IDENTITY_OR_HASH_INVALID","Identidade jurídica ou hash inválido.",400);
      const {data,error}=await admin.rpc("admin_ads_instrument_action_v1_312",{
        p_actor:user.id,p_merchant:merchantId,p_operation:operation,
        p_expected_version:body.expectedVersion,p_platform_legal_name:platformLegalName,
        p_platform_cnpj:platformCnpj,p_document_sha256:sha256,
        p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_ads_instrument_action_v1_312"||
        data.merchantId!==merchantId||
        data.status!==(operation==="issue"?"offered":"bilateral_accepted")||
        !Number.isSafeInteger(data.version)||data.version<1||
        !/^[a-f0-9]{64}$/.test(String(data.sha256||""))||
        data.recorded!==true||data.noCharge!==true||data.adsLive!==false||
        data.paymentRequestCreated!==false||data.notIcpCertified!==true)
        throw new DomainError("ADS_INSTRUMENT_RECORD_UNVERIFIED","Instrumento não confirmado.",503);
      return json(data,200,origin);
    }
    if(action==="ads-dossier-action"){
      if(String(adminAccess.admin_role||"")!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal gerencia dossiês.",403);
      const merchantId=uuid(body.merchantId,"merchantId"),operation=String(body.operation||"");
      if(!["save","share","withdraw"].includes(operation)||
        !Number.isSafeInteger(body.offerVersion)||body.offerVersion<1||
        !Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)
        throw new DomainError("ADS_DOSSIER_ACTION_INVALID","Atualize a versão do dossiê.",400);
      const serviceScope=operation==="save"?cleanText(body.serviceScope,{min:60,max:700,name:"escopo do serviço"}):null;
      const cancellationTerms=operation==="save"?cleanText(body.cancellationTerms,{min:40,max:700,name:"condições de cancelamento"}):null;
      const dueDays=operation==="save"?body.dueDays:null;
      if(operation==="save"&&(!Number.isSafeInteger(dueDays)||dueDays<1||dueDays>30))
        throw new DomainError("ADS_DOSSIER_DUE_DAYS_INVALID","Prazo de pagamento proposto inválido.",400);
      const {data,error}=await admin.rpc("admin_ads_dossier_action_v1_311",{
        p_actor:user.id,p_merchant:merchantId,p_action:operation,p_offer_version:body.offerVersion,
        p_expected_version:body.expectedVersion,p_service_scope:serviceScope,
        p_cancellation_terms:cancellationTerms,p_due_days:dueDays,
        p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      const status=operation==="save"?"draft":operation==="share"?"shared_for_review":"withdrawn";
      if(data?.source!=="admin_ads_dossier_action_v1_311"||data.merchantId!==merchantId||
        data.status!==status||!Number.isSafeInteger(data.version)||data.version<1||
        data.recorded!==true||data.noCharge!==true||data.adsLive!==false||
        data.contractSigned!==false||data.paymentRequestCreated!==false)
        throw new DomainError("ADS_DOSSIER_WRITE_UNVERIFIED","Registro comercial não confirmado.",503);
      return json(data,200,origin);
    }
    if(action==="ads-offer-action"){
      if(String(adminAccess.admin_role||"")!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal apresenta ofertas.",403);
      const merchantId=uuid(body.merchantId,"merchantId");
      const operation=String(body.operation||"");
      if(!["share","withdraw"].includes(operation)||
        !Number.isSafeInteger(body.planVersion)||body.planVersion<1||
        !Number.isSafeInteger(body.expectedOfferVersion)||body.expectedOfferVersion<0)
        throw new DomainError("ADS_OFFER_ACTION_INVALID","Atualize a proposta antes de agir.",400);
      const reason=cleanText(body.reason,{min:12,max:240,name:"justificativa"});
      const {data,error}=await admin.rpc("admin_ads_offer_action_v1_310",{
        p_actor:user.id,p_merchant:merchantId,p_action:operation,
        p_plan_version:body.planVersion,p_expected_offer_version:body.expectedOfferVersion,
        p_reason:reason,p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_ads_offer_action_v1_310"||
        data.merchantId!==merchantId||data.operation!==operation||
        data.status!==(operation==="share"?"shared":"withdrawn")||
        !Number.isSafeInteger(data.version)||data.version<1||
        data.noCharge!==true||data.adsLive!==false||data.contractSigned!==false||
        data.merchantNotified!==false)
        throw new DomainError("ADS_OFFER_UNVERIFIED","Oferta não confirmada.",503);
      return json(data,200,origin);
    }
    if(action==="ads-sales-plan-save"){
      if(String(adminAccess.admin_role||"")!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal define planos comerciais.",403);
      const merchantId=uuid(body.merchantId,"merchantId");
      const creativeVersion=body.creativeVersion,expectedVersion=body.expectedVersion;
      const priceCents=body.priceCents,durationDays=body.durationDays;
      const stage=String(body.stage||"");
      if(!Number.isSafeInteger(creativeVersion)||creativeVersion<1||
        !Number.isSafeInteger(expectedVersion)||expectedVersion<0||
        !Number.isSafeInteger(priceCents)||priceCents<1000||priceCents>5000000||
        !Number.isSafeInteger(durationDays)||durationDays<7||durationDays>90||
        !["draft","ready_for_contact","paused","closed_lost"].includes(stage))
        throw new DomainError("ADS_SALES_PLAN_INVALID","Revise o valor, prazo ou versão da proposta.",400);
      const note=cleanText(body.note,{min:12,max:500,name:"observação"});
      const {data,error}=await admin.rpc("admin_ads_sales_plan_save_v1_309",{
        p_actor:user.id,p_merchant:merchantId,p_creative_version:creativeVersion,
        p_expected_version:expectedVersion,p_price_cents:priceCents,
        p_duration_days:durationDays,p_stage:stage,p_note:note,
        p_request:uuid(body.requestId,"requestId")
      });
      if(error)throw error;
      if(data?.source!=="admin_ads_sales_plan_save_v1_309"||
        data.merchantId!==merchantId||data.creativeVersion!==creativeVersion||
        !Number.isSafeInteger(data.version)||data.version<1||
        typeof data.changed!=="boolean"||typeof data.replayed!=="boolean"||
        data.stage!==stage||data.priceCents!==priceCents||
        data.durationDays!==durationDays||data.noCharge!==true||
        data.adsLive!==false||data.contractSigned!==false||
        data.merchantNotified!==false||data.paymentCreated!==false)
        throw new DomainError("ADS_SALES_PLAN_COMMIT_UNVERIFIED","Plano comercial não confirmado.",503);
      return json(data,200,origin);
    }
    if(action==="commercial-intake-set"){
      if(String(adminAccess.admin_role||"")!=="superadmin")
        throw new DomainError("ADMIN_PERMISSION_DENIED","Somente o administrador principal altera propostas comerciais.",403);
      const moduleKey=String(body.moduleKey||"");
      if(!["ads_proposals","clube_proposals"].includes(moduleKey)||typeof body.enabled!=="boolean"||
        !Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)
        throw new DomainError("MARKETING_INTAKE_ACTION_INVALID","Atualize o estado comercial.",400);
      const reason=cleanText(body.reason,{min:8,max:240,name:"justificativa"});
      const {data,error}=await admin.rpc("admin_marketing_intake_set_v1_308",{
        p_actor:user.id,p_module:moduleKey,p_enabled:body.enabled,
        p_reason:reason,p_expected_version:body.expectedVersion
      });
      if(error)throw error;
      if(data?.source!=="admin_marketing_intake_set_v1_308"||
        data.moduleKey!==moduleKey||data.enabled!==body.enabled||
        !Number.isSafeInteger(data.version)||data.version<1||
        typeof data.changed!=="boolean"||data.adsPublicationEnabled!==false||
        data.couponSalesEnabled!==false||data.noMoneyMovement!==true)
        throw new DomainError("MARKETING_INTAKE_COMMIT_UNVERIFIED","Decisão comercial não confirmada.",503);
      return json(data,200,origin);
    }
    if(action==="market-city-commerce"){
      // Only superadmin can authorize city commerce. requireAdminAction already
      // excludes all other roles, and PostgreSQL enforces the role again.
      if(String(adminAccess.admin_role)!=="superadmin"){
        throw new DomainError("ADMIN_PERMISSION_DENIED",
          "A liberação comercial da cidade exige o administrador principal.",403);
      }
      const city=cleanText(body.city,{min:2,max:120,name:"cidade"});
      const state=String(body.state||"").trim().toUpperCase();
      const enabled=body.enabled;
      if(!/^[A-Z]{2}$/.test(state)||typeof enabled!=="boolean"){
        throw new DomainError("INVALID_CITY_COMMERCE","Liberação de cidade inválida.",400);
      }
      const reason=cleanText(body.reason,{min:5,max:240,name:"justificativa"});
      const {data,error}=await admin.rpc("admin_set_market_city_commerce",{
        p_actor_user_id:user.id,p_city:city,p_state:state,
        p_enabled:enabled,p_reason:reason
      });
      if(error)throw error;
      if(data?.globalModeUnchanged!==true||data?.noMerchantActivation!==true){
        throw new DomainError("CITY_COMMERCE_CONFIRMATION_INVALID",
          "Não foi possível confirmar a decisão comercial no banco.",503);
      }
      return json(data,200,origin);
    }
    if(action==="market-city-pause"){
      const city=cleanText(body.city,{min:2,max:120,name:"cidade"});
      const state=String(body.state||"").trim().toUpperCase();
      const paused=body.paused;
      if(typeof paused!=="boolean")throw new DomainError("INVALID_CITY_PAUSE","Estado da cidade inválido.",400);
      const reason=cleanText(body.reason,{min:5,max:240,name:"justificativa"});
      const {data,error}=await admin.rpc("admin_set_market_city_pause",{
        p_actor_user_id:user.id,p_city:city,p_state:state,p_paused:paused,p_reason:reason
      });
      if(error)throw error;
      return json(data,200,origin);
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
    }else if(action==="merchant-representation-review"){
      const decision=String(body.decision??"");
      if(!["verify","revoke"].includes(decision)){
        throw new DomainError("INVALID_REPRESENTATION_DECISION","Ação de representação inválida.",400);
      }
      payload={
        merchantId:uuid(body.merchantId,"merchant"),
        ownerUserId:decision==="verify"?uuid(body.ownerUserId,"owner"):null,
        decision,
        authorityKind:decision==="verify"?String(body.authorityKind??""):null,
        evidenceReference:cleanText(body.evidenceReference,{min:8,max:240,name:"referência documental"})
      };
      if(decision==="verify"&&!["legal_representative","authorized_delegate"].includes(String(payload.authorityKind))){
        throw new DomainError("INVALID_REPRESENTATION_AUTHORITY","Tipo de representação inválido.",400);
      }
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
        throw new DomainError("INVALID_PILOT_INVITE_ACTION","Ação de convite de parceiro inválida.",400);
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
      const merchantId=uuid(body.merchantId,"merchant");
      const reference=cleanText(body.reference,{
        min:3,max:240,name:"referência de ativação ou suspensão de pagamento"
      });
      if(enabled){
        const preflight=await merchantPaymentPreflight(admin,user.id,merchantId,provider);
        if(preflight.readyForActivation!==true){
          throw new DomainError(
            "MERCHANT_PAYMENT_PREFLIGHT_FAILED",
            "A confirmação automática não pode ser ativada enquanto a verificação obrigatória possuir bloqueios.",
            409
          );
        }
      }
      payload={
        merchantId,
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
    if(action==="merchant-representation-review"){
      rpcName="admin_merchant_representation_action";
      rpcArgs={
        p_actor_user_id:user.id,
        p_merchant_id:payload.merchantId,
        p_owner_user_id:payload.ownerUserId,
        p_decision:payload.decision,
        p_authority_kind:payload.authorityKind,
        p_evidence_reference:payload.evidenceReference,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      };
    }else if(action==="set-delivery-capability"){
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
      return json({error:"MERCHANT_PAYMENT_ACCOUNT_NOT_CONNECTED",message:"A revenda precisa conectar a própria conta deste provedor antes de ativar a confirmação automática."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_ACCOUNT_NOT_READY")){
      return json({error:"MERCHANT_PAYMENT_ACCOUNT_NOT_READY",message:"A conexão da revenda com este provedor ainda não está pronta para confirmação automática."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_PREFLIGHT_FAILED")){
      return json({error:"MERCHANT_PAYMENT_PREFLIGHT_FAILED",message:"A verificação de ativação ainda possui bloqueios. Resolva os requisitos antes de ativar a confirmação automática."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_MERCHANT_NOT_ACTIVE")){
      return json({error:"MERCHANT_PAYMENT_MERCHANT_NOT_ACTIVE",message:"A revenda precisa estar operacionalmente ativa antes de habilitar pagamentos automáticos."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_AUTOMATED_ROUTE_REQUIRED")){
      return json({error:"MERCHANT_PAYMENT_AUTOMATED_ROUTE_REQUIRED",message:"A conta PSP ainda não possui uma rota automática ativa e vinculada para esta configuração."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_PILOT_IN_FLIGHT")){
      return json({error:"MERCHANT_PAYMENT_PILOT_IN_FLIGHT",message:"Já existe uma transação automática em validação para esta revenda e PSP."},409,origin);
    }
    if(message.includes("INVALID_MERCHANT_PAYMENT_CAPABILITY")){
      return json({error:"INVALID_MERCHANT_PAYMENT_CAPABILITY",message:"A confirmação automática ainda não está disponível para este provedor no TAMÃO."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_REVIEW_REQUIRED")){
      return json({error:"MERCHANT_PAYMENT_REVIEW_REQUIRED",message:"Existe uma transação da revenda em revisão; resolva-a antes de reativar pagamentos diretos."},409,origin);
    }
    if(message.includes("MERCHANT_PAYMENT_CAPABILITY_REFERENCE_REQUIRED")){
      return json({error:"MERCHANT_PAYMENT_CAPABILITY_REFERENCE_REQUIRED",message:"Informe a referência da ativação, reativação ou suspensão."},400,origin);
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
      return json({error:"PILOT_PARTNER_NOT_FOUND",message:"Parceiro não encontrado."},404,origin);
    }
    if(message.includes("PILOT_PARTNER_CANCELLED")){
      return json({error:"PILOT_PARTNER_CANCELLED",message:"Este cadastro de parceiro foi cancelado."},409,origin);
    }
    if(message.includes("PILOT_PARTNER_INVITE_NOT_ALLOWED")){
      return json({error:"PILOT_PARTNER_INVITE_NOT_ALLOWED",message:"Este parceiro já foi convertido ou cancelado e não pode receber novo convite."},409,origin);
    }
    if(message.includes("INVALID_PILOT_INVITE_EXPIRY")){
      return json({error:"INVALID_PILOT_INVITE_EXPIRY",message:"Validade do convite inválida."},400,origin);
    }
    if(message.includes("INVALID_PILOT_INVITE_ACTION")||message.includes("INVALID_PILOT_INVITE_TOKEN_HASH")){
      return json({error:"INVALID_PILOT_INVITE_ACTION",message:"Não foi possível validar a operação de convite de parceiro."},400,origin);
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
