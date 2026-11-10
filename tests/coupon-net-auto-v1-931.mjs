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
 Array,Number,String,Set,Date
});
vm.runInContext((selectors+evaluate)
 .replace('export function selectOfficialReports(list:unknown)','function selectOfficialReports(list)')
 .replace(/export function evaluateReports\\(\\{invoice,order,reportCsv,sponsorVerified\\}:[^\\n]+\\)/,
  'function evaluateReports({invoice,order,reportCsv,sponsorVerified})')
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
console.log('V1.931 PASS: machine-only scoped read, exact net report, sponsor proof, refund/duplicate failure-closed, audited atomic registration.');
