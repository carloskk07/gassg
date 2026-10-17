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
assert.ok(start>0&&end>start);
const moduleCode=customer.slice(start,end);
const BRL={format:n=>'R$ '+Number(n).toFixed(2).replace('.',',')};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const ctx=vm.createContext({
 state:{checkout:{useCashback:false,paymentMethod:'pix'},user:{cashback:0}},
 globalThis:{__CHAMA_TEST__:false,CHAMA_INTERNAL_PILOT:false,liveRuntime:{offers:[]}},
 BRL,esc,roundMoney:n=>Math.round((Number(n)+Number.EPSILON)*100)/100,
 paymentLabel:v=>v==='pix'?'Pix':v==='card'?'Cartão':'Dinheiro',
 document:{getElementById:()=>null,querySelectorAll:()=>[]}
});
vm.runInContext(moduleCode,ctx);
const execute=js=>vm.runInContext(js,ctx);
const offers=[
 {id:'quote-a',roles:['Recomendado'],total:118,deliveryFee:8,eta:15,etaMax:35,trust:90},
 {id:'quote-b',roles:['Alternativa'],total:112,deliveryFee:5,eta:27,etaMax:44,trust:80}
];
ctx.globalThis.liveRuntime.offers=offers;
const result=execute('checkoutOfferComparison(globalThis.liveRuntime.offers)');
assert.match(result,/checkout-request-explainer/);
assert.match(result,/Antes de enviar, veja os próximos passos/);
for(const word of ['Você solicita','A revenda responde','Você acompanha','depende do aceite real'])
 assert.ok(result.includes(word),'missing checkout explanation: '+word);
assert.match(result,/TOTAL COM ENTREGA/);
assert.match(result,/PREVISÃO DE ENTREGA/);
assert.match(result,/Enviar pedido para confirmação/);
assert.match(result,/Esta ação envia uma solicitação/);
assert.match(result,/Pix na entrega/);
assert.doesNotMatch(result,/compra confirmada automaticamente|pagamento concluído|entrega garantida/i);
assert.match(result,/Menor total desta consulta/);
assert.match(result,/Menor prazo máximo previsto/);
const a=execute('offerCard(globalThis.liveRuntime.offers[0])');
assert.match(a,/R\$ 118,00/);
assert.match(a,/15–35 min/);
assert.match(a,/onclick="checkout\('quote-a'\)"/);
assert.match(a,/Confiança 90\/100/);
assert.match(a,/Esta ação envia uma solicitação/);

// Never convert absent, invalid or zero values to a fabricated approved total.
for(const total of [null,0,-1,'not-a-number','Infinity']){
 const bad={id:'bad-total',total,eta:15,etaMax:29,trust:null,roles:[]};
 const html=execute('offerCard('+JSON.stringify(bad)+')');
 assert.match(html,/Total indisponível/,String(total));
 assert.match(html,/disabled/,String(total));
 assert.doesNotMatch(html,/onclick="checkout\('/,String(total));
 assert.doesNotMatch(html,/R\$ 0,00/,String(total));
 assert.doesNotMatch(html,/undefined\/100|null\/100|NaN\/100/);
}
for(const badEta of [null,-1,'unknown']){
 const bad={id:'bad-eta',total:125,eta:badEta,etaMax:25,trust:null,roles:[]};
 const html=execute('offerCard('+JSON.stringify(bad)+')');
 assert.match(html,/Prazo indisponível/);
 assert.match(html,/disabled/);
 assert.doesNotMatch(html,/onclick="checkout\('/);
 assert.doesNotMatch(html,/0–25 min/);
}
for(const badEnd of [null,-1,'NaN']){
 const bad={id:'bad-end',total:110,eta:20,etaMax:badEnd,roles:[]};
 const html=execute('offerCard('+JSON.stringify(bad)+')');
 // A missing upper limit can use the verified minimum; a malformed limit cannot.
 if(badEnd===null) assert.match(html,/20–20 min/);
 else assert.match(html,/Prazo indisponível/);
}
const inverted={id:'inverted',roles:[],total:110,eta:42,etaMax:24};
assert.match(execute('offerCard('+JSON.stringify(inverted)+')'),/Prazo indisponível/);
const direct=execute('checkoutOfferDecisionSummary([{total:null,etaMax:null},{total:120,etaMax:25}])');
assert.doesNotMatch(direct,/MENOR TOTAL|MENOR PRAZO/);
const explicitFree=execute('checkoutOfferDecisionSummary([{total:0,etaMax:12},{total:130,etaMax:30}])');
assert.doesNotMatch(explicitFree,/MENOR TOTAL/);
assert.match(explicitFree,/MENOR PRAZO/);

// No new confirmation dialog or financial operation was added.
assert.doesNotMatch(moduleCode,/window\.confirm|window\.alert|localStorage|fetch\s*\(/);
assert.ok(moduleCode.includes("const canRequest=allowedId&&validTotal&&validEta"));
assert.ok(moduleCode.includes("customerEligibleCheckoutOffers(all,"));
for(const rule of ['.checkout-request-explainer','.checkout-request-explainer ol','.offer-submit-note',
 '.offer-comparison-card .offer-price-row','@media(max-width:420px)',
 '@media(max-width:350px)','@media(prefers-reduced-motion:reduce)'])
 assert.ok(css.includes(rule),'missing mobile checkout visual: '+rule);
assert.ok(ci.includes('node tests/checkout-offer-confidence-v1-381.mjs'));
console.log('TAMÃO V1.381 PASS — request acceptance explained, financial data not invented, mobile offer clarity, no extra action or payment changes.');
