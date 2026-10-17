import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/merchant.js'),css=read('css/components.css'),backend=read('js/backend.js');
new vm.Script(source,{filename:'js/merchant.js'});
function extract(name){
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,'Missing '+name);
 const end=source.indexOf('\n}',start);
 assert.ok(end>start,name+' closing brace');
 return source.slice(start,end+2);
}
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const now=Date.now(),inMinutes=n=>new Date(now+n*60000).toISOString();
const id1='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
const id3='33333333-3333-4333-8333-333333333333';
const id4='44444444-4444-4444-8444-444444444444';
const ctx=vm.createContext({esc,document:{
 getElementById:()=>null
},merchantLiveRefresh:()=>{},merchantLiveOrder:o=>'<article data-order="'+esc(o.orderId)+'"></article>'});
vm.runInContext([
 'merchantOrderScheduleDate','merchantOrderAttention','merchantOrderAttentionSummary',
 'merchantOrderAttentionCard','merchantFocusLiveOrder','merchantOrderQueueView'
].map(extract).join('\n')+
 ';this.assess=merchantOrderAttention;this.summary=merchantOrderAttentionSummary;'+
 'this.badge=merchantOrderAttentionCard;this.focusOrder=merchantFocusLiveOrder;'+
 'this.queue=merchantOrderQueueView;',ctx);
const assess=(status,extra={})=>ctx.assess({status,...extra},now);
assert.equal(assess('PREPARING',{dispatchDueAt:inMinutes(-10)}).level,'late');
assert.equal(assess('PREPARING',{dispatchDueAt:inMinutes(5)}).level,'soon');
assert.equal(assess('PREPARING',{dispatchDueAt:inMinutes(16)}),null);
assert.equal(assess('PREPARING',{dispatchDueAt:inMinutes(100)}),null);
assert.equal(assess('PREPARING',{}),null,'Do not invent deadlines');
assert.equal(assess('PREPARING',{dispatchDueAt:'invalid'}),null);
assert.equal(assess('OUT_FOR_DELIVERY',{promisedBy:inMinutes(-8)}).level,'late');
assert.equal(assess('ARRIVING',{promisedBy:inMinutes(-1)}).level,'late');
assert.equal(assess('ARRIVING',{promisedBy:inMinutes(8)}).level,'soon');
assert.equal(assess('AT_RISK',{riskReason:'stock_issue'}).level,'risk');
assert.equal(assess('AT_RISK',{dispatchDueAt:inMinutes(-15)}).level,'risk');
assert.ok(assess('AT_RISK',{dispatchDueAt:inMinutes(-15)}).detail.includes('já passou'));
for(const status of ['MERCHANT_ACCEPTED','OFFERED_TO_MERCHANT','DELIVERED','CANCELLED','UNKNOWN']){
 assert.equal(assess(status,{dispatchDueAt:inMinutes(-5),promisedBy:inMinutes(-5)}),null,
  'No pending order deadline alarm in '+status);
}
const data=[
 {orderId:id1,publicCode:'TAM-1',status:'PREPARING',dispatchDueAt:inMinutes(7)},
 {orderId:id2,publicCode:'TAM-2',status:'OUT_FOR_DELIVERY',promisedBy:inMinutes(-3)},
 {orderId:id3,publicCode:'TAM-3',status:'AT_RISK',riskReason:'Problema operacional'},
 {orderId:id4,publicCode:'TAM-4',status:'PREPARING',dispatchDueAt:inMinutes(80)},
 {orderId:'complete',publicCode:'TAM-5',status:'DELIVERED',promisedBy:inMinutes(-60)}
];
const summary=ctx.summary(data);
assert.ok(summary.includes('3 pedidos merecem atenção'));
for(const expected of ['TAM-1','TAM-2','TAM-3'])assert.ok(summary.includes(expected));
assert.ok(!summary.includes('TAM-4')&&!summary.includes('TAM-5'));
assert.ok(summary.indexOf('TAM-3')<summary.indexOf('TAM-2'),'Risk first');
assert.ok(summary.indexOf('TAM-2')<summary.indexOf('TAM-1'),'Passed estimate before upcoming deadline');
assert.ok(summary.includes("merchantFocusLiveOrder('"+id1+"')"));
assert.ok(summary.includes('Atualizar pedidos'));
assert.ok(summary.includes('Confira a situação antes de agir'));
assert.equal(ctx.summary([]),'');
assert.equal(ctx.summary([data[0]]).includes('1 pedido merece atenção'),true);
const limited=ctx.summary(Array.from({length:8},(_,i)=>({
 orderId:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),
 status:'AT_RISK',publicCode:'Caso '+i
})));
assert.equal(limited.split('merchant-order-attention-item').length-1,5);
assert.ok(limited.includes('outros pedidos sinalizados'));
const injection=ctx.summary([{orderId:id1,publicCode:'<svg onload=alert(1)>',
 status:'AT_RISK'}]);
