import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant.js'),css=read('css/components.css'),audit=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'js/merchant.js'});
const cut=name=>{
  const start=src.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing '+name);
  const end=src.indexOf('\n}',start);
  assert.ok(end>start,'Unterminated '+name);
  return src.slice(start,end+2);
};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now=Date.now(),when=min=>new Date(now+min*60_000).toISOString();
const order=(n,status,fields={})=>({orderId:id(n),publicCode:'TAM-'+n,status,...fields});
const focus={
 tagName:'ARTICLE',opened:false,focused:false,scrolled:false,
 focus(){this.focused=true},scrollIntoView(){this.scrolled=true}
};
const details={tagName:'DETAILS',open:false,parentElement:null};
focus.parentElement=details;
const ctx=vm.createContext({esc,document:{getElementById:key=>key==='merchant-order-card-'+id(111)?focus:null},
 merchantLiveOrder:o=>'<article data-order="'+esc(o.orderId)+'">'+esc(o.publicCode)+'</article>',
 merchantLiveRefresh:()=>{},Date});
vm.runInContext(['merchantOrderScheduleDate','merchantOrderAttention','merchantFocusLiveOrder',
 'merchantOrderAttentionSummary','merchantOrderQueueView'].map(cut).join('\n'),ctx);
assert.equal(ctx.merchantFocusLiveOrder(id(111)),true);
assert.ok(details.open&&focus.focused&&focus.scrolled,'Hidden order should reopen before focus');
assert.equal(ctx.merchantFocusLiveOrder("x');alert(1)//"),false);
assert.equal(ctx.merchantFocusLiveOrder(id(112)),false);

const urgent=order(1,'PREPARING',{dispatchDueAt:when(-15)});
const soon=order(2,'PREPARING',{dispatchDueAt:when(5)});
const risk=order(3,'AT_RISK');
const lateEarlier=order(4,'OUT_FOR_DELIVERY',{promisedBy:when(-35)});
const lateLater=order(5,'OUT_FOR_DELIVERY',{promisedBy:when(-5)});
const signals=ctx.merchantOrderAttentionSummary([soon,lateLater,risk,lateEarlier,urgent]);
assert.match(signals,/5 pedidos merecem atenção/);
assert.match(signals,/1 imprevisto\(s\)/);
assert.match(signals,/3 prazo\(s\) para revisar/);
assert.match(signals,/1 prazo\(s\) próximo\(s\)/);
assert.ok(signals.indexOf('TAM-3')<signals.indexOf('TAM-4'));
assert.ok(signals.indexOf('TAM-4')<signals.indexOf('TAM-5'),'Older past-due forecasts first');
assert.ok(signals.indexOf('TAM-5')<signals.indexOf('TAM-2'),'Past-due before upcoming');
assert.match(signals,/Confira a situação antes de agir/);
assert.equal(ctx.merchantOrderAttentionSummary([order(20,'PREPARING')]),'');

const preparations=[
 order(11,'PREPARING'),order(12,'PREPARING'),order(13,'PREPARING'),
 order(14,'PREPARING'),order(15,'PREPARING'),order(16,'PREPARING'),
 order(17,'PREPARING',{dispatchDueAt:when(-12)}),
 order(18,'PREPARING',{dispatchDueAt:when(5)})
];
const preparationHtml=ctx.merchantOrderQueueView(preparations);
assert.match(preparationHtml,/merchant-order-queue-overflow/);
assert.match(preparationHtml,/Ver mais 5 pedido\(s\) nesta etapa/);
const extra=preparationHtml.indexOf('<details class="merchant-order-queue-overflow">');
assert.ok(extra>=0);
assert.ok(preparationHtml.indexOf('TAM-17')<extra);
assert.ok(preparationHtml.indexOf('TAM-18')<extra,'Deadline needing attention remains visible');
for(const item of preparations)
 assert.equal((preparationHtml.match(new RegExp('data-order="'+item.orderId+'"','g'))||[]).length,1);

