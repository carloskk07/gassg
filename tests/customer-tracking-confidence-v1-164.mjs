import assert from 'node:assert/strict';
import {pixFixture} from './helpers/pix-fixture.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/customer.js');
const css=read('css/components.css');
const start=source.indexOf('const statusCopy={');
const beforeCare=source.indexOf('function liveCustomerCareBlock(o){',start);
const trackingStart=source.indexOf('function liveTracking(){',beforeCare);
const trackingEnd=source.indexOf('\nfunction tracking(){',trackingStart);
assert.ok(start>0&&beforeCare>start&&trackingEnd>trackingStart,
 'Expected status authority, buyer guidance and tracking render');
const statusCode=source.slice(start,beforeCare);
const trackingCode=source.slice(trackingStart,trackingEnd);
const currency=value=>'R$ '+Number(value).toFixed(2).replace('.',',');
const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
 .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const runtime={
 status:'ready',error:null,actionPending:false,
 order:{},lastSyncAt:'2026-10-11T12:00:00'
};
const globals={liveReady:()=>true,liveRuntime:runtime};
const context=vm.createContext({
  globalThis:globals,liveRuntime:runtime,BRL:{format:currency},esc,
  shell:html=>html,toast:()=>{},paymentLabel:x=>x==='cash'?'Dinheiro':'Pix',
  formatDeliveryWindow:()=> 'Hoje entre 15h e 17h',
  formatDeliveryPhone:()=> '***',
  liveCustomerCareBlock:()=>'<div>Suporte vinculado ao pedido</div>',
  hhmm:()=> '12:00'
});
vm.runInContext(statusCode+'\n'+trackingCode,context);
const evaluate=code=>vm.runInContext(code,context);
function orderFor(status,rest={}){
 runtime.error=null;
 runtime.order={
  status,orderId:'00000000-0000-4000-8000-000000000042',
  publicCode:'TAM-42',totalCents:12000,paymentMethod:'cash',
  postalCode:'97300000',address:'Rua Teste, 42',
  items:[{quantity:1,product_name:'Água 20 L',line_total_cents:12000}],
  events:[],...rest
 };
 return evaluate('liveTracking()');
}
const milestones={
 CREATED:0,QUOTE_LOCKED:0,OFFERED_TO_MERCHANT:0,
 MERCHANT_ACCEPTED:1,PREPARING:1,AT_RISK:1,
 REASSIGNING:0,REQUOTE_REQUIRED:0,
 OUT_FOR_DELIVERY:2,ARRIVING:2,DELIVERED:3,SETTLED:3,
 CANCELLED:-1
};
for(const [status,expected] of Object.entries(milestones)){
  const result=JSON.parse(evaluate(
   'JSON.stringify(customerOrderMilestones('+JSON.stringify(status)+'))'));
  assert.equal(result.stage,expected,'Incorrect confirmed progress: '+status);
  const markup=orderFor(status);
  assert.ok(markup.includes('Suporte vinculado ao pedido'),'Care access lost for '+status);
  assert.ok(markup.includes('O que fazer agora'),'Missing explicit next action: '+status);
  assert.ok(!markup.includes('AO VIVO'),'Unconfirmed live status claim: '+status);
  if(status==='CANCELLED')assert.ok(!markup.includes('class="customer-progress"'),
   'Canceled order should not masquerade as an active delivery');
  else assert.ok(markup.includes('Etapas do pedido'),'Milestone view missing '+status);
  if(['CREATED','QUOTE_LOCKED','OFFERED_TO_MERCHANT','REASSIGNING','REQUOTE_REQUIRED'].includes(status)){
    assert.ok(!markup.includes('Código de recebimento'),'PIN cannot be displayed before dispatch');
  }
}
const submitted=orderFor('OFFERED_TO_MERCHANT',{offerExpiresAt:new Date(Date.now()+45000).toISOString()});
assert.ok(submitted.includes('Aguardando aceite da revenda'));
assert.ok(submitted.includes('A entrega ainda depende de aceite'));
assert.ok(!submitted.includes('até 3 minutos'),'No fixed deadline beyond backend evidence');
assert.ok(!submitted.includes('O parceiro confirmou a entrega'),'Never claim merchant accepted on submission');
const preparing=orderFor('PREPARING',{deliveryWindowStart:'2026-10-11T15:00:00',deliveryWindowEnd:'2026-10-11T17:00:00'});
assert.ok(preparing.includes('A saída ainda não foi confirmada'));
assert.ok(preparing.includes('Janela de entrega solicitada'));
const offeredSchedule=orderFor('OFFERED_TO_MERCHANT',{deliveryWindowStart:'2026-10-11T15:00:00'});
assert.ok(offeredSchedule.includes('Essa janela ainda depende da confirmação da revenda.'));
const requote=orderFor('REQUOTE_REQUIRED',{
 proposedTotalCents:13250,offerExpiresAt:new Date(Date.now()+100000).toISOString()
});
assert.ok(requote.includes('Valor anterior')&&requote.includes('R$ 120,00'));
assert.ok(requote.includes('Nova proposta')&&requote.includes('R$ 132,50'));
assert.ok(requote.includes('Aceitar proposta de R$ 132,50'));
assert.ok(requote.includes('data-order-id="00000000-0000-4000-8000-000000000042" onclick="confirmRequote(this.dataset.orderId)"'));
assert.ok(!requote.includes('confirmRequote(\'00000000'),'Server identifiers must not enter inline JS');
const expired=orderFor('REQUOTE_REQUIRED',{
 proposedTotalCents:13250,offerExpiresAt:new Date(Date.now()-10000).toISOString()
});
assert.ok(expired.includes('O prazo indicado terminou'));
assert.ok(expired.includes('onclick="confirmRequote(this.dataset.orderId)" disabled'));
assert.ok(expired.includes('Atualizar proposta'),'Customer must be able to refresh an expired requote');
const dispatched=orderFor('OUT_FOR_DELIVERY',{deliveryPin:'4931'});
assert.ok(dispatched.includes('Código de recebimento: 4931'));
assert.ok(dispatched.includes('Só compartilhe o código após receber e conferir a entrega.'));
assert.ok(!dispatched.includes('pedido concluído'),'Dispatch must not imply settled');
const arriving=orderFor('ARRIVING',{deliveryPin:'4832'});
assert.ok(arriving.includes('Código de recebimento: 4832'));
const delivered=orderFor('DELIVERED',{deliveryPin:'4832'});
assert.ok(!delivered.includes('Código de recebimento:'),
 'PIN must be removed from completed delivery screens');
