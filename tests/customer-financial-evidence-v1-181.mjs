import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/customer.js');
const edge=read('supabase/functions/get-order/index.ts');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(js,{filename:'js/customer.js'});

const start=js.indexOf('const statusCopy={');
const stop=js.indexOf('\nfunction tracking(){',start);
assert.ok(start>=0&&stop>start);
const rt={order:null,status:'ready',error:null,actionPending:false};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
 .replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({
 globalThis:{liveReady:()=>true,liveRuntime:rt},liveRuntime:rt,
 esc,shell:x=>x,BRL:{format:v=>'R$ '+Number(v).toFixed(2).replace('.',',')},
 paymentLabel:()=> 'Pix',formatDeliveryWindow:()=> 'Hoje',
 formatDeliveryPhone:()=> '***',hhmm:()=> '15:00'
});
vm.runInContext(js.slice(start,stop),ctx);
const run=s=>vm.runInContext(s,ctx);
const stamp=new Date(Date.now()-36e5).toISOString();
const future=new Date(Date.now()+365*864e5).toISOString();
function render(status,onlinePayment,extra={}){
 rt.error=null;
 rt.order={status,publicCode:'TAM-181',
  orderId:'11111111-1111-4111-8111-111111111111',
  financialState:'pending',paymentMethod:'pix',paymentTiming:'prepaid',
  supplierName:'Revenda original',totalCents:15000,items:[],events:[],supportCases:[],
  onlinePayment,...extra};
 return run('liveTracking()');
}
let html=render('CANCELLED',{status:'refunded',provider:'mercadopago',
 refundedAt:stamp,approvedAt:stamp,amountCents:12990});
assert.ok(html.includes('Reembolso confirmado pelo provedor'));
assert.ok(html.includes('Informações do registro financeiro'));
assert.ok(html.includes('Mercado Pago'));
assert.ok(html.includes('Reembolso registrado para esta tentativa'));
assert.ok(html.includes('Registro de reembolso:'));
assert.ok(html.includes('R$ 129,90'),'Display amount from the attempt, not the order total');
assert.ok(html.includes('Não são um comprovante bancário'));
assert.ok(!html.includes('Revenda original'),'No stale merchant as ongoing supplier');
assert.ok(!html.includes('Pagar com Mercado Pago'));
assert.ok(!html.includes('Continuar pagamento'));

html=render('REASSIGNING',{status:'approved',provider:'mercadopago',
 approvedAt:stamp,amountCents:17900});
assert.ok(html.includes('Transação aprovada anteriormente'));
assert.ok(html.includes('Aprovação registrada para esta tentativa'));
assert.ok(html.includes('Registro de aprovação:'));
assert.ok(html.includes('R$ 179,00'));
assert.ok(!html.includes('Reembolso confirmado pelo provedor'));
assert.ok(html.includes('Uma nova revenda ainda não foi confirmada'));

html=render('CANCELLED',{status:'review_required',provider:'mercadopago',
 approvedAt:stamp,refundedAt:stamp,amountCents:15000});
assert.ok(html.includes('Pagamento em revisão'));
assert.ok(html.includes('Transação sinalizada para revisão'));
assert.ok(!html.includes('Registro de reembolso:'));
assert.ok(!html.includes('Registro de aprovação:'));
assert.ok(!html.includes('Reembolso confirmado pelo provedor'));

html=render('CANCELLED',{status:'refunded',provider:'other-provider',
 refundedAt:'INVALID-<script>',amountCents:-1000});
assert.ok(html.includes('Provedor de pagamento'));
assert.ok(!html.includes('Mercado Pago'));
assert.ok(!html.includes('Registro de reembolso:'));
assert.ok(!html.includes('Valor associado à tentativa:'));
assert.ok(!html.includes('<script>'));

html=render('CANCELLED',{status:'approved',provider:'mercadopago',
 approvedAt:future,amountCents:'Infinity'});
assert.ok(!html.includes('Registro de aprovação:'));
assert.ok(!html.includes('Valor associado à tentativa:'));
assert.ok(html.includes('Aprovação registrada para esta tentativa'));

html=render('CANCELLED',{status:'not_available',refundedAt:stamp,amountCents:15000});
assert.ok(!html.includes('customer-payment-evidence'));
assert.ok(!html.includes('Registro de reembolso:'));
assert.ok(html.includes('Situação do pagamento ainda não confirmada'));

html=render('CANCELLED',{status:'approved',provider:'mercadopago',approvedAt:stamp},
 {financialReversedAt:stamp});
assert.ok(html.includes('Ajuste interno do pedido registrado em'));
assert.ok(html.includes('Isso não confirma reembolso da transação'));
assert.ok(!html.includes('Reembolso confirmado pelo provedor'));

html=render('REASSIGNING',{status:'not_available'}, {financialReversedAt:stamp});
assert.ok(html.includes('Ajuste interno do pedido registrado'));
assert.ok(html.includes('Situação do pagamento ainda não confirmada'));

for(const status of ['PREPARING','OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED']){
 html=render(status,{status:'approved',approvedAt:stamp,amountCents:15000});
 assert.ok(!html.includes('customer-payment-evidence'),status+' should use regular payment presentation');
}

const edgeBlock=edge.slice(edge.indexOf('// V1.181: the original merchant'),edge.indexOf('const deliveryDetailsVisible'));
assert.ok(edgeBlock.includes('role==="customer"'),'Only the confirmed buyer may fetch the detached payment record');
assert.ok(edgeBlock.includes('["CANCELLED","REASSIGNING"].includes(order.status)'));
assert.ok(edgeBlock.includes('.eq("order_id",order.id)'),'Payment evidence scoped to authenticated order');
assert.ok(edge.indexOf('if(!role)return json(')<edge.indexOf('// V1.181: the original merchant'),
 'Authentication, ownership and origin gates must execute before attempt query');
assert.ok(edgeBlock.includes('.limit(1)'),'Only latest attempt read');
assert.ok(edgeBlock.includes('checkoutUrl:null'),'No old checkout URL in closed or reassigning payment result');
assert.ok(edgeBlock.includes('canStart:false'));
assert.ok(!edgeBlock.includes('provider_payment_id'),'No provider IDs in buyer payload');
assert.ok(!edgeBlock.includes('external_reference'),'No external provider references leaked');
assert.ok(css.includes('.customer-payment-evidence'));
assert.ok(css.includes('.customer-payment-ledger'));
assert.ok(css.includes('@media(max-width:520px)'));
assert.ok(audit.includes('node tests/customer-financial-evidence-v1-181.mjs'));
console.log('V1.181: payment approval/refund evidence, dated data, amounts, PII restrictions, closed-order scope and ledger boundaries passed.');
