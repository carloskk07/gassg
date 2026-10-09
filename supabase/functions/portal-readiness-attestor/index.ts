import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { DomainError, readJsonBody } from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";

const OIDC_ISSUER="https://token.actions.githubusercontent.com";
const OIDC_JWKS_URL="https://token.actions.githubusercontent.com/.well-known/jwks";
const OIDC_AUDIENCE="tamao-portal-attestor";
const REPOSITORY="carloskk07/gassg";
const REPOSITORY_ID="1399072319";
const REPOSITORY_OWNER_ID="171106109";
const MAIN_REF="refs/heads/main";
const WORKFLOW_REF=
  "carloskk07/gassg/.github/workflows/launch-readiness.yml@refs/heads/main";
const ALLOWED_EVENTS=new Set(["push","schedule","workflow_dispatch"]);
const GITHUB_MAIN_API=
  "https://api.github.com/repos/carloskk07/gassg/commits/main";

const PORTALS={
  customer:{origin:"https://tamao.com.br",title:"TAMÃO — Pediu? Tá na mão."},
  merchant:{origin:"https://parceiro.tamao.com.br",title:"TAMÃO Revenda — Operação"},
  admin:{origin:"https://admin.tamao.com.br",title:"TAMÃO Admin — Controle"}
};
const TEST_TURNSTILE_KEYS=new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
  "0x4AAAAAAAAAA-demo-site-key"
]);

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff"
    }
  });
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
  const data=await boundedJson(response,"GitHub main",500_000);
  const sha=String(data?.sha??"").trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(sha)){
    throw new DomainError("GITHUB_MAIN_INVALID","SHA canônico do GitHub inválido.",503);
  }
  return sha;
}
async function verifyPortal(role:string,cfg:{origin:string;title:string},expectedSha:string){
  const nonce=Date.now()+"-"+role;
  const buildResponse=await resilientFetch(
    cfg.origin+"/portal-build.json?attest="+nonce,{},"portal-build "+role
  );
  if(buildResponse.status!==200){
    throw new DomainError("PORTAL_ATTESTATION_FAILED",role+" portal-build HTTP "+buildResponse.status,503);
  }
  const build=await boundedJson(buildResponse,"portal-build "+role,200_000);
  if(
    build?.schemaVersion!==1
    ||build?.portalRole!==role
    ||build?.customerOrigin!==PORTALS.customer.origin
    ||build?.merchantOrigin!==PORTALS.merchant.origin
    ||build?.adminOrigin!==PORTALS.admin.origin
    ||String(build?.sourceSha??"").toLowerCase()!==expectedSha
  ){
    throw new DomainError("PORTAL_ATTESTATION_FAILED",role+" portal-build divergente.",503);
  }

  const runtimeResponse=await resilientFetch(
    cfg.origin+"/js/runtime-config.js?attest="+nonce,{},"runtime "+role
  );
  if(runtimeResponse.status!==200){
    throw new DomainError("PORTAL_ATTESTATION_FAILED",role+" runtime HTTP "+runtimeResponse.status,503);
  }
  const runtime=await boundedText(runtimeResponse,"runtime "+role,300_000);
  if(!runtime.includes("globalThis.CHAMA_PORTAL_ROLE="+JSON.stringify(role)+";")){
    throw new DomainError("PORTAL_ATTESTATION_FAILED",role+" runtime role divergente.",503);
  }
  for(const portal of Object.values(PORTALS)){
    if(!runtime.includes(portal.origin)){
      throw new DomainError("PORTAL_ATTESTATION_FAILED",role+" runtime sem origem oficial.",503);
    }
  }
  const quoted=/globalThis\.CHAMA_TURNSTILE_SITE_KEY=("[^"]*"|'[^']*');/.exec(runtime)?.[1]??"";
  let turnstileKey="";
  try{turnstileKey=JSON.parse(quoted)}
  catch{turnstileKey=quoted.replace(/^['"]|['"]$/g,"")}
  if(turnstileKey.length<6||TEST_TURNSTILE_KEYS.has(turnstileKey)){
    throw new DomainError("PORTAL_ATTESTATION_FAILED",role+" Turnstile inválido.",503);
  }

  const htmlResponse=await resilientFetch(
    cfg.origin+"/?attest="+nonce,{},"html "+role
  );
  if(htmlResponse.status!==200){
    throw new DomainError("PORTAL_ATTESTATION_FAILED",role+" HTML HTTP "+htmlResponse.status,503);
  }
  const html=await boundedText(htmlResponse,"html "+role,1_000_000);
  if(
    !html.includes('data-chama-portal="'+role+'"')
    ||!html.includes(cfg.title)
  ){
    throw new DomainError("PORTAL_ATTESTATION_FAILED",role+" HTML divergente.",503);
  }

  return {
    role,
    origin:cfg.origin,
    sourceSha:expectedSha,
    buildStatus:buildResponse.status,
    runtimeStatus:runtimeResponse.status,
    htmlStatus:htmlResponse.status,
    turnstileProduction:true
  };
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  try{
    const auth=String(req.headers.get("Authorization")??"");
    if(!auth.startsWith("Bearer ")){
      throw new DomainError("GITHUB_OIDC_REQUIRED","Token OIDC do GitHub obrigatório.",401);
    }
    const oidc=await verifyGithubOidc(auth.slice("Bearer ".length));
    const body=await readJsonBody(req,{maxBytes:4096});
    const expectedSourceSha=String(body.expectedSourceSha??"").trim().toLowerCase();
    if(!/^[0-9a-f]{40}$/.test(expectedSourceSha)){
      throw new DomainError("EXPECTED_SOURCE_SHA_INVALID","SHA esperado inválido.",400);
    }

    const canonicalSha=await githubMainSha();
    if(canonicalSha!==expectedSourceSha){
      throw new DomainError(
        "EXPECTED_SOURCE_NOT_MAIN",
        "O SHA do workflow não corresponde ao main canônico.",
        409
      );
    }
    if(oidc.workflowSha&&/^[0-9a-f]{40}$/.test(oidc.workflowSha)&&oidc.workflowSha!==expectedSourceSha){
      throw new DomainError(
        "WORKFLOW_SOURCE_MISMATCH",
        "O workflow OIDC não corresponde ao SHA esperado.",
        409
      );
    }

    const portals=await Promise.all(
      Object.entries(PORTALS).map(([role,cfg])=>verifyPortal(role,cfg,expectedSourceSha))
    );
    const evidence={
      schemaVersion:1,
      allPortalsReady:true,
      expectedSourceMatches:true,
      sourceSha:expectedSourceSha,
      canonicalSource:"github-main",
      repository:oidc.repository,
      repositoryId:oidc.repositoryId,
      repositoryOwnerId:oidc.repositoryOwnerId,
      workflowRef:oidc.workflowRef,
      runId:oidc.runId,
      runAttempt:oidc.runAttempt,
      eventName:oidc.eventName,
      portals
    };
    const evidenceSha256=await sha256Hex(JSON.stringify(evidence));
    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data,error}=await admin.rpc("record_automated_portal_attestation",{
      p_source_sha:expectedSourceSha,
      p_evidence_sha256:evidenceSha256,
      p_repository:oidc.repository,
      p_repository_id:oidc.repositoryId,
      p_repository_owner_id:oidc.repositoryOwnerId,
      p_workflow_ref:oidc.workflowRef,
      p_run_id:oidc.runId,
      p_run_attempt:oidc.runAttempt,
      p_event_name:oidc.eventName,
      p_evidence:evidence
    });
    if(error)throw error;
    return json({
      ok:true,
      source:"github_oidc_edge",
      sourceSha:expectedSourceSha,
      evidenceSha256,
      portals,
      readiness:data?.readiness??null
    },200);
  }catch(error){
    if(error instanceof DomainError){
      return json({error:error.code,message:error.message},error.status);
    }
    console.error(
      "portal-readiness-attestor failed",
      error instanceof Error?error.message:String(error)
    );
    return json({
      error:"PORTAL_ATTESTATION_FAILED",
      message:"Não foi possível registrar a prova automática dos portais."
    },503);
  }
});
