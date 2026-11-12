import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../css/components.css',import.meta.url),'utf8');
assert.doesNotThrow(()=>new vm.Script(admin,{filename:'admin.js'}));
assert.match(css,/admin-task-navigator/);
assert.match(admin,/\$\{adminTaskNavView\(\)\}/);
assert.match(admin,/let adminAdvancedNavOpen=\[/);
assert.match(admin,/const showAdvanced=adminAdvancedNavOpen;/);
assert.doesNotMatch(admin,/const showAdvanced=adminAdvancedNavOpen\|\|/);

const start=admin.indexOf('// This selector navigates only to known read/workspaces.');
const end=admin.indexOf('function adminQuickGo(',start);
assert.ok(start>=0&&end>start,'task navigator must remain explicit and audited');
const taskSource=admin.slice(start,end);
const ctx={
 role:'superadmin',allowed:new Set(['orders','partners','ads','growth','finance','alerts','customers','catalog','system']),
 chosen:'',called:[],adminPartnersWorkspaceTab:'queue',
 adminAdsWorkspaceTab:'campaigns',adminGrowthWorkspaceTab:'acquisition',
 adminRuntime:{section:'overview',financeWorkspace:'summary'},
 adminSectionMeta:s=>({title:s}),
 adminReady:()=>true,
 adminCurrentRole(){return ctx.role},
 adminRoleCanSection(s){return ctx.allowed.has(s)},
 document:{getElementById(){return {value:ctx.chosen}}},
 adminSetSection(s){ctx.called.push(s)},
 esc:s=>String(s).replaceAll('&','&amp;')
};
vm.createContext(ctx);
vm.runInContext(taskSource+'\nthis.choices=adminTaskNavChoices;this.open=adminSelectTaskFromUi;this.view=adminTaskNavView;',ctx);
assert.match(ctx.view(),/Ir direto para uma tarefa/);
assert.match(ctx.view(),/Publicidade — revisar campanhas/);
assert.match(ctx.view(),/Publicidade — configuração de vendas/);
assert.match(ctx.view(),/Publicidade — reembolsos/);
ctx.chosen='partners-verification';ctx.open();
assert.equal(ctx.adminPartnersWorkspaceTab,'verification');
assert.equal(ctx.called.at(-1),'partners');
ctx.chosen='ads-diagnostics';ctx.open();
assert.equal(ctx.adminAdsWorkspaceTab,'diagnostics');
assert.equal(ctx.called.at(-1),'ads');
ctx.chosen='growth-benefits';ctx.open();
assert.equal(ctx.adminGrowthWorkspaceTab,'benefits');
assert.equal(ctx.called.at(-1),'growth');
ctx.chosen='finance-billing';ctx.open();
assert.equal(ctx.adminRuntime.financeWorkspace,'billing');
assert.equal(ctx.called.at(-1),'finance');
const n=ctx.called.length;
ctx.chosen='not-a-task';ctx.open();assert.equal(ctx.called.length,n);
ctx.role='operations';
assert.ok(!ctx.choices().some(x=>x.id==='growth-budget'),'investment only for superadmin');
ctx.chosen='growth-budget';ctx.open();assert.equal(ctx.called.length,n);
ctx.role='support';ctx.allowed=new Set(['orders','customers','alerts']);
assert.ok(!ctx.choices().some(x=>x.section==='finance'||x.section==='partners'));
assert.doesNotMatch(ctx.view(),/Publicidade — campanhas/);
ctx.chosen='ads-campaigns';ctx.open();assert.equal(ctx.called.length,n);

const tabStart=admin.indexOf('function adminPartnersSetWorkspaceTab(');
const tabEnd=admin.indexOf('// This selector navigates only',tabStart);
assert.ok(tabStart>=0&&tabEnd>tabStart);
const tabs={ready:true,section:'partners',tab:'queue',role:true,renders:0,
 adminReady:()=>tabs.ready,
 adminRuntime:{section:'partners'},
 adminRoleCanSection(){return tabs.role},
 render(){tabs.renders++},
 adminPartnersWorkspaceTab:'queue'};
vm.createContext(tabs);
vm.runInContext(admin.slice(tabStart,tabEnd)+'\nthis.change=adminPartnersSetWorkspaceTab;',tabs);
tabs.change('verification');
assert.equal(tabs.adminPartnersWorkspaceTab,'verification');
tabs.change('billing');
assert.equal(tabs.adminPartnersWorkspaceTab,'verification','unknown tab must not be opened');
tabs.role=false;tabs.change('queue');
assert.equal(tabs.adminPartnersWorkspaceTab,'verification','unauthorized role must not switch tabs');

const p0=admin.indexOf('const partnerTab=');
const p1=admin.indexOf('const catalogContent=',p0);
assert.ok(p0>=0&&p1>p0);
const partnerRender=admin.slice(p0,p1);
function rendered(tab){
 const calls=[],cx={
   adminPartnersWorkspaceTab:tab,sectionActive:()=>true,
   adminMerchantNetworkView(){calls.push('network');return 'NETWORK'},
   adminMerchantOperationsQueueView(){calls.push('queue');return 'QUEUE'},
   adminPublicRequestsSection(){calls.push('requests');return 'REQUESTS'},
   adminPilotPartnerCard(){calls.push('pilot');return 'PILOT'},
   adminApplicationCard(){calls.push('application');return 'APPLICATION'},
   adminMerchantCard(){calls.push('validation');return 'VALIDATION'},
   adminVerificationMerchantView(){calls.push('validation');return 'VALIDATION'},
   pilotPartners:[{id:'p1'}],
   d:{applications:[{id:'a1'}],merchants:[{id:'m1'}]}
 };
 vm.createContext(cx);
 vm.runInContext(partnerRender+'\nthis.html=partnersContent;',cx);
 return {html:cx.html,calls};
}
const queue=rendered('queue');
assert.match(queue.html,/Fila e situação/);
assert.deepEqual(queue.calls,['network','queue','requests']);
const applications=rendered('applications');
assert.deepEqual(applications.calls,['pilot','application']);
assert.doesNotMatch(applications.html,/VALIDATION/);
const verification=rendered('verification');
assert.deepEqual(verification.calls,['validation']);
assert.doesNotMatch(verification.html,/APPLICATION/);
assert.match(verification.html,/adminPartnersSetWorkspaceTab\('verification'\)/);

// Every deep link that previously targeted a merchant/application card must
// select the right workspace before render; no approval is inferred from this.
const focus=admin.slice(admin.indexOf('function adminFocusMerchantOperationsRecord('),
  admin.indexOf('function adminPilotApplicationReview(',admin.indexOf('function adminFocusMerchantOperationsRecord(')));
assert.match(focus,/adminPartnersWorkspaceTab=type==='merchant'\?'verification':'applications'/);
const network=admin.slice(admin.indexOf('function adminOpenMerchantNetworkRecord('),
  admin.indexOf('function adminMerchantMissingProfileNotice(',admin.indexOf('function adminOpenMerchantNetworkRecord(')));
assert.match(network,/adminPartnersWorkspaceTab='verification'/);
const controls=admin.slice(admin.indexOf('function adminMerchantReturnToControls('),
  admin.indexOf('function adminCloseDetail(',admin.indexOf('function adminMerchantReturnToControls(')));
assert.match(controls,/adminPartnersWorkspaceTab='verification'/);
assert.match(admin,/adminPanel\('partners',partnersContent\)/);
console.log('V1.896 PASS: task shortcuts are role-scoped, partner tabs render separately, deep links preserve destinations and advanced navigation can close.');
