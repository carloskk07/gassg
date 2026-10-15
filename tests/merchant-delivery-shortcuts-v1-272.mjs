import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant.js'),css=read('css/components.css'),audit=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'merchant.js'});
function cut(name){
  const begin=src.indexOf('function '+name+'(');
  assert.ok(begin>=0,'missing '+name);
  const end=src.indexOf('\n}',begin);
  assert.ok(end>begin,name);
  return src.slice(begin,end+2);
}
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const id='11111111-1111-4111-8111-111111111111';
const docEvents=[];
const element={focus(opts){docEvents.push(['focus',opts])},scrollIntoView(opts){docEvents.push(['scroll',opts])}};
const ctx=vm.createContext({esc,document:{getElementById:x=>x==='merchant-order-group-delivery'?element:null},
 merchantOrderAttentionSummary:()=>'',merchantLiveOrder:o=>'<article>'+esc(o.orderId)+'</article>'});
vm.runInContext(cut('merchantFocusOrderGroup')+'\n'+cut('merchantOrderQueueView')+'\n'+
 cut('merchantDeliveryShortcuts')+';this.shortcuts=merchantDeliveryShortcuts;',ctx);
assert.equal(ctx.merchantFocusOrderGroup('delivery'),true);
assert.equal(docEvents.length,2);
assert.equal(ctx.merchantFocusOrderGroup("delivery');alert(1)//"),false);
assert.equal(ctx.merchantFocusOrderGroup('billing'),false);
assert.equal(ctx.merchantFocusOrderGroup('offers'),false);
assert.equal(docEvents.length,2);
const orders=[{orderId:id,status:'OUT_FOR_DELIVERY'}];
const queueHtml=ctx.merchantOrderQueueView(orders);
assert.match(queueHtml,/merchantFocusOrderGroup\('delivery'\)/);
assert.match(queueHtml,/merchant-order-group-delivery/);
assert.match(queueHtml,/aria-label="1 pedido\(s\): Em entrega/);
assert.match(queueHtml,/merchantFocusOrderGroup\('offers'\).*disabled|disabled title="Sem pedidos nesta etapa"/);
assert.equal((queueHtml.match(/<article>/g)||[]).length,1);
assert.ok(queueHtml.includes('tabindex="-1"'));
assert.match(ctx.merchantOrderQueueView([],'Nada <b>agora</b>'),/&lt;b&gt;/);

const address='Rua Central, 123 - São Gabriel, RS';
const authorized={status:'OUT_FOR_DELIVERY',addressVisible:true,deliveryDetailsVisible:true,address,
 customerPhone:'51999998888',postalCode:'97300000'};
const links=ctx.shortcuts(authorized);
assert.match(links,/google\.com\/maps\/dir\/\?api=1&amp;destination=/);
assert.match(links,/target="_blank" rel="noopener noreferrer"/);
assert.ok(links.includes(encodeURIComponent(address+', CEP 97300000')));
assert.match(links,/tel:\+5551999998888/);
assert.match(links,/Abrir rota/);
assert.match(links,/Ligar para cliente/);
assert.doesNotMatch(links,/<script|onclick=/);
assert.equal(ctx.shortcuts({...authorized,addressVisible:false}),'');
assert.equal(ctx.shortcuts({...authorized,deliveryDetailsVisible:false}),'');
for(const status of ['OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','AT_RISK','DELIVERED','CANCELLED'])
 assert.equal(ctx.shortcuts({...authorized,status}), '', 'no links before delivery: '+status);
assert.equal(ctx.shortcuts({...authorized,status:'ARRIVING'}),links);
assert.doesNotMatch(ctx.shortcuts({...authorized,customerPhone:'javascript:alert(1)'}),/href="tel:/);
assert.doesNotMatch(ctx.shortcuts({...authorized,address:'<svg onload=alert(1)>'}),/google\.com\/maps/);
assert.doesNotMatch(ctx.shortcuts({...authorized,address:'abc'}),/google\.com\/maps/);
assert.equal(ctx.shortcuts({...authorized,address:'bad',customerPhone:'abc'}),'');
assert.match(ctx.shortcuts({...authorized,customerPhone:null}),/Abrir rota/);
assert.doesNotMatch(ctx.shortcuts({...authorized,customerPhone:null}),/Ligar para cliente/);
assert.match(ctx.shortcuts({...authorized,address:null}),/Ligar para cliente/);

const cardCtx=vm.createContext({globalThis:{merchantRuntime:{merchant:{memberRole:'driver'},deliveryTeam:[],actionPending:false}},
 esc,BRL:{format:x=>'R$ '+Number(x).toFixed(2)},statusCopy:{},paymentLabel:()=> 'Pix',
 merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),merchantDeliveryMemberLabel:()=> '',
 merchantFormatPhone:x=>String(x),merchantDeliveryCandidates:()=>[],
 merchantOrderAttentionCard:()=>'',merchantIncidentRiskGuide:()=>'',merchantOrderProgressView:()=>''});
vm.runInContext(cut('merchantDeliveryShortcuts')+'\n'+cut('merchantLiveOrder'),cardCtx);
const base={orderId:id,publicCode:'TAM-123',items:[],paymentMethod:'pix',totalCents:10000};
assert.doesNotMatch(cardCtx.merchantLiveOrder({...base,...authorized,addressVisible:false}),/Abrir rota|Ligar para cliente/);
assert.doesNotMatch(cardCtx.merchantLiveOrder({...base,...authorized,deliveryDetailsVisible:false}),/Abrir rota|Ligar para cliente/);
const cardHtml=cardCtx.merchantLiveOrder({...base,...authorized});
assert.match(cardHtml,/Abrir rota/);
assert.match(cardHtml,/Ligar para cliente/);
assert.match(cardHtml,/Estou chegando/);
assert.match(cardHtml,/Endereço e contato para entrega/);
assert.doesNotMatch(cardHtml,/merchantLiveDeliver/);
assert.match(cardCtx.merchantLiveOrder({...base,...authorized,status:'ARRIVING'}),/live-pin-/);
assert.match(cardCtx.merchantLiveOrder({...base,...authorized,status:'ARRIVING'}),/Pagamento recebido/);
assert.match(css,/\.merchant-order-queue-stat:focus-visible/);
assert.match(css,/\.merchant-delivery-shortcut/);
assert.match(css,/@media\(max-width:540px\)/);
assert.match(audit,/node tests\/merchant-delivery-shortcuts-v1-272.mjs/);
console.log('V1.272 PASS: one-tap queue groups and authorized delivery map/phone, no hidden transaction actions.');