const offers=Array.from({length:8},(_,i)=>order(30+i,'OFFERED_TO_MERCHANT',{offerExpiresAt:when(30+i)}));
const offersHtml=ctx.merchantOrderQueueView(offers);
assert.doesNotMatch(offersHtml,/merchant-order-queue-overflow/,'Offers always visible');
assert.equal((offersHtml.match(/<article/g)||[]).length,8);
const risks=Array.from({length:8},(_,i)=>order(50+i,'AT_RISK'));
assert.doesNotMatch(ctx.merchantOrderQueueView(risks),/merchant-order-queue-overflow/,'Incidents always visible');

const deliveries=[
 order(70,'ARRIVING'),order(71,'OUT_FOR_DELIVERY'),
 order(72,'OUT_FOR_DELIVERY'),order(73,'OUT_FOR_DELIVERY'),
 order(74,'OUT_FOR_DELIVERY'),order(75,'OUT_FOR_DELIVERY'),
 order(76,'OUT_FOR_DELIVERY',{promisedBy:when(-7)})
];
const deliveryHtml=ctx.merchantOrderQueueView(deliveries);
const more=deliveryHtml.indexOf('<details class="merchant-order-queue-overflow">');
assert.ok(more>0);
assert.ok(deliveryHtml.indexOf('TAM-70')<more);
assert.ok(deliveryHtml.indexOf('TAM-76')<more);
for(const item of deliveries)
 assert.equal((deliveryHtml.match(new RegExp('data-order="'+item.orderId+'"','g'))||[]).length,1);
assert.match(ctx.merchantOrderQueueView([],'Sem pedidos <b>agora</b>'),/&lt;b&gt;agora&lt;\/b&gt;/);

const role={merchant:{memberRole:'owner'},deliveryTeam:[],actionPending:false};
const cardCtx=vm.createContext({globalThis:{merchantRuntime:role},esc,
 BRL:{format:v=>'R$ '+Number(v).toFixed(2)},statusCopy:{},paymentLabel:()=> 'Pix',
 merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
 merchantDeliveryCandidates:()=>[],merchantDeliveryMemberLabel:()=> 'Entregador',
 merchantOrderAttentionCard:()=>'',merchantIncidentRiskGuide:()=>'',merchantOrderProgressView:()=> '',
 merchantDeliveryShortcuts:()=>'',merchantFormatPhone:v=>String(v)});
vm.runInContext(cut('merchantLiveOrder'),cardCtx);
const card=o=>cardCtx.merchantLiveOrder({...order(91,'OFFERED_TO_MERCHANT'),items:[],
 totalCents:15000,paymentMethod:'pix',...o});
const expired=card({offerExpiresAt:when(-3)});
assert.match(expired,/Prazo desta oferta encerrado/);
assert.match(expired,/Atualizar pedidos/);
assert.doesNotMatch(expired,/Aceitar pedido|Não consigo atender/);
assert.doesNotMatch(expired,/merchantLiveAction\(/);
const valid=card({offerExpiresAt:when(3)});
assert.match(valid,/Aceitar pedido/);
assert.match(valid,/Não consigo atender/);
assert.doesNotMatch(valid,/Prazo desta oferta encerrado/);
const absent=card({offerExpiresAt:null});
assert.match(absent,/Prazo não informado/);
assert.match(absent,/Aceitar pedido/);
const invalid=card({offerExpiresAt:'invalid-date'});
assert.match(invalid,/Prazo não informado/);
const arrival=card({status:'ARRIVING'});
assert.match(arrival,/Pagamento recebido/);
assert.match(arrival,/live-pin-/);
assert.match(arrival,/Confirmar entrega/);
assert.match(css,/\.merchant-order-queue-overflow>summary:focus-visible/);
assert.match(css,/\.merchant-offer-expired/);
assert.match(audit,/node tests\/merchant-attention-compact-v1-274.mjs/);
console.log('V1.274 PASS: urgency-aware queue, accessible overflow, safe stale offers, full order coverage.');
