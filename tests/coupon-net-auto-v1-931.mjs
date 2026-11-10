import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const worker=read('supabase/functions/coupon-net-auto/index.ts');
const sql=read('supabase/migrations/20261110193500_coupon_net_auto_v1_931.sql');
const evidence=await import('data:text/javascript;base64,'+
 Buffer.from(read('supabase/functions/admin-ops/coupon-release-evidence.js')).toString('base64'));
const split=(first,last)=>worker.slice(worker.indexOf(first),worker.indexOf(last));
const selectors=split('export function selectOfficialReports','async function getProviderData');
const evaluate=split('export function evaluateReports','async function recordObservation');
const ctx=vm.createContext({
 couponReleasedNetEvidence:evidence.couponReleasedNetEvidence,
 safeReason:x=>String(x||'').replace(/[^A-Za-z0-9_]/g,'_').slice(0,110),
 FILE_RE:/^[A-Za-z0-9][A-Za-z0-9._-]{7,140}\.csv$/,
 MAX_REPORTS:10,
 Array,Number,String,Set,Date
});
vm.runInContext((selectors+evaluate)
 .replace('export function selectOfficialReports(list:unknown)','function selectOfficialReports(list)')
 .replace(/^export function evaluateReports.*$/m,
  'function evaluateReports({invoice,order,reportCsv,sponsorVerified}){')
 .replace('const accepted:ReturnType<typeof couponReleasedNetEvidence>[]=[];','const accepted=[];')+
 '\nthis.reports=selectOfficialReports;this.evalReports=evaluateReports;',ctx);
const report=name=>({file_name:name,status:'processed',is_test:false,currency_id:'BRL'});
const file='release-prod-20261110.csv';
assert.equal(ctx.reports([report(file)]).complete,true);
assert.equal(ctx.reports([report(file)]).files.length,1);
assert.equal(ctx.reports([report(file),report(file)]).files.length,1);
for(const bad of [
 [report('../invalid.csv')],Array.from({length:11},(_,i)=>report('report-prod-'+i+'.csv')),
 Array.from({length:51},()=>({status:'pending'}))
])assert.equal(ctx.reports(bad).complete,false);
const id='11111111-1111-4111-8111-111111111111';
const invoice={id,status:'paid',paid_at:'2026-11-10T15:46:34Z',
 provider_order_id:'mp-order-1',provider_payment_id:'mp-payment-1',
 sale_price_cents:890,coupon_face_cents:500,coupons_per_pack:3,
 sponsor_covered_cents:1500};
const order={id:'mp-order-1',external_reference:id,status:'processed',
 total_amount:'8.90',currency_id:'BRL',transactions:{
 payments:[{id:'mp-payment-1',amount:'8.90',status:'approved',
   payment_method:{id:'pix',type:'bank_transfer'}}],refunds:[]}};
const cols=['DATE','SOURCE_ID','EXTERNAL_REFERENCE','RECORD_TYPE','DESCRIPTION',
 'NET_CREDIT_AMOUNT','NET_DEBIT_AMOUNT','GROSS_AMOUNT','CURRENCY'];
const line=(override={})=>{
 const values={DATE:'2026-11-10T18:00:00Z',SOURCE_ID:'mp-payment-1',
 EXTERNAL_REFERENCE:id,RECORD_TYPE:'release',DESCRIPTION:'payment',
 NET_CREDIT_AMOUNT:'8.40',NET_DEBIT_AMOUNT:'0.00',GROSS_AMOUNT:'8.90',CURRENCY:'BRL',...override};
 return cols.map(c=>values[c]).join(',');
};
const csv=cols.join(',')+'\n'+line()+'\n';
const check=(reports,sponsorVerified=true,provider=order)=>ctx.evalReports({
 invoice,order:provider,sponsorVerified,
 reportCsv:reports.map((v,i)=>({fileName:'release-prod-2026111'+i+'.csv',csv:v}))
});
const verified=check([csv]);
assert.equal(verified.status,'verified_candidate');
assert.equal(verified.accepted.netCents,840);
assert.equal(verified.accepted.evidenceReference,
 'mp-release:release-prod-20261110.csv:mp-payment-1');
assert.equal(check([csv],false).status,'requires_review');
assert.equal(check([csv,csv]).reason,'MULTIPLE_RELEASE_REPORT_MATCHES');
assert.equal(check([cols.join(',')+'\n'+line({SOURCE_ID:'other'})]).status,'awaiting_report');
assert.equal(check([csv+'\n'+line({RECORD_TYPE:'chargeback',NET_CREDIT_AMOUNT:'0.00',
 NET_DEBIT_AMOUNT:'8.40',GROSS_AMOUNT:'-8.90'})]).status,'requires_review');
