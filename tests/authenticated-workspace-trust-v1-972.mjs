import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const merchant=read('js/merchant.js');
const css=read('css/workspace-experience.css');
const audit=read('.github/workflows/audit.yml');
for(const [file,source] of [['js/admin.js',admin],['js/merchant.js',merchant]])
 assert.doesNotThrow(()=>new vm.Script(source,{filename:file}));
function between(source,start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Could not find '+start);
 return source.slice(a,b);
}
const epoch=Date.parse('2026-11-12T15:00:00.000Z');
class Clock extends Date {static now(){return epoch}}
const ctx=vm.createContext({
 Date:Clock,adminRuntime:{lastSyncAt:new Clock(epoch-30000).toISOString(),
  providerHealth:{ok:true,provider:'Mercado Pago'}},
 adminOperationModeLabel:mode=>({LIVE:'PLATAFORMA ATIVA',PAUSED:'OPERAÇÃO PAUSADA'})[mode]||mode,
 adminBillingE2EState:()=>({validated:false}),
 adminBillingProviderName:()=> 'Mercado Pago',
 esc:value=>String(value)
});
vm.runInContext(
 between(admin,'function adminRelativeTime(value){','function adminNavIcon(')+
 between(admin,'function adminDataSyncState(value,now=Date.now()){','function adminExecutiveKpi(')+
 '\nthis.relative=adminRelativeTime;this.sync=adminDataSyncState;this.strip=adminOperationalStrip;',ctx);
assert.equal(ctx.relative('not-a-time'),'horário não confirmado');
assert.equal(ctx.relative('2030-01-01T00:00:00Z'),'horário não confirmado');
assert.equal(ctx.relative(null),'sem sincronização');
const current={operationMode:'LIVE',commerceEnabled:true,securityBlockers:[],unresolvedWarnings:[]};
assert.equal(ctx.sync(new Clock(epoch-30000).toISOString(),epoch).fresh,true);
assert.equal(ctx.sync(new Clock(epoch-11*60000).toISOString(),epoch).fresh,false);
assert.equal(ctx.sync(null,epoch).fresh,false);
assert.equal(ctx.sync('garbage',epoch).label,'Sem sincronização confirmada');
assert.equal(ctx.sync(new Clock(epoch+3600000).toISOString(),epoch).fresh,false);
let html=ctx.strip({launchReadiness:current,incidents:[],merchantBilling:{}});
assert.match(html,/PLATAFORMA ATIVA/);
assert.match(html,/COMÉRCIO HABILITADO/);
assert.match(html,/sem bloqueios/);
assert.match(html,/0 aberto\(s\)/);
assert.doesNotMatch(html,/admin-ops-stale/);
ctx.adminRuntime.lastSyncAt=new Clock(epoch-11*60000).toISOString();
html=ctx.strip({launchReadiness:current,incidents:[],merchantBilling:{}});
assert.match(html,/admin-ops-stale/);
assert.match(html,/Desatualizado/);
assert.match(html,/admin-ops-strip warning/);
ctx.adminRuntime.lastSyncAt=null;
html=ctx.strip({launchReadiness:current,incidents:[],merchantBilling:{}});
assert.match(html,/Sem sincronização confirmada/);
assert.doesNotMatch(html,/Dados do painel<\/small><strong>agora/);
html=ctx.strip({merchantBilling:{}});
assert.match(html,/PLATAFORMA NÃO VERIFICADA/);
assert.match(html,/COMÉRCIO NÃO VERIFICADO|PLATAFORMA NÃO VERIFICADA/);
assert.match(html,/Prontidão<\/small><strong>não verificada/);
assert.match(html,/Incidentes<\/small><strong>não verificados/);
assert.doesNotMatch(html,/sem bloqueios|0 aberto\(s\)/);
html=ctx.strip({launchReadiness:{...current,commerceEnabled:false,
 securityBlockers:['blocked']},incidents:[],merchantBilling:{}});
