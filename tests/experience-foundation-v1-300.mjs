import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css=read('css/components.css');
const home=read('js/customer.js'),merchant=read('js/merchant.js');
const admin=read('js/admin.js'),bootstrap=read('js/bootstrap.js');
for(const [name,s] of [['customer',home],['merchant',merchant],['admin',admin],['bootstrap',bootstrap]])
  new vm.Script(s,{filename:name+'.js'});
for(const token of [
 'TAMÃO V1.300','--tamao-focus','home-value-bridge',
 '.merchant-workspace-shortcuts','.merchant-workspace-header',
 '.merchant-workspace-section','.admin-release-hub',
 ':focus-visible','prefers-reduced-motion','@media(max-width:520px)'
])assert.ok(css.includes(token),'missing global design: '+token);
for(const token of [
 'const valueBridge=','Resolva as compras do dia a dia.','Abra mais uma porta para vender.',
 'Compartilhe algo que faz sentido.','startCustomerAvailability()',"go('merchants')",
 "go('earn')",'\u0024{valueBridge}',
 'Faltou em casa?'
])assert.ok(home.includes(token),'missing public conversion flow: '+token);
assert.ok(!home.includes('garantimos sua renda'));
const pageStart=merchant.indexOf('function merchantLivePage(){');
const pageEnd=merchant.indexOf('\nfunction merchantScheduledDispatchState(',pageStart);
assert.ok(pageStart>=0&&pageEnd>pageStart);
const page=merchant.slice(pageStart,pageEnd);
for(const token of [
 'merchant-workspace-header','merchant-workspace-shortcuts','merchant-workspace-start',
 'merchant-workspace-growth','merchant-workspace-finance','merchant-workspace-settings',
 'merchantDailyOverview(rt,orders)','merchantAvailabilityPanel(rt,',
 'merchantDeliveryBoardView(rt,orders)','merchantOrderQueueView(orders)',
 'merchantQuickCatalogView(rt)','merchantSetupView(rt)',
 'merchantBillingLiveView(rt)','merchantAlertControl()',
 'merchantEnablementAssistantView(rt)','merchantGrowthNetworkSection(m)',
 "financialHold","complianceReady","merchantWorkspaceJump('start')"
])assert.ok(page.includes(token),'missing merchant operation: '+token);
assert.ok(page.indexOf('merchantDailyOverview(rt,orders)')<page.indexOf('merchant-workspace-growth'));
assert.ok(page.indexOf('merchant-live-orders')<page.indexOf('merchant-workspace-growth'));
assert.ok(page.includes("!canGoOnline?' open':''"),'onboarding must be expanded when not ready');
assert.ok(bootstrap.includes('merchantWorkspaceJump,'));
const workspaceStart=merchant.indexOf('function merchantWorkspaceJump(');
const workspaceEnd=merchant.indexOf('\nfunction merchantLivePage()',workspaceStart);
assert.ok(workspaceStart>=0&&workspaceEnd>workspaceStart);
let focused='',opened=false;
const panel={tagName:'DETAILS',open:false,scrollIntoView:()=>{opened=true},querySelector:()=>({focus:()=>{focused='summary'}})};
const ctx=vm.createContext({document:{getElementById:id=>id==='merchant-workspace-start'?panel:null},
 matchMedia:()=>({matches:true}),String});
vm.runInContext(merchant.slice(workspaceStart,workspaceEnd)+'\nthis.jump=merchantWorkspaceJump;',ctx);
assert.equal(ctx.jump('start'),true);
assert.equal(panel.open,true);
assert.equal(opened,true);assert.equal(focused,'summary');
assert.equal(ctx.jump('unknown'),false);assert.equal(ctx.jump('growth'),false);
const hubStart=admin.indexOf('function adminReleaseHub(');
const hubEnd=admin.indexOf('\nfunction adminPage()',hubStart);
assert.ok(hubStart>=0&&hubEnd>hubStart);
let role='superadmin';
const env=vm.createContext({
 adminCurrentRole:()=>role,
 adminRoleCanSection:s=>role==='superadmin'||s!=='finance',
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
});
vm.runInContext(admin.slice(hubStart,hubEnd)+'\nthis.hub=adminReleaseHub;',env);
const d={applications:[{status:'pending'}],merchants:[{status:'inactive'}],incidents:[]};
assert.match(env.hub(d),/1 cadastro\(s\)/);
assert.match(env.hub(d),/adminSetSection\('partners'\)/);
assert.match(env.hub(d),/adminSetSection\('finance'\)/);
assert.match(env.hub(d),/sem situação ativa/);
role='operations';assert.doesNotMatch(env.hub(d),/adminSetSection\('finance'\)/);
role='support';assert.equal(env.hub(d),'');
assert.ok(admin.includes('adminReleaseHub(d)'));
assert.ok(admin.includes('adminPushReliabilityView()'));
assert.ok(admin.includes('adminRoleCanSection'));
assert.ok(admin.includes('adminSetSection(section)'));
console.log('V1.300 PASS — global design, truthful conversion paths, accessible merchant workspace, admin governance shortcuts.');