const refunded=structuredClone(order);
refunded.transactions.refunds=[{id:'refund-1'}];
assert.equal(check([csv],true,refunded).reason,'COUPON_PROVIDER_BINDING_UNVERIFIED');
assert.match(worker,/X-Tamao-Coupon-Cron-Token/);
assert.match(worker,/clube_coupon_net_auto_authorize_v1_931/);
assert.match(worker,/clube_coupon_net_auto_register_v1_931/);
assert.match(worker,/clube_coupon_sponsor_covered_v1_807/);
assert.match(worker,/getProviderData\(token,invoice,files\)/);
assert.doesNotMatch(worker,/mercadoPagoFetch\([^\n]+method:"POST"/);
assert.match(sql,/default false/);
assert.match(sql,/clube_coupon_paid_net_proceeds_verify\(/);
assert.match(sql,/on conflict \(invoice_id\) do nothing/);
assert.match(sql,/from public,anon,authenticated/);
assert.match(sql,/revoke all on function public.clube_coupon_net_auto_cron_tick_v1_931\(\)/);
assert.match(sql,/to service_role/);
assert.match(sql,/select cron.schedule\('tamao-coupon-net-auto-v1-931'/);
assert.match(sql,/clube_coupon_net_auto_audit_v1_931/);
const audit=read('.github/workflows/audit.yml');
assert.match(audit,/node tests\/coupon-net-auto-v1-931\.mjs/);
// V1.932: official account settings, NOT a payment or a permission
// to alter another app's account-wide reporting configuration.
const configSrc=worker.slice(worker.indexOf('const MANDATORY_RELEASE_FIELDS='),
 worker.indexOf('Deno.serve(async req=>{'));
assert.ok(configSrc.includes('const MANDATORY_RELEASE_FIELDS='));
vm.runInContext(configSrc
 .replace('inspectReleaseReportConfig(config:unknown)',
   'inspectReleaseReportConfig(config)')
 .replace('const c=config as Record<string,unknown>;','const c=config;')
 .replace('(x as Record<string,unknown>).key','x.key')
 .replace('export function inspectReleaseReportConfig','function inspectReleaseReportConfig')
 +String.fromCharCode(10)+'this.reportConfig=inspectReleaseReportConfig;',ctx);
const required=['DATE','SOURCE_ID','EXTERNAL_REFERENCE','RECORD_TYPE',
 'DESCRIPTION','NET_CREDIT_AMOUNT','NET_DEBIT_AMOUNT','GROSS_AMOUNT'];
const good={columns:required.map(key=>({key})),scheduled:true,format:'CSV'};
assert.equal(ctx.reportConfig(good).ready,true);
assert.equal(ctx.reportConfig(good).scheduled,true);
assert.equal(ctx.reportConfig({...good,scheduled:false}).reason,'MP_REPORT_SCHEDULE_DISABLED');
assert.equal(ctx.reportConfig(null).reason,'MP_REPORT_CONFIG_MISSING');
assert.equal(ctx.reportConfig({...good,columns:required.slice(0,6).map(key=>({key}))}).ready,false);
assert.equal(ctx.reportConfig({...good,format:'XLSX'}).ready,false);
assert.equal(ctx.reportConfig({...good,report_translation:'pt'}).ready,false);
assert.match(worker,/\/v1\/account\/release_report\/config/);
assert.match(worker,/reportConfiguration/);
assert.match(worker,/method:"GET",timeoutMs:8000/);
assert.match(worker,/mercadoPagoFetch\("\/v1\/account\/release_report\/schedule"/);
assert.match(worker,/MP_REPORT_CONFIG_SETUP_IN_PROGRESS/);
assert.match(worker,/MP_REPORT_SCHEDULE_UNCONFIRMED/);
assert.match(worker,/const afterSchedule=await getReleaseReportConfigSummary\(mpToken\)/);
assert.match(worker,/if\(afterSchedule\.ready&&afterSchedule\.scheduled&&afterSchedule\.owned\)/);
assert.match(worker,/config=afterSchedule/);
assert.match(worker,/else if\(scheduleResponse\.status!==200\)/);
assert.match(worker,/verifiedAbsent===true/);
assert.match(worker,/frequency:\{type:"daily",hour:3\}/);
assert.match(worker,/notification_email_list:\[\]/);
assert.match(worker,/clube_coupon_mp_report_setup_claim_v1_934/);
assert.doesNotMatch(worker,/mercadoPagoFetch\("\/v1\/orders",\{[^}]*method:"POST"/);
assert.match(worker,/getReleaseReportConfigSummary\(mpToken\)/);
assert.match(worker,/\.eq\("status","paid"\)\.is\("net_proceeds_verified_at",null\)\.order\("paid_at",\{ascending:true\}\)\.limit\(1\)/);
assert.match(worker,/if\(!invoices\.length\)\{/);
assert.match(worker,/pendingReceipt\.error/);
assert.match(worker,/AUTO_UNRECONCILED_COUNT_UNAVAILABLE/);
assert.match(worker,/getReleaseReportConfigSummary\(mpToken\):null/);
assert.doesNotMatch(worker,/setTimeout\([^,]*,\s*0\)/);

const setupSql=read('supabase/migrations/20261110212000_coupon_mp_report_setup_v1_934.sql');
assert.match(setupSql,/interval '24 hours'/);
assert.match(setupSql,/security invoker/);
assert.match(setupSql,/to service_role/);
assert.match(setupSql,/from public,anon,authenticated/);
assert.match(setupSql,/clube_coupon_net_auto_config_v1_931/);
assert.match(setupSql,/clube_coupon_paid_invoices/);
const backfillSql=read('supabase/migrations/20261110215000_coupon_mp_release_report_backfill_v1_936.sql');
assert.match(backfillSql,/invoice_id uuid primary key/);
assert.match(backfillSql,/request_day date not null unique/);
assert.match(backfillSql,/on conflict do nothing/);
assert.match(backfillSql,/status<>'paid'/);
assert.match(backfillSql,/net_proceeds_verified_at is not null/);
assert.match(backfillSql,/interval '2 hours'/);
assert.match(backfillSql,/interval '7 days'/);
assert.match(backfillSql,/interval '15 minutes'/);
assert.match(backfillSql,/security definer/);
assert.match(backfillSql,/for update/);
assert.match(backfillSql,/from public,anon,authenticated/);
assert.match(backfillSql,/to service_role/);
assert.match(worker,/clube_coupon_mp_report_backfill_claim_v1_936/);
assert.match(worker,/function requestHistoricalReleaseReport\(/);
assert.match(worker,/reportConfiguration\?\.owned===true/);
assert.match(worker,/reports\.complete&&reports\.files\.length===0/);
assert.match(worker,/claim\?\.claimed!==true/);
assert.match(worker,/\/v1\/account\/release_report",\{/);
assert.match(worker,/begin_date:start,end_date:end/);
assert.match(worker,/response\.status===202/);
assert.match(worker,/REPORT_REQUEST_AMBIGUOUS_NO_RETRY/);
assert.match(worker,/REPORT_RESPONSE_UNCONFIRMED_NO_RETRY/);
assert.match(worker,/reportBackfill/);
// V1.937: a missing old report can be requested without changing the
// independent 30-minute financial reconciliation checkpoint.
const cooldownStart=worker.indexOf('if(!invoices.length){');
const cooldownEnd=worker.indexOf('const listResponse=await mercadoPagoFetch',cooldownStart);
const cooldown=worker.slice(cooldownStart,cooldownEnd);
assert.ok(cooldownStart>0&&cooldownEnd>cooldownStart);
assert.match(cooldown,/reportConfiguration\?\.owned===true/);
assert.match(cooldown,/pendingReceipt\.data\?\.length===1/);
assert.match(cooldown,/selectOfficialReports\(await readMercadoPagoJson\(response\)\)/);
assert.match(cooldown,/reports\.complete&&reports\.files\.length===0/);
assert.match(cooldown,/requestHistoricalReleaseReport\(/);
assert.match(cooldown,/reportBackfill/);
assert.doesNotMatch(cooldown,/recordObservation\(/);
assert.doesNotMatch(cooldown,/\.update\(/);
assert.doesNotMatch(cooldown,/clube_coupon_net_auto_register_v1_931/);
// V1.938: report generation may be resumed only after authenticated local
// pre-POST rejection, with DB dispatch marker consumed before outbound POST.
const dispatchSql=read('supabase/migrations/20261110220000_coupon_mp_backfill_dispatch_v1_938.sql');
assert.match(dispatchSql,/dispatch_started_at/);
assert.match(dispatchSql,/verified_no_post_recovery/);
assert.match(dispatchSql,/INVALID_CLAIM_WINDOW_NO_POST/);
assert.match(dispatchSql,/net\._http_response/);
assert.match(dispatchSql,/for update/);
assert.match(dispatchSql,/security definer/);
assert.match(dispatchSql,/to service_role/);
assert.match(dispatchSql,/from public,anon,authenticated/);
assert.match(worker,/clube_coupon_mp_report_backfill_dispatch_v1_938/);
assert.match(worker,/dispatch\?\.authorized!==true/);
assert.match(worker,/DISPATCH_UNAUTHORIZED_NO_PROVIDER_POST/);
assert.match(worker,/INVALID_DISPATCH_WINDOW_NO_POST/);
assert.match(worker,/const dateRe=\/\^\\d\{4\}/);
const dateLine=worker.split(String.fromCharCode(10)).find(line=>line.includes('const dateRe='));
assert.equal(dateLine?.includes(String.fromCharCode(92,92,100)),false,'regex must match digits, not a literal backslash');
assert.ok(worker.indexOf('clube_coupon_mp_report_backfill_dispatch_v1_938')<
  worker.indexOf('mercadoPagoFetch("/v1/account/release_report",{'),
  'dispatch reservation must precede any historical provider report POST');
console.log('V1.931 PASS: machine-only scoped read, exact net report, sponsor proof, refund/duplicate failure-closed, audited atomic registration.');
