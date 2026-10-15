import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const js=read('js/merchant.js'),css=read('css/components.css'),
 audit=read('.github/workflows/audit.yml'),backend=read('js/backend.js');
new vm.Script(js,{filename:'merchant.js'});
function take(name,asyncFn=false){
 const start=js.indexOf((asyncFn?'async ':'')+'function '+name+'(');
 assert.ok(start>=0,'missing '+name);
 const end=js.indexOf('\n}',start);
 assert.ok(end>start,'unterminated '+name);
 return js.slice(start,end+2);
}
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const now=new Date(Date.now()-2*60000).toISOString();
const older=new Date(Date.now()-3*3600000).toISOString();
const rt={status:'ready',actionPending:false,
 merchant:{merchantId:'merchant-A',memberRole:'owner'},catalog:[
 {productCode:'P13',productName:'Gás P13',priceCents:12000,availableStock:8,active:true,
  updatedAt:now,priceConfirmedAt:now,pricingMode:'fixed'},
 {productCode:'AGUA20',productName:'Água 20L',priceCents:1800,availableStock:0,active:true,
  updatedAt:older,priceConfirmedAt:older,pricingMode:'fixed'},
 {productCode:'LOW',productName:'Item baixo',priceCents:5500,availableStock:2,active:true,
  updatedAt:older,priceConfirmedAt:now,pricingMode:'fixed'},
 {productCode:'ATTACK',productName:'<script>alert(1)</script>',priceCents:1000,availableStock:7,active:true,
  updatedAt:'not-a-date',priceConfirmedAt:now,pricingMode:'fixed'},
 {productCode:'INACTIVE',priceCents:2000,availableStock:4,active:false,updatedAt:older}
 ]};
let alerts=[],route=[],writes=[],renders=0,switches=[],signouts=0,confirmCalls=0,allowLeave=false;
const inputs={};
const mockDom={getElementById:id=>inputs[id]||null};
const ctx=vm.createContext({Date,Map,esc,globalThis:{merchantRuntime:rt},
 BRL:{format:v=>'R$ '+Number(v).toFixed(2)},document:mockDom,
 render:()=>{renders++;},confirm:()=>{confirmCalls++;return allowLeave;},
 go:key=>route.push(key),
 merchantUpdateProductLive:async(...args)=>writes.push(args),
 merchantSelectLive:async id=>switches.push(id),
 merchantSignOut:async()=>{signouts++;},
 toast:message=>alerts.push(String(message))
});
const bodies=[
 'const merchantQuickDrafts=new Map();',
 take('merchantTimestampFresh'),take('merchantQuickDraftKey'),
 take('merchantQuickCatalogVersion'),take('merchantQuickDraftFor'),
 take('merchantQuickCatalogChanged'),take('merchantQuickHasDrafts'),
 take('merchantQuickConfirmLeave'),take('merchantQuickGoCatalog'),
 take('merchantQuickRecentChanges'),take('merchantQuickCatalogCandidates'),
 take('merchantQuickStockAlerts'),take('merchantQuickStockAdjust'),
 take('merchantQuickCatalogView'),take('merchantQuickCatalogSave',true),
 take('merchantLiveSelect',true),take('merchantLiveLogout',true)
];
vm.runInContext(bodies.join('\n')+
 ';this.view=merchantQuickCatalogView;this.changed=merchantQuickCatalogChanged;'+
 'this.draftFor=merchantQuickDraftFor;this.hasDrafts=merchantQuickHasDrafts;'+
 'this.recent=merchantQuickRecentChanges;this.step=merchantQuickStockAdjust;'+
 'this.save=merchantQuickCatalogSave;this.leave=merchantQuickConfirmLeave;'+
 'this.catalog=merchantQuickGoCatalog;this.switchMerchant=merchantLiveSelect;'+
 'this.logout=merchantLiveLogout;this.drafts=merchantQuickDrafts;',ctx);

const initial=ctx.view(rt);
assert.match(initial,/Últimas atualizações registradas/);
assert.match(initial,/Não é um histórico de cada movimento de estoque/);
assert.match(initial,/merchantQuickCatalogChanged\('P13'\)/);
assert.match(initial,/Água 20L/);
assert.match(initial,/&lt;script&gt;/);
assert.doesNotMatch(initial,/<script>alert/);
assert.ok(initial.indexOf('Gás P13')<initial.indexOf('Água 20L'));
assert.equal(ctx.recent(rt).length,4,'Recent changes can include inactive items with genuine update timestamp');
assert.equal(ctx.recent(rt)[0].productCode,'P13');
assert.equal(ctx.hasDrafts(rt),false);