assert.ok(delivered.includes('A conciliação financeira pode estar em processamento.'));
const settled=orderFor('SETTLED');
assert.ok(settled.includes('Pedido concluído'));
assert.ok(settled.includes('CONCLUÍDO'));
// Customer must distinguish a paid Clube coupon from other wallet benefits,
// including after cancellation. Never advertise the full benefit twice.
const couponTracking=orderFor('SETTLED',{
 cashbackReservedCents:650,couponAppliedCents:500,grossTotalCents:12650,totalCents:12000
});
assert.match(couponTracking,/R\$ 5,00 de cupom do Clube TAMÃO/);
assert.match(couponTracking,/R\$ 1,50 de outros benefícios/);
assert.doesNotMatch(couponTracking,/R\$ 6,50 de benefício usado/,
 'original gross benefit must not be counted a second time');
const cancelledCoupon=orderFor('CANCELLED',{
 cashbackReservedCents:500,couponAppliedCents:500,grossTotalCents:12500,totalCents:12000
});
assert.match(cancelledCoupon,/O valor original incluía R\$ 5,00 de cupom do Clube TAMÃO/,
 'cancelled order must not imply the coupon is currently spendable');
assert.doesNotMatch(cancelledCoupon,/R\$ 5,00 de benefício usado/);
const ordinaryBenefits=orderFor('SETTLED',{
 cashbackReservedCents:150,couponAppliedCents:0,grossTotalCents:12150,totalCents:12000
});
assert.match(ordinaryBenefits,/R\$ 1,50 de benefício usado/,
 'ordinary benefit display must remain unchanged without a paid coupon');
const lost=orderFor('AT_RISK',{riskReason:'Atraso observado <script>alert(1)</script>'});
assert.ok(lost.includes('Acompanhamento prioritário'));
assert.ok(!lost.includes('<script>'), 'Risk reasons must be escaped');
runtime.error='offline';
const offline=evaluate('liveTracking()');
assert.ok(offline.includes('Acompanhamento temporariamente sem conexão'));
assert.ok(offline.includes('VERIFIQUE O STATUS'));

assert.ok(css.includes('.customer-progress')&&css.includes('.customer-requote-prices')
  &&css.includes('@media(max-width:420px)')
  &&css.includes('.customer-tracking-overview'),
 'Accessible mobile statuses, progress and revised price comparison missing');
console.log('V1.164: verified milestone map, no false acceptance, safe quote approval, real PIN boundary, cancellation, offline and mobile UI passed.');

