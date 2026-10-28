import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const merchant=read('js/merchant.js');
const css=read('css/components.css');
const ci=read('.github/workflows/audit.yml');
for(const [name,src] of [['merchant.js',merchant],['css as JS',null]]){
 if(src)new vm.Script(src,{filename:name});
}
const cut=(name)=>{
 const start=merchant.indexOf('function '+name+'(');
 const end=merchant.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'missing '+name);
 return merchant.slice(start,end+2);
};
const scripts=['merchantFirstRunModel','merchantFirstRunView','merchantWorkspaceJump'].map(cut).join('\n')+
 '\nthis.model=merchantFirstRunModel;this.view=merchantFirstRunView;this.jump=merchantWorkspaceJump;';
const steps=[
 {key:'products',title:'Produtos e preços',detail:'Informe os preços',done:false},
 {key:'delivery',title:'Entregas',detail:'Área confirmada',done:true},
 {key:'payment',title:'Recebimentos',detail:'Escolha o pagamento',done:false}
];
let focus=false,scroll=false;
const panel={tagName:'DETAILS',open:false,scrollIntoView:()=>{scroll=true},
 querySelector:()=>({focus:()=>{focus=true}})};
const ctx=vm.createContext({
 merchantSetupSnapshot:()=>steps,
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 document:{getElementById:id=>id==='merchant-workspace-setup'?panel:null},
 matchMedia:()=>({matches:true}),
 String
});
vm.runInContext(scripts,ctx);
const rt={status:'ready',merchant:{memberRole:'owner',status:'inactive',merchantId:'m'},
 enablement:{merchant_id:'m',checks:[{owner:'admin',ok:false},{owner:'merchant',ok:false}]},
 billing:{account:{salesHold:false}}};
const model=ctx.model(rt,false);
assert.equal(model.completed,1);
assert.equal(model.next.key,'products');
assert.equal(model.adminPending,1);
assert.equal(model.needsAdminApproval,true);
const page=ctx.view(rt,false);
assert.match(page,/A liberação depende do TAMÃO/);
assert.match(page,/1 de 3 configurados/);
assert.match(page,/merchantSetupGo\('products'\)/);
assert.match(page,/merchantSetupGo\('delivery'\)/);
assert.match(page,/merchantSetupGo\('payment'\)/);
assert.match(page,/merchantWorkspaceJump\('setup'\)/);
assert.match(page,/<details class="merchant-first-run-extra">/,'other setup steps should be collapsed');
assert.match(page,/<summary>Ver todas as etapas \(3\)<\/summary>/);
assert.ok(page.indexOf('merchant-first-run-actions')<page.indexOf('merchant-first-run-extra'),
  'show one direct next step before optional setup checklist');
assert.doesNotMatch(page,/<details class="merchant-first-run-extra"[^>]*\sopen/);

assert.match(page,/Aprovações, módulos estratégicos e autorizações financeiras/);
assert.doesNotMatch(page,/merchantLiveToggleOnline|adminSetMerchantStatus|Ativada automaticamente/);
assert.equal(ctx.view(rt,true),'','no onboarding when operation is already eligible');
assert.equal(ctx.model({...rt,merchant:{...rt.merchant,memberRole:'operator'}},false),null);
assert.equal(ctx.model({...rt,status:'loading'},false),null);
steps[0].done=true;steps[2].done=true;
rt.merchant.status='active';rt.enablement.checks=[{owner:'admin',ok:true}];
assert.match(ctx.view(rt,false),/Conferir requisitos/);
assert.doesNotMatch(ctx.view(rt,false),/liberação depende do TAMÃO/);
rt.billing.account.salesHold=true;
assert.match(ctx.view(rt,false),/restrição financeira/);
assert.equal(ctx.jump('setup'),true);
assert.equal(panel.open,true);assert.equal(scroll,true);assert.equal(focus,true);
assert.equal(ctx.jump('unauthorized'),false);