assert.match(html,/PEDIDOS NÃO HABILITADOS/);
assert.match(html,/1 bloqueio\(s\)/);
assert.match(html,/admin-ops-strip danger/);
assert.doesNotMatch(between(admin,'function adminOperationalStrip(d){',
 'function adminExecutiveKpi('),/adminPerform|fetch\(|createPayment|generatePix/,
 'The status strip must remain read-only');

// Authorization must determine the section BEFORE browser-visible title is set.
const prelude=between(admin,'function adminPage(){','  const pending=(d.applications||[])');
const titleCtx=vm.createContext({
 document:{title:'Anterior'},adminRuntime:{status:'ready',data:{},section:'finance'},
 adminPortalRequested:()=>true,adminCurrentRole:()=> 'support',
 adminRoleCanSection:section=>section==='orders',
 adminFirstSectionForRole:()=> 'orders',
 adminSectionMeta:section=>({title:section==='orders'?'Pedidos':'Financeiro'})
});
vm.runInContext(prelude+'\n  return document.title;\n}\nthis.run=adminPage;',titleCtx);
assert.equal(titleCtx.run(),'Pedidos — TAMÃO Admin');
assert.equal(titleCtx.adminRuntime.section,'orders');
const menu=between(admin,'const menu='+String.fromCharCode(96),
 '  tamaoEnsureWorkspaceStyles();');
assert.doesNotMatch(menu,/admin-sidebar-brand/,'the top header already carries the logo');
assert.match(menu,/aria-label="Áreas administrativas"/);

// A task picker should name the actual workspace if no preset subtask matches.
const picker=between(admin,'function adminTaskNavView(){','function adminQuickGo(');
const navCtx=vm.createContext({
 adminRuntime:{section:'overview'},adminTaskNavChoices:()=>[],
 adminCurrentTaskFromState:()=>'',adminSectionMeta:section=>({title:section==='finance'?'Financeiro':'Visão geral'}),
 esc:value=>String(value)
});
vm.runInContext(picker+'\nthis.view=adminTaskNavView;',navCtx);
assert.match(navCtx.view(),/Visão geral — escolha sua tarefa/);
navCtx.adminRuntime.section='finance';
assert.match(navCtx.view(),/Outra tarefa em Financeiro/);

// A merchant shortcut must actually place keyboard focus on its target,
// and must work on a WebView without matchMedia.
const jump=between(merchant,'function merchantWorkspaceJump(area){',
 '// V1.348 — read-only guide');
const events=[];
const heading={tagName:'H2',hasAttribute:key=>false,
 setAttribute:(key,value)=>events.push(['attribute',key,value]),
 focus:options=>events.push(['focus',options.preventScroll])};
const summary={tagName:'SUMMARY',focus:options=>events.push(['summary-focus',options.preventScroll])};
const panels={
 'merchant-live-orders':{tagName:'SECTION',querySelector:selector=>selector==='h2'?heading:null,
 scrollIntoView:options=>events.push(['scroll',options.behavior])},
 'merchant-workspace-finance':{tagName:'DETAILS',open:false,
 querySelector:selector=>selector==='summary'?summary:null,
 scrollIntoView:options=>events.push(['scroll',options.behavior])}
};
const mc=vm.createContext({
 document:{getElementById:id=>panels[id]||null},
 globalThis:{matchMedia:()=>({matches:false})}
});
vm.runInContext(jump+'\nthis.jump=merchantWorkspaceJump;',mc);
mc.document.getElementById=id=>panels[id]||null;
assert.equal(mc.jump('orders'),true);
assert.deepEqual(events[0],['attribute','tabindex','-1']);
assert.deepEqual(events[1],['scroll','smooth']);
assert.deepEqual(events[2],['focus',true]);
events.length=0;
mc.globalThis.matchMedia=()=>({matches:true});
assert.equal(mc.jump('finance'),true);
assert.equal(panels['merchant-workspace-finance'].open,true);
assert.deepEqual(events,[['scroll','auto'],['summary-focus',true]]);
events.length=0;
delete mc.globalThis.matchMedia;
assert.equal(mc.jump('orders'),true);
assert.ok(events.some(item=>item[0]==='scroll'&&item[1]==='auto'));
assert.equal(mc.jump('unknown-section'),false);
assert.equal(mc.jump('growth'),false);

assert.match(css,/\.admin-ops-strip\.admin-ops-stale/);
assert.match(css,/@media\(max-width:600px\)/);
assert.match(css,/font-size:16px/);
assert.match(audit,/node tests\/authenticated-workspace-trust-v1-972\.mjs/);
console.log('V1.972 PASS: verified sync visibility, correct RBAC title, uncluttered admin, accessible merchant focus and mobile forms.');
