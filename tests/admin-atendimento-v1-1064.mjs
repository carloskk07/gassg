import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(admin,{filename:'js/admin.js'});

const start=admin.indexOf('// This selector navigates only to known read/workspaces.');
const end=admin.indexOf('function adminQuickGo(',start);
const menuStart=admin.indexOf('function adminMenuTaskButton(');
const menuEnd=admin.indexOf('function adminMenuButton(',menuStart);
assert.ok(start>0&&end>start&&menuStart>0&&menuEnd>menuStart);

const session={
 role:'superadmin',ready:true,allowed:new Set([
  'testcenter','overview','orders','customers','partners','ads','growth',
  'finance','alerts','catalog','system'
 ]),chosen:'',visits:[],
 adminRuntime:{section:'overview',financeWorkspace:'summary'},
 adminOrdersWorkspaceTab:'orders',adminPartnersWorkspaceTab:'queue',
 adminAdsWorkspaceTab:'campaigns',adminIndependentAdsPane:'campaigns',
 adminGrowthWorkspaceTab:'acquisition',
 adminReady(){return session.ready},
 adminCurrentRole(){return session.role},
 adminRoleCanSection(section){return session.allowed.has(section)},
 adminSectionMeta:section=>({title:section}),
 adminNavIcon:()=>'<svg aria-hidden="true"></svg>',
 adminSetSection(section){session.adminRuntime.section=section;session.visits.push(section)},
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),
 document:{getElementById:()=>({value:session.chosen})}
};
vm.createContext(session);
vm.runInContext(admin.slice(start,end)+'\n'+admin.slice(menuStart,menuEnd)+
 '\nthis.open=adminOpenTask;this.sidebar=adminMenuTaskButton;this.select=adminSelectTaskFromUi;',session);

// One click directly opens the *actual* support queue, not a new simulation.
assert.equal(session.open('support'),true);
assert.equal(session.adminRuntime.section,'orders');
assert.equal(session.adminOrdersWorkspaceTab,'support');
let support=session.sidebar('support','Atendimento','customers','2');
assert.match(support,/adminOpenTask\('support'\)/);
assert.match(support,/aria-current="page"/);
assert.match(support,/>Atendimento</);
assert.match(support,/admin-nav-badge">2/);
assert.match(session.sidebar('orders','Pedidos','orders'),/aria-current="false"/);

assert.equal(session.open('orders'),true);
assert.equal(session.adminOrdersWorkspaceTab,'orders');
assert.match(session.sidebar('orders','Pedidos','orders'),/aria-current="page"/);
assert.match(session.sidebar('support','Atendimento','customers'),/aria-current="false"/);

session.chosen='support';
session.select();
assert.equal(session.adminOrdersWorkspaceTab,'support');
assert.equal(session.visits.at(-1),'orders');
const before=session.visits.length;
assert.equal(session.open('nonexistent'),false);
assert.equal(session.visits.length,before);

session.role='compliance';
session.allowed=new Set(['overview','partners','alerts']);
assert.equal(session.sidebar('support','Atendimento','customers'),'', 'No role leak to compliance');
assert.equal(session.open('support'),false);
assert.equal(session.visits.length,before);
session.role='support';
session.allowed=new Set(['overview','orders','customers','alerts']);
assert.match(session.sidebar('support','Atendimento','customers'),/Atendimento/);
assert.equal(session.open('finance-reconciliation'),false);
assert.equal(session.visits.length,before);
session.ready=false;
assert.equal(session.open('orders'),false);
assert.equal(session.visits.length,before);

const meta=admin.slice(admin.indexOf('function adminSectionMeta('),
 admin.indexOf('function adminRelativeTime(',admin.indexOf('function adminSectionMeta(')));
const context=vm.createContext({
 adminOrdersWorkspaceTab:'support',adminRuntime:{section:'orders'}
});
vm.runInContext(meta+'\nthis.meta=adminSectionMeta;',context);
assert.equal(context.meta('orders').title,'Atendimento');
context.adminOrdersWorkspaceTab='orders';
assert.equal(context.meta('orders').title,'Pedidos');
assert.equal(context.meta('finance').title,'Financeiro');

const view=admin.slice(admin.indexOf('function adminPage()'));
assert.match(view,/adminMenuTaskButton\('orders','Pedidos'/);
assert.match(view,/adminMenuTaskButton\('support','Atendimento'/);
assert.match(view,/badge\(activeOrderAttention\)/);
assert.match(view,/badge\(openSupportCases.length\+pendingHelpReports\)/);
assert.match(view,/adminOpenTask\(\\'support\\'\)/);
assert.match(css,/\.admin-nav-item/);
assert.match(css,/\.admin-nav-item.*focus-visible/s);
assert.match(audit,/node tests\/admin-atendimento-v1-1064\.mjs/);
assert.doesNotMatch(admin.slice(start,end),/adminPerform\(|adminInvoke\(|adminFinancialAction\(/i,
 'Navigation must not invoke privileged payments or assume another account');
console.log('V1.1064 PASS: atendimento one click, separate counters, real queue, RBAC and task picker parity.');
