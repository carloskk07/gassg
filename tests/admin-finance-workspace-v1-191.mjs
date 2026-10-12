import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const src=read('js/admin.js');
new vm.Script(src,{filename:'js/admin.js'});
const extract=name=>{
  const i=src.indexOf('function '+name+'(');
  assert.ok(i>0,'Missing function '+name);
  const j=src.indexOf('\n}',i);
  assert.ok(j>i,'Missing end '+name);
  return src.slice(i,j+2);
};
const declaration=src.match(/const ADMIN_FINANCE_WORKSPACES=(\[[^\n]+\]);/);
assert.ok(declaration,'Finance workspace allowlist required');
const keys=JSON.parse(declaration[1]).map(x=>x.id);
assert.equal(keys.join('|'),'summary|billing|reconciliation|policy');
let role='finance',repaints=0,focuses=[],scrolls=[];
const rt={financeWorkspace:'summary'};
const document={
  getElementById:id=>{
    if(id==='admin-finance-workspace-panel')
      return {scrollIntoView:args=>scrolls.push(args)};
    if(id.startsWith('admin-finance-switch-'))
      return {focus:args=>focuses.push({id,args})};
    return null;
  }
};
const ctx=vm.createContext({
  adminRuntime:rt,
  adminRoleCanSection:key=>key==='finance'&&['superadmin','finance'].includes(role),
  render:()=>repaints++,
  requestAnimationFrame:fn=>fn(),document
});
vm.runInContext('const ADMIN_FINANCE_WORKSPACES='+declaration[1]+';\n'
  +['adminFinanceWorkspaceCurrent','adminFinanceWorkspaceNav','adminSetFinanceWorkspace']
    .map(extract).join('\n')
  +'\nthis.current=adminFinanceWorkspaceCurrent;this.nav=adminFinanceWorkspaceNav;this.select=adminSetFinanceWorkspace;',ctx);
let html=ctx.nav();
assert.ok(html.includes('CENTRAL FINANCEIRA'));
for(const label of ['Resumo','Cobranças','Conciliação','Regras e reversões'])
  assert.ok(html.includes(label),'Missing finance work area '+label);
assert.equal((html.match(/aria-pressed=/g)||[]).length,4);
assert.ok(html.includes("aria-pressed='true'"));
assert.ok(html.includes("adminSetFinanceWorkspace('summary')"));
assert.ok(!html.includes('adminPerform('),'Navigation must not trigger financial writes');
ctx.select('billing');
assert.equal(rt.financeWorkspace,'billing');
assert.equal(repaints,1);
assert.equal(focuses.at(-1).id,'admin-finance-switch-billing');
assert.equal(scrolls.length,1);
assert.ok(ctx.nav().includes("id='admin-finance-switch-billing'"));
assert.ok(ctx.nav().includes("class='admin-finance-area active'"));
ctx.select('reconciliation');
ctx.select('policy');
assert.equal(rt.financeWorkspace,'policy');
ctx.select('summary');
assert.equal(rt.financeWorkspace,'summary');
const before=repaints;
for(const invalid of ['',null,'something-else','__proto__','<script>'])
  ctx.select(invalid);
assert.equal(repaints,before,'Unknown workspaces must not be selectable');
rt.financeWorkspace='unexpected';
assert.equal(ctx.current(),'summary','Unknown state reverts to summary');
role='operations';
assert.equal(ctx.nav(),'','No finance tab visible without finance access');
ctx.select('policy');
assert.equal(repaints,before,'Non-finance role cannot navigate');
role='readonly';
assert.equal(ctx.nav(),'');
role='superadmin';
assert.ok(ctx.nav().includes('CENTRAL FINANCEIRA'));
const from=src.indexOf('  const financeSummaryContent=');
const until=src.indexOf('  const incidentsContent=',from);
assert.ok(from>0&&until>from);
const segment=src.slice(from,until);
const overview=segment.slice(segment.indexOf('  const financeSummaryContent='),segment.indexOf('  const financeBillingContent='));
const billing=segment.slice(segment.indexOf('  const financeBillingContent='),segment.indexOf('  const financeReconciliationContent='));
const reconcile=segment.slice(segment.indexOf('  const financeReconciliationContent='),segment.indexOf('  const financePolicyContent='));
const policy=segment.slice(segment.indexOf('  const financePolicyContent='),segment.indexOf('  const financeAreas='));
for(const needle of ['adminFinanceOverview(d)','adminFinanceManagementView(d)','adminFinanceHistoryView()'])
  assert.ok(overview.includes(needle),'Important summary lost: '+needle);
for(const needle of ['adminInterruptedSalePaymentWatch(d)','adminMerchantBillingSection(d)'])
  assert.ok(billing.includes(needle),'Billing guard lost '+needle);
for(const needle of ['Revisão de indicações','Fila de benefícios','Fila contábil de settlement','Conciliação financeira',
    'adminReceivableRow','adminReimbursementRow','adminAdjustmentRow'])
  assert.ok(reconcile.includes(needle),'Reconciliation guard lost '+needle);
for(const needle of ['adminCommercialPolicySection(d)','Reversão financeira auditada','adminReverseOrder()'])
  assert.ok(policy.includes(needle),'Critical policy operation lost '+needle);
assert.ok(segment.includes('const financeSelection=adminFinanceWorkspaceCurrent();'));
assert.ok(segment.includes('financeAreas[financeSelection]'));
assert.ok(segment.includes("id='admin-finance-workspace-panel'"));
assert.ok(src.includes('globalThis.adminSetFinanceWorkspace=adminSetFinanceWorkspace;'));
assert.ok(!src.includes("body?.action==='finance-merchant-performance'"),'No dependency on un-deployed V1.190 endpoint');
const css=read('css/components.css');
assert.ok(css.includes('.admin-finance-areas'));
assert.ok(css.includes('.admin-finance-area:focus-visible'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-workspace-v1-191.mjs'));
console.log('V1.191 passed: four workspaces, RBAC, navigation focus, no financial changes, retained content, mobile layout.');
