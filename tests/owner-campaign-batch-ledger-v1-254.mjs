import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014200000_owner_campaign_batch_ledger_v1_254.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const workflow=read('.github/workflows/audit.yml');
for(const invariant of [
 'platform_funding_private_v1_254.batch_ledger',
 'platform_funding_private_v1_254.batch_report',
 'public.admin_owner_campaign_batch_ledger_v1_254',
 'CAMPAIGN_BATCH_LEDGER_DENIED',
 'CAMPAIGN_BATCH_LEDGER_MONTH_INVALID',
 "a.admin_role in ('superadmin','finance')",
 'public.platform_owner_campaign_order_attributions_v1_252',
 'public.platform_receivables',
 'public.merchant_daily_statements',
 'public.merchant_billing_payment_requests',
 'public.merchant_billing_payment_events',
 'public.merchant_billing_payment_refunds',
 'public.platform_settlement_adjustments',
 'pr.platform_fee_cents-pr.prepaid_credit_applied_cents',
 'sum_sales=s.gross_sales_cents',
 'sum_fee=s.gross_fee_cents',
 'sum_prepaid=s.prepaid_credit_applied_cents',
 'sum_due=s.amount_due_cents',
 't.line_count>=2',
 "s.resolution_kind='payment'",
 "r.approval_source='provider_event'",
 "ev.status='applied'",
 "r.received_amount_cents=r.expected_amount_cents",
 "refund.payment_request_id=r.id or refund.payment_event_id=ev.id",
 "adj.adjustment_type='platform_fee_refund_due'",
 "o.financial_state='settled'",
 "pr.status='paid'",
 "and t.all_lines_valid",
 "limit 50",
 "'noDoubleCountingWithV253',true",
 "'bankSettlementVerified',false",
 "'paidMarketingCostCents',null",
 "'cashAvailableCents',0",
 'revoke all on function public.admin_owner_campaign_batch_ledger_v1_254(uuid,date)'
]) assert.ok(sql.includes(invariant),'Absent SQL trust clause: '+invariant);
assert.ok(!/insert\s+into|update\s+public\.|delete\s+from\s+public\./i.test(sql),'Ledger must be read-only');
assert.ok(sql.includes('platform_fee_cents-pr.prepaid_credit_applied_cents'));
assert.ok(!sql.includes('platform_fee_cents*'),'No proportional allocation');
assert.ok(edge.includes('if(action==="owner-campaign-batch-ledger")'));
assert.ok(edge.includes('admin_owner_campaign_batch_ledger_v1_254'));
assert.ok(edge.includes('data?.cashAvailableCents!==0'));
assert.ok(edge.includes('data?.paidMarketingCostCents!==null'));
assert.ok(ui.includes('adminOwnerBatchLedgerSection()+'));
assert.ok(boot.includes('adminOwnerBatchLedgerLoadFromUi'));
assert.ok(workflow.includes('node tests/owner-campaign-batch-ledger-v1-254.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const user='11111111-1111-4111-8111-111111111111';
const fixture={
 source:'admin_owner_campaign_batch_ledger_v1_254',
 month:'2026-10-01',totalCampaigns:1,limit:50,truncated:false,
 evidenceLevel:'psp_paid_statement_balances_exact_all_lines_no_refunds',
 batchOnly:true,noDoubleCountingWithV253:true,
 bankSettlementVerified:false,roiMeasured:false,paidMarketingCostCents:null,
 cashAvailableCents:0,readOnly:true,noTransfers:true,newBenefitsEnabled:false,
 rows:[{
   allocationId:'22222222-2222-4222-8222-222222222222',
   campaignTag:'tam-customer_cashback-202610-campanha-01',
   verifiedBatchOrders:2,verifiedBatchStatements:1,providerSupportedNetFeeCents:286,
   entrySource:'receivable_net_fee_statement_exact_payment_event',
   bankSettlementVerified:false,roiMeasured:false,cashAvailableCents:0,paidMarketingCostCents:null
 }]
};
let role='superadmin',requests=[],toasts=[];
const ctx=vm.createContext({
 adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:user}}},
 adminInvoke:async p=>{requests.push(p);return fixture;},
 document:{getElementById:()=>({value:'2026-10'})},
 toast:s=>toasts.push(s),render:()=>{},
 adminMoney:c=>'R$ '+(Number(c)/100).toFixed(2),
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Number,String,Date,Array
});
const i=ui.indexOf('// TAMÃO V1.254 —');
const end=ui.indexOf('function adminOwnerFinanceWorkspaceSection(){',i);
assert.ok(i>=0&&end>i);
vm.runInContext(ui.slice(i,end),ctx);
assert.ok(!ctx.adminOwnerBatchLedgerSection().includes('R$ 2.86'));
await ctx.adminOwnerBatchLedgerLoadFromUi();
assert.equal(requests.length,1);
assert.equal(requests[0].action,'owner-campaign-batch-ledger');
assert.equal(requests[0].month,'2026-10-01');
const html=ctx.adminOwnerBatchLedgerSection();
assert.ok(html.includes('R$ 2.86'));
assert.ok(html.includes('Extratos agrupados conciliados'));
assert.ok(html.includes('do próprio pedido menos créditos pré-pagos'));
assert.ok(html.includes('sem sobreposição'));
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerBatchLedgerSection().includes('R$ 2.86'));
ctx.adminRuntime.session.user.id=user;
role='readonly';
assert.equal(ctx.adminOwnerBatchLedgerSection(),'');
await ctx.adminOwnerBatchLedgerLoadFromUi();
assert.equal(requests.length,1,'unauthorized role');
role='superadmin';
fixture.cashAvailableCents=286;
await ctx.adminOwnerBatchLedgerLoadFromUi();
assert.ok(toasts.some(s=>s.includes('não verificada')));
assert.ok(!ctx.adminOwnerBatchLedgerSection().includes('R$ 2.86'));
// Accounting demonstration: exact recorded fees, never gross sales nor ratio.
const lines=[{fee:190,credit:40},{fee:136,credit:0}];
const due=lines.reduce((s,l)=>s+l.fee-l.credit,0);
assert.equal(due,286);
assert.notEqual(due,lines.reduce((s,l)=>s+l.fee,0));
assert.notEqual(due,lines.reduce((s,l)=>s+l.fee*0.5,0));
console.log('V1.254 PASS — verified batch ledger, exact net-fee, no overlap V1.253, authorized read-only.');
