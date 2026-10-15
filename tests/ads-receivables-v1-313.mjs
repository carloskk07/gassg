import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016070000_ads_receivables_v1_313.sql');
const admin=read('js/admin-activations.js'),merchant=read('js/merchant.js');
const a=read('supabase/functions/admin-ops/index.ts'),m=read('supabase/functions/merchant-ops/index.ts');
new vm.Script(admin);new vm.Script(merchant);
for(const t of [
 'platform_ads_receivables_v1_313','platform_ads_receivable_requests_v1_313',
 'platform_ads_payment_reports_v1_313',
 'enable row level security',
 'revoke all on public.platform_ads_receivables_v1_313',
 'revoke all on public.platform_ads_payment_reports_v1_313',
 "a.admin_role='superadmin'","mm.member_role in ('owner','manager')",
 "v_role<>'owner'","status='bilateral_accepted'","v_instrument.version<3",
 'ADS_RECEIVABLE_DOCUMENT_HASH_MISMATCH','extensions.digest',
 'ADS_RECEIVABLE_BILATERAL_ACCEPTANCE_REQUIRED',
 'ADS_RECEIVABLE_VERSION_CONFLICT','ADS_RECEIVABLE_REQUEST_REUSE',
 "status in ('draft','issued','canceled')",
 "check(verification_status='unverified')",
 "'verifiedPaid',false","'paymentVerified',false",
 "'pspChargeCreated',false","'merchantBillingSeparate',true",
 "'collectedRevenueCents',0","'verifiedPayments',0",
 'platform_admin_audit'
])assert.ok(sql.includes(t),'SQL guard: '+t);
assert.ok(!/insert into public\.(merchant_billing_payment_requests|merchant_billing_payment_events|merchant_billing_provider_charges)/.test(sql));
assert.ok(!/update public\.(ads_placement_controls|merchant_ads_campaigns|merchant_billing)/.test(sql));
for(const t of [
 '"ads-receivables-read"','if(action==="ads-receivables-read")',
 'if(action==="ads-receivable-action")',
 'admin_ads_receivables_read_v1_313','admin_ads_receivable_action_v1_313',
 'String(adminAccess.admin_role||"")!=="superadmin"',
 'data.verifiedPaid!==false','data.merchantBillingSeparate!==true'
])assert.ok(a.includes(t),'Admin API guard: '+t);
for(const t of [
 '"ads-receivable"','if(action==="ads-receivable")',
 'role!=="owner"','admin.rpc("merchant_ads_receivable_v1_313"',
 'data.paymentVerified!==false','data.pspChargeCreated!==false'
])assert.ok(m.includes(t),'Merchant API guard: '+t);
assert.ok(admin.includes('adminAdsReceivablesView()'));
assert.ok(admin.includes("['adsReceivables','ads-receivables-read','admin_ads_receivables_v1_313']"));
assert.ok(merchant.includes('merchantAdsReceivableSection(m)'));
const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let ref='',allow=true,role='owner',n=0;let calls=[],notices=[];
const rt={merchant:{merchantId,memberRole:role}};
const tail=merchant.slice(merchant.indexOf('// TAMÃO V1.313 — merchant billing statement'));
const ctx=vm.createContext({
 merchantRuntime:rt,
 merchantInvoke:async(_name,payload)=>{
  calls.push(payload);
  if(payload.operation==='view')return {
   source:'merchant_ads_receivable_v1_313',merchantId,readOnly:true,
   paymentVerified:false,adsLive:false,pspChargeCreated:false,
   statement:{amountCents:12000,currency:'BRL',status:'issued',version:2,
    dueDate:'2026-11-15',documentSha256:'a'.repeat(64),unverifiedReports:n}
  };
  n++;
  return {source:'merchant_ads_receivable_v1_313',merchantId,reported:true,
   paymentVerified:false,adsLive:false,pspChargeCreated:false};
 },
 crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
 document:{getElementById:()=>({value:ref})},
 confirm:()=>allow,toast:s=>notices.push(s),render:()=>{},esc:s=>String(s),
 Number,String,Date,Promise
});
vm.runInContext(tail+
 '\nthis.loadStatement=merchantAdsReceivableLoad;this.reportStatement=merchantAdsReceivableReport;this.showStatement=merchantAdsReceivableSection;',ctx);
assert.equal((await ctx.loadStatement()).statement.status,'issued');
assert.match(ctx.showStatement(rt.merchant),/120,00/);
assert.match(ctx.showStatement(rt.merchant),/não verificadas/);
assert.equal(await ctx.reportStatement(),false);
ref='ABC1234567';allow=false;
assert.equal(await ctx.reportStatement(),false);
allow=true;
assert.equal(await ctx.reportStatement(),true);
assert.equal(n,1);
assert.equal(calls.filter(x=>x.operation==='report').length,1);
assert.equal(calls.find(x=>x.operation==='report').version,2);
assert.equal(calls.find(x=>x.operation==='report').reference,ref);
rt.merchant.memberRole='manager';
assert.equal(await ctx.reportStatement(),false);
rt.merchant.memberRole='support';
assert.equal(ctx.showStatement(rt.merchant),'');
console.log('V1.313 PASS — founder-only Ads statements, readback, owner reports unverified, zero PSP/paid revenue.');
