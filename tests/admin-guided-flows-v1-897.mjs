import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
new vm.Script(admin,{filename:'js/admin.js'});
const uid=n=>String(n).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const safe=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const take=(start,end)=>{const i=admin.indexOf(start),j=admin.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,'Missing source range '+start);return admin.slice(i,j);};

const merchantView=take('function adminVerificationMerchantView(d){',
 'function adminPartnersSetWorkspaceTab(tab){');
const merchants=[
 {id:uid(2),name:'Segunda <revenda>',status:'pending'},
 {id:uid(1),name:'Primeira',status:'active'}
];
const calls=[],ctx={adminVerificationMerchantId:'',esc:safe,
 adminMerchantCard:m=>{calls.push(m.id);return '<article id="merchant-view">'+safe(m.name)+'</article>'}};
vm.createContext(ctx);
vm.runInContext(merchantView+'\nthis.view=adminVerificationMerchantView;',ctx);
let html=ctx.view({merchants});
assert.match(html,/Escolha a revenda para conferir/);
assert.match(html,/Selecione uma revenda para abrir suas verificações/);
assert.ok(html.includes('Segunda &lt;revenda&gt;'));
assert.ok(!html.includes('Segunda <revenda>'));
assert.equal(calls.length,0,'Do not mount every long compliance form');
ctx.adminVerificationMerchantId=uid(1);
html=ctx.view({merchants});
assert.equal(calls.length,1);
assert.equal(calls[0],uid(1),'Only requested merchant form is mounted');
assert.ok(html.includes('merchant-view'));
assert.ok(!html.includes('Segunda <revenda>'));
ctx.adminVerificationMerchantId=uid(999);
html=ctx.view({merchants});
assert.equal(calls.length,1,'Stale selection must not open wrong account');
assert.match(html,/Selecione uma revenda para abrir suas verificações/);
ctx.adminVerificationMerchantId=uid(999);
html=ctx.view({merchants:[merchants[0]]});
assert.equal(calls.length,1,'A removed selection cannot silently switch to a different merchant');
assert.match(html,/Selecione uma revenda para abrir suas verificações/);
ctx.adminVerificationMerchantId='';
html=ctx.view({merchants:[merchants[0]]});
assert.equal(calls.length,2,'Single merchant automatically opens');
assert.equal(calls[1],uid(2));
assert.match(ctx.view({merchants:[]}),/Nenhuma revenda criada/);
assert.match(ctx.view({}),/Nenhuma revenda criada/);

const merchantSelect=take('function adminVerificationSelectMerchant(value){',
 'function adminVerificationMerchantView(d){');
const ui={ready:true,role:true,merchants:[...merchants],tab:'verification',section:'partners',
 adminVerificationMerchantId:'',renders:0,focus:0,
 adminReady:()=>ui.ready,adminRoleCanSection:s=>ui.role&&s==='partners',
 adminRuntime:{section:'partners',data:{merchants}},
 adminPartnersWorkspaceTab:'verification',render:()=>ui.renders++,
 requestAnimationFrame:fn=>fn(),
 document:{getElementById:id=>id==='admin-verification-merchant'?{focus:()=>ui.focus++}:null}};
vm.createContext(ui);
vm.runInContext(merchantSelect+'\nthis.select=adminVerificationSelectMerchant;',ui);
ui.select(uid(2));assert.equal(ui.adminVerificationMerchantId,uid(2));
assert.equal(ui.renders,1);assert.equal(ui.focus,1);
ui.select('../wrong');assert.equal(ui.renders,1);
ui.select(uid(999));assert.equal(ui.renders,1);
ui.role=false;ui.select(uid(1));assert.equal(ui.renders,1);
ui.role=true;ui.adminPartnersWorkspaceTab='queue';ui.select(uid(1));assert.equal(ui.renders,1);
ui.adminPartnersWorkspaceTab='verification';ui.adminRuntime.data={merchants:[merchants[0]]};
ui.select(uid(1));assert.equal(ui.renders,1);
ui.select('');assert.equal(ui.adminVerificationMerchantId,'');assert.equal(ui.renders,2);

