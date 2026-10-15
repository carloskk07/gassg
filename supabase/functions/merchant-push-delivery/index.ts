import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {sendPushNotification, WebPushError} from "npm:@mmmike/web-push@1.0.1/send";
import {DomainError,readJsonBody} from "../_shared/domain.js";

// TAMÃO V1.287 — short-lived GitHub OIDC job. No browser invocation.
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const VAPID_PUBLIC_KEY=(Deno.env.get("MERCHANT_VAPID_PUBLIC_KEY")??"").trim();
const VAPID_PRIVATE_KEY=(Deno.env.get("MERCHANT_VAPID_PRIVATE_KEY")??"").trim();
const VAPID_SUBJECT=(Deno.env.get("MERCHANT_VAPID_SUBJECT")??"").trim();
const PUSH_DELIVERY_READY=Deno.env.get("MERCHANT_PUSH_SENDER_VERIFIED")==="true";
const OIDC_ISSUER="https://token.actions.githubusercontent.com";
const OIDC_JWKS_URL="https://token.actions.githubusercontent.com/.well-known/jwks";
const OIDC_AUDIENCE="tamao-merchant-push-delivery";
const REPOSITORY="carloskk07/gassg";
const REPOSITORY_ID="1399072319";
const REPOSITORY_OWNER_ID="171106109";
const MAIN_REF="refs/heads/main";
const WORKFLOW_REF="carloskk07/gassg/.github/workflows/merchant-push-delivery.yml@refs/heads/main";
const ALLOWED_EVENTS=new Set(["schedule","workflow_dispatch"]);
const GITHUB_MAIN_API="https://api.github.com/repos/carloskk07/gassg/git/ref/heads/main";

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,
    headers:{"Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
function base64UrlBytes(value:string){
  const normalized=value.replace(/-/g,"+").replace(/_/g,"/");
  const padded=normalized+"=".repeat((4-normalized.length%4)%4);
  const binary=atob(padded);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function base64UrlJson(value:string,label:string){
  try{
    return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
  }catch{
    throw new DomainError("GITHUB_OIDC_INVALID",label+" inválido.",401);
  }
}
async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function boundedText(response:Response,label:string,maxBytes=1_000_000){
  const raw=await response.text();
  if(new TextEncoder().encode(raw).byteLength>maxBytes){
    throw new DomainError("REMOTE_RESPONSE_TOO_LARGE",label+" excedeu o limite.",503);
  }
  return raw;
}
async function boundedJson(response:Response,label:string,maxBytes=1_000_000){
  const raw=await boundedText(response,label,maxBytes);
  try{return JSON.parse(raw)}
  catch{throw new DomainError("REMOTE_JSON_INVALID",label+" retornou JSON inválido.",503)}
}
async function resilientFetch(url:string,init:RequestInit,label:string){
  let last:unknown=null;
  for(let attempt=1;attempt<=3;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(url,{
        ...init,
        headers:{
          "Accept":"application/json,text/plain,*/*",
          "Cache-Control":"no-cache",
          ...(init.headers??{})
        },
        signal:controller.signal
      });
      if(response.status>=500&&attempt<3){
        last=new Error(label+" HTTP "+response.status);
        await new Promise(resolve=>setTimeout(resolve,250*attempt));
        continue;
      }
      return response;
    }catch(error){
      last=error;
      if(attempt===3)throw error;
      await new Promise(resolve=>setTimeout(resolve,250*attempt));
    }finally{
      clearTimeout(timer);
    }
  }
  throw last??new Error(label+" failed");
}
async function verifyGithubOidc(token:string){
  if(token.length<100||token.length>20000){
    throw new DomainError("GITHUB_OIDC_INVALID","Token OIDC inválido.",401);
  }
  const parts=token.split(".");
  if(parts.length!==3){
    throw new DomainError("GITHUB_OIDC_INVALID","Token OIDC inválido.",401);
  }
  const header=base64UrlJson(parts[0],"Cabeçalho OIDC");
  const payload=base64UrlJson(parts[1],"Payload OIDC");
  if(header?.alg!=="RS256"||typeof header?.kid!=="string"||header.kid.length<4||header.kid.length>200){
    throw new DomainError("GITHUB_OIDC_ALGORITHM_INVALID","Algoritmo OIDC não permitido.",401);
  }

  const jwksResponse=await resilientFetch(
    OIDC_JWKS_URL,
    {headers:{"User-Agent":"TAMAO-Portal-Attestor/1.0"}},
    "GitHub OIDC JWKS"
  );
  if(!jwksResponse.ok){
    throw new DomainError("GITHUB_OIDC_JWKS_UNAVAILABLE","JWKS do GitHub indisponível.",503);
  }
  const jwks=await boundedJson(jwksResponse,"GitHub OIDC JWKS",250_000);
  const jwk=Array.isArray(jwks?.keys)
    ?jwks.keys.find((x:any)=>x?.kid===header.kid&&x?.kty==="RSA")
    :null;
  if(!jwk){
    throw new DomainError("GITHUB_OIDC_KEY_NOT_FOUND","Chave OIDC do GitHub não encontrada.",401);
  }
  let key:CryptoKey;
  try{
    key=await crypto.subtle.importKey(
      "jwk",
      jwk,
      {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},
      false,
      ["verify"]
    );
  }catch{
    throw new DomainError("GITHUB_OIDC_KEY_INVALID","Chave OIDC inválida.",401);
  }
  const signatureOk=await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(parts[0]+"."+parts[1])
  );
  if(!signatureOk){
    throw new DomainError("GITHUB_OIDC_SIGNATURE_INVALID","Assinatura OIDC inválida.",401);
  }

  const now=Math.floor(Date.now()/1000);
  const aud=Array.isArray(payload?.aud)?payload.aud:[payload?.aud];
  if(
    payload?.iss!==OIDC_ISSUER
    ||!aud.includes(OIDC_AUDIENCE)
    ||typeof payload?.exp!=="number"||payload.exp<now-30
    ||typeof payload?.nbf!=="number"||payload.nbf>now+30
    ||typeof payload?.iat!=="number"||payload.iat>now+30
    ||payload?.repository!==REPOSITORY
    ||String(payload?.repository_id??"")!==REPOSITORY_ID
    ||String(payload?.repository_owner_id??"")!==REPOSITORY_OWNER_ID
    ||payload?.ref!==MAIN_REF
    ||payload?.ref_type!=="branch"
    ||payload?.workflow_ref!==WORKFLOW_REF
    ||payload?.runner_environment!=="github-hosted"
    ||!ALLOWED_EVENTS.has(String(payload?.event_name??""))
  ){
    throw new DomainError("GITHUB_OIDC_CLAIMS_INVALID","Claims OIDC não autorizadas.",403);
  }
  const runId=Number(payload?.run_id);
  const runAttempt=Number(payload?.run_attempt);
  if(!Number.isSafeInteger(runId)||runId<=0||!Number.isInteger(runAttempt)||runAttempt<1||runAttempt>100){
    throw new DomainError("GITHUB_OIDC_RUN_INVALID","Identidade da execução OIDC inválida.",403);
  }
  return {
    repository:String(payload.repository),
    repositoryId:String(payload.repository_id),
    repositoryOwnerId:String(payload.repository_owner_id),
    workflowRef:String(payload.workflow_ref),
    runId,
    runAttempt,
    eventName:String(payload.event_name),
    workflowSha:typeof payload.workflow_sha==="string"?payload.workflow_sha.toLowerCase():null
  };
}
async function githubMainSha(){
  const response=await resilientFetch(
    GITHUB_MAIN_API,
    {headers:{
      "Accept":"application/vnd.github+json",
      "User-Agent":"TAMAO-Portal-Attestor/1.0",
      "X-GitHub-Api-Version":"2026-03-10"
    }},
    "GitHub main"
  );
  if(!response.ok){
    throw new DomainError(
      "GITHUB_MAIN_UNAVAILABLE",
      "Não foi possível validar o SHA canônico do GitHub.",
      503
    );
  }
  const data=await boundedJson(response,"GitHub main",30_000);
  if(data?.ref!=="refs/heads/main"||data?.object?.type!=="commit")
    throw new DomainError("GITHUB_MAIN_INVALID","Ref main inválido.",503);
  const sha=String(data?.object?.sha??"").trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(sha)){
    throw new DomainError("GITHUB_MAIN_INVALID","SHA canônico do GitHub inválido.",503);
  }
  return sha;
}



