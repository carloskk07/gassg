import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js');
const css=read('css/components.css');
const ci=read('.github/workflows/audit.yml');
new vm.Script(customer,{filename:'customer.js'});
const start=customer.indexOf("let checkoutOfferSort='recommended';");
const end=customer.indexOf('\nfunction deliveryAddressDraftChanged(){',start);
assert.ok(start>=0&&end>start,'comparison module and shared freshness check must be available');
const quoteModule=customer.slice(start,end);
const format=n=>'R$ '+Number(n).toFixed(2).replace('.',',');
const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const now=Date.parse('2026-10-16T20:00:00.000Z');
const sample=(id,deltaMs,total,etaMax)=>({
 id,quoteId:id,live:true,roles:[],total,deliveryFee:5,eta:10,etaMax,trust:75,
 expiresAt:new Date(now+deltaMs).toISOString()
});
const current=[
 sample('cheap',10000,100,60),
 sample('fast',10000,120,20),
 sample('stale',-1000,99,10),
 sample('edge',1000,80,9),
 {...sample('invalid',20000,78,8),expiresAt:'not-a-date'}
];
const nodes={};
const btns=['recommended','lowest','soonest'].map(mode=>({
 mode,getAttribute:()=> "setCheckoutOfferSort('"+mode+"')",
 setAttribute(name,value){if(name==='aria-pressed')this.pressed=value}
}));
const catalog={innerHTML:''};
const feedback={textContent:''};
nodes['checkout-offer-choices']=catalog;
nodes['checkout-sort-feedback']=feedback;
const doc={
 getElementById:id=>nodes[id]||null,
 querySelectorAll:selector=>selector==='.offer-sort button'?btns:[]
};
const ctx=vm.createContext({
 state:{user:{cashback:0},checkout:{useCashback:false,paymentMethod:'pix'}},
 document:doc,globalThis:{
  CHAMA_INTERNAL_PILOT:false,__CHAMA_TEST__:false,
  liveRuntime:{offers:[...current]}
 },
 Date,Math,Number,Array,String,
 esc,BRL:{format},roundMoney:n=>Math.round(Number(n)*100)/100,
 paymentLabel:v=>v==='pix'?'Pix':v,
});
vm.runInContext(quoteModule,ctx);
const run=source=>vm.runInContext(source,ctx);
const fresh=run('customerEligibleCheckoutOffers(globalThis.liveRuntime.offers,{now:'+now+'})');
assert.equal(fresh.length,2,'exclude expired, near-expiry and invalid server offers');
assert.equal(fresh[0].id,'cheap');
assert.equal(fresh[1].id,'fast');
const none=run('customerEligibleCheckoutOffers(globalThis.liveRuntime.offers,{now:'+(now+30000)+'})');
assert.equal(none.length,0);
const demo=run('customerEligibleCheckoutOffers(globalThis.liveRuntime.offers,{testDemo:true,now:'+(now+30000)+'})');
assert.equal(demo.length,current.length,'internal demo keeps its isolated simulation behavior');
assert.equal(run('customerEligibleCheckoutOffers(null).length'),0);
const summary=run('checkoutOfferDecisionSummary(customerEligibleCheckoutOffers(globalThis.liveRuntime.offers,{now:'+now+'}))');
assert.match(summary,/MENOR TOTAL COM ENTREGA/);
assert.match(summary,/R\$ 100,00/);
assert.match(summary,/MENOR PRAZO MÁXIMO PREVISTO/);
assert.match(summary,/Até 20 min/);
assert.match(summary,/não promessa de economia ou entrega/);
assert.doesNotMatch(summary,/economize agora|entrega garantida|aprovado/i);
assert.equal(run('checkoutOfferDecisionSummary([])'),'');
assert.equal(run('checkoutOfferDecisionSummary([{total:12,etaMax:20}])'),'');
assert.equal(run('checkoutOfferDecisionSummary([{total:NaN,eta:0},{total:NaN,eta:0}])').includes('MENOR TOTAL'),false);
const html=run('checkoutOfferComparison(customerEligibleCheckoutOffers(globalThis.liveRuntime.offers,{now:'+now+'}))');
assert.match(html,/offer-decision-guide/);
assert.match(html,/TOTAL COM ENTREGA/);
assert.match(html,/PREVISÃO DE ENTREGA/);
assert.match(html,/Enviar pedido para confirmação/);
assert.doesNotMatch(html,/stale|edge|invalid/);
const one=run('checkoutOfferComparison([globalThis.liveRuntime.offers[0]])');
assert.doesNotMatch(one,/offer-decision-guide/);
const ties=run('checkoutOfferComparison([{id:"a",total:10,eta:20,etaMax:30,trust:0},{id:"b",total:10,eta:20,etaMax:30,trust:0}])');
assert.doesNotMatch(ties,/Menor total desta consulta|Menor prazo máximo previsto<\/span>/,
 'equal offers cannot be falsely marked as unique winners');
