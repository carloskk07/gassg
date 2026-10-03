import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {DomainError,readJsonBody,enforceApiQuota} from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ADMIN_ALLOWED_ORIGIN=(Deno.env.get("ADMIN_ALLOWED_ORIGIN")??"").trim();

function originAllowed(origin:string|null){
  if(!origin)return false;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return ADMIN_ALLOWED_ORIGIN.length>0&&origin===ADMIN_ALLOWED_ORIGIN;
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:(ADMIN_ALLOWED_ORIGIN||"null");
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
function quotaUuidFromHash(hex:string){
  const raw=hex.slice(0,32).padEnd(32,"0");
  return raw.slice(0,8)+"-"+raw.slice(8,12)+"-"+raw.slice(12,16)+"-"+raw.slice(16,20)+"-"+raw.slice(20,32);
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
  if(captchaToken.length<20)return json({error:"CAPTCHA_REQUIRED",message:"Verificação anti-bot obrigatória."},400,origin);
  const redirectTo=safeRedirect(body?.redirectTo,origin);

  const admin=createClient(SUPABASE_URL,SECRET_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const emailHash=await sha256Hex(email);
  await enforceApiQuota(admin,{
    userId:quotaUuidFromHash(emailHash),
    actionName:"admin-auth-request",
    limit:5,
    windowSeconds:3600
  });
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
  const {error:claimError}=await admin.rpc("claim_reserved_platform_admin",{
    p_user_id:data.user.id
  });
  if(claimError){
    console.error("admin-auth bootstrap claim failed",String(claimError.code??"RPC_ERROR"));
  }

  return json({ok:true},200,origin);
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
