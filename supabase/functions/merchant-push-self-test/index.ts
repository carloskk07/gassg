import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {sendPushNotification,WebPushError} from "npm:@mmmike/web-push@1.0.1/send";

// V1.291: manual self-test only. No cron, no order data, no campaign sends.
const URL_ROOT=Deno.env.get("SUPABASE_URL")??"";
const publicKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE=publicKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ALLOWED=new Set(["https://parceiro.tamao.com.br","https://tamao-sg-revenda.pages.dev"]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]+$/;
function originAllowed(origin:string|null):boolean{
 return !origin||ALLOWED.has(origin)||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function json(payload:Record<string,unknown>,status:number,origin:string|null){
 return new Response(JSON.stringify(payload),{
  status,headers:{"Content-Type":"application/json; charset=utf-8",
   "Cache-Control":"no-store","Vary":"Origin","X-Content-Type-Options":"nosniff",
   "Access-Control-Allow-Methods":"OPTIONS, POST",
   "Access-Control-Allow-Headers":"authorization, apikey, content-type",
   ...(origin&&originAllowed(origin)?{"Access-Control-Allow-Origin":origin}:{})
  }
 });
}
function bad(code:string,status:number,origin:string|null){
 return json({ok:false,code},status,origin);
}
async function sha256(value:string):Promise<string>{
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");
}
function allowedPushEndpoint(value:unknown):value is string{
 if(typeof value!=="string"||value.length<40||value.length>2048)return false;
 try{
  const u=new URL(value);const h=u.hostname.toLowerCase();
  if(u.protocol!=="https:"||u.username||u.password||u.hash)return false;
  return h==="fcm.googleapis.com"||
   h==="updates.push.services.mozilla.com"||
   /^[-a-z0-9.]+\.push\.services\.mozilla\.com$/.test(h)||
   h==="web.push.apple.com"||/^[-a-z0-9]+\.push\.apple\.com$/.test(h)||
   /^[-a-z0-9.]+\.notify\.windows\.com$/.test(h);
 }catch{return false}
}
function credentialsValid(c:unknown):c is {publicKey:string;privateKey:string;subject:string}{
 if(!c||typeof c!=="object")return false;
 const v=c as Record<string,unknown>;
 return typeof v.publicKey==="string"&&v.publicKey.length===87&&KEY.test(v.publicKey)&&
  typeof v.privateKey==="string"&&v.privateKey.length===43&&KEY.test(v.privateKey)&&
  v.subject==="https://tamao.com.br";
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin");
 if(!originAllowed(origin))return bad("ORIGIN_NOT_ALLOWED",403,null);
 if(req.method==="OPTIONS")return json({ok:true},200,origin);
 if(req.method!=="POST")return bad("METHOD_NOT_ALLOWED",405,origin);
 if(!URL_ROOT||!PUBLISHABLE||!SECRET)return bad("UNAVAILABLE",503,origin);
 const bearer=req.headers.get("Authorization");
 if(!bearer?.startsWith("Bearer "))return bad("UNAUTHORIZED",401,origin);
 try{
  const raw=await req.text();
  if(raw.length>2500)return bad("INVALID_REQUEST",400,origin);
  let body:Record<string,unknown>;
  try{
   const parsed=JSON.parse(raw);
   if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
    return bad("INVALID_REQUEST",400,origin);
   body=parsed;
  }catch{return bad("INVALID_REQUEST",400,origin)}
  if(body.action!=="send-self-test"||!UUID.test(String(body.merchantId??""))||
    !allowedPushEndpoint(body.endpoint))
   return bad("INVALID_REQUEST",400,origin);
  const authClient=createClient(URL_ROOT,PUBLISHABLE,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await authClient.auth.getUser(bearer.slice(7));
  const user=authData.user;
  if(authError||!user||user.is_anonymous)return bad("UNAUTHORIZED",401,origin);
  const admin=createClient(URL_ROOT,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:member,error:memberError}=await admin.from("merchant_members")
   .select("member_role").eq("merchant_id",body.merchantId)
   .eq("user_id",user.id).eq("active",true).maybeSingle();
  if(memberError)return bad("UNAVAILABLE",503,origin);
  if(!member||!["owner","manager","operator","driver"].includes(member.member_role))
   return bad("ACCESS_DENIED",403,origin);
  // One test per user per 3 minutes, enforced atomically in the database.
  // The endpoint hash can only select this signed-in user's own subscription.
  const {data:reserved,error:reserveError}=await admin.rpc("merchant_push_test_reserve",{
   p_merchant_id:body.merchantId,p_user_id:user.id,
   p_endpoint_hash:await sha256(body.endpoint)
  });
  if(reserveError)return bad("UNAVAILABLE",503,origin);
  if(reserved?.rateLimited===true)return bad("RATE_LIMITED",429,origin);
  if(!reserved?.runId||!allowedPushEndpoint(reserved.endpoint))
   return bad("DEVICE_NOT_REGISTERED",409,origin);
  const {data:creds,error:credsError}=await admin.rpc("merchant_push_test_credentials");
  let state="failed",code="SENDER_UNAVAILABLE",httpStatus:number|null=null;
  if(!credsError&&credentialsValid(creds)){
   try{
    // Keep the private test kind in the serialized payload, while satisfying
    // the Web Push library's structurally typed PushPayload interface.
    const payload={
     kind:"test",title:"Teste de notificação TAMÃO",
     body:"Este é um teste solicitado neste aparelho.",tag:"tamao-merchant-self-test",
     url:"/?merchant=1#merchant"
    };
    const accepted=await sendPushNotification({
     endpoint:reserved.endpoint,
     keys:{p256dh:reserved.p256dh,auth:reserved.auth}
    },payload,{
     publicKey:creds.publicKey,privateKey:creds.privateKey,subject:creds.subject
    },{ttl:45,timeoutMs:8000,urgency:"normal"});
    state=accepted?"provider_accepted":"gateway_rejected";
    code=accepted?"PROVIDER_ACCEPTED":"SUBSCRIPTION_GONE";
   }catch(error){
    if(error instanceof WebPushError){
     const reported=Number(error.statusCode);
     if(Number.isInteger(reported)&&reported>=100&&reported<=599)httpStatus=reported;
     code=httpStatus===404||httpStatus===410?"SUBSCRIPTION_GONE":
      httpStatus===408||httpStatus===429||httpStatus!==null&&httpStatus>=500?
      "GATEWAY_UNAVAILABLE":"GATEWAY_REJECTED";
    }else code=error instanceof TypeError?"NETWORK_ERROR":"PUSH_TEST_FAILED";
    state="failed";
   }
  }
  const {data:stored,error:storeError}=await admin.rpc("merchant_push_test_finish",{
   p_run_id:reserved.runId,p_user_id:user.id,p_state:state,
   p_status:httpStatus,p_failure_code:code==="PROVIDER_ACCEPTED"?null:code
  });
  if(storeError||stored!==true)return bad("RESULT_UNAVAILABLE",503,origin);
  // Provider acceptance is NEVER proof that the user saw the notification.
  return json({ok:state==="provider_accepted",runId:reserved.runId,
   providerAccepted:state==="provider_accepted",deviceDisplayConfirmed:false,
   state,code},200,origin);
 }catch{
  // Never log or expose subscription endpoint, browser encryption keys or VAPID.
  return bad("UNAVAILABLE",503,origin);
 }
});