const VAPID_KEY_RE=/^[A-Za-z0-9_-]+$/;
function senderConfigured():boolean {
  return PUSH_DELIVERY_READY&&SECRET_KEY.length>20&&SUPABASE_URL.startsWith("https://")&&
    VAPID_PUBLIC_KEY.length>=85&&VAPID_PUBLIC_KEY.length<=100&&VAPID_KEY_RE.test(VAPID_PUBLIC_KEY)&&
    VAPID_PRIVATE_KEY.length>=40&&VAPID_PRIVATE_KEY.length<=60&&VAPID_KEY_RE.test(VAPID_PRIVATE_KEY)&&
    /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+(?:\/[^\s]*)?)$/.test(VAPID_SUBJECT);
}
function validPushEndpoint(endpoint:string):boolean {
  try {
    const u=new URL(endpoint);
    if(u.protocol!=="https:"||u.username||u.password||u.hash)return false;
    const host=u.hostname.toLowerCase();
    return host==="fcm.googleapis.com"||
      host==="updates.push.services.mozilla.com"||
      /^[-a-z0-9.]+\.push\.services\.mozilla\.com$/.test(host)||
      host==="web.push.apple.com"||/^[-a-z0-9]+\.push\.apple\.com$/.test(host)||
      /^[-a-z0-9.]+\.notify\.windows\.com$/.test(host);
  } catch{return false}
}
type Claimed={
 delivery_id:number;lease_token:string;subscription_id:number;event_kind:string;
 endpoint_url:string;p256dh:string;auth_secret:string;expires_at:string;order_id:string;
};
function classifyFailure(err:unknown):{status:number|null;code:string;outcome:string}{
  if(err instanceof WebPushError){
    const status=Number(err.statusCode)||null;
    if(status===404||status===410)return {status,code:"SUBSCRIPTION_GONE",outcome:"gone"};
    if(status===408||status===429||status!==null&&status>=500)
      return {status,code:"PUSH_GATEWAY_RETRY",outcome:"retry"};
    return {status,code:"PUSH_GATEWAY_REJECTED",outcome:"permanent_failure"};
  }
  if(err instanceof TypeError||err instanceof DOMException)
    return {status:null,code:"NETWORK_ERROR",outcome:"retry"};
  return {status:null,code:"PUSH_PAYLOAD_INVALID",outcome:"permanent_failure"};
}
function pushPayload(kind:string):{kind:string}{
  // All customer/order/private details intentionally excluded.
  return {kind:kind==="assigned_delivery"?"assigned_delivery":"new_offer"};
}
async function deliver(admin:any,row:Claimed):Promise<{outcome:string;status:number|null;resolved:boolean}>{
  let outcome="retry",httpStatus:number|null=null,code:string|null=null;
  const seconds=Math.floor((Date.parse(row.expires_at)-Date.now())/1000);
  if(!Number.isFinite(seconds)||seconds<=0){
    outcome="expired";code="EXPIRED";
  }else if(!validPushEndpoint(row.endpoint_url)){
    outcome="permanent_failure";code="ENDPOINT_NOT_ALLOWED";
  }else if(!["new_offer","assigned_delivery"].includes(row.event_kind)){
    outcome="permanent_failure";code="UNKNOWN_EVENT";
  }else{
    try{
      // RFC 8291 encrypted payload + RFC 8292 VAPID signing.
      // Timeout and TTL are bounded so expired offers are not delivered later.
      const accepted=await sendPushNotification({
        endpoint:row.endpoint_url,
        keys:{p256dh:row.p256dh,auth:row.auth_secret}
      },pushPayload(row.event_kind),{
        publicKey:VAPID_PUBLIC_KEY,privateKey:VAPID_PRIVATE_KEY,subject:VAPID_SUBJECT
      },{ttl:Math.max(1,Math.min(300,seconds)),timeoutMs:8000,urgency:"high"});
      outcome=accepted?"provider_accepted":"gone";
      // The library returns an acceptance boolean, not an exact HTTP status.
      // Do not manufacture a 201/410 status value in the audit ledger.
      httpStatus=null;
      if(!accepted)code="SUBSCRIPTION_GONE";
    }catch(error){
      const classified=classifyFailure(error);
      outcome=classified.outcome;
      httpStatus=classified.status;
      code=classified.code;
    }
  }
  // Never log endpoint URLs, encryption keys, or device-specific payloads.
  const {data,error}=await admin.rpc("merchant_push_resolve_delivery",{
    p_delivery_id:row.delivery_id,p_lease_token:row.lease_token,
    p_outcome:outcome,p_status:httpStatus,p_error_code:code
  });
  if(error)throw new Error("PUSH_RESULT_STORE_FAILED");
  return {outcome,status:httpStatus,resolved:data===true};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  try{
    const bearer=String(req.headers.get("Authorization")??"");
    if(!bearer.startsWith("Bearer "))
      throw new DomainError("GITHUB_OIDC_REQUIRED","OIDC JWT required",401);
    const oidc=await verifyGithubOidc(bearer.slice(7));
    const body=await readJsonBody(req,{maxBytes:4096});
    const expected=String(body.expectedSourceSha??"").trim().toLowerCase();
    if(!/^[a-f0-9]{40}$/.test(expected))
      throw new DomainError("SOURCE_SHA_INVALID","Invalid source",400);
    const canonical=await githubMainSha();
    if(canonical!==expected||oidc.workflowSha&&oidc.workflowSha!==expected)
      throw new DomainError("SOURCE_NOT_MAIN","Source mismatch",409);

    // Permanent rollout gate: no writes, no claims, no network push until
    // the verified sender and a single VAPID key pair are configured.
    if(!senderConfigured())
      return json({ok:true,enabled:false,attempted:0,providerAccepted:0,
        note:"PUSH_SENDER_NOT_CONFIGURED",sourceSha:canonical},200);

    const admin=createClient(SUPABASE_URL,SECRET_KEY,
      {auth:{persistSession:false,autoRefreshToken:false}});
    const {data:rows,error:claimError}=await admin.rpc("merchant_push_claim_due",{p_limit:4});
    if(claimError)throw new Error("PUSH_CLAIM_FAILED");
    const summary={providerAccepted:0,gone:0,retry:0,expired:0,permanentFailure:0,unresolved:0};
    for(const row of (rows??[]) as Claimed[]){
      try{
        const result=await deliver(admin,row);
        if(!result.resolved)summary.unresolved++;
        else if(result.outcome==="provider_accepted")summary.providerAccepted++;
        else if(result.outcome==="gone")summary.gone++;
        else if(result.outcome==="retry")summary.retry++;
        else if(result.outcome==="expired")summary.expired++;
        else summary.permanentFailure++;
      }catch{
        // Lease expiry allows a later worker to resume. Never claim success.
        summary.unresolved++;
      }
    }
    return json({ok:summary.unresolved===0,enabled:true,attempted:(rows??[]).length,
      ...summary,sourceSha:canonical,runId:oidc.runId},summary.unresolved?503:200);
  }catch(error){
    if(error instanceof DomainError)
      return json({error:error.code,message:error.message},error.status);
    console.error("merchant push dispatch failed",error instanceof Error?error.message:"UNKNOWN");
    return json({error:"PUSH_DISPATCH_FAILED"},503);
  }
});
