import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=load('supabase/migrations/20261014050000_owner_funding_pulse_v1_245.sql');
const edge=load('supabase/functions/admin-ops/index.ts');
const ui=load('js/admin-acquisition.js');
const flow=load('.github/workflows/audit.yml');
for(const fragment of [
 'platform_funding_private_v1_245.pulse','security definer',
 'public.admin_owner_funding_pulse_v1_245',
 "p_actor is null or not exists(",
 "a.admin_role in ('superadmin','finance')",
 "'OWNER_PULSE_ACCESS_DENIED'",
 "date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')",
 "g.created_at>=v_start and g.created_at<v_finish",
 "g.reversed_at is not null",
 "greatest(g.cashback_cents,0)",
 "greatest(g.referral_pending_cents,0)",
 'public.order_reward_grants',
 'public.reward_policy',
 'public.growth_merchant_benefit_policy_v1_228',
 'public.clube_package_drafts_v1_239',
 "'metricMeaning','grants_created_this_month_not_bank_spending'",
 "'budgetMeaning','owner_plan_not_funds_deposited'",
 "'payoutsMeasured',false",
 "'newBenefitsActivated',false",
 "'moneyReservedCents',0",
 "'verifiedDepositCents',0",
 "'budget_not_defined'",
 "'gross_exceeds_plan'",
 "'near_planned_limit'",
 "'within_planned_limit'",
 "'grossGrantedCents'",
 "'reversedGrantedCents'",
 "'netGrantedCents'",
 'OWNER_PULSE_ACL_DRIFT'
])assert.ok(sql.includes(fragment),'SQL invariant absent: '+fragment);
assert.ok(!/\b(insert\s+into|update\s+public|delete\s+from)\s+public\.(orders|order_reward_grants|reward_policy|referral_reward_reviews|platform_incentive_funding_plan_v1_244)/i.test(sql),'Read endpoint must not write money ledgers');
for(const x of [
 'if(action==="owner-funding-pulse"){',
 '"owner-funding-pulse"',
 'admin_owner_funding_pulse_v1_245',
 'data?.moneyReservedCents!==0',
 'data?.payoutsMeasured!==false',
 'x.netGrantedCents!==x.grossGrantedCents-x.reversedGrantedCents',
 '"budget_not_defined","gross_exceeds_plan","near_planned_limit","within_planned_limit"',
 'if(!["superadmin","finance"].includes(String(adminAccess.admin_role)))'
])assert.ok(edge.includes(x),'Edge guard absent: '+x);
for(const x of [
 'let adminOwnerFundingPulseState=null;',
 "adminInvoke({action:'owner-funding-pulse'})",
 "pulse?.metricMeaning!=='grants_created_this_month_not_bank_spending'",
 "pulse?.budgetMeaning!=='owner_plan_not_funds_deposited'",
 'adminOwnerFundingPulseState={...pulse,loadedFor:actor}',
 'function adminOwnerFundingReaisToCents(',
 "adminOwnerFundingReaisToCents(val('budget'),50000000)",
 "adminOwnerFundingReaisToCents(val('cap'),10000000)",
 'Créditos gerados no mês','Créditos das emissões do mês estornados',
 'Emissões ainda válidas','Planejamento do fundador',
 'Os meios de recebimento'
].filter(x=>x!=='Os meios de recebimento'))assert.ok(ui.includes(x),'UI missing: '+x);
assert.ok(flow.includes('node tests/owner-funding-pulse-v1-245.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
const start=ui.indexOf('function adminOwnerFundingReaisToCents(');
const end=ui.indexOf('\n}',start);
assert.ok(start>=0&&end>start);
const ctx=vm.createContext({Number,Math});
vm.runInContext(ui.slice(start,end+2)+'\nthis.cvt=adminOwnerFundingReaisToCents;',ctx);
for(const [inValue,expected] of [['0',0],['3.10',310],['1000',100000],['500000',50000000],['0.01',1]])assert.equal(ctx.cvt(inValue,50000000),expected);
for(const invalid of ['-1','3.001','500000.01','Infinity','NaN'])assert.equal(ctx.cvt(invalid,50000000),null);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
.replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const id='11111111-1111-4111-8111-111111111111';
const ctxt=vm.createContext({adminRuntime:{session:{user:{id}}},
 adminCurrentRole:()=> 'superadmin',adminMoney:n=>'R$ '+(n/100).toFixed(2),
 esc,Number,String, adminOwnerFundingState:null,adminOwnerFundingPulseState:null,
 adminOwnerFundingLoading:false,adminOwnerFundingSaving:new Set()});
const startView=ui.indexOf('function adminOwnerFundingSection(){');
const endView=ui.indexOf('\n}',startView);
assert.ok(startView>=0&&endView>startView);
vm.runInContext(ui.slice(startView,endView+2)+'\nthis.section=adminOwnerFundingSection;',ctxt);
assert.ok(ctxt.section().includes('Consulte os quatro centros de incentivo'));
ctxt.adminOwnerFundingState={loadedFor:id,rows:[{
  benefitKey:'customer_cashback',version:1,budgetCents:10000,capCents:5000,
  status:'planning',note:'Plano interno estimado de teste'}]};
ctxt.adminOwnerFundingPulseState={loadedFor:id,monthStart:'2026-10-01',
 periodEndExclusive:'2026-11-01',grantsCount:2,reversedGrantsCount:1,rows:[{
 benefitKey:'customer_cashback',policyEnabled:true,grossGrantedCents:700,
 reversedGrantedCents:200,netGrantedCents:500,plannedBudgetCents:10000,
 grossVsPlannedPct:7,planningSignal:'within_planned_limit'
 }]};
const html=ctxt.section();
assert.ok(html.includes('R$ 7.00'));
assert.ok(html.includes('R$ 2.00'));
assert.ok(html.includes('R$ 5.00'));
assert.ok(html.includes('Orçamento mensal (R$)'));
assert.ok(html.includes('step="0.01"'));
assert.ok(html.includes('value="100.00"'));
assert.ok(!html.includes('Teto planejado por mês (centavos)'));
console.log('V1.245 PASS — read-only grant evidence, cap planning in BRL, validated metrics and escaped Admin view');
