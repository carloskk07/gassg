import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014234000_owner_campaign_benefit_costs_v1_259.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const phrase of [
 'platform_funding_private_v1_259.benefit_costs',
 'public.admin_owner_campaign_benefit_costs_v1_259',
 'OWNER_BENEFIT_COSTS_DENIED',
 "admin_role in ('superadmin','finance')",
 'public.order_reward_grants g',
 'public.orders o',
 "o.status='SETTLED' and o.financial_state='settled'",
 'o.payment_confirmed_at is not null',
 "w.entry_type='referral_available'",
 "w.entry_type='referral_reversal'",
 'public.platform_owner_campaign_order_attributions_v1_252 att',
 'g.order_id=att.order_id and g.created_at>=v_start',
 'att.allocation_id=s.allocation_id',
 "'externalPaidBenefitsCents',null",
 "'externalPayoutMeasured',false",
 "'benefitsUsedAreIssuanceCohort',false",
 "'campaignAttributionIsCausal',false",
 "'noTransfers',true,'readOnly',true",
 "from public,anon,authenticated,service_role",
 'grant execute on function public.admin_owner_campaign_benefit_costs_v1_259(uuid,date)',
]) assert.ok(sql.includes(phrase),'Missing SQL gate: '+phrase);
assert.ok(!/\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+table)\b/i.test(sql),
  'Benefit report must be read-only');
assert.ok(edge.includes('"owner-campaign-benefit-costs"'));
assert.ok(edge.includes('if(action==="owner-campaign-benefit-costs")'));
assert.ok(edge.includes('admin_owner_campaign_benefit_costs_v1_259'));
assert.ok(edge.includes('data?.externalPaidBenefitsCents!==null'));
assert.ok(edge.includes('data?.benefitsUsedAreIssuanceCohort!==false'));
assert.ok(ui.includes('adminOwnerBenefitCostsSection()'));
assert.ok(ui.includes('adminOwnerBenefitsLoadFromUi'));
assert.ok(boot.includes('adminOwnerBridgeLoadFromUi,adminOwnerOrphanAuditLoadFromUi,adminOwnerBenefitsLoadFromUi'));
assert.ok(audit.includes('node tests/owner-campaign-benefit-costs-v1-259.mjs'));
new vm.Script(ui,{filename:'js/admin-acquisition.js'});
new vm.Script(boot,{filename:'js/bootstrap.js'});
const base={
 source:'admin_owner_campaign_benefit_costs_v1_259',
 month:'2026-10-01',timezone:'America/Sao_Paulo',
 totalCampaigns:1,limit:50,truncated:false,
 rows:[{allocationId:'22222222-2222-4222-8222-222222222222',
  benefitKey:'customer_cashback',campaignTag:'tam-customer_cashback-202610-campanha_01',
  campaignLabel:'Campanha de clientes da cidade',plannedIncentiveBudgetCents:10000,
  attributedGrantOrders:1,cashbackGrantedCents:500,cashbackReversedCents:100,
  cashbackNetGrantedCents:400,referralGrantedCents:300,referralReversedCents:0,
  referralNetGrantedCents:300}],
 cashbackGrantedCents:500,cashbackReversedCents:100,cashbackNetGrantedCents:400,
 referralGrantedCents:300,referralReversedCents:0,referralNetGrantedCents:300,
 cashbackUsedInSettledOrdersCents:250,referralMovedToAvailableCents:175,
 referralAvailableReversedCents:25,merchantReferralPaidCents:null,
 clubeCouponPaidCents:null,externalPaidBenefitsCents:null,externalPayoutMeasured:false,
 benefitsUsedAreIssuanceCohort:false,
 metricMeaning:'grant_cohort_vs_settlement_activity_non_causal',
 campaignAttributionIsCausal:false,bankSettlementVerified:false,
 profitMeasured:false,roiMeasured:false,newBenefitsEnabled:false,
 noTransfers:true,readOnly:true
};
let data=structuredClone(base),role='superadmin',calls=[],messages=[];
const actor='11111111-1111-4111-8111-111111111111';
const ctx=vm.createContext({
 adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:actor}}},
 document:{getElementById:()=>({value:'2026-10'})},
 adminInvoke:async request=>{calls.push(request);return data;},
 render:()=>{},toast:t=>messages.push(t),
 adminMoney:n=>'R$ '+(n/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Array,Date
});
const start=ui.indexOf('// TAMÃO V1.259 —');
const end=ui.indexOf('// TAMÃO V1.257 —',start);
assert.ok(start>=0&&end>start);
vm.runInContext(ui.slice(start,end),ctx);
assert.ok(!ctx.adminOwnerBenefitCostsSection().includes('R$ 5.00'));
await ctx.adminOwnerBenefitsLoadFromUi();
assert.deepEqual(calls[0],{action:'owner-campaign-benefit-costs',month:'2026-10-01'});
let html=ctx.adminOwnerBenefitCostsSection();
assert.ok(html.includes('R$ 5.00'));
assert.ok(html.includes('R$ 4.00'));
assert.ok(html.includes('R$ 2.50'));
assert.ok(html.includes('R$ 1.75'));
assert.ok(html.includes('não apurado'));
assert.ok(html.includes('não some esses números'));
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerBenefitCostsSection().includes('R$ 5.00'));
ctx.adminRuntime.session.user.id=actor;
role='readonly';
assert.equal(ctx.adminOwnerBenefitCostsSection(),'');
await ctx.adminOwnerBenefitsLoadFromUi();
assert.equal(calls.length,1);
role='superadmin';
data={...base,cashbackNetGrantedCents:401};
await ctx.adminOwnerBenefitsLoadFromUi();
assert.ok(messages.some(t=>t.includes('não validada')));
assert.ok(!ctx.adminOwnerBenefitCostsSection().includes('R$ 4.01'));
console.log('V1.259 PASS — cohort vs usage, grant reversals, no external payouts, role/actor guards.');
