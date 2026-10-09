import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";
import {
  randomBase64Url,
  sha256Base64Url,
  sha256Hex,
  encryptPaymentSecret,
  paymentEncryptionConfigured
} from "../_shared/payment-secrets.js";

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
  const allowed=origin&&originAllowed(origin)?origin:"https://tamao-sg-revenda.pages.dev";
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
  return assertPermanentMerchantUser(data.user);
}
async function financeMembership(admin:any,userId:string,merchantId:string){
  const {data,error}=await admin
    .from("merchant_members")
    .select("member_role,active")
    .eq("merchant_id",merchantId)
    .eq("user_id",userId)
    .eq("active",true)
    .maybeSingle();
  if(error)throw error;
  if(!data||!["owner","manager"].includes(data.member_role)){
    throw new DomainError(
      "MERCHANT_PAYMENT_PERMISSION_DENIED",
      "Somente owner ou gerente pode gerenciar recebimentos.",
      403
    );
  }
  return data;
}
function httpsUrl(value:string){
  try{
    const url=new URL(value);
    return url.protocol==="https:"&&!url.username&&!url.password;
  }catch{return false}
}
function encryptionKey(){
  const value=String(Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??"").trim();
  if(!paymentEncryptionConfigured(value)){
    throw new DomainError(
      "MERCHANT_PAYMENT_ENCRYPTION_NOT_CONFIGURED",
      "A camada segura de conexão de pagamentos ainda não está configurada.",
      503
    );
  }
  return value;
}
function mercadoPagoConfig(){
  const clientId=String(Deno.env.get("MERCADOPAGO_CLIENT_ID")??"").trim();
  const redirectUri=String(Deno.env.get("MERCADOPAGO_OAUTH_REDIRECT_URI")??"").trim();
  if(clientId.length<5||clientId.length>160||!httpsUrl(redirectUri)){
    throw new DomainError(
      "MERCADOPAGO_OAUTH_NOT_CONFIGURED",
      "A conexão Mercado Pago ainda não está configurada no TAMÃO.",
      503
    );
  }
  return {clientId,redirectUri,encryptionKey:encryptionKey()};
}
function pagBankConfig(){
  const clientId=String(Deno.env.get("PAGBANK_CLIENT_ID")??"").trim();
  const clientSecret=String(Deno.env.get("PAGBANK_CLIENT_SECRET")??"").trim();
  const authToken=String(Deno.env.get("PAGBANK_AUTH_TOKEN")??"").trim();
  const redirectUri=String(Deno.env.get("PAGBANK_OAUTH_REDIRECT_URI")??"").trim();
  const authBase=String(
    Deno.env.get("PAGBANK_CONNECT_AUTH_BASE_URL")
      ??"https://connect.pagseguro.uol.com.br"
  ).trim().replace(/\/$/,"");
  const apiBase=String(
    Deno.env.get("PAGBANK_API_BASE_URL")
      ??"https://api.pagseguro.com"
  ).trim().replace(/\/$/,"");
  const allowedAuthBases=new Set([
    "https://connect.pagseguro.uol.com.br",
    "https://connect.sandbox.pagseguro.uol.com.br"
  ]);
  const allowedApiBases=new Set([
    "https://api.pagseguro.com",
    "https://sandbox.api.pagseguro.com"
  ]);
  if(
    clientId.length<5||clientId.length>160
    ||clientSecret.length<8||clientSecret.length>512
    ||authToken.length<12||authToken.length>4096
    ||!httpsUrl(redirectUri)
    ||!allowedAuthBases.has(authBase)
    ||!allowedApiBases.has(apiBase)
  ){
    throw new DomainError(
      "PAGBANK_CONNECT_NOT_CONFIGURED",
      "O conector PagBank está preparado, mas ainda depende das credenciais Connect do TAMÃO.",
      503
    );
  }
  return {
    clientId,clientSecret,authToken,redirectUri,authBase,apiBase,
    encryptionKey:encryptionKey()
  };
}
function publicAccount(row:any,provider:string){
  if(!row){
    return {
      provider,
      connected:false,
      status:"not_connected",
      providerAccountId:null,
      connectionMode:null,
      verificationLevel:null,
      connectedAt:null,
      tokenExpiresAt:null,
      refreshedAt:null,
      revokedAt:null,
      lastErrorCode:null,
      lastErrorAt:null,
      capabilities:{},
      fundsOwner:"merchant",
      tamaoReceivesSaleProceeds:false
    };
  }
  return {
    id:row.id,
    provider:row.provider,
    connected:row.status==="active",
    status:row.status,
    providerAccountId:row.provider_account_id??null,
    connectionMode:row.connection_mode??null,
    verificationLevel:row.verification_level??null,
    connectedAt:row.connected_at??null,
    tokenExpiresAt:row.token_expires_at??null,
    refreshedAt:row.refreshed_at??null,
    revokedAt:row.revoked_at??null,
    lastErrorCode:row.last_error_code??null,
    lastErrorAt:row.last_error_at??null,
    capabilities:row.capabilities??{},
    metadata:row.metadata??{},
    fundsOwner:"merchant",
    tamaoReceivesSaleProceeds:false
  };
}
async function providerDefinition(admin:any,provider:string){
  const {data,error}=await admin
    .from("payment_provider_catalog")
    .select("provider_key,display_name,connection_mode,verification_level,adapter_status,supported_methods,supports_webhook,supports_lookup,requires_platform_credentials,funds_flow,notes")
    .eq("provider_key",provider)
    .maybeSingle();
  if(error)throw error;
  if(!data)throw new DomainError("PAYMENT_PROVIDER_INVALID","Provedor de pagamento inválido.",400);
  return data;
}
async function saveOauthState(admin:any,{
  merchantId,provider,userId,state,redirectUri,encryptionKey,verifier,metadata={}
}:{
  merchantId:string;provider:string;userId:string;state:string;redirectUri:string;
  encryptionKey:string;verifier:string;metadata?:Record<string,unknown>
}){
  const stateHash=await sha256Hex(state);
  const aad="oauth-state:"+merchantId+":"+provider+":"+stateHash;
  const encrypted=await encryptPaymentSecret(verifier,encryptionKey,aad);
  const expiresAt=new Date(Date.now()+10*60_000).toISOString();

  await admin
    .from("merchant_payment_oauth_states")
    .delete()
    .eq("merchant_id",merchantId)
    .eq("provider",provider)
    .eq("initiated_by",userId)
    .is("consumed_at",null);

  const {error}=await admin
    .from("merchant_payment_oauth_states")
    .insert({
      merchant_id:merchantId,
      provider,
      initiated_by:userId,
      state_hash:stateHash,
      code_verifier_ciphertext:encrypted.ciphertext,
      code_verifier_nonce:encrypted.nonce,
      redirect_uri:redirectUri,
      expires_at:expiresAt,
      metadata
    });
  if(error)throw error;
  return {stateHash,expiresAt};
}
async function startMercadoPago(admin:any,merchantId:string,userId:string){
  const cfg=mercadoPagoConfig();
  const state=randomBase64Url(32);
  const verifier=randomBase64Url(48);
  const challenge=await sha256Base64Url(verifier);
  const {expiresAt}=await saveOauthState(admin,{
    merchantId,provider:"mercadopago",userId,state,
    redirectUri:cfg.redirectUri,encryptionKey:cfg.encryptionKey,verifier,
    metadata:{scopes:["offline_access","read","write"]}
  });
  const authorize=new URL("https://auth.mercadopago.com/authorization");
  authorize.searchParams.set("client_id",cfg.clientId);
  authorize.searchParams.set("response_type","code");
  authorize.searchParams.set("platform_id","mp");
  authorize.searchParams.set("state",state);
  authorize.searchParams.set("redirect_uri",cfg.redirectUri);
  authorize.searchParams.set("code_challenge",challenge);
  authorize.searchParams.set("code_challenge_method","S256");
  return {
    provider:"mercadopago",
    authorizationUrl:authorize.toString(),
    expiresAt,
    fundsOwner:"merchant",
    tamaoReceivesSaleProceeds:false
  };
}
async function startPagBank(admin:any,merchantId:string,userId:string){
  const cfg=pagBankConfig();
  const state=randomBase64Url(32);
  // PagBank Connect Authorization documents state but not PKCE. We keep a
  // one-time encrypted nonce in the common state envelope for parity/audit.
  const nonce=randomBase64Url(48);
  const scope="payments.read payments.create accounts.read";
  const {expiresAt}=await saveOauthState(admin,{
    merchantId,provider:"pagbank",userId,state,
    redirectUri:cfg.redirectUri,encryptionKey:cfg.encryptionKey,verifier:nonce,
    metadata:{scope,apiBase:cfg.apiBase,authBase:cfg.authBase}
  });
  const authorize=new URL(cfg.authBase+"/oauth2/authorize");
  authorize.searchParams.set("client_id",cfg.clientId);
  authorize.searchParams.set("response_type","code");
  authorize.searchParams.set("redirect_uri",cfg.redirectUri);
  authorize.searchParams.set("scope",scope);
  authorize.searchParams.set("state",state);
  return {
    provider:"pagbank",
    authorizationUrl:authorize.toString(),
    expiresAt,
    scopes:scope.split(" "),
    fundsOwner:"merchant",
    tamaoReceivesSaleProceeds:false
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
    const merchantId=String(body.merchantId??"").trim();
    const action=String(body.action??"status").trim().toLowerCase();
    const provider=String(body.provider??"mercadopago").trim().toLowerCase();
    if(!UUID_RE.test(merchantId)){
      throw new DomainError("INVALID_MERCHANT","Revenda inválida.",400);
    }
    if(!["status","start","disconnect"].includes(action)){
      throw new DomainError("INVALID_PAYMENT_CONNECTION_ACTION","Ação de conexão inválida.",400);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    await enforceApiQuota(admin,{
      userId:user.id,
      actionName:"merchant-payment-connect",
      limit:30,
      windowSeconds:60
    });
    await financeMembership(admin,user.id,merchantId);
    const definition=await providerDefinition(admin,provider);

    if(action==="status"){
      const {data,error}=await admin
        .from("merchant_payment_provider_accounts")
        .select("id,provider,provider_account_id,status,connection_mode,verification_level,capabilities,metadata,token_expires_at,connected_at,refreshed_at,revoked_at,last_error_code,last_error_at")
        .eq("merchant_id",merchantId)
        .eq("provider",provider)
        .maybeSingle();
      if(error)throw error;
      return json({
        ok:true,
        provider:{
          key:definition.provider_key,
          displayName:definition.display_name,
          connectionMode:definition.connection_mode,
          verificationLevel:definition.verification_level,
          adapterStatus:definition.adapter_status,
          supportedMethods:definition.supported_methods,
          supportsWebhook:definition.supports_webhook===true,
          supportsLookup:definition.supports_lookup===true,
          requiresPlatformCredentials:definition.requires_platform_credentials===true,
          fundsFlow:definition.funds_flow,
          notes:definition.notes??null
        },
        account:publicAccount(data,provider)
      },200,origin);
    }

    if(action==="disconnect"){
      if(provider==="manual"){
        throw new DomainError("PAYMENT_PROVIDER_INVALID","A rota manual não possui conexão para desconectar.",400);
      }
      const {data,error}=await admin.rpc(
        "disconnect_merchant_payment_provider_account",
        {
          p_actor_user_id:user.id,
          p_merchant_id:merchantId,
          p_provider:provider
        }
      );
      if(error){
        const message=String(error.message??error);
        if(message.includes("PAYMENT_CONNECTION_HAS_ACTIVE_ROUTES")){
          throw new DomainError(
            "PAYMENT_CONNECTION_HAS_ACTIVE_ROUTES",
            "Desative primeiro as formas de pagamento que dependem desta conexão.",
            409
          );
        }
        if(message.includes("PAYMENT_CONNECTION_HAS_LIVE_ATTEMPTS")){
          throw new DomainError(
            "PAYMENT_CONNECTION_HAS_LIVE_ATTEMPTS",
            "Há transações em andamento nesta conexão. Aguarde ou resolva a transação antes de desconectar.",
            409
          );
        }
        throw error;
      }
      return json({ok:true,result:data},200,origin);
    }

    if(definition.adapter_status==="manual_only"||definition.connection_mode==="manual"){
      throw new DomainError(
        "PROVIDER_MANUAL_ONLY",
        definition.display_name+" pode ser usado como forma de recebimento, mas ainda não possui conexão automática oficial no TAMÃO.",
        409
      );
    }
    if(definition.adapter_status==="planned"){
      throw new DomainError(
        "PROVIDER_CONNECT_NOT_AVAILABLE",
        "Este conector ainda está planejado e não pode ser ativado.",
        409
      );
    }
    if(provider==="mercadopago"){
      return json({ok:true,...await startMercadoPago(admin,merchantId,user.id)},200,origin);
    }
    if(provider==="pagbank"){
      return json({ok:true,...await startPagBank(admin,merchantId,user.id)},200,origin);
    }

    throw new DomainError(
      "PROVIDER_CONNECT_SETUP_REQUIRED",
      definition.display_name+" já está modelado no TAMÃO, mas a conexão automática depende do credenciamento/credenciais deste provedor.",
      409
    );
  }catch(error){
    if(error instanceof DomainError){
      return json({error:error.code,message:error.message},error.status,origin);
    }
    console.error(
      "merchant-payment-connect failed",
      error instanceof Error?error.message:String(error)
    );
    return json({
      error:"MERCHANT_PAYMENT_CONNECTION_FAILED",
      message:"Não foi possível gerenciar a conexão de pagamentos agora."
    },503,origin);
  }
});
