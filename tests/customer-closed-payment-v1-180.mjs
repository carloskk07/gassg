import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/customer.js'),css=read('css/components.css');
new vm.Script(js,{filename:'js/customer.js'});
const start=js.indexOf('const statusCopy={'),end=js.indexOf('\nfunction tracking(){',start);
assert.ok(start>=0&&end>start,'Live tracking source not found');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const rt={status:'ready',error:null,actionPending:false,order:null};
const ctx=vm.createContext({
  globalThis:{liveReady:()=>true,liveRuntime:rt},
  liveRuntime:rt,BRL:{format:n=>'R$ '+Number(n).toFixed(2).replace('.',',')},
  esc,shell:s=>s,toasts:[],toast:()=>{},paymentLabel:()=> 'Pix',
  formatDeliveryWindow:()=> 'Hoje, entre 15h e 17h',
  formatDeliveryPhone:()=> '***',hhmm:()=> '14:30'
});
vm.runInContext(js.slice(start,end),ctx);
const render=(status,extra={})=>{
  rt.error=null;rt.actionPending=false;
  rt.order={
    orderId:'11111111-1111-4111-8111-111111111111',publicCode:'TAM-180',
    status,financialState:'pending',paymentMethod:'pix',paymentTiming:'prepaid',
    totalCents:12000,supplierName:'Fornecedor Anterior',items:[],events:[],supportCases:[],
    onlinePayment:{available:false,canStart:false,status:'not_available',checkoutUrl:null},
    ...extra
  };
  return vm.runInContext('liveTracking()',ctx);
};
const notice=(order)=>vm.runInContext('customerInterruptedPaymentView('+JSON.stringify(order)+')',ctx);

let html=render('REASSIGNING');
assert.ok(html.includes('Seu pedido está sendo reavaliado'));
assert.ok(html.includes('Situação do pagamento ainda não confirmada'));
assert.ok(html.includes('Esta consulta não confirma cobrança nem reembolso'));
assert.ok(html.includes('Uma nova revenda ainda não foi confirmada'));
assert.ok(!html.includes('Fornecedor Anterior'),'No false accepted supplier');
assert.ok(!html.includes('Pagar com Mercado Pago')&&!html.includes('Continuar pagamento'),
  'Do not initiate direct payment while supplier is being reassigned');
assert.ok(!html.includes('Reembolso confirmado pelo provedor'));
assert.ok(!html.includes('customer-closed-next'),'No retry order action while matching still underway');

html=render('CANCELLED');
assert.ok(html.includes('Pedido encerrado'));
assert.ok(html.includes('Consultar novas ofertas'));
assert.ok(html.includes("onclick=\"go('home')\""),'New search is explicit, not duplicate order');
assert.ok(html.includes('Preciso de ajuda com este pedido'));
assert.ok(html.includes('href="#customer-care"'));
assert.ok(html.includes('id="customer-care"'));
assert.ok(html.includes('Situação do pagamento ainda não confirmada'));
assert.ok(!html.includes('é devolvido pelo ledger'),'Do not assert cashback refund without evidence');
assert.ok(!html.includes('Reembolso confirmado pelo provedor'));
assert.ok(!html.includes('Fornecedor Anterior'));
assert.ok(!html.includes('Código de recebimento'));

html=render('CANCELLED',{onlinePayment:{status:'refunded',refundedAt:'2026-10-12T12:00:00Z'}});
assert.ok(html.includes('Reembolso confirmado pelo provedor'));
assert.ok(html.includes('reversão informada pelo provedor'));
assert.ok(!html.includes('Situação do pagamento ainda não confirmada'));

html=render('CANCELLED',{onlinePayment:{status:'approved',approvedAt:'2026-10-12T11:00:00Z'}});
assert.ok(html.includes('Transação aprovada anteriormente'));
assert.ok(html.includes('não há confirmação de reembolso'));
assert.ok(!html.includes('class="notice success" style="margin-top:14px"><strong>Pagamento confirmado pela revenda.'));
assert.ok(!html.includes('Reembolso confirmado pelo provedor'));

html=render('CANCELLED',{onlinePayment:{status:'review_required'}});
assert.ok(html.includes('Pagamento em revisão'));
assert.ok(html.includes('Não considere um reembolso concluído'));
assert.ok(!html.includes('Reembolso confirmado pelo provedor'));

html=render('CANCELLED',{paymentMethod:'cash',paymentTiming:'on_delivery',
  onlinePayment:{status:'not_available'}});
assert.ok(html.includes('Pagamento previsto na entrega'));
assert.ok(html.includes('Esta consulta não indica um pagamento antecipado confirmado'));
assert.ok(!html.includes('Reembolso confirmado pelo provedor'));

html=render('CANCELLED',{paymentMethod:'pix',paymentTiming:null,
  onlinePayment:{status:'not_available'}});
assert.ok(html.includes('Situação do pagamento ainda não confirmada'));
assert.ok(!html.includes('Pagamento previsto na entrega'),'Missing timing cannot imply pay on delivery');

html=render('REASSIGNING',{
  paymentTiming:'prepaid',onlinePayment:{available:true,canStart:true,status:'checkout_ready',
    checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123'}
});
assert.ok(!html.includes('Continuar pagamento'),'No inactive merchant payment CTA during reassigning');
assert.ok(html.includes('Situação do pagamento ainda não confirmada'));

html=render('REASSIGNING',{onlinePayment:{status:'approved'}});
assert.ok(html.includes('Transação aprovada anteriormente'));
assert.ok(!html.includes('Reembolso confirmado pelo provedor'));

for(const status of ['PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED']){
  html=render(status);
  assert.ok(!html.includes('customer-interrupted-payment'),'No payment incident panel for '+status);
  assert.ok(!html.includes('customer-closed-next'),'No retry panel for '+status);
}
html=render('PREPARING',{onlinePayment:{available:true,canStart:true,status:'not_started'}});
assert.ok(html.includes('Pagar com Mercado Pago'),'Existing merchant payment flow retained during normal order');

const payment=notice({status:'CANCELLED',paymentMethod:'pix',paymentTiming:'prepaid',
 onlinePayment:{status:'<img src=x onerror=alert(1)>'}});
assert.ok(!payment.includes('<img src=x onerror=alert(1)>'),'Provider data never injected to HTML');
assert.ok(payment.includes('Situação do pagamento ainda não confirmada'));

assert.equal(vm.runInContext("customerClosedOrderChoices({status:'REASSIGNING'})",ctx),'');
assert.equal(vm.runInContext("customerInterruptedPaymentView({status:'SETTLED'})",ctx),'');
assert.ok(css.includes('.customer-interrupted-payment'));
assert.ok(css.includes('.customer-closed-next-actions'));
assert.ok(css.includes('@media(max-width:520px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/customer-closed-payment-v1-180.mjs'));
console.log('V1.180: cancelled/reassigning payment truth, recorded refunds, safe future purchase and mobile support passed.');
