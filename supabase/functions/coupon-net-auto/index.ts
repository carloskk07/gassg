import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {mercadoPagoFetch,mercadoPagoConfigured,readMercadoPagoJson}
 from "../_shared/mercadopago.js";
import {couponReleasedNetEvidence}
 from "../admin-ops/coupon-release-evidence.js";
import {inspectReportSearch,discoverInvoiceReleaseReports} from "./report-search.js";

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
 // The official /list response can omit file_name even for processed reports.
 // This is a discoverability gap, not a reason to trust an unverified CSV.
 // Malformed, nonempty paths still fail closed and never reach download.
 // A mixed list must not let one absent name hide a different unsafe path.
 if(processed.some(r=>r?.file_name!=null&&r.file_name!==""&&
    !FILE_RE.test(String(r.file_name))))
  return {complete:false,files:[],reason:"MP_RELEASE_INVALID_FILENAME"};
 if(processed.some(r=>r?.file_name==null||r.file_name===""))
  return {complete:false,files:[],reason:"MP_RELEASE_FILENAME_MISSING"};
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
async function discoverReleaseReports(mpToken:string){
 const first=await mercadoPagoFetch("/v1/account/release_report/list",{
  accessToken:mpToken,method:"GET",timeoutMs:8000});
 if(!first.ok)throw new Error("MP_RELEASE_LIST_UNAVAILABLE");
 const initial=selectOfficialReports(await readMercadoPagoJson(first));
 // When /list lacks a file name, use the independent official /search
 // metadata as a bounded, read-only recovery path. Never accept bad paths.
 if((!initial.complete&&initial.reason!=="MP_RELEASE_FILENAME_MISSING")||
    (initial.complete&&initial.files.length>0))
  return {...initial,pending:0,blocked:0,source:"list_only"};
 const search=await mercadoPagoFetch(
  "/v1/account/release_report/search?limit=50&offset=0",{
  accessToken:mpToken,method:"GET",timeoutMs:8000});
 if(!search.ok)return {complete:false,files:[],pending:0,blocked:0,
  reason:"MP_RELEASE_SEARCH_UNAVAILABLE",source:"search_unavailable"};
 const raw=await readMercadoPagoJson(search);
 const total=Number(raw?.paging?.total);
 if(!Number.isSafeInteger(total)||total<0||total>50||
    !Array.isArray(raw?.results)||raw.results.length>total)
  return {complete:false,files:[],pending:0,blocked:0,
   reason:"MP_RELEASE_SEARCH_PAGINATION_INVALID",source:"official_search"};
 const items=[...raw.results];
 const ids=new Set<string>();
 for(const row of items){
  const id=String(row?.id??"");
  if(!/^[1-9][0-9]{0,19}$/.test(id)||ids.has(id))
   return {complete:false,files:[],pending:0,blocked:0,
    reason:"MP_RELEASE_SEARCH_ID_INVALID",source:"official_search"};
  ids.add(id);
 }
 // API search is paginated independently from /list. Never use an incomplete
 // page as evidence of report coverage or infer that generation has finished.
 // At most five provider pages and fifty rows for the entire account.
 for(let page=1;items.length<total&&page<=5;page++){
  if(items.length===0)break;
  const next=await mercadoPagoFetch(
   "/v1/account/release_report/search?limit=50&offset="+items.length,{
   accessToken:mpToken,method:"GET",timeoutMs:8000});
  if(!next.ok)return {complete:false,files:[],pending:0,blocked:0,
   reason:"MP_RELEASE_SEARCH_PAGE_UNAVAILABLE",source:"official_search"};
  const data=await readMercadoPagoJson(next);
  if(Number(data?.paging?.total)!==total||
      Number(data?.paging?.offset)!==items.length||
      !Array.isArray(data?.results)||data.results.length<1||
      data.results.length>total-items.length)
   return {complete:false,files:[],pending:0,blocked:0,
    reason:"MP_RELEASE_SEARCH_PAGE_MISMATCH",source:"official_search"};
  for(const row of data.results){
   const id=String(row?.id??"");
   if(!/^[1-9][0-9]{0,19}$/.test(id)||ids.has(id))
    return {complete:false,files:[],pending:0,blocked:0,
     reason:"MP_RELEASE_SEARCH_DUPLICATED",source:"official_search"};
   ids.add(id);items.push(row);
  }
 }
 const result=inspectReportSearch({paging:{total},results:items});
 return {...result,source:initial.reason==="MP_RELEASE_FILENAME_MISSING"?
   "official_search_missing_list_filename":"official_search"};
}
export function evaluateReports({invoice,order,reportCsv,sponsorVerified}:{invoice:CouponInvoice;order:unknown;reportCsv:NetReport[];sponsorVerified:boolean}){
 const accepted:ReturnType<typeof couponReleasedNetEvidence>[]=[];
 const correlation={invoiceReferenceRows:0,nativePaymentRows:0,referencePaymentRows:0};
 for(const {fileName,csv} of reportCsv){
  const evidence=couponReleasedNetEvidence(csv,{
   invoice,order,reportFileName:fileName,sponsorVerified
  });
  if(evidence.eligible===true){accepted.push(evidence);continue;}
  if('correlation' in evidence&&evidence.correlation){
   correlation.invoiceReferenceRows+=Number(evidence.correlation.invoiceReferenceRows||0);
   correlation.nativePaymentRows+=Number(evidence.correlation.nativePaymentRows||0);
   correlation.referencePaymentRows+=Number(evidence.correlation.referencePaymentRows||0);
  }
  if(evidence.reason!=="COUPON_RELEASE_NOT_FOUND"){
   return {status:"requires_review",reason:safeReason(evidence.reason),accepted:null};
  }
 }
 if(accepted.length>1)return {status:"requires_review",
   reason:"MULTIPLE_RELEASE_REPORT_MATCHES",accepted:null};
 if(!accepted.length)return {status:"awaiting_report",reason:"MP_RELEASE_NOT_FOUND",accepted:null,correlation};
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
// V1.933: bounded read-only report readiness even during the invoice retry
// cooldown. No schedule creation, financial mutation, or invoice status edit.
// MP is authoritative. Only an actual HTTP 404 proves that account-wide
// report configuration is absent and permits a one-time safe initial setup.
const REPORT_PREFIX="tamao-release-v1";
async function getReleaseReportConfigSummary(mpToken:string){
 try{
  const response=await mercadoPagoFetch("/v1/account/release_report/config",{
   accessToken:mpToken,method:"GET",timeoutMs:8000});
  if(response.status===404)
   return {...inspectReleaseReportConfig(null),verifiedAbsent:true,owned:false};
  if(response.ok){
   const data=await readMercadoPagoJson(response);
   const report=inspectReleaseReportConfig(data);
   const d=data&&typeof data==="object"&&!Array.isArray(data)?data:{};
   const frequency=d.frequency&&typeof d.frequency==="object"?d.frequency:{};
   const noRecipients=!Array.isArray(d.notification_email_list)||
     d.notification_email_list.length===0;
   const noExternalDelivery=!d.sftp_info&&noRecipients;
   const owned=report.ready&&d.file_name_prefix===REPORT_PREFIX&&
     frequency.type==="daily"&&noExternalDelivery;
   return {...report,verifiedAbsent:false,owned};
  }
 }catch{/* Provider may not expose these reports to this account. */}
 return {ready:false,scheduled:false,verifiedAbsent:false,owned:false,
  reason:"MP_REPORT_CONFIG_UNAVAILABLE",missing:[]};
}
async function claimReportSetup(client:DbClient,action:"create_config"|"enable_schedule"){
 const {data,error}=await client.rpc("clube_coupon_mp_report_setup_claim_v1_934",{
  p_action:action
 });
 if(error)throw new Error("MP_REPORT_SETUP_CLAIM_UNAVAILABLE");
 return data===true;
}
async function prepareReleaseReports(client:DbClient,mpToken:string,initial:Awaited<ReturnType<typeof getReleaseReportConfigSummary>>){
 let config=initial;
 if(config.verifiedAbsent===true){
  if(!await claimReportSetup(client,"create_config"))
   return {...config,reason:"MP_REPORT_CONFIG_SETUP_IN_PROGRESS"};
  // First-time account configuration only. No SFTP, webhooks, customer
  // notifications or other external delivery. No POST /orders or /payments.
  const createResponse=await mercadoPagoFetch("/v1/account/release_report/config",{
   accessToken:mpToken,method:"POST",timeoutMs:9000,
   body:{file_name_prefix:REPORT_PREFIX,
    frequency:{type:"daily",hour:3},
    columns:MANDATORY_RELEASE_FIELDS.map(key=>({key})),
    separator:",",report_translation:"en",
    include_withdrawal_at_end:false,execute_after_withdrawal:false,
    notification_email_list:[]}
  });
  if(![200,201].includes(createResponse.status))
   return {...config,reason:"MP_REPORT_CONFIG_CREATE_REJECTED"};
  config=await getReleaseReportConfigSummary(mpToken);
  if(!config.ready||!config.owned)
   return {...config,reason:"MP_REPORT_CONFIG_CREATE_UNCONFIRMED"};
 }
 // Never change a configuration owned by another integration and never
 // alter existing columns, recipients, timezone or schedule frequency.
 if(config.ready&&config.scheduled===false&&config.owned===true){
  if(!await claimReportSetup(client,"enable_schedule"))
   return {...config,reason:"MP_REPORT_SCHEDULE_SETUP_IN_PROGRESS"};
  const scheduleResponse=await mercadoPagoFetch("/v1/account/release_report/schedule",{
    accessToken:mpToken,method:"POST",timeoutMs:9000
  });
  // MP may activate scheduling before a non-200 / ambiguous response.
  // An authenticated GET readback is authoritative; never report failure
  // merely from the POST status or issue a second POST to compensate.
  const afterSchedule=await getReleaseReportConfigSummary(mpToken);
  if(afterSchedule.ready&&afterSchedule.scheduled&&afterSchedule.owned)
   config=afterSchedule;
  else if(scheduleResponse.status!==200)
   return {...afterSchedule,reason:"MP_REPORT_SCHEDULE_REJECTED"};
  else return {...afterSchedule,reason:"MP_REPORT_SCHEDULE_UNCONFIRMED"};
 }
 return config;
}
// V1.936: initiate at most one historical report request per invoice and one
// globally per UTC day. An ambiguous response is never automatically replayed.
// This creates a provider REPORT only, not a payment, refund or voucher.
async function requestHistoricalReleaseReport(client:DbClient,mpToken:string,invoice:CouponInvoice){
 const {data:claim,error:claimError}=await client.rpc("clube_coupon_mp_report_backfill_claim_v1_936",{
  p_invoice:invoice.id
 });
 if(claimError)return "CLAIM_FAILED_NO_PROVIDER_POST";
 if(claim?.claimed!==true&&claim?.reason!=="ALREADY_REQUESTED")
  return "NOT_REQUESTED_"+safeReason(claim?.reason);
 // Transactionally mark the exact provider report window as dispatched
 // BEFORE sending POST. A lost HTTP reply or concurrent cron cannot replay it.
 // A legacy reservation can be resumed only if pg_net proves the old worker
 // failed locally BEFORE the outbound POST (INVALID_CLAIM_WINDOW_NO_POST).
 const {data:dispatch,error:dispatchError}=await client.rpc(
  "clube_coupon_mp_report_backfill_dispatch_v1_938",{p_invoice:invoice.id});
 if(dispatchError||dispatch?.authorized!==true)
  return "DISPATCH_UNAUTHORIZED_NO_PROVIDER_POST";
 const start=String(dispatch?.begin_date??""),end=String(dispatch?.end_date??"");
 const dateRe=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
 if(!dateRe.test(start)||!dateRe.test(end))return "INVALID_DISPATCH_WINDOW_NO_POST";
 try{
  const response=await mercadoPagoFetch("/v1/account/release_report",{
   accessToken:mpToken,method:"POST",timeoutMs:9000,
   body:{begin_date:start,end_date:end}
  });
  // HTTP 202 confirms report generation accepted, NOT financial settlement.
  return response.status===202?"REPORT_GENERATION_ACCEPTED":
    "REPORT_RESPONSE_UNCONFIRMED_NO_RETRY";
 }catch{
  return "REPORT_REQUEST_AMBIGUOUS_NO_RETRY";
 }
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
  if(!invoices.length){
   // Eligibility is cooldown-limited (30 minutes). During the cooldown,
   // still diagnose provider settings when a genuine paid invoice awaits
   // independent net proof. Never reset last_checked_at to force a check.
   const pendingReceipt=await client.from("clube_coupon_paid_invoices")
    .select("id,status,paid_at,provider_order_id,provider_payment_id,sale_price_cents,coupon_face_cents,coupons_per_pack,sponsor_covered_cents")
    .eq("status","paid").is("net_proceeds_verified_at",null).order("paid_at",{ascending:true}).limit(1);
   if(pendingReceipt.error)throw new Error("AUTO_UNRECONCILED_COUNT_UNAVAILABLE");
   let reportConfiguration=Array.isArray(pendingReceipt.data)&&pendingReceipt.data.length>0
      ?await getReleaseReportConfigSummary(mpToken):null;
   if(reportConfiguration)
    reportConfiguration=await prepareReleaseReports(client,mpToken,reportConfiguration);
   let reportBackfill="NOT_ATTEMPTED";
   let providerReportQueue:null|{pendingAccountReports:number;failedAccountReports:number;
     source:string;coverageComplete:boolean;reason:string|null}=null;
   // V1.937: a paid invoice's 30-minute NET-reconciliation cooldown is
   // independent of a one-time, rate-limited provider report generation.
   // Do NOT update last_checked_at or recheck Pix/settlement in this branch.
   if(reportConfiguration?.ready===true&&reportConfiguration?.scheduled===true&&
     reportConfiguration?.owned===true&&pendingReceipt.data?.length===1){
    try{
     const reports=await discoverReleaseReports(mpToken);
     providerReportQueue={pendingAccountReports:reports.pending,
       failedAccountReports:reports.blocked,source:reports.source,
       coverageComplete:reports.complete,reason:reports.reason};
     // An existing pending task also blocks creating another report.
     if(reports.source==="official_search"&&reports.complete&&
        reports.files.length===0&&reports.pending===0&&reports.blocked===0)
      reportBackfill=await requestHistoricalReleaseReport(
        client,mpToken,pendingReceipt.data[0]);
    }catch{/* Report list is required; never request under uncertain coverage. */}
   }
   return json({ok:true,checked:0,registered:0,review:0,waiting:0,
     reportConfiguration,reportBackfill,providerReportQueue});
  }
  const reports=await discoverReleaseReports(mpToken);
  // No POST to MP: a missing report may be a disabled account-wide schedule
  // or a missing/incompatible configuration. Diagnose rather than asserting
  // settlement or changing shared MP account settings.
  let reportConfiguration:null|Awaited<ReturnType<typeof getReleaseReportConfigSummary>>=null;
  if(reports.complete&&!reports.files.length){
   const initial=await getReleaseReportConfigSummary(mpToken);
   reportConfiguration=await prepareReleaseReports(client,mpToken,initial);
  }
  let reportBackfill="NOT_ATTEMPTED";
  // The direct report generation endpoint is independent of the existing
  // daily schedule. Only a verified TAMÃO-owned active configuration permits
  // requesting a bounded historical report for a genuine paid invoice.
  if(reports.source==="official_search"&&reports.complete&&
    reports.files.length===0&&reports.pending===0&&reports.blocked===0&&
    reportConfiguration?.ready===true&&reportConfiguration?.scheduled===true&&
    reportConfiguration?.owned===true&&invoices.length>0)
    reportBackfill=await requestHistoricalReleaseReport(client,mpToken,invoices[0]);
  let registered=0,review=0,waiting=0;
  const reportCorrelation={invoiceReferenceRows:0,nativePaymentRows:0,referencePaymentRows:0};
  for(const invoice of invoices){
   let result:any;
   let receiptReports=reports;
   if(!reports.complete&&["MP_RELEASE_LIST_INCOMPLETE","MP_RELEASE_COVERAGE_LIMIT",
     "MP_RELEASE_SEARCH_TOO_MANY_FILES","MP_RELEASE_SEARCH_PAGINATION_INVALID"].includes(String(reports.reason))){
    try{
     receiptReports={...await discoverInvoiceReleaseReports(invoice,async(path:string)=>{
      const response=await mercadoPagoFetch(path,{accessToken:mpToken,method:"GET",timeoutMs:8000});
      if(!response.ok)throw Error("MP_RELEASE_INVOICE_WINDOW_UNAVAILABLE");
      return readMercadoPagoJson(response);
     }),source:"invoice_creation_window"};
    }catch{receiptReports={...reports,reason:"MP_RELEASE_INVOICE_WINDOW_UNAVAILABLE"};}
   }
   if(!receiptReports.complete)result={status:"coverage_incomplete",reason:receiptReports.reason};
   else if(!receiptReports.files.length)result={status:receiptReports.blocked>0?
      "requires_review":"awaiting_report",
     reason:receiptReports.blocked>0?"MP_REPORT_GENERATION_FAILED":
       receiptReports.pending>0?"MP_REPORT_PROCESSING":
       reportConfiguration?.reason==="MP_REPORT_CONFIG_READY"?
       "NO_PROCESSED_REPORT":reportConfiguration?.reason??"MP_REPORT_CONFIG_UNAVAILABLE"};
   else{
    try{result=await reconcileOne(client,mpToken,invoice,receiptReports.files);}
    catch{result={status:"provider_unavailable",reason:"RETRYABLE_PROVIDER_OR_DATABASE_FAILURE"};}
   }
   await recordObservation(client,invoice.id,result.status,result.reason);
   if(result.correlation){
    reportCorrelation.invoiceReferenceRows+=Number(result.correlation.invoiceReferenceRows||0);
    reportCorrelation.nativePaymentRows+=Number(result.correlation.nativePaymentRows||0);
    reportCorrelation.referencePaymentRows+=Number(result.correlation.referencePaymentRows||0);
   }
   if(result.status==="net_verified")registered++;
   else if(result.status==="requires_review")review++;
   else waiting++;
  }
  return json({ok:true,checked:invoices.length,registered,review,waiting,reportCorrelation,
    reportConfiguration,reportBackfill,
    providerReportQueue:{pendingAccountReports:reports.pending,
      failedAccountReports:reports.blocked,source:reports.source,
      coverageComplete:reports.complete,reason:reports.reason}});
 }catch{
  return json({ok:false,error:"AUTO_CONCILIATION_UNAVAILABLE"},503);
 }
});
