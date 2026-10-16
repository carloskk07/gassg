import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js');
const backend=read('js/backend.js');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(customer,{filename:'customer.js'});
new vm.Script(backend,{filename:'backend.js'});
const i=customer.indexOf('function customerTrackingReadEvidence(');
const j=customer.indexOf('\nfunction liveCustomerCareBlock(',i);
assert.ok(i>=0&&j>i,'tracking evidence and action model must remain separate pure functions');
const helpers=customer.slice(i,j);
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({esc});
vm.runInContext(helpers+'\nthis.evidence=customerTrackingReadEvidence;this.action=customerTrackingPrimaryAction;',ctx);
const now=Date.parse('2026-10-16T20:00:00Z');
const order={orderId:'order-8',status:'OFFERED_TO_MERCHANT'};
const evidence=(delta,id=order.orderId,error=false)=>ctx.evidence(order,{
 checkedAt:new Date(now+delta).toISOString(),checkedId:id,now,error});
assert.equal(evidence(-1000).kind,'recent');
assert.equal(evidence(-2*60*1000).kind,'recent');
assert.equal(evidence(-3*60*1000).kind,'stale');
assert.equal(evidence(-12*60*1000).kind,'stale');
assert.equal(evidence(-500,'another-order').kind,'unknown');
assert.equal(evidence(2*60*1000).kind,'unknown','future clock cannot certify an order read');
assert.equal(evidence(-1000,order.orderId,true).kind,'unverified');
assert.equal(ctx.evidence(order,{now}).kind,'unknown');
assert.equal(ctx.evidence(order,{checkedId:order.orderId,checkedAt:'not-date',now}).kind,'unknown');
const recent=evidence(-1000),stale=evidence(-9*60*1000);
const action=(status,{ev=recent,pending=false,proposal=null,seconds=null,pin=null}={})=>
 ctx.action({orderId:order.orderId,status,proposedTotalCents:proposal,deliveryPin:pin},
 {evidence:ev,pending,remainingSeconds:seconds});
assert.match(action('REQUOTE_REQUIRED',{proposal:13000,seconds:70}),/href="#customer-requote-decision"/);
assert.doesNotMatch(action('REQUOTE_REQUIRED',{proposal:13000,seconds:0}),/href="#customer-requote-decision"/);
assert.match(action('REQUOTE_REQUIRED',{proposal:13000,seconds:0}),/Atualizar proposta/);
assert.match(action('REQUOTE_REQUIRED',{proposal:null,seconds:60}),/Atualizar proposta/);
assert.match(action('REQUOTE_REQUIRED',{proposal:13000,seconds:60,ev:stale}),/Atualizar pedido/);
assert.match(action('AT_RISK'),/href="#customer-care"/);
assert.match(action('OFFERED_TO_MERCHANT'),/Conferir aceite/);
assert.match(action('REASSIGNING'),/Atualizar andamento/);
assert.match(action('PREPARING'),/href="#customer-history"/);
assert.match(action('OUT_FOR_DELIVERY',{pin:'4372'}),/href="#customer-delivery-code"/);
assert.doesNotMatch(action('OUT_FOR_DELIVERY'),/href="#customer-delivery-code"/);
assert.match(action('OUT_FOR_DELIVERY'),/href="#customer-history"/);
assert.match(action('ARRIVING',{pin:'4372'}),/href="#customer-delivery-code"/);
assert.match(action('SETTLED'),/Avaliar ou pedir ajuda/);
assert.match(action('CANCELLED'),/Ajuda sobre este pedido/);
assert.match(action('SETTLED',{ev:stale}),/Atualizar pedido/,
 'stale order status must not be presented as fresh');
assert.match(action('PREPARING',{ev:stale,pending:true}),/disabled/,
 'ongoing mutation must block concurrent manual refresh');
