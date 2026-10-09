import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  sha256Hex,
  decryptPaymentSecret,
  encryptPaymentSecret,
  paymentEncryptionConfigured
} from "../_shared/payment-secrets.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MERCHANT_PORTAL="https://parceiro.tamao.com.br";

function redirect(provider:string,status:string,detail:string|null=null){
  const url=new URL(MERCHANT_PORTAL);
  url.searchParams.set("paymentConnection",provider||"unknown");
  url.searchParams.set("status",status);
  if(detail)url.searchParams.set("detail",detail);
  return Response.redirect(url.toString(),303);
}
function encryptionKey(){
  const value=String(Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??"").trim();
  if(!paymentEncryptionConfigured(value)){
    throw new Error("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY_INVALID");
  }
  return value;
}
function mercadoPagoConfig(){
  const clientId=String(Deno.env.get("MERCADOPAGO_CLIENT_ID")??"").trim();
  const clientSecret=String(Deno.env.get("MERCADOPAGO_CLIENT_SECRET")??"").trim();
  if(clientId.length<5||clientId.length>160||clientSecret.length<10||clientSecret.length>512){
    throw new Error("MERCADOPAGO_OAUTH_NOT_CONFIGURED");
  }
  return {clientId,clientSecret};
}
function pagBankConfig(){
  const clientId=String(Deno.env.get("PAGBANK_CLIENT_ID")??"").trim();
  const clientSecret=String(Deno.env.get("PAGBANK_CLIENT_SECRET")??"").trim();
  const authToken=String(Deno.env.get("PAGBANK_AUTH_TOKEN")??"").trim();
  const apiBase=String(
    Deno.env.get("PAGBANK_API_BASE_URL")
      ??"https://api.pagseguro.com"
  ).trim().replace(/\/$/,"");
  const allowedApiBases=new Set([
    "https://api.pagseguro.com",
    "https://sandbox.api.pagseguro.com"
  ]);
  if(
    clientId.length<5||clientId.length>160
    ||clientSecret.length<8||clientSecret.length>512
    ||authToken.length<12||authToken.length>4096
    ||!allowedApiBases.has(apiBase)
  ){
    throw new Error("PAGBANK_CONNECT_NOT_CONFIGURED");
  }
  return {clientId,clientSecret,authToken,apiBase};
}
async function boundedJson(response:Response,label:string){
  const raw=await response.text();
  if(new TextEncoder().encode(raw).byteLength>250000){
    throw new Error(label+"_RESPONSE_TOO_LARGE");
  }
  if(!raw)return {};
  try{return JSON.parse(raw)}catch{throw new Error(label+"_INVALID_JSON")}
}
async function exchangeMercadoPagoCode(
  cfg:{clientId:string;clientSecret:string},
  code:string,
  redirectUri:string,
  verifier:string
){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch("https://api.mercadopago.com/oauth/token",{
      method:"POST",
      headers:{"Accept":"application/json","Content-Type":"application/json"},
      body:JSON.stringify({
        client_id:cfg.clientId,
        client_secret:cfg.clientSecret,
        grant_type:"authorization_code",
        code,
        code_verifier:verifier,
        redirect_uri:redirectUri,
        test_token:false
      }),
      signal:controller.signal
    });
    const data=await boundedJson(response,"MERCADOPAGO_OAUTH");
    if(!response.ok){
      throw new Error(
        response.status===400?"MERCADOPAGO_OAUTH_CODE_REJECTED":
        response.status===401?"MERCADOPAGO_OAUTH_CLIENT_REJECTED":
        "MERCADOPAGO_OAUTH_HTTP_"+response.status
      );
    }
    return data;
  }finally{clearTimeout(timer)}
}
async function verifyMercadoPagoSellerToken(accessToken:string,expectedUserId:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch("https://api.mercadolibre.com/users/me",{
      method:"GET",
      headers:{"Accept":"application/json","Authorization":"Bearer "+accessToken},
      signal:controller.signal
    });
    const data=await boundedJson(response,"MERCADOPAGO_SELLER");
    if(!response.ok)throw new Error("MERCADOPAGO_OAUTH_TOKEN_VERIFY_FAILED");
    const actual=String(data?.id??"").trim();
    if(!actual||actual!==expectedUserId){
      throw new Error("MERCADOPAGO_OAUTH_ACCOUNT_MISMATCH");
    }
    return actual;
  }finally{clearTimeout(timer)}
}
async function exchangePagBankCode(
  cfg:{clientId:string;clientSecret:string;authToken:string;apiBase:string},
  code:string,
  redirectUri:string
){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(cfg.apiBase+"/oauth2/token",{
      method:"POST",
      headers:{
        "Accept":"application/json",
        "Content-Type":"application/json",
        "Authorization":"Bearer "+cfg.authToken,
        "X_CLIENT_ID":cfg.clientId,
        "X_CLIENT_SECRET":cfg.clientSecret
      },
      body:JSON.stringify({
        grant_type:"authorization_code",
        code,
        redirect_uri:redirectUri
      }),
      signal:controller.signal
    });
    const data=await boundedJson(response,"PAGBANK_OAUTH");
    if(!response.ok){
      throw new Error(
        response.status===400?"PAGBANK_OAUTH_CODE_REJECTED":
        response.status===401||response.status===403?"PAGBANK_OAUTH_CLIENT_REJECTED":
        "PAGBANK_OAUTH_HTTP_"+response.status
      );
    }
    return data;
  }finally{clearTimeout(timer)}
}
function pagBankAccountId(token:any){
  const candidates=[
    token?.account_id,
    token?.account?.id,
    token?.accountId,
    token?.seller?.account_id,
    token?.seller?.accountId
  ];
  for(const value of candidates){
    const id=String(value??"").trim();
    if(id.length>=2&&id.length<=160&&!/[\u0000-\u001f\u007f]/.test(id))return id;
  }
  return null;
}
async function verifyPagBankSellerToken(
  cfg:{authToken:string;apiBase:string},
  accessToken:string,
  accountId:string
){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(
      cfg.apiBase+"/accounts/"+encodeURIComponent(accountId),
      {
        method:"GET",
        headers:{
          "Accept":"application/json",
          "Authorization":"Bearer "+cfg.authToken,
          "x-client-token":accessToken
        },
        signal:controller.signal
      }
    );
    const data=await boundedJson(response,"PAGBANK_ACCOUNT");
    if(!response.ok)throw new Error("PAGBANK_OAUTH_TOKEN_VERIFY_FAILED");
    const actual=String(data?.id??data?.account_id??"").trim();
    if(actual&&actual!==accountId){
      throw new Error("PAGBANK_OAUTH_ACCOUNT_MISMATCH");
    }
    return actual||accountId;
  }finally{clearTimeout(timer)}
}
function tokenExpiry(token:any){
  const expiresIn=Number(token?.expires_in??token?.expiresIn??0);
  if(Number.isSafeInteger(expiresIn)&&expiresIn>=300&&expiresIn<=366*86400){
    return {
      expiresIn,
      tokenExpiresAt:new Date(Date.now()+expiresIn*1000).toISOString()
    };
  }
  const expiresAt=Date.parse(String(token?.expires_at??token?.expiresAt??""));
  if(Number.isFinite(expiresAt)&&expiresAt>Date.now()+5*60_000&&expiresAt<Date.now()+366*86400_000){
    return {
      expiresIn:Math.floor((expiresAt-Date.now())/1000),
      tokenExpiresAt:new Date(expiresAt).toISOString()
    };
  }
  throw new Error("OAUTH_TOKEN_EXPIRY_INVALID");
}
async function upsertOauthAccount(admin:any,{
  merchantId,provider,providerAccountId,accessToken,refreshToken,
  tokenExpiresAt,scope,metadata,encryptionKey
}:{
  merchantId:string;provider:string;providerAccountId:string;
  accessToken:string;refreshToken:string;tokenExpiresAt:string;
  scope:string[];metadata:Record<string,unknown>;encryptionKey:string
}){
  const accountAad="provider-account:"+merchantId+":"+provider;
  const [accessEncrypted,refreshEncrypted]=await Promise.all([
    encryptPaymentSecret(accessToken,encryptionKey,accountAad+":access"),
    encryptPaymentSecret(refreshToken,encryptionKey,accountAad+":refresh")
  ]);
  const now=new Date().toISOString();
  const {error}=await admin
    .from("merchant_payment_provider_accounts")
    .upsert({
      merchant_id:merchantId,
      provider,
      provider_account_id:providerAccountId,
      status:"active",
      connection_mode:"oauth",
      verification_level:"provider",
      credential_kind:"oauth_access_token",
      capabilities:{
        oauthConnected:true,
        canValidateProviderTransactions:true,
        directSalePaymentsEnabled:false,
        scope
      },
      metadata,
      access_token_ciphertext:accessEncrypted.ciphertext,
      access_token_nonce:accessEncrypted.nonce,
      refresh_token_ciphertext:refreshEncrypted.ciphertext,
      refresh_token_nonce:refreshEncrypted.nonce,
      credential_bundle_ciphertext:null,
      credential_bundle_nonce:null,
      token_expires_at:tokenExpiresAt,
      connected_at:now,
      refreshed_at:now,
      revoked_at:null,
      last_error_code:null,
      last_error_at:null,
      updated_at:now
    },{onConflict:"merchant_id,provider"});
  if(error)throw error;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="GET")return new Response("Method Not Allowed",{status:405});
  let provider="unknown";
  try{
    const url=new URL(req.url);
    const code=String(url.searchParams.get("code")??"").trim();
    const state=String(url.searchParams.get("state")??"").trim();
    const providerError=String(url.searchParams.get("error")??"").trim();
    if(
      state.length<32||state.length>256
      ||/[\u0000-\u001f\u007f]/.test(state)
    ){
      return redirect(provider,"error","invalid_state");
    }

    const stateHash=await sha256Hex(state);
    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data:oauthState,error:stateError}=await admin.rpc(
      "consume_merchant_payment_oauth_state",
      {p_state_hash:stateHash}
    );
    if(stateError||!oauthState){
      console.error("merchant OAuth state rejected",String(stateError?.message??"state_rejected"));
      return redirect(provider,"error","invalid_state");
    }

    provider=String(oauthState.provider??"").trim().toLowerCase();
    if(!["mercadopago","pagbank"].includes(provider)){
      return redirect(provider,"error","provider_mismatch");
    }
    if(providerError){
      return redirect(provider,"cancelled");
    }
    if(code.length<8||code.length>512||/[\u0000-\u001f\u007f]/.test(code)){
      return redirect(provider,"error","invalid_callback");
    }

    const merchantId=String(oauthState.merchantId??"");
    const redirectUri=String(oauthState.redirectUri??"");
    const key=encryptionKey();
    const aad="oauth-state:"+merchantId+":"+provider+":"+stateHash;
    const verifier=await decryptPaymentSecret(
      oauthState.codeVerifierCiphertext,
      oauthState.codeVerifierNonce,
      key,
      aad
    );

    if(provider==="mercadopago"){
      const cfg=mercadoPagoConfig();
      const token=await exchangeMercadoPagoCode(cfg,code,redirectUri,verifier);
      const accessToken=String(token?.access_token??"").trim();
      const refreshToken=String(token?.refresh_token??"").trim();
      const providerAccountId=String(token?.user_id??"").trim();
      const expiry=tokenExpiry(token);
      if(
        accessToken.length<20||accessToken.length>4096
        ||refreshToken.length<8||refreshToken.length>4096
        ||providerAccountId.length<1||providerAccountId.length>160
      ){
        throw new Error("MERCADOPAGO_OAUTH_TOKEN_SHAPE_INVALID");
      }
      await verifyMercadoPagoSellerToken(accessToken,providerAccountId);
      await upsertOauthAccount(admin,{
        merchantId,provider,providerAccountId,accessToken,refreshToken,
        tokenExpiresAt:expiry.tokenExpiresAt,
        scope:String(token?.scope??"").split(/\s+/).filter(Boolean),
        metadata:{liveMode:token?.live_mode===true},
        encryptionKey:key
      });
      return redirect(provider,"connected");
    }

    // PagBank Connect Authorization. The provider account ID is intentionally
    // required and then verified via Accounts API before the connection becomes active.
    const cfg=pagBankConfig();
    const token=await exchangePagBankCode(cfg,code,redirectUri);
    const accessToken=String(token?.access_token??"").trim();
    const refreshToken=String(token?.refresh_token??"").trim();
    const providerAccountId=pagBankAccountId(token);
    const expiry=tokenExpiry(token);
    if(
      accessToken.length<20||accessToken.length>4096
      ||refreshToken.length<8||refreshToken.length>4096
      ||!providerAccountId
    ){
      throw new Error("PAGBANK_OAUTH_TOKEN_SHAPE_INVALID");
    }
    const verifiedAccountId=await verifyPagBankSellerToken(
      cfg,accessToken,providerAccountId
    );
    const scope=String(token?.scope??"payments.read payments.create accounts.read")
      .split(/\s+/).filter(Boolean);
    await upsertOauthAccount(admin,{
      merchantId,provider,providerAccountId:verifiedAccountId,
      accessToken,refreshToken,tokenExpiresAt:expiry.tokenExpiresAt,scope,
      metadata:{
        apiBase:cfg.apiBase,
        accountVerified:true
      },
      encryptionKey:key
    });
    return redirect(provider,"connected");
  }catch(error){
    console.error(
      "merchant-payment-oauth-callback failed",
      provider,
      error instanceof Error?error.message:String(error)
    );
    return redirect(provider,"error","connection_failed");
  }
});
