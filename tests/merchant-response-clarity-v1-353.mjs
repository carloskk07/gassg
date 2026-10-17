import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant.js'),css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'js/merchant.js'});
const cut=name=>{
 const start=src.indexOf('function '+name+'(');
 const end=src.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,name+' missing');
 return src.slice(start,end+2);
};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
 .replaceAll('"','&quot;').replaceAll("'",'&#39;');
const now=Date.now();
const min=n=>new Date(now+n*60000).toISOString();
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const rows=[
 {orderId:uuid(1),publicCode:'N-1',status:'OFFERED_TO_MERCHANT',offerExpiresAt:min(3)},
 {orderId:uuid(2),publicCode:'N-2',status:'OFFERED_TO_MERCHANT',offerExpiresAt:min(-1)},
 {orderId:uuid(3),publicCode:'N-3',status:'OFFERED_TO_MERCHANT',offerExpiresAt:'invalid'},
 {orderId:uuid(4),publicCode:'N-4',status:'AT_RISK'},
 {orderId:uuid(5),publicCode:'N-5',status:'OUT_FOR_DELIVERY'},
 {orderId:uuid(6),publicCode:'N-6',status:'ARRIVING'},
 {orderId:uuid(7),publicCode:'N-7',status:'PREPARING'}
];
const ctx=vm.createContext({
 Date,Number,String,Array,Math,esc,
 globalThis:{merchantRuntime:{merchant:{memberRole:'operator'},orders:rows}},
 BRL:{format:x=>'R$ '+Number(x).toFixed(2)},
 merchantDailyVerifiedSales:()=>null,
 merchantOrderNextStepLabel:()=> 'Conferir aceite'
});
vm.runInContext(cut('merchantDailyFocusModel')+'\n'+
 cut('merchantDayQueuePulse')+'\n'+cut('merchantDayQueuePulseView')+'\n'+
 cut('merchantDailyOverview')+'\nthis.pulse=merchantDayQueuePulse;'+
 'this.view=merchantDayQueuePulseView;this.focus=merchantDailyFocusModel;'+
 'this.overview=merchantDailyOverview;',ctx);
const pulse=JSON.parse(vm.runInContext('JSON.stringify(pulse('+JSON.stringify(rows)+','+now+'))',ctx));
assert.equal(pulse.waiting,1,'valid future offers only');
assert.equal(pulse.refresh,2,'expired and invalid offers must be flagged');
assert.equal(pulse.incidents,1);
assert.equal(pulse.deliveries,2);
assert.equal(ctx.pulse([],now).waiting,0);
assert.equal(ctx.pulse([rows[1]],now).refresh,1);
assert.equal(ctx.focus(rows,now).order.orderId,uuid(1),
 'urgent valid offer ranks ahead of an incident for timely response');
assert.equal(ctx.focus(rows.slice(1),now).order.orderId,uuid(4),
 'invalid/expired offer never becomes a next accept action');
assert.equal(ctx.focus([rows[1],rows[2]],now).refresh,true);
const html=ctx.view(rows);
assert.match(html,/Resposta pendente/);
assert.match(html,/Imprevistos/);
assert.match(html,/Em entrega/);
assert.match(html,/2 ofertas precisam de nova consulta/);
assert.match(html,/Não aceite sem um prazo válido/);
assert.match(html,/merchantLiveRefresh\(\)/);
assert.doesNotMatch(html,/merchantLiveAction|merchantPerformAction/);
const overview=ctx.overview({merchant:{memberRole:'operator'}},rows);
assert.match(overview,/merchant-day-queue-pulse/);
assert.match(overview,/N-1/);
assert.doesNotMatch(overview,/Suas vendas|Vendas registradas/);
assert.match(ctx.view([{status:'OFFERED_TO_MERCHANT',offerExpiresAt:'2050-01-01T00:00:00Z'}]),/Resposta pendente/);
const cardCtx=vm.createContext({
 Date,Math,Number,String,Array,
 globalThis:{merchantRuntime:{merchant:{memberRole:'operator'},orders:rows,actionPending:false,deliveryTeam:[]}},
 esc,BRL:{format:x=>'R$ '+Number(x).toFixed(2)},statusCopy:{},paymentLabel:()=> 'Pix',
 merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
 merchantDeliveryCandidates:()=>[],merchantDeliveryMemberLabel:()=>'',merchantFormatPhone:()=> '',
 merchantDeliveryShortcuts:()=>'',merchantIncidentRiskGuide:()=>'',merchantOrderAttentionCard:()=> '',
 merchantOrderProgressView:()=>'<details><summary>Acompanhar etapas</summary></details>'
});
vm.runInContext(cut('merchantLiveOrder')+'\nthis.card=merchantLiveOrder;',cardCtx);
const order={orderId:uuid(1),status:'OFFERED_TO_MERCHANT',publicCode:'TAM-353',
 paymentMethod:'pix',items:[{quantity:1,productName:'Água 20 L'}],totalCents:12000,
 address:'Rua privada',addressVisible:false,deliveryDetailsVisible:false};
let card=cardCtx.card(order);
assert.match(card,/Prazo sem confirmação/);
assert.match(card,/Atualizar pedidos/);
assert.doesNotMatch(card,/Aceitar pedido|Não consigo atender/);
assert.doesNotMatch(card,/Rua privada/);
order.offerExpiresAt='not-a-date';
card=cardCtx.card(order);
assert.match(card,/Prazo sem confirmação/);
assert.doesNotMatch(card,/Aceitar pedido/);
order.offerExpiresAt=min(-1);
card=cardCtx.card(order);
assert.match(card,/Prazo desta oferta encerrado/);
assert.doesNotMatch(card,/Aceitar pedido/);
order.offerExpiresAt=min(3);
card=cardCtx.card(order);
assert.match(card,/Aceitar pedido/);
assert.match(card,/Não consigo atender/);
assert.match(card,/Prazo ~/);
assert.ok(card.includes("merchantLiveAction('"+order.orderId+"','accept')"));
cardCtx.globalThis.merchantRuntime.actionPending=true;
assert.match(cardCtx.card(order),/merchant-order-action-fieldset" disabled/,
 'concurrent mutation should disable the actions');
assert.ok(!cut('merchantLiveOrder').includes('merchantPerformAction('),
 'render must not accept or reject requests');
assert.match(src,/if\(Number\.isFinite\(expiry\)&&expiry>Date\.now\(\)\+1000\)target=actionButton\(\)/,
 'quick-focus should not select accept without a current response window');
assert.ok(css.includes('.merchant-day-queue-pulse')&&css.includes('.merchant-day-queue-warning'));
assert.ok(css.includes('@media(max-width:620px)'));
assert.ok(css.includes('.merchant-day-queue-warning button:focus-visible'));
assert.ok(audit.includes('node tests/merchant-response-clarity-v1-353.mjs'));
console.log('TAMÃO V1.353 PASS — offer windows fail closed, scoped queue counts, risk/response priorities, mobile and non-transactional summaries.');