const a=merchant.indexOf('function merchantLivePage(){');
const b=merchant.indexOf('\nfunction merchantScheduledDispatchState(',a);
assert.ok(a>=0&&b>a);
const live=merchant.slice(a,b);
assert.ok(live.indexOf('merchantDailyOverview(rt,orders)')<live.indexOf('merchantDeliveryBoardView(rt,orders)'));
assert.ok(live.indexOf('merchantDailyOverview(rt,orders)')<live.indexOf('merchantFirstRunView(rt,canGoOnline)'));
assert.ok(live.indexOf('merchantFirstRunView(rt,canGoOnline)')<live.indexOf('merchantOrderQueueView(orders)'));
assert.ok(live.indexOf('merchantDeliveryBoardView(rt,orders)')<live.indexOf('merchantOrderQueueView(orders)'));
assert.ok(live.indexOf('merchantOrderQueueView(orders)')<live.indexOf('merchantDailyChecklistView(rt,'));
assert.ok(live.indexOf('merchantOrderQueueView(orders)')<live.indexOf('merchantQuickCatalogView(rt)'));
assert.ok(live.indexOf('merchantOrderQueueView(orders)')<live.indexOf('merchantSetupView(rt)'));
assert.ok(live.indexOf('merchantSetupView(rt)')<live.indexOf('merchantBillingLiveView(rt)'));
assert.match(live,/m.status==='active'&&complianceReady&&commercialReady&&!financialHold/);
assert.match(live,/merchantAvailabilityPanel\(rt/);
assert.match(live,/merchantAlertControl\(\)/);
assert.match(live,/merchantLiveSavePaymentMethods\(\)/);
assert.match(live,/merchantLiveSaveLogistics\(\)/);
assert.match(live,/merchantLiveSaveScheduling\(\)/);
assert.match(live,/merchantLiveSaveCapacity\(\)/);
assert.match(live,/merchantEnablementAssistantView\(rt\)/);
assert.match(live,/id="merchant-workspace-setup"/);
const quickStart=live.indexOf('<nav class="merchant-workspace-shortcuts"');
const quickEnd=live.indexOf('</nav>',quickStart);
assert.ok(quickStart>=0&&quickEnd>quickStart,'merchant shortcuts must be a single accessible nav');
const quick=live.slice(quickStart,quickEnd);
assert.match(quick,/<details class="merchant-workspace-more">/);
assert.match(quick,/<summary>Mais opções: financeiro, divulgação e configurações<\/summary>/);
assert.ok(quick.indexOf("merchantWorkspaceJump('orders')")<quick.indexOf('<details class="merchant-workspace-more">'));
assert.ok(quick.indexOf("merchantWorkspaceJump('start')")<quick.indexOf('<details class="merchant-workspace-more">'));
assert.match(quick,/merchantWorkspaceJump\(\\'finance\\'\)/);
assert.match(quick,/merchantWorkspaceJump\(\\'growth\\'\)/);
assert.match(quick,/merchantWorkspaceJump\('settings'\)/);
assert.ok(!quick.includes('<details class="merchant-workspace-more" open'),'secondary areas closed initially');

assert.doesNotMatch(live,/<details id="merchant-workspace-setup" class="merchant-workspace-section"\$\{!canGoOnline/);
for(const marker of [
 '.merchant-first-run','.merchant-first-run-steps','.merchant-first-run-actions',
 '.merchant-first-run-extra','.merchant-workspace-more','.merchant-workspace-more-actions',
 '@media(max-width:550px)','.merchant-workspace #merchant-live-orders'
])assert.ok(css.includes(marker),'missing responsive CSS '+marker);
assert.ok(css.includes('.merchant-workspace-more:not([open])>.merchant-workspace-more-actions'),
 'secondary merchant links must actually hide when closed despite display:grid');
assert.ok(css.includes('.merchant-first-run-extra:not([open])>.merchant-first-run-steps'),
 'setup checklist must actually hide until explicitly expanded');
assert.ok(ci.includes('node tests/merchant-onboarding-v1-303.mjs'));
// ANP applies to active GLP and GLP cylinders, not to unrelated products.
// Exercise the exact production predicate, not a test-only replacement.
const complianceStart=live.indexOf('  const compliance=m.compliance||{};');
const complianceEnd=live.indexOf('  const cnpjWhen=',complianceStart);
assert.ok(complianceStart>=0&&complianceEnd>complianceStart,'merchant compliance decision present');
const complianceSource=live.slice(complianceStart,complianceEnd);
const checkCompliance=(catalog,compliance)=>{
 const {hasGlp,complianceReady}=vm.runInNewContext(
  '(function(){'+complianceSource+';return {hasGlp,complianceReady};})()',
  {rt:{catalog},m:{compliance}}
 );
 return {hasGlp,complianceReady};
};
const verified={cnpjCurrent:true,anpCurrent:false};
for(const item of ['WATER20','WOOD','CHARCOAL_5KG','ICE_BAR_10KG']){
 const value=checkCompliance([{active:true,productCode:item}],{cnpjCurrent:true,anpCurrent:true});
 assert.equal(value.hasGlp,false,item+' is not locally classed as ANP-regulated');
 assert.equal(value.complianceReady,true,item+' is permitted when the server confirms ANP is non-applicable');
 assert.equal(checkCompliance([{active:true,productCode:item}],verified).complianceReady,false,
  'missing or contradictory server ANP evidence must fail closed: '+item);
}
assert.equal(checkCompliance([{active:false,productCode:'P13'}],
 {cnpjCurrent:true,anpCurrent:true}).complianceReady,true,
 'inactive GLP must not impose an ANP requirement on non-GLP products');
for(const item of ['P13','P13_CONTAINER','P90_CONTAINER']){
 const value=checkCompliance([{active:true,productCode:item}],verified);
 assert.equal(value.hasGlp,true,item+' remains regulated');
 assert.equal(value.complianceReady,false,item+' cannot pass without ANP');
 assert.equal(checkCompliance([{active:true,productCode:item}],
  {cnpjCurrent:true,anpCurrent:true}).complianceReady,true);
}
assert.equal(checkCompliance([{active:true,productCode:'CUSTOM_ITEM',deliveryClass:'regulated_glp'}],
 verified).complianceReady,false,'backend-regulated delivery classes must still require ANP');
assert.equal(checkCompliance([{active:true,productCode:'WATER20'}],
 {cnpjCurrent:false,anpCurrent:true}).complianceReady,false,'CNPJ remains mandatory');
assert.ok(live.includes('!anpCurrent?'),
 'ANP warnings must follow authoritative server verdict even for unclassified regulated SKUs');
assert.ok(!live.includes('Sem GLP ativo no catálogo; ANP não é exigida'),
 'a missing delivery class must never be presented as evidence of ANP exemption');
assert.equal(checkCompliance([{active:true,productCode:'REGULATED_CUSTOM'}],verified).complianceReady,false,
 'when the server marks a custom regulated SKU ineligible, UI must fail closed');
assert.equal(checkCompliance([{active:true,productCode:'REGULATED_CUSTOM'}],
 {cnpjCurrent:true,anpCurrent:true}).complianceReady,true);

console.log('V1.303 PASS — merchant tasks and orders first, owner-only guidance, admin control and retained operations.');
