import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js');
const backend=read('js/backend.js');
const server=read('supabase/functions/get-offers/index.ts');
const css=read('css/components.css');

const start=customer.indexOf("let checkoutOfferSort='recommended';");
const end=customer.indexOf('\nfunction deliveryAddressDraftChanged(){',start);
assert.ok(start>0&&end>start,'Cannot find entire client comparison module');
const source=customer.slice(start,end);
const currency=x=>'R$ '+Number(x).toFixed(2).replace('.',',');
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const offers=[
  {id:'quote-recommended',live:true,roles:['Recomendado'],total:120,deliveryFee:12,
    eta:22,etaMax:32,trust:95,completedOrders:14,expiresAt:'2999-01-01T00:00:00Z'},
  {id:'quote-cheap',live:true,roles:['Mais barato'],total:115,deliveryFee:0,
    eta:38,etaMax:50,trust:88,completedOrders:5,comparisonSavings:10,
    expiresAt:'2999-01-01T00:00:00Z'},
  {id:'quote-fast',live:true,roles:['Mais rápido'],total:125,deliveryFee:15,
    eta:12,etaMax:18,trust:92,feedbackCount:5,positiveFeedbackRate:.8,
    expiresAt:'2999-01-01T00:00:00Z'}
];
const buttons=[
  {attr:"setCheckoutOfferSort('recommended')",setAttribute(name,value){if(name==='aria-pressed')this.pressed=value},getAttribute(){return this.attr}},
  {attr:"setCheckoutOfferSort('lowest')",setAttribute(name,value){if(name==='aria-pressed')this.pressed=value},getAttribute(){return this.attr}},
  {attr:"setCheckoutOfferSort('soonest')",setAttribute(name,value){if(name==='aria-pressed')this.pressed=value},getAttribute(){return this.attr}}
];
const container={innerHTML:''};
const state={checkout:{useCashback:false,paymentMethod:'pix'},user:{cashback:20}};
const document={getElementById:id=>id==='checkout-offer-choices'?container:null,
  querySelectorAll:selector=>selector==='.offer-sort button'?buttons:[]};
const ctx=vm.createContext({state,document,
  globalThis:{__CHAMA_TEST__:false,CHAMA_INTERNAL_PILOT:false,liveRuntime:{offers}},
  esc:escape,BRL:{format:currency},roundMoney:value=>Math.round(value*100)/100,
  paymentLabel:v=>v==='card'?'Cartão':v==='cash'?'Dinheiro':'Pix',
  offers:()=>offers
});
vm.runInContext(source,ctx);
const run=code=>vm.runInContext(code,ctx);
const ids=expr=>JSON.parse(run('JSON.stringify('+expr+')'));
assert.deepEqual(ids('sortedCheckoutOffers(globalThis.liveRuntime.offers).map(o=>o.id)'),
  ['quote-recommended','quote-cheap','quote-fast'],'Default must retain server recommendation');
assert.deepEqual(ids("sortedCheckoutOffers(globalThis.liveRuntime.offers,'lowest').map(o=>o.id)"),
  ['quote-cheap','quote-recommended','quote-fast'],'Price order must include delivery');
assert.deepEqual(ids("sortedCheckoutOffers(globalThis.liveRuntime.offers,'soonest').map(o=>o.id)"),
  ['quote-fast','quote-recommended','quote-cheap'],'Fastest upper-bound time first');
assert.deepEqual(ids('globalThis.liveRuntime.offers.map(o=>o.id)'),
  ['quote-recommended','quote-cheap','quote-fast'],'Sorting cannot modify backend arrays');
const initial=run('checkoutOfferComparison(globalThis.liveRuntime.offers)');
assert.ok(initial.includes('Compare 3 opções'), 'Customer-friendly comparison heading');
assert.ok(initial.includes('Sugeridas')&&initial.includes('Menor total')&&initial.includes('Menor prazo'),
  'Required sort controls');
assert.ok(initial.includes('TOTAL COM ENTREGA')&&initial.includes('PREVISÃO DE ENTREGA'));
assert.ok(initial.includes('Produtos')&&initial.includes('Entrega'));
assert.ok(initial.includes('R$ 108,00')&&initial.includes('R$ 12,00'),
  'Fee breakdown must equal total without hidden additional charge');
