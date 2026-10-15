import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=load('js/merchant.js'),css=load('css/components.css'),workflow=load('.github/workflows/audit.yml');
new vm.Script(src,{filename:'merchant.js'});
const at=src.indexOf('function merchantLiveOrder('),end=src.indexOf('\n}',at);
assert.ok(at>0&&end>at);
const source=src.slice(at,end+2);
const escapeText=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#39;');
const runtime={merchant:{memberRole:'owner'},orders:[],actionPending:false,deliveryTeam:[]};
const ctx=vm.createContext({
  Date,globalThis:{merchantRuntime:runtime},esc:escapeText,
  BRL:{format:x=>'R$ '+Number(x).toFixed(2)},statusCopy:{},
  paymentLabel:()=> 'Pix',merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
  merchantDeliveryCandidates:()=>[],merchantDeliveryMemberLabel:()=>'',merchantFormatPhone:()=> '',
  merchantDeliveryShortcuts:()=>'',merchantIncidentRiskGuide:()=>'',merchantOrderAttentionCard:()=> '',
  merchantOrderProgressView:()=>'<details class="merchant-order-progress"><summary>Acompanhar etapas</summary></details>'
});
vm.runInContext(source+'\nthis.card=merchantLiveOrder;',ctx);
const id='11111111-1111-4111-8111-111111111111';
const minutes=n=>new Date(Date.now()+n*60000).toISOString();
const order={
  orderId:id,publicCode:'TAM-2026',status:'OFFERED_TO_MERCHANT',
  items:[{quantity:1,productName:'Gás P13'}],totalCents:11900,paymentMethod:'pix',
  address:'Rua sigilosa',addressVisible:false,deliveryDetailsVisible:false,
  offerExpiresAt:minutes(18)
};
let html=ctx.card(order);
assert.match(html,/merchant-order-compact-meta/);
assert.match(html,/Aguardando resposta/);
assert.match(html,/Limite da oferta/);
assert.match(html,/Aceitar pedido/);
assert.match(html,/Não consigo atender/);
assert.match(html,/Endereço protegido até o aceite/);
assert.doesNotMatch(html,/Rua sigilosa/);
assert.ok(html.indexOf('merchant-order-compact-meta')<html.indexOf('merchant-order-action-fieldset'));
assert.match(html,/merchant-order-progress/,'Existing milestone drawer preserved');
assert.match(html,/merchant-order-total/);
order.offerExpiresAt=minutes(-5);
html=ctx.card(order);
assert.match(html,/horário já passou/);
assert.match(html,/Prazo desta oferta encerrado/);
assert.doesNotMatch(html,/Aceitar pedido/);
order.offerExpiresAt='invalid';
html=ctx.card(order);
assert.doesNotMatch(html,/Limite da oferta/);
assert.match(html,/Prazo não informado/);
order.offerExpiresAt=minutes(18);
order.status='PREPARING';order.dispatchDueAt=minutes(12);
html=ctx.card(order);
assert.match(html,/Em preparação/);
assert.match(html,/Prazo de saída/);
assert.match(html,/Confirmar saída/);
assert.match(html,/merchant-order-exception/);
order.status='AT_RISK';order.dispatchDueAt=minutes(-20);
html=ctx.card(order);
assert.match(html,/Precisa de atenção/);
assert.match(html,/horário já passou/);
assert.match(html,/Não consigo concluir este pedido/);
order.status='OUT_FOR_DELIVERY';order.promisedBy=minutes(50);
html=ctx.card(order);
assert.match(html,/Em entrega/);
assert.match(html,/Previsão de entrega/);
assert.match(html,/Estou chegando/);
order.status='ARRIVING';
html=ctx.card(order);
assert.match(html,/Chegada informada/);
assert.match(html,/Previsão de entrega/);
assert.match(html,/Pagamento recebido/);
assert.match(html,/PIN informado pelo cliente/);
assert.match(html,/disabled onclick="merchantLiveDeliver/);
order.status='MERCHANT_ACCEPTED';
html=ctx.card(order);
assert.match(html,/Pedido aceito/);
assert.doesNotMatch(html,/Prazo de saída/);
order.status='NEW_UNKNOWN';
order.publicCode='<img src=x onerror=alert(1)>';
html=ctx.card(order);
assert.match(html,/Confira o pedido/);
assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(html,/<img src=x/);
assert.doesNotMatch(html,/Previsão de entrega/);
order.status='OUT_FOR_DELIVERY';order.promisedBy='2050-01-01T00:00:00Z';
html=ctx.card(order);
assert.doesNotMatch(html,/Previsão de entrega/,'Absurd future deadline not shown');
order.promisedBy='1999-01-01T00:00:00Z';
assert.doesNotMatch(ctx.card(order),/Previsão de entrega/);
assert.ok(!source.includes('merchantPerformAction('),'Rendering never performs transactions');
assert.ok(!source.includes('merchantCompleteDeliveryLive('),'Rendering never confirms payments');
assert.match(src,/function merchantOrderProgressView/);
assert.match(css,/\.merchant-order-compact-status/);
assert.match(css,/\.merchant-order-deadline-passed/);
assert.match(css,/@media\(max-width:540px\)/);
assert.match(css,/@media\(max-width:360px\)/);
assert.match(workflow,/node tests\/merchant-order-mobile-v1-284.mjs/);
console.log('V1.284 PASS — readable mobile order status and deadlines, private addresses, unchanged confirmations.');