assert.ok(injection.includes('&lt;svg onload=alert(1)&gt;'));
assert.ok(!injection.includes('<svg onload=alert(1)>'));
assert.ok(ctx.badge({status:'PREPARING',dispatchDueAt:inMinutes(-10)})
 .includes('Este aviso não altera o pedido.'));
assert.equal(ctx.badge({status:'PREPARING'}),'');
const subset=ctx.queue([data[0]],'Nenhum pedido');
assert.ok(subset.includes('TAM-1')&&!subset.includes('TAM-2'),
 'Driver queue only has supplied server-scoped orders');
const card={focused:false,scrolled:false,
 focus(){this.focused=true},scrollIntoView(){this.scrolled=true}};
const dom=vm.createContext({document:{getElementById:key=>key==='merchant-order-card-'+id1?card:null}});
vm.runInContext(extract('merchantFocusLiveOrder')+';this.focusOrder=merchantFocusLiveOrder;',dom);
assert.equal(dom.focusOrder(id1),true);
assert.ok(card.focused&&card.scrolled);
assert.equal(dom.focusOrder("x');alert(1)//"),false);
assert.equal(dom.focusOrder(id4),false);

const merchant={merchant:{memberRole:'operator'},deliveryTeam:[],actionPending:false,orders:data};
const cardCtx=vm.createContext({globalThis:{merchantRuntime:merchant},esc,
 BRL:{format:x=>'R$ '+Number(x).toFixed(2)},statusCopy:{},paymentLabel:()=> 'Pix',
 merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
 merchantDeliveryMemberLabel:()=> 'Equipe',merchantFormatPhone:x=>String(x),merchantDeliveryShortcuts:()=>''});
vm.runInContext(['merchantDeliveryCandidates','merchantOrderEventDate','merchantOrderScheduleDate',
 'merchantOrderProgressView','merchantOrderAttention','merchantOrderAttentionCard','merchantIncidentAdvice','merchantIncidentRiskGuide','merchantLiveOrder']
 .map(extract).join('\n')+';this.renderCard=merchantLiveOrder;',cardCtx);
const order={...data[1],items:[],paymentMethod:'pix',totalCents:11990,
 addressVisible:false,deliveryDetailsVisible:false};
let html=cardCtx.renderCard(order);
assert.ok(html.includes('Revisar previsão de entrega'));
assert.ok(html.includes('A previsão registrada já passou'));
assert.ok(html.includes('Acompanhar etapas'));
assert.ok(!html.includes('Confirmar entrega'),'Do not skip PIN and arrival stage');
assert.ok(html.includes('Estou chegando'));
assert.ok(!html.includes('merchant-order-contact'),'No protected customer info leaked');
order.status='ARRIVING';html=cardCtx.renderCard(order);
assert.ok(html.includes('Pagamento recebido')&&html.includes('live-pin-'));
assert.ok(html.includes('Confirmar entrega'));
order.status='OFFERED_TO_MERCHANT';order.offerExpiresAt=inMinutes(8);html=cardCtx.renderCard(order);
assert.ok(!html.includes('merchant-order-attention-inline'));
assert.ok(html.includes('Aceitar pedido'));
assert.ok(backend.includes('expectedVersion:order.version'));
assert.ok(backend.includes('merchantRuntime.actionPending=true'));
assert.ok(css.includes('.merchant-order-attention-summary'));
assert.ok(css.includes('.merchant-order-attention-inline'));
assert.ok(css.includes('@media(max-width:540px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/merchant-order-attention-v1-177.mjs'));
console.log('V1.177: deadline windows, verified incidents, scoped summaries, escaping, focus, PIN and server authority passed.');
