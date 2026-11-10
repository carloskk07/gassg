import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {readJsonBody,enforceApiQuota,DomainError} from "../_shared/domain.js";

// V1.884. Advertising intake/delivery; viewability signals are explicitly
// NOT independent invoice evidence. No PSP calls or payable balances.
const URL_BASE=Deno.env.get("SUPABASE_URL")??"";
const PUBLISHABLE=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default
  ??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default
  ??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ORIGINS=new Set(["https://tamao.com.br","https://www.tamao.com.br",
  "https://tamao-sg-cliente.pages.dev","https://carloskk07.github.io",
  "https://admin.tamao.com.br"]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean=(v:unknown,n:number)=>String(v??"").trim().replace(/\s+/g," ").slice(0,n);
function allowed(origin:string|null){
  return Boolean(origin&&(ORIGINS.has(origin)||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)));
}
function cors(origin:string|null){
  return {
    "Access-Control-Allow-Origin":origin&&allowed(origin)?origin:"null",
    "Access-Control-Allow-Headers":"authorization,apikey,content-type",
    "Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"
  };
}
function respond(body:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(body),{status,headers:{
    ...cors(origin),"Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store"
  }});
}
function isSafeHttpsDestination(value:unknown){
  const valueText=String(value??"").trim();
  if(valueText.length<15||valueText.length>300||/[<>\s@\\]/.test(valueText))return false;
  try{
    const u=new URL(valueText);
    const host=u.hostname.toLowerCase();
    return u.protocol==="https:"&&!u.username&&!u.password&&(!u.port||u.port==="443")
      &&host.includes(".")&&!host.endsWith(".local")&&!host.endsWith(".internal")
      &&!host.endsWith(".localhost")&&host!=="localhost"
      &&!/^\d+\.\d+\.\d+\.\d+$/.test(host)&&!host.startsWith("[")
      &&u.href.length<=300;
  }catch{return false}
}
async function hashViewer(req:Request){
  // Never store raw IP, UA, cookies, contact details or arbitrary browser IDs.
  // Treat browser-originated visibility signals as diagnostic only.
  const ip=clean(req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||"not-provided",128);
  const ua=clean(req.headers.get("user-agent")||"unknown",256);
  const secret=SECRET.slice(0,96);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const data=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(ip+"\n"+ua));
  return Array.from(new Uint8Array(data),x=>x.toString(16).padStart(2,"0")).join("");
}
async function sessionUser(req:Request){
  const token=String(req.headers.get("authorization")??"").trim();
  if(!token.startsWith("Bearer "))return null;
  const client=createClient(URL_BASE,PUBLISHABLE,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.getUser(token.slice(7));
  if(error||!data?.user||data.user.is_anonymous===true||!data.user.email_confirmed_at)return null;
  return data.user;
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(!allowed(origin))return respond({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return respond({error:"METHOD_NOT_ALLOWED"},405,origin);
  if(!String(req.headers.get("content-type")||"").toLowerCase().includes("application/json"))
    return respond({error:"CONTENT_TYPE_INVALID"},415,origin);
  if(!SECRET||!PUBLISHABLE||!URL_BASE)return respond({error:"ADS_SERVICE_UNAVAILABLE"},503,origin);
  try{
    const body:any=await readJsonBody(req,{maxBytes:9000});
    const action=String(body.action||"").trim();
    const admin=createClient(URL_BASE,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
    if(action==="serve"){
      const city=clean(body.city,100),state=clean(body.state,2).toUpperCase();
      if(city.length<2||!/^[A-Z]{2}$/.test(state))return respond({
        source:"ads_independent_issue_v1_884",slot:null,noCharge:true,billingEnabled:false
      },200,origin);
      const viewerHash=await hashViewer(req);
      const {data,error}=await admin.rpc("ads_independent_issue_v1_884",{
        p_city:city,p_state:state,p_viewer_hash:viewerHash
      });
      if(error)throw error;
      if(data?.source!=="ads_independent_issue_v1_884"||data?.billingEnabled!==false
        ||data?.noCharge!==true)
        throw Error("ADS_DELIVERY_CONTRACT_MISMATCH");
      // Own institutional inventory is entirely separate from paid campaign
      // checkout and remains deliverable while commercial sales are OFF.
      // Paid placements take priority when legitimately enabled.
      if(data.slot)return respond(data,200,origin);
      const {data:institutional,error:institutionalError}=
        await admin.rpc("ads_institutional_issue_v1_916",{
          p_city:city,p_state:state,p_viewer_hash:viewerHash
        });
      if(institutionalError)throw institutionalError;
      if(institutional?.source!=="ads_institutional_issue_v1_916"||
         institutional?.noCharge!==true||institutional?.billingEnabled!==false||
         (institutional.slot!==null&&(
           !uuid.test(String(institutional.slot?.challenge||""))||
           institutional.slot?.label!=="Institucional"||
           institutional.slot?.advertiser!=="TAMÃO"||
           !String(institutional.slot?.url||"").startsWith("https://tamao.com.br/"))))
        throw Error("ADS_INSTITUTIONAL_DELIVERY_INVALID");
      return respond({...institutional,source:"ads_independent_issue_v1_884"},200,origin);
    }
    if(action==="confirm"){
      const challenge=String(body.challenge||"");
      const visibleMs=Number(body.visibleMs),visiblePercent=Number(body.visiblePercent);
      if(!uuid.test(challenge)||body.tabVisible!==true||
        !Number.isSafeInteger(visibleMs)||!Number.isSafeInteger(visiblePercent)||
        visibleMs<1000||visibleMs>60000||visiblePercent<50||visiblePercent>100)
        return respond({countedForDiagnostics:false,billable:false,reason:"invalid_claim"},200,origin);
      const viewerHash=await hashViewer(req);
      const {data:institutional,error:institutionalError}=
        await admin.rpc("ads_institutional_confirm_v1_916",{
          p_token:challenge,p_viewer_hash:viewerHash,
          p_visible_ms:visibleMs,p_visible_percent:visiblePercent
        });
      if(institutionalError)throw institutionalError;
      if(typeof institutional?.recognized!=="boolean"||
         typeof institutional?.countedForDiagnostics!=="boolean"||
         institutional?.billable!==false)
        throw Error("ADS_INSTITUTIONAL_VIEW_INVALID");
      if(institutional.recognized===true)return respond(institutional,200,origin);
      const {data,error}=await admin.rpc("ads_independent_confirm_v1_884",{
        p_token:challenge,p_viewer_hash:viewerHash,
        p_visible_ms:visibleMs,p_visible_percent:visiblePercent
      });
      if(error)throw error;
      if(typeof data?.countedForDiagnostics!=="boolean"||data?.billable!==false)
        throw Error("ADS_VIEW_EVIDENCE_UNVERIFIED");
      return respond(data,200,origin);
    }
    if(action==="refund-request"){
      const user=await sessionUser(req);
      if(!user)return respond({error:"VERIFIED_EMAIL_REQUIRED"},401,origin);
      const campaignId=String(body.campaignId||"");
      const requestId=String(body.requestId||"");
      const reason=String(body.reason||"").trim();
      if(!uuid.test(campaignId)||!uuid.test(requestId)||reason.length<12||
         reason.length>500||/[\u0000-\u001f\u007f]/.test(reason))
        return respond({error:"ADS_REFUND_REQUEST_INVALID"},400,origin);
      await enforceApiQuota(admin,{userId:user.id,
        actionName:"ads-independent-refund-request",limit:6,windowSeconds:3600});
      const {data,error}=await admin.rpc("ads_independent_refund_request_v1_887",{
        p_owner:user.id,p_campaign:campaignId,p_request:requestId,p_reason:reason
      });
      if(error)throw error;
      if(data?.source!=="ads_independent_refund_request_v1_887"||
        data?.refundIssued!==false||!uuid.test(String(data.caseId||"")))
        throw Error("ADS_REFUND_REQUEST_UNVERIFIED");
      return respond(data,200,origin);
    }
    if(action==="submit"||action==="mine"){
      const user=await sessionUser(req);
      if(!user)return respond({error:"VERIFIED_EMAIL_REQUIRED",
        message:"Entre com um e-mail confirmado para gerenciar campanhas."},401,origin);
      await enforceApiQuota(admin,{userId:user.id,
        actionName:action==="mine"?"ads-independent-status":"ads-independent-submit",
        limit:action==="mine"?30:15,windowSeconds:3600});
      if(action==="mine"){
        const {data,error}=await admin.rpc("ads_independent_mine_v1_884",{p_owner:user.id});
        if(error)throw error;
        if(data?.source!=="ads_independent_mine_v1_884"||data?.noCharge!==true)
          throw Error("ADS_PRIVATE_STATUS_UNVERIFIED");
        const {data:gate,error:gateError}=await admin
          .from("ads_independent_sales_controls_v1_886")
          .select("homologation_campaign_id,homologation_expires_at")
          .eq("singleton",true).maybeSingle();
        if(gateError||!gate)throw Error("ADS_HOMOLOGATION_STATUS_UNAVAILABLE");
        const allowedId=String(gate.homologation_campaign_id||"");
        const authorized=Array.isArray(data.rows)&&
          data.rows.some((r:any)=>r.id===allowedId)&&
          Date.parse(String(gate.homologation_expires_at||""))>Date.now();
        return respond({...data,
          homologationCampaignId:authorized?allowedId:null,
          homologationExpiresAt:authorized?gate.homologation_expires_at:null},200,origin);
      }
      const requestId=String(body.requestId||"");
      const business=clean(body.advertiser,120),title=clean(body.title,80);
      const description=clean(body.description,240),city=clean(body.city,100);
      const state=clean(body.state,2).toUpperCase();
      const destination=String(body.destination||"").trim();
      const budget=Number(body.budgetCents),days=Number(body.durationDays);
      if(!uuid.test(requestId)||business.length<2||title.length<12||
        description.length<20||city.length<2||!/^[A-Z]{2}$/.test(state)||
        !isSafeHttpsDestination(destination)||
        ![1990,4990,9990,19990].includes(budget)||![7,15,30].includes(days))
        return respond({error:"CAMPAIGN_INVALID",
          message:"Revise empresa, mensagem, cidade, link HTTPS, prazo e orçamento."},400,origin);
      const {count,countError}=await (async()=>{
        const r=await admin.from("ads_independent_campaigns_v1_884")
          .select("id",{count:"exact",head:true})
          .eq("owner_user_id",user.id)
          .gte("created_at",new Date(Date.now()-24*60*60*1000).toISOString());
        return {count:r.count,countError:r.error};
      })();
      if(countError)throw countError;
      // Replays are still accepted by DB only when the signature matches.
      if(Number(count??0)>=5){
        const {data:prior,error:priorErr}=await admin.from("ads_independent_campaigns_v1_884")
          .select("request_id").eq("request_id",requestId).eq("owner_user_id",user.id).maybeSingle();
        if(priorErr)throw priorErr;
        if(!prior)return respond({error:"ADS_REQUEST_LIMIT"},429,origin);
      }
      const {data,error}=await admin.rpc("ads_independent_submit_v1_884",{
        p_owner:user.id,p_request:requestId,p_advertiser:business,p_title:title,
        p_description:description,p_city:city,p_state:state,p_destination:destination,
        p_budget_cents:budget,p_duration_days:days
      });
      if(error){
        const message=String(error.message||"");
        if(message.includes("ADS_CAMPAIGN_IDEMPOTENCY_CONFLICT"))
          return respond({error:"REQUEST_REUSED"},409,origin);
        if(message.includes("ADS_CAMPAIGN_INVALID"))return respond({error:"CAMPAIGN_INVALID"},400,origin);
        throw error;
      }
      if(data?.source!=="ads_independent_submit_v1_884"||data?.paymentCreated!==false)
        throw Error("ADS_REQUEST_CONTRACT_UNVERIFIED");
      return respond(data,200,origin);
    }
    return respond({error:"UNKNOWN_ACTION"},400,origin);
  }catch(error){
    if(error instanceof DomainError)return respond({error:error.code,message:error.message},error.status,origin);
    console.error("ads-independent service",error instanceof Error?error.message:String(error));
    return respond({error:"ADS_SERVICE_FAILED",message:"Tente novamente mais tarde."},503,origin);
  }
});
