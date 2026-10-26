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
assert.equal(keys.join('|'),'summary|billing|lab|reconciliation|policy');
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
  adminCurrentRole:()=>role,
  adminRoleCanSection:key=>key==='finance'&&['superadmin','finance'].includes(role),
  render:()=>repaints++,
  adminFinanceLabReadinessFromUi:async()=>{},
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
assert.ok(ctx.nav().includes('Laboratório'));
assert.equal((ctx.nav().match(/aria-pressed=/g)||[]).length,5);
ctx.select('lab');
assert.equal(rt.financeWorkspace,'lab');
role='finance';
assert.equal(ctx.current(),'summary','Non-superadmin must not stay inside financial lab');
const beforeLab=repaints;
ctx.select('lab');
assert.equal(repaints,beforeLab,'Only superadmin can enter the financial lab');
role='superadmin';
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
assert.ok(src.slice(from-280,from).includes("const financeSelection=sectionActive('finance')?adminFinanceWorkspaceCurrent():'summary';"),
  'Selecting finance workspace must occur only for the authorized active finance tab');
assert.ok(segment.includes('financeAreas[financeSelection]'));
assert.ok(segment.includes("id='admin-finance-workspace-panel'"));
assert.ok(src.includes('globalThis.adminSetFinanceWorkspace=adminSetFinanceWorkspace;'));
assert.ok(!src.includes("body?.action==='finance-merchant-performance'"),'No dependency on un-deployed V1.190 endpoint');
const css=read('css/components.css');
assert.ok(css.includes('.admin-finance-areas'));
assert.ok(css.includes('.admin-finance-area:focus-visible'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-workspace-v1-191.mjs'));
// One renderer must never blank all authenticated Admin navigation.
const errors=[],diagnostics={};
const partContext=vm.createContext({
  console:{error:(...args)=>errors.push(args)},
  globalThis:diagnostics,
  esc:s=>String(s).replaceAll('<','&lt;')
});
vm.runInContext(extract('adminFinanceRenderPart')+
  '\nthis.part=adminFinanceRenderPart;',partContext);
assert.equal(partContext.part('Resumo financeiro',()=>'<section>R$ 0,00</section>'),
  '<section>R$ 0,00</section>');
const fallback=partContext.part('Laboratório',()=>{throw new TypeError('Falha local')});
assert.ok(fallback.includes('Laboratório indisponível'));
assert.ok(fallback.includes('demais áreas continuam acessíveis'));
assert.equal(diagnostics.__lastFinanceRenderError.area,'Laboratório');
assert.equal(diagnostics.__lastFinanceRenderError.type,'TypeError');
assert.equal(errors.length,1);
for(const [name,call] of [
  ['Resumo financeiro','adminFinanceOverview(d)'],
  ['Controle gerencial','adminFinanceManagementView(d)'],
  ['Histórico financeiro','adminFinanceHistoryView()'],
  ['Financeiro por revenda','adminMerchantFinanceView()'],
  ['Pagamentos interrompidos','adminInterruptedSalePaymentWatch(d)'],
  ['Cobranças','adminMerchantBillingSection(d)'],
  ['Laboratório','adminFinanceLabView(d)'],
  ['Política comercial','adminCommercialPolicySection(d)'],
  ['Benefícios da Rede','adminGrowthBenefitPreviewView()'],
  ['Prévia de cupons','adminClubeCouponPreviewView()'],
  ['Clube financeiro','adminClubeFinanceView()'],
  ['Navegação financeira','adminFinanceWorkspaceNav()'],
  ['Prioridades financeiras','adminFinanceDailyPrioritiesView(d)'],
  ['Fila financeira','adminFinanceTriageView(d)']
]){
  assert.ok(src.includes("adminFinanceRenderPart('"+name+"',()=>"+call+")"),
    'The finance renderer must be isolated: '+name);
}
assert.ok(!src.includes('adminFinanceRenderPart('+"\x27"+'Cobranças'+"\x27"+',()=>adminPerform('),
  'Panel rendering must not create a financial transaction');
// Browser regression: the Admin portal deliberately does not load merchant.js.
// The shared formatter must exist in core.js and BOTH failing Finance panels
// must render from real functions without merchant-only globals.
const coreScript=read('js/core.js');
const merchantScript=read('js/merchant.js');
const coreFormatter=coreScript.match(/function formatDateTime\(v\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(coreFormatter,'shared core.js must declare the classic-script date formatter');
assert.doesNotMatch(merchantScript,/function formatDateTime\(/,
  'merchant.js must reuse core.js and not shadow the formatter');
const rootHtml=read('index.html');
assert.ok(rootHtml.indexOf('js/core.js')>0
  &&rootHtml.indexOf('js/core.js')<rootHtml.indexOf('js/admin.js')
  &&rootHtml.indexOf('js/core.js')<rootHtml.indexOf('js/merchant.js'),
  'shared date helper must load before each portal module');
const dNow=new Date().toISOString();
const financeFixture={
  merchantBilling:{
    paymentRequests:[{id:'12345678-1234-4123-8123-123456789012',status:'pending',
      merchant_id:'b',expected_amount_cents:300,requested_at:dNow}],
    paymentEvents:[],refunds:[],statements:[],
    providerCharges:[],paymentIngress:{activeBillingProvider:'mercadopago'}
  }
};
const financeRuntime={
  lastSyncAt:dNow,status:'ready',data:{merchants:[]},providerHealth:null,
  financeLab:{readiness:{configured:true,recentTests:[{orderId:'TEST_ORDER_123456',
    providerStatus:'action_required',createdAt:dNow}],
    prerequisites:{enabled:true,tokenConfigured:true,payerConfigured:true,distinctToken:true}}}
};
const financeContext=vm.createContext({
  Date,Number,String,Object,Set,Map,
  adminRuntime:financeRuntime,adminRoleCanSection:()=>true,
  adminCurrentRole:()=> 'superadmin',adminMerchantName:()=> 'Revenda de teste',
  adminMoney:amount=>'R$ '+(Number(amount)/100).toFixed(2),
  esc:value=>String(value??'').replace(/[&<>"]/g,''),
});
vm.runInContext(coreFormatter+'\n'+[
 'adminFinanceDailyPriorities','adminFinanceTriageRecords','adminFinanceTriageView',
 'adminFinanceLabPrerequisiteChecks','adminFinanceLabView'
].map(extract).join('\n')+
 '\nthis.runFinanceViews=(d)=>[adminFinanceTriageView(d),adminFinanceLabView(d)];',financeContext);
const [renderedTriage,renderedLab]=financeContext.runFinanceViews(financeFixture);
assert.match(renderedTriage,/Conferência sem procurar registros/);
assert.match(renderedLab,/Testar sem entrar em uma revenda/);
assert.match(renderedLab,/TEST_ORDER_123456/);
assert.doesNotMatch(renderedTriage+renderedLab,/indisponível.*diagnóstico no console/);

console.log('V1.191 passed: four workspaces, RBAC, navigation focus, no financial changes, retained content, mobile layout.');
