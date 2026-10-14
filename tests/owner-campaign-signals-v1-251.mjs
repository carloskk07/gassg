import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=load('supabase/migrations/20261014170000_owner_campaign_signals_v1_251.sql');
const edge=load('supabase/functions/admin-ops/index.ts');
const ui=load('js/admin-acquisition.js');
const boot=load('js/bootstrap.js');
const analytics=load('js/analytics.js');
const workflow=load('.github/workflows/audit.yml');

for(const invariant of [
 'platform_funding_private_v1_251.signals',
 'public.admin_owner_campaign_signals_v1_251',
 "a.admin_role in ('superadmin','finance')",
 'OWNER_SIGNALS_DENIED',
 'OWNER_SIGNALS_MONTH_INVALID',
 'platform_owner_budget_allocations_v1_247',
 'public.prelaunch_marketing_event_daily',
 'public.prelaunch_leads',
 "m.source='tamao' and m.medium='owner_campaign'",
 "l.source='tamao' and l.medium='owner_campaign'",
 "'tam-'||a.benefit_key",
 "'first_party_utm_tag_within_month_and_allocation_window'",
 "'returnOnInvestmentMeasured',false",
 "'revenueAttributedCents',null",
 "'spendableCents',0",
 "has_function_privilege('authenticated'",
])assert.ok(sql.includes(invariant),'SQL invariant missing: '+invariant);
assert.ok(!/(insert\s+into|update\s+public|delete\s+from)\s+public\./i.test(sql));
assert.ok(edge.includes('"owner-campaign-signals"'));
assert.ok(edge.includes('if(action==="owner-campaign-signals")'));
assert.ok(edge.includes('admin_owner_campaign_signals_v1_251'));
assert.ok(edge.includes('data?.returnOnInvestmentMeasured!==false'));
assert.ok(edge.includes('data?.spendableCents!==0'));
assert.ok(edge.includes('data?.revenueAttributedCents!==null'));
assert.ok(analytics.includes("const params=new URLSearchParams(location.search)"));
assert.ok(analytics.includes("campaign:safe('utm_campaign',120)"));
assert.ok(analytics.includes("'tamao.com.br'"));
assert.ok(!analytics.includes("globalThis.prelaunchExamplesEnabled?.()===true"),
  'Aggregate first party measurement must run on real site, not only previews');
assert.ok(boot.includes('adminOwnerCampaignSignalsLoadFromUi'));
assert.ok(boot.includes('adminOwnerCampaignSignalsCopyFromUi'));
assert.ok(ui.includes("['signals','Resultados']"));
assert.ok(ui.includes("adminOwnerFinanceTab==='signals'?adminOwnerCampaignSignalsSection()"));
assert.ok(workflow.includes('node tests/owner-campaign-signals-v1-251.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
new vm.Script(analytics,{filename:'analytics.js'});
const actor='11111111-1111-4111-8111-111111111111';
const allocation='22222222-2222-4222-8222-222222222222';
const ref='primeiros-clientes-01';
const tag='tam-customer_cashback-202610-'+ref;
const row={
 allocationId:allocation,campaignReference:ref,campaignLabel:'Primeira campanha <script>alert(1)</script>',
 campaignTag:tag,benefitKey:'customer_cashback',month:'2026-10-01',status:'allocated',
 plannedAllocationCents:5000,createdAt:'2026-10-14T12:00:00Z',releasedAt:null,
 landingViews:3,formViews:2,leads:2,customerLeads:2,merchantLeads:0,
 qualifiedLeads:1,crmConvertedLeads:0,
 attributionScope:'first_party_utm_tag_within_month_and_allocation_window',
 returnOnInvestmentMeasured:false,revenueAttributedCents:null
};
const fixtures={
 source:'admin_owner_campaign_signals_v1_251',
 month:'2026-10-01',totalCampaigns:1,rows:[row],limit:50,truncated:false,
 unattributedLandingViews:28,unattributedFormViews:8,
 measurementUnit:'first_party_event_counts_not_unique_people',
 revenueAttributedCents:null,returnOnInvestmentMeasured:false,
 readOnly:true,plannedOnly:true,bankApiConfirmed:false,
 spendableCents:0,newBenefitsEnabled:false,noCharge:true
};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
let role='superadmin',calls=[],toasts=[],copies=[];
const ctx=vm.createContext({
 adminCurrentRole:()=>role,
 adminRuntime:{session:{user:{id:actor}}},
 adminInvoke:async body=>{calls.push(body);return fixtures;},
 document:{getElementById:()=>({value:'2026-10'})},
 adminMoney:n=>'R$ '+(Number(n)/100).toFixed(2),
 esc,render:()=>{},toast:s=>toasts.push(s),
 navigator:{clipboard:{writeText:async s=>copies.push(s)}},
 window:{prompt:()=>{}},
 Number,Array,String,Date,Intl,Set,encodeURIComponent
});
const i=ui.indexOf('// TAMÃO V1.251 —');
const end=ui.indexOf('function adminOwnerFinanceWorkspaceSection(){',i);
assert.ok(i>=0&&end>i);
vm.runInContext(ui.slice(i,end),ctx);
let html=ctx.adminOwnerCampaignSignalsSection();
assert.ok(html.includes('Consultar resultados'));
assert.ok(!html.includes('R$ 50.00'),'No campaign values before authenticated fetch');
await ctx.adminOwnerCampaignSignalsLoadFromUi();
assert.equal(calls.length,1);
assert.equal(calls[0].action,'owner-campaign-signals');
assert.equal(calls[0].month,'2026-10-01');
html=ctx.adminOwnerCampaignSignalsSection();
for(const expected of ['R$ 50.00','não mensurado','28','Primeira campanha','Copiar link da campanha','(não são compras comprovadas)']){
 assert.ok(html.includes(expected),expected);
}
assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(!html.includes('<script>alert(1)</script>'));
await ctx.adminOwnerCampaignSignalsCopyFromUi(tag);
assert.equal(copies.length,1);
assert.equal(copies[0],'https://tamao.com.br/?utm_source=tamao&utm_medium=owner_campaign&utm_campaign='+tag+'#home');
await ctx.adminOwnerCampaignSignalsCopyFromUi('tam-customer_cashback-202610-missing');
assert.equal(copies.length,1,'Link unknown to authenticated result cannot be copied');
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerCampaignSignalsSection().includes('R$ 50.00'),'Session isolation');
ctx.adminRuntime.session.user.id=actor;
role='readonly';
assert.equal(ctx.adminOwnerCampaignSignalsSection(),'');
await ctx.adminOwnerCampaignSignalsLoadFromUi();
assert.equal(calls.length,1,'Read-only role cannot access finance signals');
role='superadmin';
fixtures.spendableCents=100;
await ctx.adminOwnerCampaignSignalsLoadFromUi();
assert.ok(toasts.some(s=>s.includes('não verificados')));
assert.ok(!ctx.adminOwnerCampaignSignalsSection().includes('R$ 50.00'),'Fail closed on unverified response');
console.log('V1.251 PASS — tagged campaign signals, source isolation, UTM link, escaping, no financial ROI.');