// The tracking panel and clipboard must refuse invalid or stale Pix evidence.
const pixCode=pixFixture(12000);
const core=read('js/core.js'),vstart=core.indexOf(' function valid(code,amountCents){'),vend=core.indexOf('\n function load(){',vstart);
assert.ok(vstart>=0&&vend>vstart);
const validate=vm.runInNewContext(core.slice(vstart,vend)+'\nvalid',{TextEncoder,TextDecoder});
globals.tamaoPixCodeValid=validate;
const pix={available:true,provider:'mercadopago',fundsOwner:'merchant',tamaoReceivesSaleProceeds:false,pixPayable:true,status:'pending',amountCents:12000,pixCode,expiresAt:new Date(Date.now()+3600000).toISOString()};
const pixOrder={paymentMethod:'pix',paymentTiming:'prepaid',onlinePayment:pix};
runtime.orderCheckedId='00000000-0000-4000-8000-000000000042';
runtime.orderCheckedAt=new Date(Date.now()-1000).toISOString();
assert.match(orderFor('PREPARING',pixOrder),/Pix copia e cola/);
for(const [status,extra] of [['SETTLED',{}],['DELIVERED',{}],['PREPARING',{paymentTiming:'on_delivery'}],['PREPARING',{onlinePayment:{...pix,fundsOwner:'platform'}}],['PREPARING',{onlinePayment:{...pix,provider:'other'}}]]){
 const html=orderFor(status,{...pixOrder,...extra});
 assert.doesNotMatch(html,/Pix copia e cola|Copiar código Pix/);
 assert.ok(!html.includes(pixCode));
}
runtime.orderCheckedAt=new Date(Date.now()-600000).toISOString();
assert.match(orderFor('PREPARING',pixOrder),/Pix aguardando conferência/);
assert.ok(!orderFor('PREPARING',pixOrder).includes(pixCode));
runtime.orderCheckedAt=new Date(Date.now()-1000).toISOString();
for(const payment of [{...pix,pixCode:pixFixture(12001)},{...pix,pixCode:pixCode.slice(0,-1)+'Z'},{...pix,expiresAt:'invalid'},{...pix,status:'not_started',canStart:true}]){
 const html=orderFor('PREPARING',{...pixOrder,onlinePayment:payment});
 assert.match(html,/Pix aguardando conferência/);
 assert.doesNotMatch(html,/Pix copia e cola|Copiar código Pix|Gerar Pix do pedido/);
 assert.ok(!html.includes(payment.pixCode));
}
delete globals.tamaoPixCodeValid;
assert.match(orderFor('PREPARING',pixOrder),/Pix aguardando conferência/);
const backend=read('js/backend.js'),copyStart=backend.indexOf('async function liveCopyOrderPix('),copyEnd=backend.indexOf('\n}',copyStart);
assert.ok(copyStart>=0&&copyEnd>copyStart);
async function copyCase({alter={},stale=false,error=false,switchSession=false}={}){
 const id='order-a',rt={session:{user:{id:'buyer'}},authGeneration:1,orderId:id};
 const written=[],notices=[];
 const order={orderId:id,status:'PREPARING',totalCents:12000,...pixOrder,...alter};
 const ctx=vm.createContext({liveRuntime:rt,liveReady:()=>true,render:()=>{},toast:v=>notices.push(v),
  tamaoPixCodeValid:validate,navigator:{clipboard:{writeText:async v=>written.push(v)}},
  liveGetOrder:async()=>{if(switchSession)rt.authGeneration++;if(error)throw Error('offline');
    rt.orderCheckedId=id;rt.orderCheckedAt=new Date(Date.now()-(stale?60000:0)).toISOString();return order;}});
 vm.runInContext(backend.slice(copyStart,copyEnd+2),ctx);
 const result=await ctx.liveCopyOrderPix(id);
 return {result,written,notices};
}
assert.deepEqual((await copyCase()).written,[pixCode]);
for(const options of [{stale:true},{error:true},{switchSession:true},{alter:{orderId:'other'}},{alter:{status:'CANCELLED'}},{alter:{onlinePayment:{...pix,expiresAt:'invalid'}}},{alter:{onlinePayment:{...pix,fundsOwner:'platform'}}},{alter:{onlinePayment:{...pix,provider:'other'}}}]){
 const x=await copyCase(options);assert.equal(x.result,false);assert.equal(x.written.length,0);
}
assert.equal((await copyCase({switchSession:true})).notices.length,0);
console.log('PASS: tracking hides unverified Pix and copy requires fresh current-order evidence.');
