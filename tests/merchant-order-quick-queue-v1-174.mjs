import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant.js'),css=read('css/components.css'),backend=read('js/backend.js');
new vm.Script(src);
const cut=(name,async=false)=>{
 const begin=src.indexOf((async?'async ':'')+'function '+name+'(');
 assert.ok(begin>=0,name);
 const end=src.indexOf('\n}',begin);
 assert.ok(end>begin,name+' end');
 return src.slice(begin,end+2);
};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
 .replaceAll('"','&quot;').replaceAll("'",'&#39;');
const queue=vm.createContext({esc,merchantLiveOrder:o=>'<article data-id="'+esc(o.orderId)+'"></article>'});
vm.runInContext(cut('merchantOrderScheduleDate')+'\n'+cut('merchantOrderAttention')+'\n'+cut('merchantOrderAttentionSummary')+'\n'+cut('merchantOrderQueueView')+';this.draw=merchantOrderQueueView;',queue);
const orders=[
 {orderId:'prep',status:'PREPARING'},
 {orderId:'later',status:'OFFERED_TO_MERCHANT',offerExpiresAt:'2026-10-12T20:00:00Z'},
 {orderId:'travel',status:'OUT_FOR_DELIVERY'},
 {orderId:'earlier',status:'OFFERED_TO_MERCHANT',offerExpiresAt:'2026-10-12T19:00:00Z'},
 {orderId:'risk',status:'AT_RISK'},
 {orderId:'arrival',status:'ARRIVING'},
 {orderId:'accepted',status:'MERCHANT_ACCEPTED'},
 {orderId:'other',status:'UNKNOWN_STATE'}
];
const html=queue.draw(orders);
for(const id of orders.map(o=>o.orderId)){
 assert.equal(html.split('data-id="'+id+'"').length-1,1,'order listed once '+id);
}
for(const key of ['offers','risk','delivery','preparing','other'])
 assert.ok(html.includes('merchant-order-group-'+key),'group '+key);
assert.ok(html.indexOf('merchant-order-group-offers')<html.indexOf('merchant-order-group-risk'));
assert.ok(html.indexOf('merchant-order-group-risk')<html.indexOf('merchant-order-group-delivery'));
assert.ok(html.indexOf('data-id="earlier"')<html.indexOf('data-id="later"'),'Earlier offer first');
assert.ok(!queue.draw([orders[2]]).includes('data-id="prep"'),'Driver-scoped subset stays private');
assert.ok(queue.draw([],'Sem pedido <b>hoje</b>').includes('&lt;b&gt;'),'Empty state escaped');
assert.ok(queue.draw([{orderId:'dated',status:'OFFERED_TO_MERCHANT',offerExpiresAt:'2026-10-12T18:00:00Z'},
 {orderId:'undated',status:'OFFERED_TO_MERCHANT',offerExpiresAt:'invalid'}])
 .indexOf('data-id="dated"')<queue.draw([{orderId:'dated',status:'OFFERED_TO_MERCHANT',offerExpiresAt:'2026-10-12T18:00:00Z'},
 {orderId:'undated',status:'OFFERED_TO_MERCHANT',offerExpiresAt:'invalid'}]).indexOf('data-id="undated"'));

const runtime={merchant:{memberRole:'operator'},deliveryTeam:[],actionPending:false};
const cardCtx=vm.createContext({globalThis:{merchantRuntime:runtime},esc,BRL:{format:v=>'R$ '+Number(v).toFixed(2)},
 statusCopy:{},paymentLabel:()=> 'Pix',merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
 merchantDeliveryMemberLabel:()=> 'Entregador',merchantFormatPhone:v=>String(v),merchantDeliveryShortcuts:()=>''});
vm.runInContext(cut('merchantDeliveryCandidates')+'\n'+cut('merchantOrderEventDate')+'\n'+cut('merchantOrderScheduleDate')+'\n'+cut('merchantOrderProgressView')+'\n'+cut('merchantOrderAttention')+'\n'+cut('merchantOrderAttentionCard')+'\n'+cut('merchantIncidentAdvice')+'\n'+cut('merchantIncidentRiskGuide')+'\n'+cut('merchantLiveOrder')+';this.card=merchantLiveOrder;',cardCtx);
const item={
 orderId:'11111111-1111-4111-8111-111111111111',publicCode:'TAM-1234',status:'PREPARING',
 items:[{quantity:1,productName:'Gás 13 kg'}],totalCents:12000,
 address:'Rua A, 12',addressVisible:true,deliveryDetailsVisible:true,
 customerPhone:'51900000000',paymentMethod:'pix'
};
let card=cardCtx.card(item);
assert.ok(card.includes('merchant-order-action-fieldset'));
assert.ok(card.includes('merchant-order-contact'));
assert.ok(!card.includes('class="merchant-order-contact" open'),'Contact collapsed in preparation');
assert.ok(card.includes('Confirmar saída')&&card.includes('merchantLiveCannotFulfill('));
item.status='OUT_FOR_DELIVERY';card=cardCtx.card(item);
assert.ok(card.includes('class="merchant-order-contact" open'));
assert.ok(card.includes('Estou chegando'));
item.status='ARRIVING';card=cardCtx.card(item);
assert.ok(card.includes('Pagamento recebido')&&card.includes('live-pin-'));
assert.ok(card.includes('Confirmar entrega'));
runtime.actionPending=true;card=cardCtx.card(item);
assert.ok(card.includes('merchant-order-action-fieldset" disabled'));
runtime.actionPending=false;item.deliveryDetailsVisible=false;
assert.ok(!cardCtx.card(item).includes('merchant-order-contact'));
item.status='OFFERED_TO_MERCHANT';item.offerExpiresAt=new Date(Date.now()+12*60000).toISOString();card=cardCtx.card(item);
assert.ok(card.includes('Aceitar pedido')&&card.includes('Não consigo atender'));

let calls=0;const messages=[];
const action=vm.createContext({globalThis:{merchantRuntime:{actionPending:true}},
 merchantPerformAction:async()=>{calls++;return {}},toast:v=>messages.push(String(v))});
vm.runInContext(cut('merchantPostActionConfirmation')+'\n'+cut('merchantLiveAction',true)+';this.run=merchantLiveAction;',action);
await action.run(item.orderId,'accept');
assert.equal(calls,0,'No concurrent action');
assert.equal(messages.length,0,'No success toast when ignored');
action.globalThis.merchantRuntime.actionPending=false;
await action.run(item.orderId,'accept');
assert.equal(calls,1);
assert.equal(messages.at(-1),'Pedido aceito');
assert.ok(cut('merchantLivePage').includes('merchantOrderQueueView(orders)'));
assert.ok(cut('merchantLivePage').indexOf('id="merchant-live-orders"')<cut('merchantLivePage').indexOf('merchantSetupView(rt)'),
 'Live orders should appear before long setup details');
assert.ok(cut('merchantDriverLivePage').indexOf('Pedidos atribuídos a você')<cut('merchantDriverLivePage').indexOf('merchantAlertControl()'),
 'Assigned driver orders should appear before secondary profile and alert settings');
assert.ok(cut('merchantDriverLivePage').includes("merchantOrderQueueView(orders,'Nenhuma entrega atribuída a você agora.')"));
assert.ok(backend.includes('merchantRuntime.actionPending=true;'));
assert.ok(backend.includes('expectedVersion:order.version'));
assert.ok(css.includes('.merchant-order-queue-stats')&&css.includes('@media(max-width:540px)'));
console.log('V1.174: order grouping, urgency, driver scope, action locks, contact privacy and PIN/payment fields passed.');
