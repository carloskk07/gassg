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
function oauthConfig(){
  const clientId=String(Deno.env.get("MERCADOPAGO_CLIENT_ID")??"").trim();
  const redirectUri=String(Deno.env.get("MERCADOPAGO_OAUTH_REDIRECT_URI")??"").trim();
  const encryptionKey=String(Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??"").trim();
  let redirectValid=false;
  try{
    const u=new URL(redirectUri);
    redirectValid=u.protocol==="https:"&&!u.username&&!u.password;
  }catch{}
  if(
    clientId.length<5||clientId.length>160
    ||!redirectValid
    ||!paymentEncryptionConfigured(encryptionKey)
  ){
    throw new DomainError(
      "MERCADOPAGO_OAUTH_NOT_CONFIGURED",
      "A conexão Mercado Pago ainda não está configurada no TAMÃO.",
      503
    );
  }
  return {clientId,redirectUri,encryptionKey};
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
function publicAccount(row:any){
  if(!row){
    return {
      provider:"mercadopago",
      connected:false,
      status:"not_connected",
      providerAccountId:null,
      connectedAt:null,
      tokenExpiresAt:null,
      refreshedAt:null,
      revokedAt:null,
      lastErrorCode:null,
      lastErrorAt:null,
      capabilities:{}
    };
  }
  return {
    provider:"mercadopago",
    connected:row.status==="active",
    status:row.status,
    providerAccountId:row.provider_account_id??null,
    connectedAt:row.connected_at??null,
    tokenExpiresAt:row.token_expires_at??null,
    refreshedAt:row.refreshed_at??null,
    revokedAt:row.revoked_at??null,
    lastErrorCode:row.last_error_code??null,
    lastErrorAt:row.last_error_at??null,
    capabilities:row.capabilities??{}
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

    if(action==="status"){
      const {data,error}=await admin
        .from("merchant_payment_provider_accounts")
        .select("provider_account_id,status,capabilities,token_expires_at,connected_at,refreshed_at,revoked_at,last_error_code,last_error_at")
        .eq("merchant_id",merchantId)
        .eq("provider","mercadopago")
        .maybeSingle();
      if(error)throw error;
      return json({ok:true,account:publicAccount(data)},200,origin);
    }

    if(action==="disconnect"){
      const {data,error}=await admin.rpc(
        "disconnect_merchant_payment_provider_account",
        {
          p_actor_user_id:user.id,
          p_merchant_id:merchantId,
          p_provider:"mercadopago"
        }
      );
      if(error)throw error;
      return json({ok:true,result:data},200,origin);
    }

    const config=oauthConfig();
    const state=randomBase64Url(32);
    const stateHash=await sha256Hex(state);
    const verifier=randomBase64Url(48);
    const challenge=await sha256Base64Url(verifier);
    const aad="oauth-state:"+merchantId+":mercadopago:"+stateHash;
    const encrypted=await encryptPaymentSecret(
      verifier,config.encryptionKey,aad
    );
    const expiresAt=new Date(Date.now()+10*60_000).toISOString();

    await admin
      .from("merchant_payment_oauth_states")
      .delete()
      .eq("merchant_id",merchantId)
      .eq("provider","mercadopago")
      .eq("initiated_by",user.id)
      .is("consumed_at",null);

    const {error:insertError}=await admin
      .from("merchant_payment_oauth_states")
      .insert({
        merchant_id:merchantId,
        provider:"mercadopago",
        initiated_by:user.id,
        state_hash:stateHash,
        code_verifier_ciphertext:encrypted.ciphertext,
        code_verifier_nonce:encrypted.nonce,
        redirect_uri:config.redirectUri,
        expires_at:expiresAt
      });
    if(insertError)throw insertError;

    const authorize=new URL("https://auth.mercadopago.com/authorization");
    authorize.searchParams.set("client_id",config.clientId);
    authorize.searchParams.set("response_type","code");
    authorize.searchParams.set("platform_id","mp");
    authorize.searchParams.set("state",state);
    authorize.searchParams.set("redirect_uri",config.redirectUri);
    authorize.searchParams.set("code_challenge",challenge);
    authorize.searchParams.set("code_challenge_method","S256");

    return json({
      ok:true,
      provider:"mercadopago",
      authorizationUrl:authorize.toString(),
      expiresAt
    },200,origin);
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
