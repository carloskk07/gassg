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
assert.doesNotMatch(live,/<details id="merchant-workspace-setup" class="merchant-workspace-section"\$\{!canGoOnline/);
for(const marker of [
 '.merchant-first-run','.merchant-first-run-steps','.merchant-first-run-actions',
 '@media(max-width:550px)','.merchant-workspace #merchant-live-orders'
])assert.ok(css.includes(marker),'missing responsive CSS '+marker);
assert.ok(ci.includes('node tests/merchant-onboarding-v1-303.mjs'));
console.log('V1.303 PASS — merchant tasks and orders first, owner-only guidance, admin control and retained operations.');
