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

function redirect(status:string,detail:string|null=null){
  const url=new URL(MERCHANT_PORTAL);
  url.searchParams.set("paymentConnection","mercadopago");
  url.searchParams.set("status",status);
  if(detail)url.searchParams.set("detail",detail);
  return Response.redirect(url.toString(),303);
}
function config(){
  const clientId=String(Deno.env.get("MERCADOPAGO_CLIENT_ID")??"").trim();
  const clientSecret=String(Deno.env.get("MERCADOPAGO_CLIENT_SECRET")??"").trim();
  const encryptionKey=String(Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??"").trim();
  if(
    clientId.length<5||clientId.length>160
    ||clientSecret.length<10||clientSecret.length>512
    ||!paymentEncryptionConfigured(encryptionKey)
  ){
    throw new Error("MERCADOPAGO_OAUTH_NOT_CONFIGURED");
  }
  return {clientId,clientSecret,encryptionKey};
}
async function boundedJson(response:Response){
  const raw=await response.text();
  if(new TextEncoder().encode(raw).byteLength>250000){
    throw new Error("MERCADOPAGO_OAUTH_RESPONSE_TOO_LARGE");
  }
  if(!raw)return {};
  try{return JSON.parse(raw)}catch{throw new Error("MERCADOPAGO_OAUTH_INVALID_JSON")}
}
async function exchangeCode(
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
      headers:{
        "Accept":"application/json",
        "Content-Type":"application/json"
      },
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
    const data=await boundedJson(response);
    if(!response.ok){
      throw new Error(
        response.status===400?"MERCADOPAGO_OAUTH_CODE_REJECTED":
        response.status===401?"MERCADOPAGO_OAUTH_CLIENT_REJECTED":
        "MERCADOPAGO_OAUTH_HTTP_"+response.status
      );
    }
    return data;
  }finally{
    clearTimeout(timer);
  }
}
async function verifySellerToken(accessToken:string,expectedUserId:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch("https://api.mercadolibre.com/users/me",{
      method:"GET",
      headers:{
        "Accept":"application/json",
        "Authorization":"Bearer "+accessToken
      },
      signal:controller.signal
    });
    const data=await boundedJson(response);
    if(!response.ok)throw new Error("MERCADOPAGO_OAUTH_TOKEN_VERIFY_FAILED");
    const actual=String(data?.id??"").trim();
    if(!actual||actual!==expectedUserId){
      throw new Error("MERCADOPAGO_OAUTH_ACCOUNT_MISMATCH");
    }
    return actual;
  }finally{
    clearTimeout(timer);
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="GET")return new Response("Method Not Allowed",{status:405});
  try{
    const url=new URL(req.url);
    const providerError=String(url.searchParams.get("error")??"").trim();
    if(providerError){
      return redirect("cancelled");
    }

    const code=String(url.searchParams.get("code")??"").trim();
    const state=String(url.searchParams.get("state")??"").trim();
    if(
      code.length<8||code.length>512
      ||state.length<32||state.length>256
      ||/[\u0000-\u001f\u007f]/.test(code+state)
    ){
      return redirect("error","invalid_callback");
    }

    const cfg=config();
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
      return redirect("error","invalid_state");
    }
    if(oauthState.provider!=="mercadopago"){
      return redirect("error","provider_mismatch");
    }

    const merchantId=String(oauthState.merchantId??"");
    const redirectUri=String(oauthState.redirectUri??"");
    const aad="oauth-state:"+merchantId+":mercadopago:"+stateHash;
    const verifier=await decryptPaymentSecret(
      oauthState.codeVerifierCiphertext,
      oauthState.codeVerifierNonce,
      cfg.encryptionKey,
      aad
    );

    const token=await exchangeCode(cfg,code,redirectUri,verifier);
    const accessToken=String(token?.access_token??"").trim();
    const refreshToken=String(token?.refresh_token??"").trim();
    const providerAccountId=String(token?.user_id??"").trim();
    const expiresIn=Number(token?.expires_in??0);
    if(
      accessToken.length<20||accessToken.length>4096
      ||refreshToken.length<8||refreshToken.length>4096
      ||providerAccountId.length<1||providerAccountId.length>160
      ||!Number.isSafeInteger(expiresIn)||expiresIn<300||expiresIn>366*86400
    ){
      throw new Error("MERCADOPAGO_OAUTH_TOKEN_SHAPE_INVALID");
    }

    await verifySellerToken(accessToken,providerAccountId);

    const accountAad="provider-account:"+merchantId+":mercadopago";
    const [accessEncrypted,refreshEncrypted]=await Promise.all([
      encryptPaymentSecret(accessToken,cfg.encryptionKey,accountAad+":access"),
      encryptPaymentSecret(refreshToken,cfg.encryptionKey,accountAad+":refresh")
    ]);
    const now=new Date();
    const tokenExpiresAt=new Date(now.getTime()+expiresIn*1000).toISOString();
    const {error:upsertError}=await admin
      .from("merchant_payment_provider_accounts")
      .upsert({
        merchant_id:merchantId,
        provider:"mercadopago",
        provider_account_id:providerAccountId,
        status:"active",
        capabilities:{
          oauthConnected:true,
          canValidateProviderTransactions:true,
          directSalePaymentsEnabled:false,
          liveMode:token?.live_mode===true,
          scope:String(token?.scope??"").split(/\s+/).filter(Boolean)
        },
        access_token_ciphertext:accessEncrypted.ciphertext,
        access_token_nonce:accessEncrypted.nonce,
        refresh_token_ciphertext:refreshEncrypted.ciphertext,
        refresh_token_nonce:refreshEncrypted.nonce,
        token_expires_at:tokenExpiresAt,
        connected_at:now.toISOString(),
        refreshed_at:now.toISOString(),
        revoked_at:null,
        last_error_code:null,
        last_error_at:null,
        updated_at:now.toISOString()
      },{
        onConflict:"merchant_id,provider"
      });
    if(upsertError)throw upsertError;

    return redirect("connected");
  }catch(error){
    console.error(
      "merchant-payment-oauth-callback failed",
      error instanceof Error?error.message:String(error)
    );
    return redirect("error","connection_failed");
  }
});