assert.doesNotMatch(helpers,/adminPerform\(|liveCustomerAction\(|confirmRequote\(/,
 'next-step shortcut must not approve, cancel or change a financial state');
const source=customer.slice(customer.indexOf('const statusCopy={'),
 customer.indexOf('\nfunction tracking(){',customer.indexOf('function liveTracking(){')));
const runtime={
 status:'ready',error:null,actionPending:false,order:null,
 orderCheckedAt:new Date().toISOString(),orderCheckedId:'order-8'
};
const viewCtx=vm.createContext({
 globalThis:{liveReady:()=>true,liveRuntime:runtime},liveRuntime:runtime,
 shell:x=>x,esc,BRL:{format:x=>'R$ '+Number(x).toFixed(2).replace('.',',')},
 paymentLabel:x=>x||'Pix',formatDeliveryWindow:()=> 'Hoje entre 15h e 17h',
 formatDeliveryPhone:()=> '***',hhmm:()=> '12h'
});
vm.runInContext(source,viewCtx);
const render=(status,extras={})=>{
 runtime.error=null;
 runtime.order={orderId:'order-8',publicCode:'TAM-8',status,totalCents:12000,
  paymentMethod:'cash',postalCode:'97300000',address:'Rua Teste, 1',
  items:[{quantity:1,product_name:'Água 20L',line_total_cents:12000}],
  events:[],supportCases:[],...extras};
 runtime.orderCheckedId='order-8';
 runtime.orderCheckedAt=new Date().toISOString();
 return vm.runInContext('liveTracking()',viewCtx);
};
let markup=render('REQUOTE_REQUIRED',{
 proposedTotalCents:13500,offerExpiresAt:new Date(Date.now()+60000).toISOString()
});
assert.match(markup,/href="#customer-requote-decision"/);
assert.match(markup,/id="customer-requote-decision"/);
assert.match(markup,/Última consulta|consultado agora|consultado há/);
assert.match(markup,/O que fazer agora/);
assert.match(markup,/id="customer-history"/);
markup=render('AT_RISK');
assert.match(markup,/href="#customer-care"/);
assert.match(markup,/id="customer-care"/);
markup=render('OUT_FOR_DELIVERY',{deliveryPin:'4372'});
assert.match(markup,/href="#customer-delivery-code"/);
assert.match(markup,/id="customer-delivery-code"/);
assert.match(markup,/Código de recebimento: 4372/);
markup=render('OFFERED_TO_MERCHANT');
assert.doesNotMatch(markup,/Código de recebimento: 4372/);
runtime.orderCheckedAt=new Date(Date.now()-10*60*1000).toISOString();
markup=vm.runInContext('liveTracking()',viewCtx);
assert.match(markup,/Atualize antes de tomar uma decisão/);
assert.doesNotMatch(markup,/Pedido consultado agora/);
runtime.orderCheckedId='another-order';
markup=vm.runInContext('liveTracking()',viewCtx);
assert.match(markup,/Ainda não há horário comprovado/);
runtime.error='offline';
markup=vm.runInContext('liveTracking()',viewCtx);
assert.match(markup,/Não conseguimos confirmar mudanças recentes/);
assert.match(markup,/Acompanhamento temporariamente sem conexão/);
assert.match(backend,/orderCheckedAt:null,/);
assert.match(backend,/orderCheckedId:null,/);
const backendGetOrder=backend.slice(backend.indexOf('async function liveGetOrder('),
 backend.indexOf('async function liveStartMerchantPayment(',backend.indexOf('async function liveGetOrder(')));
assert.match(backendGetOrder,/liveRuntime\.orderCheckedAt=liveRuntime\.lastSyncAt;/);
assert.match(backendGetOrder,/liveRuntime\.orderCheckedId=order\.orderId;/);
assert.ok(backendGetOrder.indexOf('liveRuntime.orderCheckedId=order.orderId')>
 backendGetOrder.indexOf('liveRuntime.order=order'),'only accepted response stamps the order');
for(const marker of ['.customer-tracking-actions','.customer-tracking-evidence.stale',
 '#customer-requote-decision:target','@media(max-width:620px)',
 '.customer-tracking-actions .primary:focus-visible']){
 assert.ok(css.includes(marker),'missing accessible compact tracking guidance: '+marker);
}
assert.ok(audit.includes('node tests/buyer-tracking-action-v1-352.mjs'));
console.log('TAMÃO V1.352 PASS — verified order freshness, safe status-specific navigation, hidden PIN boundary, stale proof, mobile and role-safe actions.');
