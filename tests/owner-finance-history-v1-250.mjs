import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=load('supabase/migrations/20261014160000_owner_finance_history_v1_250.sql');
const edge=load('supabase/functions/admin-ops/index.ts');
const ui=load('js/admin-acquisition.js');
const boot=load('js/bootstrap.js');
const workflow=load('.github/workflows/audit.yml');
for(const required of [
  'platform_funding_private_v1_250.history','public.admin_owner_finance_history_v1_250',
  "a.active and a.admin_role in ('superadmin','finance')",
  'OWNER_HISTORY_ACCESS_DENIED','OWNER_HISTORY_FILTER_INVALID',
  "p_offset>10000 or p_offset%20<>0",
  'platform_owner_contribution_events_v1_246',
  'platform_owner_budget_allocation_events_v1_247',
  "time zone 'America/Sao_Paulo'",
  "'campaign_allocated'","'campaign_released'",
  'order by created_at desc,event_id desc,kind',
  "'spendableCents',0","'fundsSpendable',false",
  "'bankApiConfirmed',false","'newBenefitsEnabled',false",
  "has_function_privilege('authenticated'",
  'owner_budget_event_date_v1_250'
]) assert.ok(sql.includes(required),'Missing SQL invariant: '+required);
assert.ok(!/(insert\s+into|update\s+public|delete\s+from)\s+public\./i.test(sql),
  'History migration must not mutate financial records');
assert.ok(edge.includes('"owner-finance-history"'));
assert.ok(edge.includes('if(action==="owner-finance-history")'));
assert.ok(edge.includes('admin_owner_finance_history_v1_250'));
assert.ok(edge.includes('data?.spendableCents!==0'));
assert.ok(edge.includes('p_actor:user.id,p_month:month||null'));
assert.ok(ui.includes("['history','Histórico']"));
assert.ok(ui.includes("adminOwnerFinanceTab==='history'?adminOwnerFinanceHistorySection()"));
assert.ok(ui.includes('function adminOwnerFinanceHistorySection()'));
assert.ok(boot.includes('adminOwnerFinanceHistoryLoadFromUi'));
assert.ok(workflow.includes('node tests/owner-finance-history-v1-250.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const actor='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const row={
  eventId:id,actorId:actor,createdAt:'2026-10-14T12:00:00Z',
  benefitKey:'customer_cashback',kind:'campaign',eventType:'campaign_allocated',
  amountCents:9500,campaignMonth:'2026-10-01',campaignLabel:'Primeiras compras <script>alert(1)</script>',
  transferDate:null,note:'Campanha inicial & regionais',fromVersion:0,toVersion:1
};
let role='superadmin',user=actor,params=[],toasts=[];
const result={
  source:'admin_owner_finance_history_v1_250',readOnly:true,
  bankApiConfirmed:false,fundsSpendable:false,spendableCents:0,
  newBenefitsEnabled:false,cashMoved:false,
  month:null,benefitKey:null,kind:'all',eventType:'all',offset:0,pageSize:20,
  total:1,rows:[row]
};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
.replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const inputs={month:'',benefit:'',kind:'all',event:'all'};
const ctx=vm.createContext({
  adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:user}}},
  document:{getElementById:key=>({value:inputs[key.slice('owner-history-'.length)]})},
  adminInvoke:async body=>{params.push(body);return result;},
  adminMoney:n=>'R$ '+(n/100).toFixed(2),
  toast:s=>toasts.push(s),render:()=>{},esc,
  String,Number,Date,Promise,Array,Object
});
const i=ui.indexOf('// TAMÃO V1.250 —');
const end=ui.indexOf('function adminOwnerFinanceWorkspaceSection(){',i);
assert.ok(i>=0&&end>i,'History section location');
vm.runInContext(ui.slice(i,end),ctx);
let view=ctx.adminOwnerFinanceHistorySection();
assert.ok(view.includes('Histórico de decisões financeiras'));
assert.ok(view.includes('Pesquisar histórico'));
assert.ok(!view.includes('Primeiras compras'),'Must not invent before loading');
await ctx.adminOwnerFinanceHistoryLoadFromUi(0);
assert.equal(params.length,1);
assert.equal(params[0].action,'owner-finance-history');
assert.equal(params[0].month,'');
assert.equal(params[0].kind,'all');
view=ctx.adminOwnerFinanceHistorySection();
assert.ok(view.includes('R$ 95.00'));
assert.ok(view.includes('Orçamento separado para campanha'));
assert.ok(view.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(!view.includes('<script>alert(1)</script>'));
assert.ok(view.includes('20 por página'));
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerFinanceHistorySection().includes('R$ 95.00'),
  'Isolate session state');
ctx.adminRuntime.session.user.id=actor;role='readonly';
assert.equal(ctx.adminOwnerFinanceHistorySection(),'');
await ctx.adminOwnerFinanceHistoryLoadFromUi(0);
assert.equal(params.length,1,'Non-finance role cannot fetch history');
role='superadmin';result.spendableCents=100;
await ctx.adminOwnerFinanceHistoryLoadFromUi(0);
assert.ok(toasts.some(s=>s.includes('não verificada')));
assert.ok(!ctx.adminOwnerFinanceHistorySection().includes('R$ 95.00'));
console.log('V1.250 PASS — immutable events, strict auth, pagination, filters, escaping and zero spendable cash.');