assert.ok(initial.includes('Incluída sem custo adicional'),'Zero fee described honestly');
assert.ok(initial.includes('Pedir')===false,'CTA must explain it sends a real order for confirmation');
assert.ok(initial.includes('Enviar pedido para confirmação'));
assert.ok(initial.includes('Pag')&&initial.includes('Pix na entrega'),'Direct merchant payment must be visible');
assert.ok(initial.includes('Menor total desta consulta')&&initial.includes('Menor prazo máximo previsto'),
  'Comparison labels anchored to distinct actual numeric minima');
assert.ok(initial.includes('OPÇÃO DISPONÍVEL AGORA')===false,
 'Server must control availability label; do not fabricate from sorting');
assert.ok(initial.includes('abaixo da maior oferta desta consulta')&& !initial.includes('Economiza R$'),
 'Comparison vs most expensive cannot be marketed as guaranteed savings');
assert.ok(initial.includes('Por que esta opção apareceu?')&&initial.includes('<details'),
 'Optional proof detail stays available');
run("setCheckoutOfferSort('lowest')");
assert.ok(container.innerHTML.indexOf('quote-cheap')<container.innerHTML.indexOf('quote-recommended'));
assert.deepEqual(buttons.map(b=>b.pressed),['false','true','false']);
run("setCheckoutOfferSort('soonest')");
assert.ok(container.innerHTML.indexOf('quote-fast')<container.innerHTML.indexOf('quote-recommended'));
assert.deepEqual(buttons.map(b=>b.pressed),['false','false','true']);
assert.equal(container.innerHTML.includes('R$ 125,00'),true);
run("setCheckoutOfferSort('injected')");
assert.deepEqual(buttons.map(b=>b.pressed),['false','false','true'],
 'Unexpected sort modes rejected');

state.checkout.useCashback=true;
const discounted=run('offerCard(globalThis.liveRuntime.offers[0])');
assert.ok(discounted.includes('R$ 120,00')&&discounted.includes('Estimativa após cashback: R$ 100,00'),
 'Quote total and conditional cashback must remain separately disclosed');
assert.ok(discounted.includes('O valor aplicável é confirmado na criação do pedido.'));
assert.ok(!discounted.includes('Total a pagar R$ 100,00'),'No unconditional cashback promise');

const ties=[
  {id:'a',roles:['Recomendado'],total:110,eta:20,etaMax:30,trust:0},
  {id:'b',roles:['Alternativa'],total:110,eta:20,etaMax:30,trust:0}
];
const tieHtml=run('checkoutOfferComparison('+JSON.stringify(ties)+')');
assert.ok(!tieHtml.includes('Menor total desta consulta')&&!tieHtml.includes('Menor prazo máximo previsto'),
 'No fabricated winner when numeric values tie');
const malformed=[
  {id:"bad');alert(1)//",roles:['Alternativa'],total:90,deliveryFee:500,
   eta:20,etaMax:30,trust:0},
  {id:'safe',roles:['Alternativa'],total:100,eta:30,etaMax:40,trust:0}
];
const risky=run('checkoutOfferComparison('+JSON.stringify(malformed)+')');
assert.ok(!risky.includes('onclick="checkout(\'bad')'),'Invalid quote ID must never become actionable JS');
assert.ok(risky.includes('disabled'),'Malformed ID should fail closed');
assert.ok(!risky.includes('R$ 500,00'),'Invalid breakdown cannot display excessive delivery fee');

const anon=server.slice(server.indexOf('const safe:any=anonymizeOffer('),
 server.indexOf('if(hasMerchantLeak(safe))'));
assert.ok(anon.includes('candidate.totalCents===Number(quote.grossTotalCents)')
 &&anon.includes('safe.deliveryFeeCents=candidate.deliveryFeeCents'),
 'Merchant delivery fee can only be exposed if it balances canonical quote');
assert.ok(!anon.includes('safe.merchantId=')&&!anon.includes('safe.merchantName='),
 'Do not leak supplier identity before acceptance');
assert.ok(backend.includes('deliveryFee:raw.deliveryFeeCents==null')
 &&backend.includes('Number(raw.deliveryFeeCents)>Number(raw.totalCents)'),
 'Client must validate server fee breakdown before showing it');
assert.ok(css.includes('.offer-sort button[aria-pressed="true"]')
 &&css.includes('@media(max-width:420px)')
 &&css.includes('.offer-price-row')
 &&css.includes(':focus-visible'),
 'Mobile and focus semantics must be retained');

console.log('V1.163: supplier-anonymous, price/ETA sorted quotes, fee reconciliation, cashback honesty, false-winner ties, XSS rejection and mobile UI contracts passed.');
