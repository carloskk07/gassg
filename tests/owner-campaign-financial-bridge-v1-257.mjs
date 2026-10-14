import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014230000_owner_campaign_financial_bridge_v1_257.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const required of [
 'platform_funding_private_v1_257.summary',
 'platform_funding_private_v1_257.orphans',
 'public.admin_owner_campaign_financial_bridge_v1_257',
 'public.admin_owner_campaign_receipt_orphans_v1_257',
 'OWNER_FINANCIAL_BRIDGE_DENIED',
 'OWNER_RECEIPT_ORPHANS_DENIED',
 "a.admin_role in ('superadmin','finance')",
 'platform_funding_private_v1_253.fee_receipts(p_actor,v_month)',
 'platform_funding_private_v1_254.batch_report(p_actor,v_month)',
 'platform_funding_private_v1_255.read_expenses(p_actor,v_month)',
 "o.bucket_id='tamao-owner-campaign-receipts-v1-256'",
 'public.platform_campaign_marketing_receipts_v1_256',
 'public.platform_campaign_marketing_cost_voids_v1_255',
 'v_solo->>','v_batches->>','v_costs->>',
 "'providerFeeEvidenceCents',e.solo_fee+e.batch_fee",
 "'ownerReportedMarketingSpendCents',e.owner_spend",
 "'marketingSpendWithStoredReceiptCents',e.attached_cost_cents",
 "'marketingSpendWithoutStoredReceiptCents',e.owner_spend-e.attached_cost_cents",
 "'partialEvidenceDifferenceCents',case",
 "e.solo_fee+e.batch_fee>0 and e.owner_spend>0",
 "'comparisonMeaning','partial_difference_not_profit_not_roi'",
 "'revenueAttributionIsCausal',false",
 "'bankSettlementVerified',false",
 "'profitMeasured',false",
 "'roiMeasured',false",
 "'readOnly',true",
 "'automaticDeletionEnabled',false",
 "'deletionPerformed',false",
 "o.created_at<=clock_timestamp()-interval '24 hours'",
 "o.created_at>clock_timestamp()-interval '24 hours'",
 "'noObjectPaths',true",
 'grant execute on function public.admin_owner_campaign_financial_bridge_v1_257(uuid,date)',
 'grant execute on function public.admin_owner_campaign_receipt_orphans_v1_257(uuid)',
]) assert.ok(sql.includes(required),'missing SQL contract: '+required);
assert.ok(!/(insert\s+into|update\s+public\.|delete\s+from\s+public\.|delete\s+from\s+storage\.objects)/i.test(sql),'Read-only bridge must not write');
for(const name of ['owner-campaign-financial-summary','owner-campaign-orphan-audit'])
 assert.ok(edge.includes('if(action==="'+name+'")'),'Edge route missing: '+name);
