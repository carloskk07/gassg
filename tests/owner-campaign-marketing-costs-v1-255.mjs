import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const rd=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=rd('supabase/migrations/20261014210000_owner_campaign_marketing_costs_v1_255.sql');
const edge=rd('supabase/functions/admin-ops/index.ts');
const ui=rd('js/admin-acquisition.js');
const boot=rd('js/bootstrap.js');
const workflow=rd('.github/workflows/audit.yml');
for(const x of [
 'platform_campaign_marketing_costs_v1_255',
 'platform_campaign_marketing_cost_voids_v1_255',
 'owner_campaign_cost_proof_reference_uq_v1_255',
 'enable row level security',
 'platform_funding_private_v1_255.record_expense',
 'platform_funding_private_v1_255.void_expense',
 'platform_funding_private_v1_255.read_expenses',
 'public.admin_owner_campaign_cost_record_v1_255',
 'public.admin_owner_campaign_cost_void_v1_255',
 'public.admin_owner_campaign_cost_read_v1_255',
 'CAMPAIGN_COST_ADMIN_DENIED',
 'CAMPAIGN_COST_REPLAY_CONFLICT',
 'CAMPAIGN_COST_NOT_ELIGIBLE',
 'CAMPAIGN_COST_ALREADY_VOID',
 'CAMPAIGN_COST_VOID_REPLAY_CONFLICT',
 "a.admin_role='superadmin'",
 "a.admin_role in ('superadmin','finance')",
 'v_allocation.month_key','v_allocation.released_at',
 "'ownerReportedPaidMarketingCents'",
 "sum(c.amount_cents) filter(where v.expense_id is null)",
 "'bankVerified',false","'receiptFileUploaded',false",
 "'incentiveBudgetDebited',false"
])assert.ok(sql.includes(x),'Missing SQL contract: '+x);
assert.ok(!sql.includes('update public.platform_incentive_funding_plan_'));
assert.ok(!sql.includes('update public.platform_owner_budget_allocations_'));
for(const a of ['owner-campaign-cost-read','owner-campaign-cost-record','owner-campaign-cost-void'])
 assert.ok(edge.includes('if(action==="'+a+'")'));
for(const a of ['adminCampaignCostsLoadFromUi','adminCampaignCostsRecordFromUi','adminCampaignCostsVoidFromUi'])
 assert.ok(boot.includes(a));
assert.ok(ui.includes('adminCampaignCostsSection()+'));
assert.ok(workflow.includes('node tests/owner-campaign-marketing-costs-v1-255.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const actor='11111111-1111-4111-8111-111111111111',camp='22222222-2222-4222-8222-222222222222';
const expense='33333333-3333-4333-8333-333333333333';
const d={
 source:'admin_owner_campaign_cost_read_v1_255',month:'2026-10-01',
 totalCampaigns:1,campaignLimit:50,campaignTruncated:false,
 totalExpenses:1,expenseLimit:100,expenseTruncated:false,
 evidenceLevel:'owner_attested_proof_reference_not_bank_verified',bankVerified:false,
 receiptFileUploaded:false,roiMeasured:false,cashMoved:false,
 incentiveBudgetDebited:false,newBenefitsEnabled:false,readOnly:true,
 campaigns:[{allocationId:camp,campaignTag:'tam-clube_coupons-202610-campanha-01',
  campaignLabel:'Campanha de divulgação de cupons',status:'allocated',
  incentivePlannedCents:19900,ownerReportedPaidMarketingCents:890,activeExpenses:1,voidedExpenses:0}],
 expenses:[{expenseId:expense,allocationId:camp,amountCents:890,paidOn:'2026-10-14',
  paymentMethod:'pix',proofReference:'PIX-2026-10-14-PROVA-01',
  description:'Anúncio regional contratado',recordedAt:'2026-10-14T15:00:00Z',
  status:'owner_attested',voidedAt:null,voidReason:null}]
};
const v={
 'owner-campaign-signals-month':'2026-10','owner-cost-allocation':camp,
 'owner-cost-amount':'8,90','owner-cost-date':'2026-10-14','owner-cost-method':'pix',
 'owner-cost-proof':'PIX-2026-10-14-PROVA-02',
 'owner-cost-description':'Divulgação de comércio regional',
 ['owner-cost-void-'+expense]:'Pagamento lançado no mês errado'
};
let role='superadmin',requests=[],toasts=[];
const c=vm.createContext({adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:actor}}},
 document:{getElementById:id=>({value:v[id]||''})},
 adminInvoke:async p=>{requests.push(p);const operation=p.action.split('-').at(-1);
  if(operation==='record'||operation==='void')return {
    source:'admin_owner_campaign_cost_'+operation+'_v1_255',
    recorded:true,replayed:false,status:operation==='record'?'owner_attested':'voided',
    cashMoved:false,bankVerified:false,receiptFileUploaded:false,
    incentiveBudgetDebited:false,newBenefitsEnabled:false};
  return d;},
 crypto:{randomUUID:()=> '44444444-4444-4444-8444-444444444444'},
 adminOwnerFundingReaisToCents:s=>Math.round(Number(s.replace(',','.'))*100),
 toast:s=>toasts.push(s),render:()=>{},
 adminMoney:n=>'R$ '+(Number(n)/100).toFixed(2),esc:s=>String(s),
 Number,String,Date,Array,Map
});
const start=ui.indexOf('// TAMÃO V1.255 —');
const end=ui.indexOf('// TAMÃO V1.252 —',start);
assert.ok(start>=0&&end>start);
vm.runInContext(ui.slice(start,end),c);
assert.ok(!c.adminCampaignCostsSection().includes('R$ 8.90'));
await c.adminCampaignCostsLoadFromUi();
assert.equal(requests[0].action,'owner-campaign-cost-read');
assert.equal(requests[0].month,'2026-10-01');
assert.ok(c.adminCampaignCostsSection().includes('R$ 8.90'));
assert.ok(c.adminCampaignCostsSection().includes('Não há upload'));
await c.adminCampaignCostsRecordFromUi();
assert.equal(requests[1].action,'owner-campaign-cost-record');
assert.equal(requests[1].amountCents,890);
assert.equal(requests[2].action,'owner-campaign-cost-read');
await c.adminCampaignCostsVoidFromUi(expense);
assert.equal(requests[3].action,'owner-campaign-cost-void');
assert.equal(requests[3].reason,'Pagamento lançado no mês errado');
assert.equal(requests[4].action,'owner-campaign-cost-read');
c.adminRuntime.session.user.id='55555555-5555-4555-8555-555555555555';
assert.ok(!c.adminCampaignCostsSection().includes('R$ 8.90'));
c.adminRuntime.session.user.id=actor;
role='finance';
assert.ok(!c.adminCampaignCostsSection().includes('Registrar despesa paga'));
await c.adminCampaignCostsRecordFromUi();
assert.equal(requests.length,5);
role='readonly';
assert.equal(c.adminCampaignCostsSection(),'');
role='superadmin';d.bankVerified=true;
await c.adminCampaignCostsLoadFromUi();
assert.ok(toasts.some(s=>s.includes('não confirmadas')));
assert.ok(!c.adminCampaignCostsSection().includes('R$ 8.90'));
console.log('V1.255 PASS — receipt reference, immutable corrections, isolation, roles and fail-closed validation');
