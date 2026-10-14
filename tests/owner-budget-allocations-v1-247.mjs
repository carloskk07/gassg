import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014070000_owner_budget_allocations_v1_247.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const workflow=read('.github/workflows/audit.yml');
for(const fragment of [
 'platform_owner_budget_allocations_v1_247',
 'platform_owner_budget_allocation_events_v1_247',
 'enable row level security',
 'check(spendable=false)','check(funds_verified=false)','check(coupons_enabled=false)',
 "check(status in ('allocated','released'))",
 'owner_budget_allocation_campaign_unique_v1_247',
 'platform_funding_private_v1_247.protect_plan',
 'create trigger owner_budget_protect_plan_v1_247',
 'OWNER_BUDGET_PLAN_HAS_ALLOCATIONS',
 'platform_funding_private_v1_247.allocate',
 'platform_funding_private_v1_247.release',
 'platform_funding_private_v1_247.queue',
 'public.admin_owner_budget_allocate_v1_247',
 'public.admin_owner_budget_release_v1_247',
 'public.admin_owner_budget_queue_v1_247',
 "'OWNER_BUDGET_SUPERADMIN_REQUIRED'",
 "'OWNER_BUDGET_PLAN_STALE'",
 "'OWNER_BUDGET_EXCEEDED'",
 "'OWNER_BUDGET_IDEMPOTENCY_CONFLICT'",
 "'OWNER_BUDGET_RELEASE_REPLAY_CONFLICT'",
 "'OWNER_BUDGET_RELEASE_STALE'",
 'pg_advisory_xact_lock',
 "'founder-funding-v1-244:'||p_benefit",
 "'owner-budget-v1-247:'||p_benefit",
 "p_amount>v_plan.planned_budget_cents-v_total",
 "v_plan.status<>'internally_committed'",
 "new.status<>'internally_committed'",
 "'newBenefitsEnabled',false",
 "'spendableCents',0",
 "'fundsVerified',false",
 "OWNER_BUDGET_ACL_DRIFT",
 'revoke all on public.platform_owner_budget_allocations_v1_247'
])assert.ok(sql.includes(fragment),'Missing allocation invariant: '+fragment);
assert.ok(!/(insert\s+into|update\s+public|delete\s+from)\s+public\.(orders|order_reward_grants|reward_policy|clube_package_drafts_v1_239|platform_owner_contributions_v1_246|customer_wallet_ledger)/i.test(sql),
 'Allocation must never modify real cash, rewards or orders');
for(const fragment of [
 '"owner-budget-queue"',
 'if(action==="owner-budget-queue"){',
 'if(action==="owner-budget-allocate"){',
 'if(action==="owner-budget-release"){',
 'admin_owner_budget_allocate_v1_247',
 'admin_owner_budget_release_v1_247',
 'admin_owner_budget_queue_v1_247',
 'String(adminAccess.admin_role)!=="superadmin"',
 'data?.verifiedCashCents!==0',
 'data?.spendableCents!==0',
 'data?.newBenefitsEnabled!==false',
 'data?.fundsVerified!==false',
 'data?.plannedOnly!==true'
])assert.ok(edge.includes(fragment),'Missing backend gate: '+fragment);
for(const fragment of [
 'function adminOwnerBudgetSection()',
 'adminOwnerBudgetSection(),',
 'async function adminOwnerBudgetLoadFromUi(){',
 'async function adminOwnerBudgetAllocateFromUi(){',
 'async function adminOwnerBudgetReleaseFromUi(',
 'adminOwnerFundingReaisToCents',
 'Distribuição do orçamento por campanha',
 'Separar orçamento planejado',
 'Devolver ao orçamento planejado',
 'Caixa confirmado, dinheiro disponível para uso e benefícios ativados são zero',
 'adminOwnerBudgetPending',
 'fundsVerified!==false'
])assert.ok(ui.includes(fragment),'Missing UI safeguard: '+fragment);
for(const fragment of [
 'adminOwnerBudgetLoadFromUi','adminOwnerBudgetAllocateFromUi','adminOwnerBudgetReleaseFromUi'
])assert.ok(boot.includes(fragment));
assert.ok(workflow.includes('node tests/owner-budget-allocations-v1-247.mjs'));
new vm.Script(ui,{filename:'js/admin-acquisition.js'});
new vm.Script(boot,{filename:'js/bootstrap.js'});
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const actor='11111111-1111-4111-8111-111111111111';
const ctx=vm.createContext({Number,String,
  adminRuntime:{session:{user:{id:actor}}},
  adminCurrentRole:()=> 'superadmin',
  adminMoney:n=>'R$ '+(Number(n)/100).toFixed(2),esc,
  adminOwnerBudgetState:null,adminOwnerBudgetBusy:false,
  adminOwnerBudgetPending:new Set()});
const start=ui.indexOf('function adminOwnerBudgetSection(){');
const end=ui.indexOf('\n}',start);
assert.ok(start>=0&&end>start);
vm.runInContext(ui.slice(start,end+2)+'\nthis.view=adminOwnerBudgetSection;',ctx);
assert.ok(ctx.view().includes('Configure um orçamento positivo'));
ctx.adminOwnerBudgetState={loadedFor:actor,rows:[{
 benefitKey:'customer_cashback',month:'2026-10-01',
 planVersion:1,planStatus:'internally_committed',
 plannedCents:10000,allocatedCents:2000,unallocatedCents:8000,
 coverageExceeded:false
}],allocations:[{
 allocationId:'22222222-2222-4222-8222-222222222222',benefitKey:'customer_cashback',
 month:'2026-10-01',campaignReference:'campanha-out-01',
 campaignLabel:'Campanha <script>alert(1)</script> local',amountCents:2000,
 status:'allocated',version:1,planVersion:1
}]};
const html=ctx.view();
assert.ok(html.includes('R$ 80.00'));
assert.ok(html.includes('R$ 20.00'));
assert.ok(html.includes('&lt;script&gt;'));
assert.ok(!html.includes('<script>alert(1)</script>'));
assert.ok(html.includes('Devolver ao orçamento planejado'));
console.log('V1.247 PASS — capped monthly planning, idempotency, status locks, plan-change guard, permission and UI safety.');
