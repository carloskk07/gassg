import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/admin.js');
new vm.Script(source,{filename:'js/admin.js'});
function extract(name){
  const a=source.indexOf('function '+name+'(');
  assert.ok(a>0,'Missing '+name);
  const b=source.indexOf('\n}',a);
  assert.ok(b>a,'Unterminated '+name);
  return source.slice(a,b+2);
}
const money=c=>'R$ '+(c/100).toFixed(2).replace('.',',');
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
let role='finance',now=Date.now();
const state={lastSyncAt:new Date(now-5000).toISOString()};
const ctx=vm.createContext({
  adminRuntime:state,Date,Number,esc,adminMoney:money,
  adminRoleCanSection:key=>key==='finance'&&['finance','superadmin'].includes(role)
});
vm.runInContext(extract('adminFinanceDailyPriorities')+'\n'+extract('adminFinanceDailyPrioritiesView')+
  '\nthis.snapshot=adminFinanceDailyPriorities;this.view=adminFinanceDailyPrioritiesView;',ctx);
const base={
  merchantBilling:{
    metrics:{
      openStatementCount:5,openStatementCents:15000,
      overdueStatementCount:2,overdueStatementCents:4000,
      pendingPaymentCount:3,pendingPaymentCents:11000,
      queueSla:{breachCount:1}
    },
    reconciliation:{issueCount:4}
  }
};
const snapshot=ctx.snapshot(base,now);
assert.equal(snapshot.consistent,true);
assert.equal(snapshot.fresh,true);
assert.equal(snapshot.ready,true);
assert.equal(snapshot.attention,true);
assert.equal(snapshot.open,5);
assert.equal(snapshot.overdue,2);
assert.equal(snapshot.pending,3);
let html=ctx.view(base);
for(const txt of [
  'PRIORIDADES DO FINANCEIRO','O que precisa de atenção?',
  'D+1 vencido','R$ 40,00','Pagamentos informados','R$ 110,00',
  'Divergências de conciliação','Itens fora do SLA',
  'Ver cobranças','Conferir pagamentos','Ver conciliação',
  'Revisar pendências','não somar','não são receita do TAMÃO'
]){
  assert.ok(html.toLowerCase().includes(txt.toLowerCase()),'Missing '+txt);
}
assert.equal((html.match(/class='admin-finance-priority-card'/g)||[]).length,4);
assert.equal((html.match(/adminSetFinanceWorkspace\('billing'\)/g)||[]).length,2);
assert.equal((html.match(/adminSetFinanceWorkspace\('reconciliation'\)/g)||[]).length,2);
assert.ok(!html.includes('adminPerform('));
assert.ok(!html.includes('adminReverseOrder('));
assert.ok(!html.includes('adminBillingPaymentEventAction('));
assert.ok(!html.includes('Nenhuma prioridade identificada'));
const zero={merchantBilling:{
  metrics:{...base.merchantBilling.metrics,
    overdueStatementCount:0,overdueStatementCents:0,
    pendingPaymentCount:0,pendingPaymentCents:0,queueSla:{breachCount:0}},
  reconciliation:{issueCount:0}
}};
assert.equal(ctx.snapshot(zero,now).ready,true);
assert.equal(ctx.snapshot(zero,now).attention,false);
html=ctx.view(zero);
assert.ok(html.includes('Nenhuma prioridade identificada nos indicadores verificados'));
assert.ok(html.includes('não substitui a conciliação financeira'));
assert.ok(!html.includes('admin-finance-priority-card'));
const one={merchantBilling:{metrics:{...zero.merchantBilling.metrics,pendingPaymentCount:1,pendingPaymentCents:500},
  reconciliation:{issueCount:0}}};
assert.equal((ctx.view(one).match(/class='admin-finance-priority-card'/g)||[]).length,1);
assert.ok(ctx.view(one).includes('Conferir pagamentos'));
const missing=[
  null,
  {},
  {merchantBilling:{metrics:{},reconciliation:{}}},
  {merchantBilling:{metrics:{...zero.merchantBilling.metrics,overdueStatementCount:-1},reconciliation:{issueCount:0}}},
  {merchantBilling:{metrics:{...zero.merchantBilling.metrics,overdueStatementCount:'0'},reconciliation:{issueCount:0}}},
  {merchantBilling:{metrics:{...zero.merchantBilling.metrics,pendingPaymentCents:'0'},reconciliation:{issueCount:0}}},
  {merchantBilling:{metrics:{...zero.merchantBilling.metrics,overdueStatementCount:9,openStatementCount:2},reconciliation:{issueCount:0}}},
  {merchantBilling:{metrics:{...zero.merchantBilling.metrics,overdueStatementCents:5000,openStatementCents:1000},reconciliation:{issueCount:0}}},
  {merchantBilling:{metrics:zero.merchantBilling.metrics,reconciliation:{issueCount:null}}},
  {merchantBilling:{metrics:{...zero.merchantBilling.metrics,queueSla:{}},reconciliation:{issueCount:0}}}
];
for(const d of missing){
  assert.equal(ctx.snapshot(d,now).ready,false,'Source must fail closed');
  const s=ctx.view(d);
  assert.ok(s.includes('Conferência necessária.'));
  assert.ok(!s.includes('Nenhuma prioridade identificada'));
  assert.ok(s.includes('Atualizar dados'));
}
state.lastSyncAt=new Date(now-6*60*1000).toISOString();
assert.equal(ctx.snapshot(zero,now).fresh,false);
assert.ok(ctx.view(zero).includes('Consulta desatualizada'));
assert.ok(!ctx.view(zero).includes('Nenhuma prioridade identificada'));
assert.ok(ctx.view(base).includes('is-stale'));
state.lastSyncAt=new Date(now+120*1000).toISOString();
assert.equal(ctx.snapshot(zero,now).fresh,false,'Future timestamp cannot mark verified');
state.lastSyncAt='not-a-time';
assert.equal(ctx.snapshot(zero,now).fresh,false);
state.lastSyncAt=new Date(now-5000).toISOString();
role='readonly';
assert.equal(ctx.view(base),'','Readonly cannot view finance');
role='operations';
assert.equal(ctx.view(base),'');
role='superadmin';
assert.ok(ctx.view(base).includes('PRIORIDADES DO FINANCEIRO'));
assert.ok(source.includes('adminFinanceDailyPrioritiesView(d)'));
assert.ok(source.includes('globalThis.adminSetFinanceWorkspace=adminSetFinanceWorkspace;'));
const start=source.indexOf('const financeContent=');
const end=source.indexOf('const incidentsContent=',start);
assert.ok(start>0&&end>start);
const content=source.slice(start,end);
assert.ok(content.includes('adminFinanceWorkspaceNav()'));
assert.ok(content.includes('adminFinanceDailyPrioritiesView(d)'));
assert.ok(content.includes('financeAreas[financeSelection]'));
const css=read('css/components.css');
assert.ok(css.includes('.admin-finance-priority-grid'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(css.includes('admin-finance-priority-card button{width:100%;min-height:44px'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-priorities-v1-192.mjs'));
assert.ok(!source.includes('admin_finance_merchant_performance_v1_190'),
  'V1.192 must be independent from blocked V1.190 endpoint');
console.log('V1.192: source-aware priorities, safe zero, missing/stale conditions, RBAC, CTA routing, responsive styles passed.');
