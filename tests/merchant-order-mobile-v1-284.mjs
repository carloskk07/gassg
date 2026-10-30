import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=load('js/merchant.js'),css=load('css/components.css'),workflow=load('.github/workflows/audit.yml');
new vm.Script(src,{filename:'merchant.js'});
const at=src.indexOf('function merchantLiveOrder('),end=src.indexOf('\n}',at);
assert.ok(at>0&&end>at);
const source=src.slice(at,end+2);
const benefitAt=src.indexOf('function merchantOrderBenefitDisclosure(');
const benefitEnd=src.indexOf('\n}',benefitAt);
assert.ok(benefitAt>0&&benefitEnd>benefitAt);
const benefitSource=src.slice(benefitAt,benefitEnd+2);
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
vm.runInContext(benefitSource+'\n'+source+'\nthis.card=merchantLiveOrder;',ctx);
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
assert.doesNotMatch(html,/merchant-benefit-disclosure/,'normal order must stay compact');
// Live order: merchant receives a real gross/payable/cashback snapshot,
// but the order contains NO documented sponsor, fee waiver or compensation.
const discounted={...order,grossTotalCents:13000,cashbackReservedCents:750,couponAppliedCents:0,totalCents:12250};
html=ctx.card(discounted);
for(const value of [
 'merchant-benefit-disclosure','Benefícios usados pelo cliente','R$ 130.00',
 'R$ 7.50','R$ 122.50','Compensação à revenda: não comprovada',
 'Taxa TAMÃO e reembolso','Patrocínio:','não comprovado',
 'Desconto ou isenção da taxa TAMÃO:'
])assert.ok(html.includes(value),'missing live order financing disclosure: '+value);
assert.ok(html.indexOf('merchant-benefit-disclosure')<html.indexOf('merchant-order-action-fieldset'),
 'partner must see discount explanation BEFORE accepting');
assert.doesNotMatch(html,/Patrocínio: confirmado|Reembolso garantido|Isenção aprovada/);
assert.ok(html.includes('Pagamento: Pix'));
assert.match(html,/Cupom pago Clube TAMÃO aplicado: <strong>R\$ 0\.00<\/strong>/,
 'ordinary cashback cannot be represented as a paid coupon');
html=ctx.card({...discounted,couponAppliedCents:500});
assert.match(html,/Cupom pago Clube TAMÃO aplicado: <strong>R\$ 5\.00<\/strong>/);
assert.match(html,/Cashback de outros saldos: <strong>R\$ 2\.50<\/strong>/);
assert.match(html,/NÃO confirma que a revenda já recebeu o reembolso/);
html=ctx.card({...discounted,couponAppliedCents:800});
assert.match(html,/Origem dos benefícios inconsistente ou indisponível/,
 'a claimed coupon greater than all reserved benefits must fail closed');
html=ctx.card({...discounted,grossTotalCents:'13000',cashbackReservedCents:'750',totalCents:'12250'});
assert.match(html,/Benefícios usados pelo cliente/,'numeric-string cents must be recognized');
html=ctx.card({...discounted,totalCents:11500});
assert.match(html,/Valores divergentes/,'inconsistent gross, benefit, payable must be visible');
html=ctx.card({...discounted,grossTotalCents:null});
assert.match(html,/Dados incompletos/);
assert.doesNotMatch(html,/Preço antes dos benefícios: <strong>R\$ 0.00/,'missing gross not zero');
html=ctx.card({...discounted,cashbackReservedCents:0,totalCents:13000});
assert.doesNotMatch(html,/merchant-benefit-disclosure/,'no benefit must not clutter mobile layout');
// Same disclosure is on the actual in-browser merchant simulator, not just live Auth.
const demoAt=src.indexOf('function merchantOrder(o){');
const demoEnd=src.indexOf('\n}',demoAt);
assert.ok(demoAt>0&&demoEnd>demoAt);
const demoCtx=vm.createContext({
 Date,esc:escapeText,BRL:{format:x=>'R$ '+Number(x).toFixed(2)},
 statusCopy:{OFFERED_TO_MERCHANT:['Recebido','']},
 paymentLabel:()=> 'Dinheiro',
 products:{P13:{name:'Gás P13'}}
});
vm.runInContext(benefitSource+'\n'+src.slice(demoAt,demoEnd+2)+
 '\nthis.card=merchantOrder;',demoCtx);
const demoOrder={id:'SG-TEST',status:'OFFERED_TO_MERCHANT',
 offerExpiresAt:minutes(10),items:[{qty:1,name:'Gás P13'}],
 cart:{P13:1},grossTotal:120,cashbackReserved:7.5,total:112.5,
 address:'Rua Fictícia',paymentMethod:'cash'};
const demoHtml=demoCtx.card(demoOrder);
for(const value of ['R$ 120.00','R$ 7.50','R$ 112.50',
 'Compensação à revenda: não comprovada',
 'nenhum dinheiro ou crédito real é movimentado neste simulador']){
 assert.ok(demoHtml.includes(value),'missing actual simulator disclosure '+value);
}
assert.ok(demoHtml.indexOf('merchant-benefit-disclosure')<
 demoHtml.indexOf('Aceitar pedido'),'financing summary precedes merchant acceptance');
assert.doesNotMatch(demoCtx.card({...demoOrder,cashbackReserved:0,total:120}),
 /merchant-benefit-disclosure/);
assert.doesNotMatch(benefitSource,/\.rpc\(|\.insert\(|\.update\(|merchantCompleteDeliveryLive\(/,
 'the disclosure is read-only and does not create a refund, fee adjustment or promotion');
order.offerExpiresAt=minutes(-5);
html=ctx.card(order);
assert.match(html,/horário já passou/);
assert.match(html,/Prazo desta oferta encerrado/);
assert.doesNotMatch(html,/Aceitar pedido/);
order.offerExpiresAt='invalid';
html=ctx.card(order);
assert.doesNotMatch(html,/Limite da oferta/);
assert.match(html,/Prazo sem confirmação/);
assert.doesNotMatch(html,/Aceitar pedido|Não consigo atender/,'Invalid expiry must not permit an unverified offer response');
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