// Sorting an expired snapshot must not leave ghost cards or a blank result.
run("setCheckoutOfferSort('lowest')");
assert.match(catalog.innerHTML,/As opções desta consulta expiraram/);
assert.match(catalog.innerHTML,/Atualizar opções/);
assert.doesNotMatch(catalog.innerHTML,/onclick="checkout\('/);
assert.match(feedback.textContent,/Nenhuma oferta válida/);
assert.deepEqual(btns.map(b=>b.pressed),['false','true','false']);
// A fresh response can still be sorted without modifying server order or prices.
const liveNow=Date.now();
ctx.globalThis.liveRuntime.offers=[
 {id:'live-slow',quoteId:'live-slow',live:true,roles:[],total:135,deliveryFee:5,
  eta:22,etaMax:40,trust:80,expiresAt:new Date(liveNow+120000).toISOString()},
 {id:'live-cheap',quoteId:'live-cheap',live:true,roles:[],total:110,deliveryFee:5,
  eta:30,etaMax:50,trust:85,expiresAt:new Date(liveNow+120000).toISOString()}
];
run("setCheckoutOfferSort('lowest')");
assert.ok(catalog.innerHTML.indexOf("checkout('live-cheap')")<
  catalog.innerHTML.indexOf("checkout('live-slow')"));
assert.match(feedback.textContent,/Menor total primeiro/);
assert.deepEqual(ctx.globalThis.liveRuntime.offers.map(o=>o.id),
 ['live-slow','live-cheap'],'sorting must not mutate trusted offers');
run("setCheckoutOfferSort('soonest')");
assert.ok(catalog.innerHTML.indexOf("checkout('live-slow')")<
  catalog.innerHTML.indexOf("checkout('live-cheap')"));
assert.match(feedback.textContent,/Menor prazo máximo primeiro/);
run("setCheckoutOfferSort('untrusted')");
assert.deepEqual(btns.map(b=>b.pressed),['false','false','true']);
assert.ok(css.includes('.offer-decision-guide-metrics'));
assert.ok(css.includes('.offer-expired-notice'));
assert.ok(css.includes('@media(max-width:550px)'));
assert.ok(css.includes('.offer-expired-notice button:focus-visible'));
assert.ok(ci.includes('node tests/verified-offer-clarity-v1-351.mjs'));
const page=customer.slice(customer.indexOf('function orderPage(){'),customer.indexOf('\nfunction cartRow(',customer.indexOf('function orderPage(){')));
assert.ok(page.includes('const freshOffers=customerEligibleCheckoutOffers(os,{testDemo})'));
assert.ok(page.includes('offerBlock=checkoutOfferComparison(freshOffers)'));
assert.ok(page.includes('ready&&os.length&&freshOffers.length===0'));
assert.ok(page.includes('hasOffers:currentOffers.length>0'));
assert.ok(page.includes('const currentOffers=hasAddress&&hasItems&&(testDemo||ready)?freshOffers:[]'));
assert.ok(!page.includes('offerBlock=checkoutOfferComparison(os)'));
assert.ok(page.includes('Nenhum pedido foi enviado.'));
console.log('TAMÃO V1.351 PASS — quote eligibility, no fake winners, expiry UX, server-price integrity and mobile clarity.');
