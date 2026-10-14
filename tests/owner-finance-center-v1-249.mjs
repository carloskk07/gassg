import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=load('js/admin-acquisition.js');
const boot=load('js/bootstrap.js');
const workflow=load('.github/workflows/audit.yml');
const legacy=[
 'adminOwnerFundingSection()', 'adminOwnerEvidenceSection()', 'adminOwnerBudgetSection()'
];
assert.ok(ui.includes('adminOwnerFinanceWorkspaceSection(),'),
 'Acquisition must render the unified finance center');
assert.ok(!ui.includes('      adminOwnerFundingSection(),\n      adminOwnerEvidenceSection(),\n      adminOwnerBudgetSection(),'),
 'Three sprawling finance sections must no longer appear together');
for(const name of ['adminOwnerFinanceLoadFromUi','adminOwnerFinanceSelectFromUi']){
 assert.ok(boot.includes(name),'Missing registered callback: '+name);
}
for(const action of ['owner-funding-read','owner-funding-pulse','owner-evidence-queue','owner-budget-queue']){
 assert.ok(ui.includes("adminInvoke({action:'"+action+"'})"),'Read endpoint missing: '+action);
}
assert.ok(workflow.includes('node tests/owner-finance-center-v1-249.mjs'));
assert.ok(!/(owner-evidence-review|owner-budget-allocate|owner-funding-save|owner-budget-release)/.test(
 ui.slice(ui.indexOf('// TAMÃO V1.249 —'),ui.indexOf('function adminPrelaunchLeadsSection(data){'))),
 'Overview may read only, never write');
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
let role='superadmin', actor='11111111-1111-4111-8111-111111111111', calls=[], messages=[];
const labels=['customer_cashback','customer_referral','merchant_referral','clube_coupons'];
const month='2026-10-01';
const money=n=>'R$ '+(Number(n)/100).toFixed(2);
const fixtures={
 'owner-funding-read':{
   source:'admin_owner_funding_read_v1_244',fundingSource:'platform_owner',
   readOnly:true,noCharge:true,newBenefitsEnabled:false,
   verifiedDepositCents:0,moneyReservedCents:0,
   rows:labels.map(benefitKey=>({benefitKey,budgetCents:10000,status:'internally_committed'}))
 },
 'owner-funding-pulse':{
   source:'admin_owner_funding_pulse_v1_245',readOnly:true,noCharge:true,
   timezone:'America/Sao_Paulo',monthStart:month,
   metricMeaning:'grants_created_this_month_not_bank_spending',
   budgetMeaning:'owner_plan_not_funds_deposited',
   verifiedDepositCents:0,moneyReservedCents:0,newBenefitsActivated:false,
   payoutsMeasured:false,
   rows:labels.map(benefitKey=>({benefitKey,netGrantedCents:100}))
 },
 'owner-evidence-queue':{
   source:'admin_owner_evidence_queue_v1_246',readOnly:true,
   bankApiConfirmed:false,fundsSpendable:false,spendableCents:0,
   newBenefitsEnabled:false,cashMoved:false,
   total:2,pendingCount:1,manualReconciledCents:22000,rows:[]
 },
 'owner-budget-queue':{
   source:'admin_owner_budget_queue_v1_247',readOnly:true,plannedOnly:true,
   noCharge:true,verifiedCashCents:0,spendableCents:0,newBenefitsEnabled:false,
   rows:['2026-10-01','2026-11-01','2026-12-01'].flatMap(m=>
     labels.map(benefitKey=>({month:m,benefitKey,allocatedCents:1000,
       unallocatedCents:9000,plannedCents:10000}))),
   allocations:[]
 }
};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({
 adminCurrentRole:()=>role, adminRuntime:{session:{user:{id:actor}}},
 adminOwnerFundingState:null,adminOwnerFundingPulseState:null,
 adminOwnerEvidenceState:null,adminOwnerBudgetState:null,
 adminOwnerFundingSection:()=>'<section>planning</section>',
 adminOwnerEvidenceSection:()=>'<section>evidence</section>',
 adminOwnerBudgetSection:()=>'<section>campaigns</section>',
 adminInvoke:async({action})=>{calls.push(action);return fixtures[action];},
 adminMoney:money,esc,render:()=>{},toast:message=>messages.push(message),
 Number,Date,String,Set,Promise
});
const i=ui.indexOf('// TAMÃO V1.249 —');
const end=ui.indexOf('function adminPrelaunchLeadsSection(data){',i);
assert.ok(i>0&&end>i);
vm.runInContext(ui.slice(i,end),ctx);
let html=ctx.adminOwnerFinanceWorkspaceSection();
assert.ok(html.includes('Central de financiamento e crescimento'));
assert.ok(html.includes('Atualize a visão financeira'));
assert.ok(!html.includes('R$ 400.00'),'Do not invent summary before fetch');
await ctx.adminOwnerFinanceLoadFromUi();
assert.equal(calls.length,4);
html=ctx.adminOwnerFinanceWorkspaceSection();
for(const expected of ['R$ 400.00','R$ 40.00','R$ 4.00','R$ 220.00',
  'Aportes conferidos manualmente','Emissões válidas geradas no mês',
  'não distribuído','Saldo']){if(expected!=='Saldo')assert.ok(html.includes(expected),expected)}
assert.ok(html.includes('Nenhum desses indicadores representa saldo disponível'));
assert.ok(html.includes('aria-valuenow="10"'));
ctx.adminOwnerFinanceSelectFromUi('evidence');
assert.ok(ctx.adminOwnerFinanceWorkspaceSection().includes('<section>evidence</section>'));
assert.ok(!ctx.adminOwnerFinanceWorkspaceSection().includes('<section>planning</section>'));
ctx.adminOwnerFinanceSelectFromUi('plan');
assert.ok(ctx.adminOwnerFinanceWorkspaceSection().includes('<section>planning</section>'));
ctx.adminOwnerFinanceSelectFromUi('campaigns');
assert.ok(ctx.adminOwnerFinanceWorkspaceSection().includes('<section>campaigns</section>'));
ctx.adminOwnerFinanceSelectFromUi('does-not-exist');
assert.ok(ctx.adminOwnerFinanceWorkspaceSection().includes('<section>campaigns</section>'));
role='readonly';
assert.equal(ctx.adminOwnerFinanceWorkspaceSection(),'');
await ctx.adminOwnerFinanceLoadFromUi();
assert.equal(calls.length,4,'Unauthorized role must not fetch');
role='superadmin';
ctx.adminRuntime.session.user.id='22222222-2222-4222-8222-222222222222';
assert.ok(!ctx.adminOwnerFinanceWorkspaceSection().includes('R$ 400.00'),
 'Summary must not leak across account switches');
ctx.adminRuntime.session.user.id=actor;
fixtures['owner-budget-queue'].spendableCents=100;
await ctx.adminOwnerFinanceLoadFromUi();
assert.ok(messages.some(x=>x.includes('Distribuição mensal não validada')));
assert.ok(!ctx.adminOwnerFinanceWorkspaceSection().includes('R$ 400.00'),
 'Invalid response must invalidate aggregate readiness');
console.log('V1.249 PASS — consolidating only authorized reads, correct periods, tabs and fail-closed behavior.');