// Simulate manual text input and a background re-render.
inputs['merchant-quick-price-P13']={value:'130.00'};
inputs['merchant-quick-stock-P13']={value:'12',closest:()=>({disabled:false})};
inputs['merchant-quick-feedback-P13']={textContent:''};
assert.equal(ctx.changed('P13'),true);
assert.equal(ctx.hasDrafts(rt),true);
assert.match(inputs['merchant-quick-feedback-P13'].textContent,/ainda não salvas/i);
let painted=ctx.view(rt);
assert.match(painted,/<details id="merchant-quick-catalog" class="merchant-quick-catalog" open>/);
assert.match(painted,/value="130.00"/);
assert.match(painted,/value="12"/);
assert.match(painted,/Alterações ainda não salvas/);
assert.equal(writes.length,0,'Rendering drafts must not mutate the server');

// Stock stepper also captures draft without triggering a save.
assert.equal(ctx.step('P13',5),true);
assert.equal(inputs['merchant-quick-stock-P13'].value,'17');
assert.equal(ctx.view(rt).includes('value="17"'),true);
assert.equal(writes.length,0);
assert.equal(ctx.drafts.size,1);

// Return to exact server baseline to clear the draft.
inputs['merchant-quick-price-P13'].value='120.00';
inputs['merchant-quick-stock-P13'].value='8';
assert.equal(ctx.changed('P13'),false);
assert.equal(ctx.hasDrafts(rt),false);
assert.equal(ctx.drafts.size,0);

// Leaving without saving must be explicit.
inputs['merchant-quick-price-P13'].value='128.00';
inputs['merchant-quick-stock-P13'].value='9';
ctx.changed('P13');
assert.equal(ctx.leave(),false);
assert.equal(confirmCalls,1);
assert.equal(ctx.catalog(),false);
assert.equal(route.length,0);
await ctx.switchMerchant('merchant-B');
assert.equal(switches.length,0);
await ctx.logout();
assert.equal(signouts,0);
assert.equal(ctx.hasDrafts(rt),true);
assert.equal(ctx.drafts.size,1);

// Successful confirmed update clears only on success.
await ctx.save('P13');
assert.equal(writes.length,1);
assert.deepEqual(Array.from(writes[0]).slice(0,4),['P13',12800,9,true]);
assert.equal(ctx.hasDrafts(rt),false);
assert.equal(renders,1);
assert.equal(alerts.at(-1),'Preço e estoque de P13 confirmados.');

inputs['merchant-quick-price-P13'].value='125.00';
inputs['merchant-quick-stock-P13'].value='10';
ctx.changed('P13');
const originalWrite=ctx.merchantUpdateProductLive;
ctx.merchantUpdateProductLive=async()=>{throw Error('catalog conflict');};
await ctx.save('P13');
assert.match(alerts.at(-1),/catalog conflict/);
assert.equal(ctx.hasDrafts(rt),true,'Failed backend operation must not claim save or discard draft');
ctx.merchantUpdateProductLive=originalWrite;

// A server product update replaces stale drafts instead of submitting outdated values.
const staleProduct=rt.catalog[0];
rt.catalog[0]={...staleProduct,updatedAt:new Date().toISOString(),priceCents:12400};
painted=ctx.view(rt);
assert.doesNotMatch(painted,/value="125.00"/);
assert.match(painted,/value="124.00"/);
assert.equal(ctx.hasDrafts(rt),false);
assert.equal(ctx.drafts.size,0);

// Cancelled changes remain for the current merchant. Switching confirms explicit discard.
inputs['merchant-quick-price-P13'].value='127.00';
inputs['merchant-quick-stock-P13'].value='12';
ctx.changed('P13');
allowLeave=true;
await ctx.switchMerchant('merchant-B');
assert.deepEqual(switches,['merchant-B']);
assert.equal(ctx.drafts.size,0);
assert.equal(ctx.catalog(),true);
assert.deepEqual(route,['catalog']);
ctx.changed('P13');
await ctx.logout();
assert.equal(signouts,1);
assert.equal(ctx.drafts.size,0);

// Invalid code/role cannot create drafts or edits.
rt.merchant.memberRole='driver';
inputs['merchant-quick-price-P13'].value='129.00';
assert.equal(ctx.changed('P13'),false);
assert.equal(ctx.view(rt),'');
rt.merchant.memberRole='owner';
assert.equal(ctx.changed("P13');alert(1)//"),false);
rt.actionPending=true;
assert.equal(ctx.changed('P13'),false);
rt.actionPending=false;

// Browser tab protection is only installed once, never in a render callback.
assert.match(js,/window\.addEventListener\('beforeunload'/);
assert.match(js,/event\.returnValue=''/);
assert.match(backend,/expectedUpdatedAt=String\(current.updatedAt\)/);
assert.match(css,/\.merchant-quick-recent-list/);
assert.match(audit,/node tests\/merchant-protected-drafts-v1-279.mjs/);
console.log('V1.279 PASS: unsaved drafts survive renders, require exit confirmation, respect merchant versions, and show truthful timestamps.');
