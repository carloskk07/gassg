import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/customer.js'),css=read('css/components.css');
new vm.Script(js,{filename:'js/customer.js'});
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const begin=js.indexOf('const statusCopy={');
const stop=js.indexOf('function liveCustomerCareBlock(o){',begin);
const live=js.indexOf('function liveTracking(){',stop);
const end=js.indexOf('\nfunction tracking(){',live);
assert.ok(begin>=0&&stop>begin&&live>stop&&end>live);
const ctxData={status:'ready',error:null,actionPending:false,order:null,lastSyncAt:new Date().toISOString()};
const ctx=vm.createContext({
 globalThis:{liveReady:()=>true,liveRuntime:ctxData},
 liveRuntime:ctxData,esc,BRL:{format:n=>'R$ '+Number(n).toFixed(2).replace('.',',')},
 shell:html=>html,toasts:[],toast:()=>{},paymentLabel:()=> 'Dinheiro',
 formatDeliveryWindow:()=> 'Hoje, entre 15h e 17h',
 formatDeliveryPhone:()=> '***',
 hhmm:()=> '14:30'
});
vm.runInContext(js.slice(begin,end),ctx);
const evalIn=script=>vm.runInContext(script,ctx);
const order=status=>{
 ctxData.error=null;
 ctxData.order={
  status,orderId:'11111111-1111-4111-8111-111111111111',publicCode:'TAM-179',
  totalCents:12000,paymentMethod:'cash',supplierName:'Revenda Antiga',
  riskReason:'staffing_issue <img src=x onerror=alert(1)>',
  items:[{quantity:1,product_name:'Água 20L',line_total_cents:12000}],
  events:[{type:'merchant_private_driver_unavailable',title:'João sem carro',detail:'Telefone interno 51999991234',
   createdAt:'2026-10-12T10:00:00Z'},
   {type:'merchant_accepted',title:'Revenda Antiga',detail:'staffing_issue',createdAt:'2026-10-12T10:01:00Z'}],
  supportCases:[]
 };
 return evalIn('liveTracking()');
};

let html=order('REASSIGNING');
assert.ok(html.includes('Seu pedido está sendo reavaliado'));
assert.ok(html.includes('nenhuma nova entrega está garantida'));
assert.ok(html.includes('Ainda não há nova revenda confirmada'));
assert.ok(html.includes('href="#customer-care"'));
assert.ok(html.includes('id="customer-care"'));
assert.ok(html.includes('Atualizar pedido'));
assert.ok(!html.includes('Revenda Antiga'),'Previous vendor must not imply current acceptance');
assert.ok(!html.includes('Telefone interno')&&!html.includes('João sem carro'),
 'Internal staff diagnostics never appear in customer events');
assert.ok(!html.includes('staffing_issue'),'Internal failure code must not be disclosed');
assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
assert.ok(html.includes('Atualização registrada no pedido'),'Unrecognized event type redacted');
assert.ok(html.includes('Revenda aceitou o pedido'),'Recognized event mapped to neutral title');
assert.ok(html.includes('Etapas do pedido'));
assert.ok(!html.includes('Código de recebimento'),'PIN remains protected');
assert.ok(!html.includes('Aceitar proposta de'),'No offer yet');
assert.ok(html.includes('Total protegido:'));

html=order('AT_RISK');
assert.ok(html.includes('Acompanhamento prioritário'));
assert.ok(html.includes('Estamos verificando um imprevisto'));
assert.ok(html.includes('Revenda Antiga'),'Current accepted merchant still visible');
assert.ok(!html.includes('staffing_issue'),'Internal operational reason must be redacted');
assert.ok(!html.includes('Telefone interno'));
assert.ok(html.includes('O pedido precisa de atenção da operação'));
assert.ok(!html.includes('Detectamos risco de atraso'),'Risk is not necessarily a delay');

html=order('REQUOTE_REQUIRED');
ctxData.order.proposedTotalCents=13500;
ctxData.order.offerExpiresAt=new Date(Date.now()+90000).toISOString();
html=evalIn('liveTracking()');
assert.ok(html.includes('Há uma nova proposta para você avaliar'));
assert.ok(html.includes('Outra proposta precisa da sua autorização'));
assert.ok(html.includes('Nova proposta'));
assert.ok(html.includes('R$ 135,00'));
assert.ok(html.includes('R$ 120,00'));
assert.ok(html.includes('Aceitar proposta de R$ 135,00'));
assert.ok(!html.includes('Revenda Antiga'),'Old supplier stays hidden until accepted');
assert.ok(html.includes('Não é necessário pagar uma diferença sem aprovar'));
assert.ok(html.includes('onclick="confirmRequote()"'));
assert.ok(!html.includes('staffing_issue'));

ctxData.actionPending=true;
html=evalIn('liveTracking()');
assert.ok(html.includes('>Atualizar pedido</button>'));
assert.ok(html.includes('onclick="liveGetOrder().catch(()=>{})" disabled>Atualizar pedido</button>'),
 'Concurrent action disables refresh');
ctxData.actionPending=false;

for(const status of ['OFFERED_TO_MERCHANT','CREATED','QUOTE_LOCKED']){
 html=order(status);
 assert.ok(!html.includes('customer-incident-status'),'Do not claim incident without server state');
 assert.ok(!html.includes('Revenda Antiga'),'Supplier must not be advertised before acceptance');
}
for(const status of ['PREPARING','OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED']){
 html=order(status);
 assert.ok(!html.includes('customer-incident-status'),'No incident in normal state '+status);
 assert.ok(html.includes('Revenda Antiga'),'Confirmed supplier preserved in '+status);
}
html=order('CANCELLED');
assert.ok(!html.includes('Revenda Antiga'),'Cancelled order does not promise active supplier');
assert.ok(!html.includes('customer-incident-status'));
assert.ok(html.includes('ENCERRADO'));

const event=e=>evalIn('customerPublicTimelineEvent('+JSON.stringify(e)+')');
assert.equal(event({type:'merchant_accepted',detail:'internal-secret'}),'Revenda aceitou o pedido');
assert.equal(event({type:'other_admin_secret',title:'Confidential <script>alert(1)</script>'}),
 'Atualização registrada no pedido');
assert.equal(event({type:'__proto__'}),'Atualização registrada no pedido');
assert.equal(event({type:'constructor'}),'Atualização registrada no pedido');

const supplier=x=>JSON.parse(evalIn('JSON.stringify(customerSupplierPresentation('+JSON.stringify(x)+'))'));
assert.equal(supplier({status:'REASSIGNING',supplierName:'Velho'}).name,'Revenda em confirmação');
assert.equal(supplier({status:'REQUOTE_REQUIRED',supplierName:'Velho'}).name,'Revenda em confirmação');
assert.equal(supplier({status:'PREPARING',supplierName:'Ativa'}).name,'Ativa');

assert.ok(css.includes('.customer-incident-status')&&css.includes('.customer-incident-help'));
assert.ok(css.includes('@media(max-width:520px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/customer-incident-tracking-v1-179.mjs'));
console.log('V1.179: reassign without false supplier, incident privacy, safe events, requote, PIN and support access passed.');