// Two distinct parts of the Orders page must never mount at the same time.
const orders=take('const ordersContent=(sectionActive(\'orders\'))?(',
 'const customersContent=');
function orderPart(tab){
 const emitted=[],ctx={
  adminOrdersWorkspaceTab:tab,sectionActive:()=>true,d:{},controlOrders:[],supportCases:[],
  adminOrderDemoView:()=>{emitted.push('demo');return 'DEMO'},
  adminControlTower:()=>{emitted.push('orders');return 'ORDERS'},
  adminSupportQueueView:()=>{emitted.push('support');return 'SUPPORT'},
  adminProblemReportsSection:()=>{emitted.push('reports');return 'REPORTS'}
 };
 vm.createContext(ctx);
 vm.runInContext(orders+'\nthis.html=ordersContent;',ctx);
 return {html:ctx.html,emitted};
}
let operation=orderPart('orders'),support=orderPart('support');
assert.deepEqual(operation.emitted,['demo','orders']);
assert.deepEqual(support.emitted,['support','reports']);
assert.doesNotMatch(operation.html,/SUPPORT|REPORTS/);
assert.doesNotMatch(support.html,/DEMO|ORDERS/);
assert.match(support.html,/Atendimento e relatos/);

const ordersSetter=take('function adminOrdersSetWorkspaceTab(tab){',
 'function adminVerificationSelectMerchant(value){');
const x={adminOrdersWorkspaceTab:'orders',adminRuntime:{section:'orders'},role:true,
 adminReady:()=>true,adminRoleCanSection:k=>x.role&&k==='orders',
 adminCurrentRole:()=> 'support',render:()=>x.rendered++,
 adminHelpReportsPage:async()=>{x.loaded++},rendered:0,loaded:0};
vm.createContext(x);
vm.runInContext(ordersSetter+'\nthis.open=adminOrdersSetWorkspaceTab;',x);
x.open('support');assert.equal(x.adminOrdersWorkspaceTab,'support');
assert.equal(x.rendered,1);
x.open('not-real');assert.equal(x.rendered,1);
x.role=false;x.open('orders');assert.equal(x.rendered,1);

// Task picker "Suporte" must actually select the support sub-workspace.
const nav=take('function adminSelectTaskFromUi(){','function adminTaskNavView(){');
const sel={adminOrdersWorkspaceTab:'orders',adminPartnersWorkspaceTab:'queue',
 adminRuntime:{financeWorkspace:'summary'},chosen:'support',section:'',
 adminReady:()=>true,
 document:{getElementById:()=>({value:sel.chosen})},
 adminTaskNavChoices:()=>[{id:'support',section:'orders',tab:'support'},
  {id:'orders',section:'orders'}],
 adminSetSection:s=>{sel.section=s}};
vm.createContext(sel);
vm.runInContext(nav+'\nthis.go=adminSelectTaskFromUi;',sel);
sel.go();assert.equal(sel.section,'orders');
assert.equal(sel.adminOrdersWorkspaceTab,'support');
sel.chosen='orders';sel.go();assert.equal(sel.adminOrdersWorkspaceTab,'orders');
assert.match(admin,/adminVerificationMerchantId=id;/);
assert.match(admin,/adminVerificationMerchantId='';\n}\nfunction adminSensitiveReadCurrent/);
assert.match(admin,/adminPanel\('orders',ordersContent\)/);
assert.match(admin,/adminPanel\('partners',partnersContent\)/);
assert.doesNotMatch(merchantSelect,/adminPerform|adminInvoke|confirm\(/);
console.log('V1.897 PASS: a single merchant form is mounted, deep links stay scoped, Orders/Support tabs are isolated, shortcuts work and no writes are added.');
