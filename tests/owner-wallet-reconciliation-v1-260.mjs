import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014234500_owner_wallet_reconciliation_v1_260.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const workflow=read('.github/workflows/audit.yml');
for(const part of [
 'platform_funding_private_v1_260.reconcile','public.admin_owner_wallet_reconciliation_v1_260',
 'OWNER_WALLET_RECONCILIATION_DENIED',"admin_role in ('superadmin','finance')",
 'public.order_reward_grants g','public.wallet_entries e','public.orders o',
 "e.entry_type='cashback_earn'","e.entry_type='referral_pending'",
 "e.entry_type='cashback_reserve'","e.entry_type='cashback_release'",
 "o.status='SETTLED' and o.financial_state='settled'",
 "o.financial_reversed_at is null","o.payment_confirmed_at is not null",
 "w.reserve_count=1 and w.reserve_cents=o.cashback_reserved_cents",
 "w.bad_users=0 and w.release_count=0",
 'public.platform_owner_campaign_order_attributions_v1_252',
 "'externalPaidBenefitsCents',null",
 "'spentCreditLotAttribution','unavailable_fungible_wallet'",
 "'walletFlowsAreCashPayments',false",
 "'campaignAttributionIsCausal',false",
 "'readOnly',true,'noTransfers',true,'newBenefitsEnabled',false",
 "from public,anon,authenticated,service_role"
]) assert.ok(sql.includes(part),'missing SQL invariant: '+part);
assert.ok(!/(insert\s+into|update\s+public\.|delete\s+from|truncate\s+table)\b/i.test(sql),'SQL must be non-mutating');
assert.ok(edge.includes('"owner-wallet-reconciliation"'));
assert.ok(edge.includes('if(action==="owner-wallet-reconciliation")'));
assert.ok(edge.includes('admin_owner_wallet_reconciliation_v1_260'));
assert.ok(edge.includes('data?.spentCreditLotAttribution!=="unavailable_fungible_wallet"'));
assert.ok(edge.includes('data?.externalPaidBenefitsCents!==null'));
assert.ok(ui.includes('adminOwnerWalletReconciliationSection()'));
assert.ok(boot.includes('adminOwnerWalletReconLoadFromUi'));
assert.ok(workflow.includes('node tests/owner-wallet-reconciliation-v1-260.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const sample={
 source:'admin_owner_wallet_reconciliation_v1_260',
 month:'2026-10-01',timezone:'America/Sao_Paulo',
 grantCohort:{grantOrders:2,cashbackExpectedCents:600,cashbackMatchedCents:400,
 cashbackUnmatchedCents:200,referralExpectedCents:250,referralMatchedCents:250,
 referralUnmatchedCents:0,cashbackMismatchOrders:1,referralMismatchOrders:0},
 settledUse:{settledOrdersWithCashback:2,reservedInSettledOrdersCents:300,
 verifiedUseCents:200,unverifiedUseCents:100,verifiedOrders:1,unverifiedOrders:1},
 walletEventFlows:{seedIssuedCents:2000,cashbackEarnedEntriesCents:400,
 cashbackReservedEntriesCents:300,cashbackReleasedEntriesCents:100,
 cashbackReversedEntriesCents:0,referralPendingEntriesCents:250,
 referralPendingReleasedEntriesCents:250,referralAvailableEntriesCents:250,
 referralReversedEntriesCents:0},
 totalCampaigns:1,limit:50,truncated:false,
 rows:[{allocationId:'22222222-2222-4222-8222-222222222222',
 campaignTag:'tam-customer_cashback-202610-promo_001',
 campaignLabel:'Campanha promocional de cashback',
 tracedGrantOrders:2,matchedCashbackIssueCents:400,unmatchedCashbackIssueCents:200,
 matchedReferralIssueCents:250,unmatchedReferralIssueCents:0,mismatchOrders:1}],
 spentCreditLotAttribution:'unavailable_fungible_wallet',
 settledOrderMatchBasis:'wallet_reservation_and_unreversed_settlement',
 walletFlowsAreCashPayments:false,externalPaidBenefitsCents:null,externalPayoutMeasured:false,
 campaignAttributionIsCausal:false,bankSettlementVerified:false,
 profitMeasured:false,roiMeasured:false,readOnly:true,noTransfers:true,newBenefitsEnabled:false
};
let data=structuredClone(sample),role='superadmin',calls=[],messages=[];
const actor='11111111-1111-4111-8111-111111111111';
const ctx=vm.createContext({
 adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:actor}}},
 document:{getElementById:()=>({value:'2026-10'})},
 adminInvoke:async request=>{calls.push(request);return data;},
 render:()=>{},toast:t=>messages.push(t),
 adminMoney:v=>'R$ '+(v/100).toFixed(2),
 esc:t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Date,Array
});
const start=ui.indexOf('// TAMÃO V1.260 —');
const end=ui.indexOf('// TAMÃO V1.259 —',start);
assert.ok(start>=0&&end>start);
vm.runInContext(ui.slice(start,end),ctx);
assert.ok(!ctx.adminOwnerWalletReconciliationSection().includes('R$ 4.00'));
await ctx.adminOwnerWalletReconLoadFromUi();
assert.equal(calls[0].action,'owner-wallet-reconciliation');
assert.equal(calls[0].month,'2026-10-01');
let html=ctx.adminOwnerWalletReconciliationSection();
assert.ok(html.includes('R$ 4.00'));
assert.ok(html.includes('R$ 2.00'));
assert.ok(html.includes('R$ 1.00'));
assert.ok(html.includes('Campanha promocional'));
assert.ok(html.includes('não é identificável'));
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerWalletReconciliationSection().includes('R$ 4.00'));
ctx.adminRuntime.session.user.id=actor;
role='readonly';
assert.equal(ctx.adminOwnerWalletReconciliationSection(),'');
await ctx.adminOwnerWalletReconLoadFromUi();
assert.equal(calls.length,1);
role='superadmin';
data={...sample,settledUse:{...sample.settledUse,verifiedUseCents:201}};
await ctx.adminOwnerWalletReconLoadFromUi();
assert.ok(messages.some(m=>m.includes('não validada')));
assert.ok(!ctx.adminOwnerWalletReconciliationSection().includes('R$ 2.01'));
console.log('V1.260 PASS — wallet issued and spent backed by ledger, discrepancy guards, no made-up payout.');
