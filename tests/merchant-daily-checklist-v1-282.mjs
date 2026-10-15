import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/merchant.js'),css=read('css/components.css'),audit=read('.github/workflows/audit.yml');
const backend=read('js/backend.js');
new vm.Script(js,{filename:'merchant.js'});
const take=name=>{
  const i=js.indexOf('function '+name+'('),j=js.indexOf('\n}',i);
  assert.ok(i>=0&&j>i,'function not found: '+name);return js.slice(i,j+2);
};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const now=new Date().toISOString();
const expired=new Date(Date.now()-2*86400000).toISOString();
const rt={status:'ready',merchant:{merchantId:'merchant1',memberRole:'owner',online:true},
  catalog:[
    {productCode:'P13',active:true,priceCents:12500,availableStock:0,priceConfirmedAt:now},
    {productCode:'A20',active:true,priceCents:4000,availableStock:3,priceConfirmedAt:expired},
    {productCode:'ICE1',active:true,priceCents:500,availableStock:20,priceConfirmedAt:now},
    {productCode:'DISABLED',active:false,priceCents:0,availableStock:0,priceConfirmedAt:null}
  ]};
let draft=false;
const ctx=vm.createContext({Date,esc,
  merchantQuickHasDrafts:()=>draft});
vm.runInContext(take('merchantTimestampFresh')+'\n'+take('merchantQuickStockAlerts')+'\n'+
  take('merchantDailyChecklistModel')+'\n'+take('merchantDailyChecklistView')+
  ';this.model=merchantDailyChecklistModel;this.view=merchantDailyChecklistView;',ctx);
let model=ctx.model(rt,{deliveryFresh:false});
assert.deepEqual(Array.from(model.issues,x=>x.type),['stock','low','price','delivery']);
let html=ctx.view(rt,{deliveryFresh:false});
assert.match(html,/O que precisa da sua atenção/);
assert.match(html,/4 pontos/);
assert.ok(html.includes('1 produto sem estoque'));
assert.ok(html.includes('1 produto com até 3 unidades'));
assert.ok(html.includes('1 preço para confirmar'));
assert.match(html,/Conferir entregas/);
assert.ok(html.includes("merchantAvailabilityGo('stock')"));
assert.ok(html.includes("merchantAvailabilityGo('delivery')"));
assert.doesNotMatch(html,/merchantUpdateProductLive|merchantSetOnlineLive|merchantPerformAction/);
draft=true;
model=ctx.model(rt,{deliveryFresh:false});
assert.equal(model.issues[0].type,'draft');
assert.match(ctx.view(rt),/Ajustes aguardando confirmação/);
draft=false;
rt.catalog=[{productCode:'ICE1',active:true,priceCents:500,availableStock:20,priceConfirmedAt:now}];
assert.equal(ctx.model(rt,{deliveryFresh:true}).issues.length,0);
assert.match(ctx.view(rt,{deliveryFresh:true}),/Sem alertas de estoque, preços ou taxa de entrega/);
rt.catalog=[{productCode:'BAD',active:true,priceCents:0,availableStock:-1,priceConfirmedAt:now}];
model=ctx.model(rt,{deliveryFresh:true});
assert.deepEqual(Array.from(model.issues,x=>x.type),['incomplete']);
assert.match(ctx.view(rt),/Configurar produtos/);
assert.doesNotMatch(ctx.view(rt),/Sem alertas de estoque/);
rt.catalog=[{productCode:'DISABLED',active:false,priceCents:100,availableStock:0,priceConfirmedAt:null}];
assert.equal(ctx.model(rt).issues[0].type,'catalog');
assert.ok(!ctx.view(rt).includes('produto sem estoque'));
rt.merchant.memberRole='operator';
assert.equal(ctx.view(rt),'');
assert.equal(ctx.model(rt),null);
rt.merchant.memberRole='driver';
assert.equal(ctx.view(rt),'');
rt.merchant.memberRole='manager';
assert.match(ctx.view(rt),/Configurar produtos/);
rt.status='unauthenticated';
assert.equal(ctx.view(rt),'');
rt.status='ready';
const live=js.slice(js.indexOf('function merchantLivePage('),js.indexOf('\nfunction merchantScheduledDispatchState(',js.indexOf('function merchantLivePage(')));
const first=live.indexOf('merchantAvailabilityPanel(rt,');
const daily=live.indexOf('merchantDailyOverview(rt,orders)');
const checklist=live.indexOf('merchantDailyChecklistView(rt,');
const editor=live.indexOf('merchantQuickCatalogView(rt)');
const queue=live.indexOf('merchantOrderQueueView(orders)');
// V1.303: urgent orders must appear before the full catalog editor.
// The existing role-safe checklist is retained after the queue.
assert.ok(first>=0&&daily>first&&queue>daily&&checklist>queue&&editor>checklist);
assert.equal(live.split('merchantDailyOverview(rt,orders)').length-1,1);
assert.equal(live.split('merchantDailyChecklistView(rt,').length-1,1);
assert.match(backend,/async function merchantUpdateProductLive\(/);
assert.match(backend,/action:'update-product'/);
assert.match(css,/\.merchant-daily-checklist/);
assert.match(css,/@media\(max-width:600px\)/);
assert.match(audit,/node tests\/merchant-daily-checklist-v1-282.mjs/);
console.log('V1.282 PASS — role-scoped attention, stock, price, draft, delivery, no auto-write, single checklist, with urgent orders before catalog editing.');
