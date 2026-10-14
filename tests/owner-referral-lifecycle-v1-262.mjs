import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014235500_referral_commission_lifecycle_v1_262.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const part of [
 'platform_referral_trace_private_v1_262.stage(',
 "'reversed_before_maturity'",
 "'reversed_after_maturity'",
 "when $1 is not null then 'available'",
 "else 'pending'",
 'platform_referral_trace_private_v1_262.report(',
 'public.admin_owner_referral_lifecycle_v1_262',
 'public.order_reward_grants g',
 'public.wallet_entries w',
 'w.order_id=g.order_id',
 'w.user_id is distinct from g.referrer_user_id',
 'e.pending_count=1 and e.pending_cents=g.value_cents',
 'e.release_count=1 and e.release_cents=g.value_cents',
 'e.available_count=1 and e.available_cents=g.value_cents',
 'e.reversal_count=1 and e.reversal_cents=g.value_cents',
 'g.matured_at is null and g.reversed_at is not null',
 'g.matured_at is not null and g.reversed_at is not null',
 'eventsWithoutValidGrant',
 'public.platform_owner_campaign_order_attributions_v1_252',
 "'cohortStagesCurrentNotHistorical',true",
 "'walletFlowsAreCashPayments',false",
 "'externalPaidReferralCents',null",
 "'externalPayoutMeasured',false",
 "'campaignAttributionIsCausal',false",
 "'readOnly',true",
 'grant execute on function public.admin_owner_referral_lifecycle_v1_262(uuid,date)'
])assert.ok(sql.includes(part),'SQL contract missing: '+part);
assert.ok(!/(insert\s+into|update\s+public\.|delete\s+from|truncate\s+table)\b/i.test(sql),
 'Read-only attribution cannot mutate financial records');
assert.ok(edge.includes('"owner-referral-lifecycle"'));
assert.ok(edge.includes('if(action==="owner-referral-lifecycle")'));
assert.ok(edge.includes('admin_owner_referral_lifecycle_v1_262'));
assert.ok(edge.includes('data?.externalPaidReferralCents!==null'));
assert.ok(edge.includes('co.issuedCents!==co.verifiedLifecycleCents+co.unverifiedLifecycleCents'));
assert.ok(ui.includes('adminOwnerReferralLifecycleSection()'));
assert.ok(boot.includes('adminOwnerReferralTraceLoadFromUi'));
assert.ok(audit.includes('node tests/owner-referral-lifecycle-v1-262.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const sample={
 source:'admin_owner_referral_lifecycle_v1_262',
 month:'2026-10-01',timezone:'America/Sao_Paulo',
 cohort:{grantOrders:4,issuedCents:1000,verifiedLifecycleCents:750,
   unverifiedLifecycleCents:250,verifiedOrders:3,unverifiedOrders:1,
   pendingCents:200,availableCents:300,verifiedAvailableCents:300,
   reversedBeforeMaturityCents:250,reversedAfterMaturityCents:250,
   pendingOrders:1,availableOrders:1,reversedBeforeMaturityOrders:1,
   reversedAfterMaturityOrders:1},
 walletEventFlows:{totalEvents:12,pendingCreatedCents:1000,pendingReleasedCents:800,
   availableCreatedCents:550,availableReversedCents:250,eventsWithoutValidGrant:1},
 totalCampaigns:1,limit:50,truncated:false,
 rows:[{allocationId:'22222222-2222-4222-8222-222222222222',
   campaignTag:'tam-customer_referral-202610-foo',
   campaignLabel:'Indicação da região',referralGrantOrders:4,
   referralIssuedCents:1000,referralPendingCents:200,
   referralAvailableCents:300,referralReversedCents:500}],
 issuerOrderTraceAvailable:true,
 pendingReleaseIsAmbiguousWithoutGrantState:true,
 cohortStagesCurrentNotHistorical:true,walletFlowsAreCashPayments:false,
 externalPaidReferralCents:null,externalPayoutMeasured:false,
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
 adminMoney:x=>'R$ '+(x/100).toFixed(2),
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Date,Array
});
const start=ui.indexOf('// V1.262: authorized referral');
const end=ui.indexOf('// TAMÃO V1.261 —',start);
assert.ok(start>=0&&end>start);
vm.runInContext(ui.slice(start,end),ctx);
assert.ok(!ctx.adminOwnerReferralLifecycleSection().includes('R$ 10.00'));
await ctx.adminOwnerReferralTraceLoadFromUi();
assert.equal(calls[0].action,'owner-referral-lifecycle');
assert.equal(calls[0].month,'2026-10-01');
let html=ctx.adminOwnerReferralLifecycleSection();
for(const term of ['R$ 10.00','R$ 7.50','R$ 3.00','R$ 2.50',
 'Indicação da região','não saque ou pagamento externo','divergência'])
 assert.ok(html.includes(term),'Missing UI: '+term);
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerReferralLifecycleSection().includes('R$ 10.00'));
ctx.adminRuntime.session.user.id=actor;
role='support';
assert.equal(ctx.adminOwnerReferralLifecycleSection(),'');
await ctx.adminOwnerReferralTraceLoadFromUi();
assert.equal(calls.length,1);
role='finance';
data={...sample,cohort:{...sample.cohort,verifiedLifecycleCents:751}};
await ctx.adminOwnerReferralTraceLoadFromUi();
assert.ok(messages.some(x=>x.includes('não validada')));
assert.ok(!ctx.adminOwnerReferralLifecycleSection().includes('R$ 7.51'));
console.log('V1.262 PASS — traced referral lifecycle, role gates, invalid response rejected, payout unknown.');
