import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {mercadoPagoFetch,mercadoPagoConfigured,readMercadoPagoJson}
 from "../_shared/mercadopago.js";
import {couponReleasedNetEvidence}
 from "../admin-ops/coupon-release-evidence.js";

// V1.931: machine-only read/compare/register; NOT a new payment or coupon engine.
// Existing invoice row lock and sponsor/partner funding guards remain authoritative.
type CouponInvoice={id:string;status:string;paid_at:string;provider_order_id:string;
 provider_payment_id:string;sale_price_cents:number;coupon_face_cents:number;
 coupons_per_pack:number;sponsor_covered_cents:number};
type NetReport={fileName:string;csv:string};
// DB schema is verified by SQL migrations; every RPC response is checked at runtime.
type DbClient=any;
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const SECRETS=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=SECRETS.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MAX_REPORTS=10,MAX_INVOICES=2,MAX_CSV_BYTES=1_000_000;
const FILE_RE=/^[A-Za-z0-9][A-Za-z0-9._-]{7,140}\.csv$/;
function json(body:unknown,status=200){
 return new Response(JSON.stringify(body),{status,headers:{
  "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff"}});
}
function safeReason(reason:unknown){
 const key=String(reason||"").replace(/[^A-Za-z0-9_]/g,"_").slice(0,110);
 return key.length>=2?key:"UNAVAILABLE";
}
async function sha256Hex(value:string){
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function limitedCsv(response:Response){
 const type=String(response.headers.get("content-type")||"");
 if(type.includes("spreadsheet")||type.includes("excel")||type.includes("application/json")||
    !response.body||Number(response.headers.get("content-length")||0)>MAX_CSV_BYTES)
  throw new Error("MP_RELEASE_CSV_INVALID");
 const reader=response.body.getReader();let total=0;const chunks:Uint8Array[]=[];
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>MAX_CSV_BYTES)throw new Error("MP_RELEASE_CSV_TOO_LARGE");
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
export function selectOfficialReports(list:unknown){
 if(!Array.isArray(list)||list.length>50)
  return {complete:false,files:[],reason:"MP_RELEASE_LIST_INCOMPLETE"};
 const processed=list.filter(r=>String(r?.status||"").toLowerCase()==="processed"&&
  r?.is_test===false&&r?.currency_id==="BRL");
 if(processed.some(r=>!FILE_RE.test(String(r?.file_name||""))))
  return {complete:false,files:[],reason:"MP_RELEASE_INVALID_FILENAME"};
 const names=[...new Set(processed.map(r=>r.file_name))];
 if(names.length>MAX_REPORTS)
  return {complete:false,files:[],reason:"MP_RELEASE_COVERAGE_LIMIT"};
 return {complete:true,files:names,reason:null};
}
async function getProviderData(token:string,invoice:CouponInvoice,reportFiles:string[]){
 const orderResponse=await mercadoPagoFetch("/v1/orders/"+
   encodeURIComponent(String(invoice.provider_order_id)),{
    accessToken:token,method:"GET",timeoutMs:8000});
 if(!orderResponse.ok)throw new Error("MP_ORDER_UNAVAILABLE");
 const order=await readMercadoPagoJson(orderResponse);
 const reportCsv:NetReport[]=[];
 for(const name of reportFiles){
  const response=await mercadoPagoFetch("/v1/account/release_report/"+
   encodeURIComponent(name),{accessToken:token,method:"GET",timeoutMs:8000});
  if(!response.ok)throw new Error("MP_RELEASE_FILE_UNAVAILABLE");
  reportCsv.push({fileName:name,csv:await limitedCsv(response)});
 }
 return {order,reportCsv};
}
export function evaluateReports({invoice,order,reportCsv,sponsorVerified}:{invoice:CouponInvoice;order:unknown;reportCsv:NetReport[];sponsorVerified:boolean}){
 const accepted:ReturnType<typeof couponReleasedNetEvidence>[]=[];
 for(const {fileName,csv} of reportCsv){
  const evidence=couponReleasedNetEvidence(csv,{
   invoice,order,reportFileName:fileName,sponsorVerified
  });
  if(evidence.eligible===true){accepted.push(evidence);continue;}
  if(evidence.reason!=="COUPON_RELEASE_NOT_FOUND"){
   return {status:"requires_review",reason:safeReason(evidence.reason),accepted:null};
  }
 }
 if(accepted.length>1)return {status:"requires_review",
   reason:"MULTIPLE_RELEASE_REPORT_MATCHES",accepted:null};
 if(!accepted.length)return {status:"awaiting_report",reason:"MP_RELEASE_NOT_FOUND",accepted:null};
 return {status:"verified_candidate",reason:"MATCHED_REPORT",
   accepted:accepted[0]};
}
async function recordObservation(client:DbClient,invoiceId:string,status:string,reason:unknown){
 const {error}=await client.from("clube_coupon_net_auto_observations_v1_931")
   .upsert({invoice_id:invoiceId,status,reason:safeReason(reason),
     last_checked_at:new Date().toISOString()},{onConflict:"invoice_id"});
 if(error)throw new Error("AUTO_OBSERVATION_UNAVAILABLE");
}
async function reconcileOne(client:DbClient,token:string,invoice:CouponInvoice,files:string[]){
 if(invoice.status!=="paid"||!invoice.paid_at||
    !invoice.provider_order_id||!invoice.provider_payment_id)
  return {status:"requires_review",reason:"PAID_INVOICE_INCOMPLETE"};
 const face=Number(invoice.coupon_face_cents)*Number(invoice.coupons_per_pack);
 const sponsorCandidate=Number.isSafeInteger(face)&&face>=1&&face<=10000&&
   Number(invoice.sponsor_covered_cents)===face;
 let sponsorVerified=false;
 if(sponsorCandidate){
  const {data,error}=await client.rpc("clube_coupon_sponsor_covered_v1_807",{
   p_invoice:invoice.id,p_required:face
  });
  if(error)throw new Error("SPONSOR_PROOF_UNAVAILABLE");
  sponsorVerified=data===true;
 }
 const {order,reportCsv}=await getProviderData(token,invoice,files);
 const found=evaluateReports({invoice,order,reportCsv,sponsorVerified});
 if(!found.accepted)return found;
 // Must re-check invoice state while registering, under original SQL row lock.
 // Neither a webhook nor one CSV row is sufficient alone; pure helper checks
 // order, specific Pix, exact gross/net and all correlated reversals.
 const {data,error}=await client.rpc("clube_coupon_net_auto_register_v1_931",{
  p_invoice_id:invoice.id,
  p_provider_order_id:invoice.provider_order_id,
  p_net_cents:found.accepted.netCents,
  p_reference:found.accepted.evidenceReference
 });
 if(error||data?.ok!==true||data?.auditRecorded!==true||
    data?.source!=="coupon_mp_net_auto_v1_931"||data?.moneyMoved!==false||
    data?.couponsActivated!==false)
  return {status:"requires_review",reason:"NET_REGISTER_REJECTED"};
 return {status:"net_verified",reason:"PROVIDER_CSV_ATOMICALLY_REGISTERED"};
}
// V1.932 — inspect existing MP report settings without changing an account-wide schedule.
const MANDATORY_RELEASE_FIELDS=["DATE","SOURCE_ID","EXTERNAL_REFERENCE","RECORD_TYPE",
 "DESCRIPTION","NET_CREDIT_AMOUNT","NET_DEBIT_AMOUNT","GROSS_AMOUNT"];
export function inspectReleaseReportConfig(config:unknown){
 if(!config||typeof config!=="object"||Array.isArray(config))
  return {ready:false,scheduled:false,reason:"MP_REPORT_CONFIG_MISSING",missing:MANDATORY_RELEASE_FIELDS};
 const c=config as Record<string,unknown>;
 const columns=Array.isArray(c.columns)?c.columns:[];
 const keys=new Set(columns.filter(x=>x&&typeof x==="object")
   .map(x=>String((x as Record<string,unknown>).key??"").toUpperCase()));
 const missing=MANDATORY_RELEASE_FIELDS.filter(k=>!keys.has(k));
 const format=String(c.format??"CSV").toUpperCase();
 const separator=String(c.separator??",");
 const translation=String(c.report_translation??"en").toLowerCase();
 const ready=missing.length===0&&format==="CSV"&&
   [",",";"].includes(separator)&&translation==="en";
 const reason=!ready?
   (missing.length?"MP_REPORT_COLUMNS_INCOMPLETE":"MP_REPORT_FORMAT_UNSUPPORTED"):
   c.scheduled===true?"MP_REPORT_CONFIG_READY":"MP_REPORT_SCHEDULE_DISABLED";
 return {ready,scheduled:c.scheduled===true,reason,missing};
}
Deno.serve(async req=>{
 if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
 const token=req.headers.get("X-Tamao-Coupon-Cron-Token")||"";
 if(!/^[0-9a-f]{64}$/.test(token)||!SUPABASE_URL||!SECRET_KEY)return json({ok:false},403);
 const client:DbClient=createClient(SUPABASE_URL,SECRET_KEY,{
  auth:{autoRefreshToken:false,persistSession:false}
 });
 const {data:authorized,error:authError}=await client.rpc(
  "clube_coupon_net_auto_authorize_v1_931",{p_token_sha:await sha256Hex(token)});
 if(authError||authorized!==true)return json({ok:false},403);
 const mpToken=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
 if(!mercadoPagoConfigured(mpToken))
  return json({ok:false,error:"MP_NOT_CONFIGURED"},503);
 try{
  const {data:invoices,error:pendingError}=await client.rpc(
   "clube_coupon_net_auto_pending_v1_931",{p_limit:MAX_INVOICES});
  if(pendingError||!Array.isArray(invoices)||invoices.length>MAX_INVOICES)
   throw new Error("AUTO_PENDING_UNAVAILABLE");
  if(!invoices.length)return json({ok:true,checked:0,registered:0,review:0,waiting:0});
  const listResponse=await mercadoPagoFetch("/v1/account/release_report/list",{
    accessToken:mpToken,method:"GET",timeoutMs:8000});
  if(!listResponse.ok)throw new Error("MP_RELEASE_LIST_UNAVAILABLE");
  const reports=selectOfficialReports(await readMercadoPagoJson(listResponse));
  // No POST to MP: a missing report may be a disabled account-wide schedule
  // or a missing/incompatible configuration. Diagnose rather than asserting
  // settlement or changing shared MP account settings.
  let reportConfiguration:null|ReturnType<typeof inspectReleaseReportConfig>=null;
  if(reports.complete&&!reports.files.length){
    try{
      const configResponse=await mercadoPagoFetch("/v1/account/release_report/config",{
        accessToken:mpToken,method:"GET",timeoutMs:8000});
      if(configResponse.status===404)
        reportConfiguration=inspectReleaseReportConfig(null);
      else if(configResponse.ok)
        reportConfiguration=inspectReleaseReportConfig(await readMercadoPagoJson(configResponse));
      else reportConfiguration={ready:false,scheduled:false,
        reason:"MP_REPORT_CONFIG_UNAVAILABLE",missing:[]};
    }catch{
      reportConfiguration={ready:false,scheduled:false,
        reason:"MP_REPORT_CONFIG_UNAVAILABLE",missing:[]};
    }
  }
  let registered=0,review=0,waiting=0;
  for(const invoice of invoices){
   let result;
   if(!reports.complete)result={status:"coverage_incomplete",reason:reports.reason};
   else if(!reports.files.length)result={status:"awaiting_report",
     reason:reportConfiguration?.reason==="MP_REPORT_CONFIG_READY"?
       "NO_PROCESSED_REPORT":reportConfiguration?.reason??"MP_REPORT_CONFIG_UNAVAILABLE"};
   else{
    try{result=await reconcileOne(client,mpToken,invoice,reports.files);}
    catch{result={status:"provider_unavailable",reason:"RETRYABLE_PROVIDER_OR_DATABASE_FAILURE"};}
   }
   await recordObservation(client,invoice.id,result.status,result.reason);
   if(result.status==="net_verified")registered++;
   else if(result.status==="requires_review")review++;
   else waiting++;
  }
  return json({ok:true,checked:invoices.length,registered,review,waiting,
    reportConfiguration});
 }catch{
  return json({ok:false,error:"AUTO_CONCILIATION_UNAVAILABLE"},503);
 }
});
