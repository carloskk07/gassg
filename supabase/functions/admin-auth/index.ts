import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {DomainError,readJsonBody,enforceApiQuota} from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ADMIN_ALLOWED_ORIGIN=(Deno.env.get("ADMIN_ALLOWED_ORIGIN")??"https://chama-sg-admin.netlify.app").trim();
const ADMIN_PRIMARY_ORIGINS=new Set([
  "https://tamao-sg-admin.pages.dev",
  "https://admin.tamao.com.br",
  ADMIN_ALLOWED_ORIGIN
].filter(Boolean));

function originAllowed(origin:string|null){
  if(!origin)return false;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return ADMIN_PRIMARY_ORIGINS.has(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:"https://tamao-sg-admin.pages.dev";
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
async function sha256Hex(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function enforceHashedQuota(admin:any,{
  keyHash,actionName,limit,windowSeconds
}:{keyHash:string,actionName:string,limit:number,windowSeconds:number}){
  if(!/^[0-9a-f]{64}$/.test(keyHash)){
    throw new DomainError("RATE_LIMIT_KEY_INVALID","Rate limiter inválido.",500);
  }
  const {data,error}=await admin.rpc("consume_hashed_api_quota",{
    p_key_hash:keyHash,
    p_action_name:actionName,
    p_limit:limit,
    p_window_seconds:windowSeconds
  });
  if(error){
    console.error("admin-auth hashed quota failed",String(error.code??"RPC_ERROR"),actionName);
    throw new DomainError("RATE_LIMIT_BACKEND_FAILED","Não foi possível validar o limite de requisições.",503);
  }
  if(data?.allowed!==true){
    throw new DomainError("RATE_LIMITED","Muitas tentativas. Aguarde antes de tentar novamente.",429);
  }
  return data;
}
function clientIp(req:Request){
  return String(
    req.headers.get("cf-connecting-ip")
    ||req.headers.get("x-real-ip")
    ||req.headers.get("x-forwarded-for")?.split(",")[0]
    ||"unknown"
  ).trim().slice(0,128);
}
function normalizeEmail(value:unknown){
  const email=String(value??"").trim().toLowerCase();
  if(email.length<3||email.length>160||!/^\S+@\S+\.\S+$/.test(email))throw new Error("INVALID_EMAIL");
  return email;
}
function safeRedirect(value:unknown,origin:string){
  const url=new URL(String(value??""));
  if(url.origin!==origin)throw new Error("INVALID_REDIRECT");
  if(!["http:","https:"].includes(url.protocol))throw new Error("INVALID_REDIRECT");
  url.searchParams.set("admin","1");
  url.hash="admin";
  return url.toString();
}
async function requestLoginLink(req:Request,origin:string,body:any){
  const email=normalizeEmail(body?.email);
  const captchaToken=String(body?.captchaToken??"").trim();

  const admin=createClient(SUPABASE_URL,SECRET_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const emailHash=await sha256Hex(email);
  const quotaSalt=SECRET_KEY.slice(0,32);
  const ipHash=await sha256Hex(quotaSalt+":ip:"+clientIp(req));
  const emailQuotaHash=await sha256Hex(quotaSalt+":email:"+email);

  // Every caller is throttled by a salted network hash before email eligibility is resolved.
  await enforceHashedQuota(admin,{
    keyHash:ipHash,
    actionName:"admin-auth-request-ip",
    limit:30,
    windowSeconds:3600
  });

  if(captchaToken.length<20){
    return json({error:"CAPTCHA_REQUIRED",message:"Verificação anti-bot obrigatória."},400,origin);
  }

  const redirectTo=safeRedirect(body?.redirectTo,origin);

  const {data:mode,error:modeError}=await admin.rpc("admin_login_mode",{
    p_email_sha256_hex:emailHash
  });
  if(modeError){
    console.error("admin-auth login mode failed",String(modeError.code??"RPC_ERROR"));
    return json({ok:true,message:"Se este e-mail estiver autorizado, o link de acesso será enviado."},200,origin);
  }

  if(!["existing_admin","bootstrap_reserved"].includes(String(mode??""))){
    return json({ok:true,message:"Se este e-mail estiver autorizado, o link de acesso será enviado."},200,origin);
  }

  // Only an authorized/reserved address can consume the stricter salted email quota.
  await enforceHashedQuota(admin,{
    keyHash:emailQuotaHash,
    actionName:"admin-auth-request-email",
    limit:5,
    windowSeconds:3600
  });

  const auth=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {error}=await auth.auth.signInWithOtp({
    email,
    options:{
      emailRedirectTo:redirectTo,
      shouldCreateUser:mode==="bootstrap_reserved",
      captchaToken
    }
  });
  if(error){
    console.error("admin-auth otp failed",String(error.code??error.status??"AUTH_ERROR"));
  }

  return json({ok:true,message:"Se este e-mail estiver autorizado, o link de acesso será enviado."},200,origin);
}
async function claimBootstrap(req:Request,origin:string){
  const authHeader=req.headers.get("Authorization");
  if(!authHeader?.startsWith("Bearer ")){
    return json({error:"UNAUTHORIZED",message:"Sessão administrativa obrigatória."},401,origin);
  }
  const token=authHeader.slice("Bearer ".length);
  const auth=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data,error}=await auth.auth.getUser(token);
  if(error||!data.user||data.user.is_anonymous===true){
    return json({error:"UNAUTHORIZED",message:"Conta permanente obrigatória."},401,origin);
  }

  const admin=createClient(SUPABASE_URL,SECRET_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  await enforceApiQuota(admin,{
    userId:data.user.id,
    actionName:"admin-auth-claim",
    limit:20,
    windowSeconds:300
  });
  const {data:claim,error:claimError}=await admin.rpc("claim_reserved_platform_admin",{
    p_user_id:data.user.id
  });
  if(claimError){
    const code=String(claimError.code??"RPC_ERROR");
    console.error("admin-auth bootstrap claim failed",code);
    if(code==="40001"){
      return json({
        error:"ADMIN_BOOTSTRAP_RETRY",
        message:"Houve uma concorrência temporária ao validar o primeiro acesso. Tente novamente."
      },409,origin);
    }
    if(code==="42501"){
      return json({
        error:"ADMIN_IDENTITY_NOT_CONFIRMED",
        message:"A identidade administrativa precisa estar confirmada."
      },403,origin);
    }
    return json({
      error:"ADMIN_BOOTSTRAP_FAILED",
      message:"Não foi possível concluir a validação administrativa agora."
    },503,origin);
  }

  const status=String(claim?.status??"unknown");
  const safeStatus=["claimed","existing_admin","bootstrap_closed","not_reserved"].includes(status)
    ? status
    : "unknown";

  return json({ok:true,status:safeStatus},200,origin);
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const body=await readJsonBody(req);
    const action=String(body?.action??"");
    if(action==="request-link")return await requestLoginLink(req,origin!,body);
    if(action==="claim")return await claimBootstrap(req,origin!);
    return json({error:"INVALID_ACTION",message:"Ação inválida."},400,origin);
  }catch(error){
    if(error instanceof DomainError){
      return json({error:error.code,message:error.message},error.status,origin);
    }
    const code=error instanceof Error?error.message:"INVALID_REQUEST";
    if(["INVALID_EMAIL","INVALID_REDIRECT"].includes(code)){
      return json({error:code,message:"Dados de acesso inválidos."},400,origin);
    }
    console.error("admin-auth failed",code);
    return json({error:"INVALID_REQUEST",message:"Não foi possível processar o acesso."},400,origin);
  }
});