assert.ok(edge.includes('data?.cashAvailableCents!==0'));
assert.ok(edge.includes('data?.comparisonMeaning!=="partial_difference_not_profit_not_roi"'));
assert.ok(edge.includes('data?.deletionPerformed!==false'));
assert.ok(edge.includes('data?.automaticDeletionEnabled!==false'));
assert.ok(ui.includes('adminOwnerFinancialSummarySection()'));
assert.ok(ui.includes('adminOwnerBridgeLoadFromUi'));
assert.ok(ui.includes('adminOwnerOrphanAuditLoadFromUi'));
assert.ok(boot.includes('adminOwnerBridgeLoadFromUi,adminOwnerOrphanAuditLoadFromUi'));
assert.ok(audit.includes('node tests/owner-campaign-financial-bridge-v1-257.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const actor='11111111-1111-4111-8111-111111111111';
const fixture={
 source:'admin_owner_campaign_financial_bridge_v1_257',month:'2026-10-01',
 totalCampaigns:1,rows:[{
  allocationId:'22222222-2222-4222-8222-222222222222',
  campaignTag:'tam-clube_coupons-202610-campanha-01',
  campaignLabel:'Campanha de divulgação de cupons',
  plannedIncentiveBudgetCents:9900,
  soloProviderFeeCents:250,batchProviderFeeCents:150,
  providerFeeEvidenceCents:400,providerFeeEvidenceOrders:3,
  ownerReportedMarketingSpendCents:300,
  marketingSpendWithStoredReceiptCents:200,
  marketingSpendWithoutStoredReceiptCents:100,
  activeExpenseCount:2,storedReceiptCount:1,
  partialEvidenceDifferenceCents:100,profitMeasured:false,
  roiMeasured:false,bankSettlementVerified:false
 }],limit:50,truncated:false,
 receiptSources:['v1_253_single_order_psp','v1_254_batch_order_psp'],
 expenseSource:'v1_255_owner_attested_with_v1_256_optional_document',
 comparisonMeaning:'partial_difference_not_profit_not_roi',
 revenueAttributionIsCausal:false,bankSettlementVerified:false,
 profitMeasured:false,roiMeasured:false,cashAvailableCents:0,
 readOnly:true,noTransfers:true,newBenefitsEnabled:false
};
const orphan={
 source:'admin_owner_campaign_receipt_orphans_v1_257',
 bucketObjects:8,linkedObjects:5,recentUnlinkedObjects:2,
 reviewCandidatesAfter24h:1,unexpectedPathObjects:0,minAgeHours:24,
 readOnly:true,deletionPerformed:false,automaticDeletionEnabled:false,
 noObjectPaths:true,privateBucket:true,bankVerified:false
};
let role='superadmin',requests=[],toasts=[];
const ctx=vm.createContext({
 adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:actor}}},
 document:{getElementById:()=>({value:'2026-10'})},
 adminInvoke:async request=>{requests.push(request);return request.action==='owner-campaign-financial-summary'?fixture:orphan;},
 toast:x=>toasts.push(x),render:()=>{},
 adminMoney:v=>'R$ '+(v/100).toFixed(2),
 esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Number,String,Array,Date
});
const start=ui.indexOf('// TAMÃO V1.257 —');
const end=ui.indexOf('// TAMÃO V1.252 —',start);
assert.ok(start>0&&end>start,'V1.257 section extraction');
vm.runInContext(ui.slice(start,end),ctx);
assert.ok(!ctx.adminOwnerFinancialSummarySection().includes('R$ 4.00'));
await ctx.adminOwnerBridgeLoadFromUi();
assert.equal(requests[0].action,'owner-campaign-financial-summary');
assert.equal(requests[0].month,'2026-10-01');
let html=ctx.adminOwnerFinancialSummarySection();
assert.ok(html.includes('R$ 4.00'));
assert.ok(html.includes('R$ 3.00'));
assert.ok(html.includes('R$ 2.00'));
assert.ok(html.includes('R$ 1.00'));
assert.ok(html.includes('Não é lucro, margem líquida, saldo bancário nem ROI'));
await ctx.adminOwnerOrphanAuditLoadFromUi();
assert.equal(requests[1].action,'owner-campaign-orphan-audit');
html=ctx.adminOwnerFinancialSummarySection();
assert.ok(html.includes('Pendências para revisão após 24h'));
assert.ok(html.includes('Nenhuma exclusão automática'));
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerFinancialSummarySection().includes('R$ 4.00'));
ctx.adminRuntime.session.user.id=actor;role='readonly';
assert.equal(ctx.adminOwnerFinancialSummarySection(),'');
await ctx.adminOwnerBridgeLoadFromUi();
assert.equal(requests.length,2);
role='superadmin';
fixture.rows[0].providerFeeEvidenceCents=401;
await ctx.adminOwnerBridgeLoadFromUi();
assert.ok(toasts.some(t=>t.includes('não verificados')));
assert.ok(!ctx.adminOwnerFinancialSummarySection().includes('R$ 4.01'));
fixture.rows[0].providerFeeEvidenceCents=400;
orphan.deletionPerformed=true;
await ctx.adminOwnerOrphanAuditLoadFromUi();
assert.ok(toasts.some(t=>t.includes('não validada')));
console.log('V1.257 PASS — consolidated PSP proof and declared expenses, no double count, no profit/ROI; non-destructive orphan audit.');
