import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const merchant=read('js/merchant.js');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(admin,{filename:'js/admin.js'});
new vm.Script(merchant,{filename:'js/merchant.js'});
const take=(s,start,end)=>{
 const a=s.indexOf(start),b=s.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Function boundaries must exist: '+start);
 return s.slice(a,b);
};
const taskSource=take(admin,'function adminCurrentTaskFromState(','function adminSelectTaskFromUi()');
const pickerSource=take(admin,'function adminTaskNavView(){','function adminQuickGo(');
const allowed=[
 {id:'orders',section:'orders',label:'Pedidos — acompanhar entregas'},
 {id:'support',section:'orders',tab:'support',label:'Atendimento'},
 {id:'partners-queue',section:'partners',tab:'queue',label:'Revendas — fila'},
 {id:'partners-verification',section:'partners',tab:'verification',label:'Revendas — verificar'},
 {id:'ads-campaigns',section:'ads',tab:'campaigns',pane:'campaigns',label:'Campanhas'},
 {id:'ads-finance',section:'ads',tab:'campaigns',pane:'finance',label:'Financeiro Ads'},
 {id:'ads-diagnostics',section:'ads',tab:'diagnostics',label:'Diagnósticos'},
 {id:'growth-acquisition',section:'growth',tab:'acquisition',label:'Captação'},
 {id:'finance-summary',section:'finance',tab:'summary',label:'Resumo'},
 {id:'finance-reconciliation',section:'finance',tab:'reconciliation',label:'Conciliação'},
 {id:'system',section:'system',label:'Segurança'}
];
const state={section:'overview',financeWorkspace:'summary'};
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const context=vm.createContext({adminRuntime:state,adminOrdersWorkspaceTab:'orders',adminPartnersWorkspaceTab:'queue',
 adminGrowthWorkspaceTab:'acquisition',adminAdsWorkspaceTab:'campaigns',adminIndependentAdsPane:'campaigns',
 adminTaskNavChoices:()=>allowed,adminSectionMeta:s=>({title:s}),esc});
vm.runInContext(taskSource+pickerSource+'\nthis.current=adminCurrentTaskFromState;this.view=adminTaskNavView;',context);
const cases=[
 ['overview','', ''],
 ['orders','orders','orders'],
 ['orders','support','support'],
 ['partners','queue','partners-queue'],
 ['partners','verification','partners-verification'],
 ['growth','acquisition','growth-acquisition'],
 ['ads','campaigns','ads-campaigns'],
 ['ads','finance','ads-finance'],
 ['ads','diagnostics','ads-diagnostics'],
 ['finance','summary','finance-summary'],
 ['finance','reconciliation','finance-reconciliation'],
 ['system','', 'system']
];
for(const [section,tab,expected] of cases){
 state.section=section;
 if(section==='orders')context.adminOrdersWorkspaceTab=tab;
 if(section==='partners')context.adminPartnersWorkspaceTab=tab;
 if(section==='growth')context.adminGrowthWorkspaceTab=tab;
 if(section==='finance')state.financeWorkspace=tab;
 if(section==='ads'){context.adminAdsWorkspaceTab=tab==='diagnostics'?'diagnostics':'campaigns';context.adminIndependentAdsPane=tab;}
 assert.equal(context.current(),expected,section+': '+tab);
 const view=context.view();
 assert.match(view,/<optgroup label=/);
 assert.equal((view.match(/ selected/g)||[]).length,1,'exactly one selected option');
 assert.match(view,new RegExp('value="'+(expected||'')+'" selected'));
}
state.section='finance';
state.financeWorkspace='restricted-private-tab';
assert.equal(context.current(),'', 'unlisted subtask never pretends to be active');
assert.doesNotMatch(context.view(),/value="finance-summary" selected/);
state.section='growth';
context.adminTaskNavChoices=()=>allowed.filter(x=>x.section!=='finance');
assert.doesNotMatch(context.view(),/finance-summary/, 'role-hidden sections stay hidden');
const guide=take(merchant,'function merchantWorkspaceNeedsGuide(','function merchantWorkspaceOrientation(');
const merchantContext=vm.createContext({});
vm.runInContext(guide+'\nthis.needsGuide=merchantWorkspaceNeedsGuide;',merchantContext);
assert.equal(merchantContext.needsGuide({fresh:true},[{orderId:'a'}]),false);
assert.equal(merchantContext.needsGuide({fresh:true},[]),true);
assert.equal(merchantContext.needsGuide({fresh:false},[{orderId:'a'}]),true);
assert.equal(merchantContext.needsGuide(null,[]),true);
assert.match(merchant,/const orientationMarkup=merchantWorkspaceNeedsGuide\(orderEvidence,orders\)\?/);
assert.match(merchant,/orderEvidence\.fresh\?\(orders\.length\+/);
assert.match(merchant,/Atualize para conferir a fila/);
assert.match(merchant,/merchantOrderListRecovery\(rt\)/);
assert.match(merchant,/merchantDailyOverview\(rt,orders\)/);
assert.match(css,/@media\(max-width:520px\)/);
assert.match(css,/:focus-visible/);
assert.match(css,/prefers-reduced-motion:reduce/);
assert.match(audit,/node tests\/authenticated-workspace-clarity-v1-970.mjs/);
console.log('V1.970 PASS: role-aware task selection, selected tab truthfulness, stale queue clarity, order CTA deduplication and responsive focus.');
