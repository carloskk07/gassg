import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=load('supabase/migrations/20261014190000_owner_campaign_fee_receipts_v1_253.sql');
const edge=load('supabase/functions/admin-ops/index.ts');
const ui=load('js/admin-acquisition.js');
const boot=load('js/bootstrap.js');
const workflow=load('.github/workflows/audit.yml');

for(const invariant of [
 'platform_funding_private_v1_253.fee_receipts',
 'public.admin_owner_campaign_fee_receipts_v1_253',
 "a.admin_role in ('superadmin','finance')",
 "CAMPAIGN_FEE_RECEIPTS_DENIED",
 "CAMPAIGN_FEE_RECEIPTS_MONTH_INVALID",
 'platform_owner_campaign_order_attributions_v1_252',
 'public.platform_receivables pr',
 'public.merchant_daily_statements s',
 'public.merchant_billing_payment_requests req',
 'public.merchant_billing_payment_events ev',
 'public.merchant_billing_payment_refunds refund',
 "o.financial_state='settled'",
 "o.payment_confirmed_at is not null",
 "pr.status='paid'",
 "s.resolution_kind='payment'",
 "pr.prepaid_credit_applied_cents=0",
 "s.prepaid_credit_applied_cents=0",
 "where other.daily_statement_id=s.id)=1",
 "same_statement.status='approved')=1",
 "req.approval_source='provider_event'",
 "ev.status='applied'",
 "refund.payment_request_id=req.id or refund.payment_event_id=ev.id",
 "adj.adjustment_type='platform_fee_refund_due'",
 "'bankSettlementVerified',false",
 "'marketingSpendPaidCents',null",
 "'roiMeasured',false",
 "'spendableCents',0",
 "has_function_privilege(",
]) assert.ok(sql.includes(invariant),'Missing fee evidence contract: '+invariant);
assert.ok(!/(insert\s+into|update\s+public|delete\s+from)\s+public\./i.test(sql),
 'Read model must not mutate money records');
assert.ok(edge.includes('"owner-campaign-fee-receipts"'));
assert.ok(edge.includes('if(action==="owner-campaign-fee-receipts")'));
assert.ok(edge.includes('admin_owner_campaign_fee_receipts_v1_253'));
assert.ok(edge.includes('data?.bankSettlementVerified!==false'));
assert.ok(edge.includes('data?.spendableCents!==0'));
assert.ok(edge.includes('data?.marketingSpendPaidCents!==null'));
assert.ok(boot.includes('adminOwnerCampaignFeeReceiptsLoadFromUi'));
assert.ok(ui.includes('adminOwnerCampaignFeeReceiptsSection()+'));
assert.ok(workflow.includes('node tests/owner-campaign-fee-receipts-v1-253.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});

const user='11111111-1111-4111-8111-111111111111';
const fixture={
 source:'admin_owner_campaign_fee_receipts_v1_253',month:'2026-10-01',
 totalCampaigns:1,limit:50,truncated:false,
 evidenceLevel:'provider_event_applied_single_order_statement_no_refund',
 readOnly:true,noTransfers:true,spendableCents:0,newBenefitsEnabled:false,
 bankSettlementVerified:false,roiMeasured:false,marketingSpendPaidCents:null,
 rows:[{allocationId:'22222222-2222-4222-8222-222222222222',
  campaignTag:'tam-customer_cashback-202610-campanha-01',
  attributedOrders:4,providerConfirmedOrders:1,providerConfirmedFeeCents:225,
  notIndividuallyProvenOrders:3,
  bankSettlementVerified:false,roiMeasured:false,marketingSpendPaidCents:null}]
};
let role='superadmin',requests=[],toasts=[];
const ctx=vm.createContext({
 adminCurrentRole:()=>role,
 adminRuntime:{session:{user:{id:user}}},
 adminInvoke:async p=>{requests.push(p);return fixture;},
 document:{getElementById:()=>({value:'2026-10'})},
 toast:s=>toasts.push(s),render:()=>{},
 adminMoney:n=>'R$ '+(Number(n)/100).toFixed(2),
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Number,String,Date,Array
});
const i=ui.indexOf('// TAMÃO V1.253 —');
const end=ui.indexOf('function adminOwnerFinanceWorkspaceSection(){',i);
assert.ok(i>=0&&end>i);
vm.runInContext(ui.slice(i,end),ctx);
assert.ok(!ctx.adminOwnerCampaignFeeReceiptsSection().includes('R$ 2.25'));
await ctx.adminOwnerCampaignFeeReceiptsLoadFromUi();
assert.equal(requests.length,1);
assert.equal(requests[0].action,'owner-campaign-fee-receipts');
assert.equal(requests[0].month,'2026-10-01');
const html=ctx.adminOwnerCampaignFeeReceiptsSection();
assert.ok(html.includes('R$ 2.25'));
assert.ok(html.includes('Pedidos ainda sem confirmação individual'));
assert.ok(html.includes('sem rateio')||html.includes('Não se rateiam'));
assert.ok(html.includes('não significa saldo bancário'));
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerCampaignFeeReceiptsSection().includes('R$ 2.25'));
ctx.adminRuntime.session.user.id=user;
role='readonly';
assert.equal(ctx.adminOwnerCampaignFeeReceiptsSection(),'');
await ctx.adminOwnerCampaignFeeReceiptsLoadFromUi();
assert.equal(requests.length,1,'Unauthorized role cannot call RPC');
role='superadmin';
fixture.bankSettlementVerified=true;
await ctx.adminOwnerCampaignFeeReceiptsLoadFromUi();
assert.ok(toasts.some(x=>x.includes('não confirmada')));
assert.ok(!ctx.adminOwnerCampaignFeeReceiptsSection().includes('R$ 2.25'));
console.log('V1.253 PASS — solo-order PSP proof, no pro-rata, no refunds, no fake ROI, auth and fail closed');
