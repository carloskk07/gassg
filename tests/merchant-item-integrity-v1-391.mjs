import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const merchant=read('js/merchant.js'),css=read('css/components.css');
new vm.Script(merchant,{filename:'merchant.js'});
const a=merchant.indexOf('function merchantLiveOrder(o){');
const b=merchant.indexOf('\nasync function merchantEnableAlertsFromUi(){',a);
assert.ok(a>=0&&b>a);
const code=merchant.slice(a,b);
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const rt={merchant:{memberRole:'owner'},actionPending:false};
const ctx=vm.createContext({
 globalThis:{merchantRuntime:rt},Date,esc,
 BRL:{format:n=>'R$ '+Number(n).toFixed(2).replace('.',',')},
 statusCopy:{PREPARING:['Em preparação',''],OFFERED_TO_MERCHANT:['Oferecido','']},
 merchantDeliveryCandidates:()=>[],merchantDeliveryMemberLabel:()=> '',
 merchantOrderAttentionCard:()=>'',merchantSupportForOrder:()=> '',
 merchantIncidentRiskGuide:()=>'',merchantOrderProgressView:()=> '',
 merchantDeliveryShortcuts:()=>'',merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
 paymentLabel:()=> 'Dinheiro',formatDeliveryWindow:()=>'',merchantFormatPhone:()=>''
});
vm.runInContext(code+'\nthis.render=merchantLiveOrder;',ctx);
const base={
 status:'PREPARING',orderId:'00000000-0000-4000-8000-000000000391',
 publicCode:'TAM-391',addressVisible:false,paymentMethod:'cash',
 totalCents:12500
};
const render=(items,rest={})=>ctx.render({...base,...rest,items});

let html=render([{quantity:2,productName:'Água 20 L'}, {quantity:'1',productCode:'P13'}]);
assert.match(html,/2× Água 20 L/);
assert.match(html,/1× P13/);
assert.doesNotMatch(html,/Quantidade não confirmada|Confira os itens deste pedido|merchant-order-items-notice/);
assert.match(html,/R\$ 125,00/);

for(const value of [undefined,null,'',0,-1,1.25,'1.2','1a','abc',
 NaN,Infinity,1000001,false]){
 html=render([{quantity:value,productName:'Água 20 L'}]);
 assert.match(html,/Quantidade não confirmada — Água 20 L/,'invalid quantity: '+String(value));
 assert.match(html,/Confira os itens deste pedido/);
 assert.match(html,/Atualize a fila antes de decidir/);
 assert.doesNotMatch(html,/NaN×|Infinity×|undefined×|false×/);
 assert.match(html,/merchant-order-items-notice" role="status"/);
 assert.match(html,/onclick="merchantLiveAction\('00000000-0000-4000-8000-000000000391','dispatch'\)"/,
  'no client-side order transition change');
}
html=render([{quantity:1,productName:'<img src=x onerror=alert(1)>'}]);
assert.match(html,/&lt;img/);
assert.doesNotMatch(html,/<img|onerror=/);
html=render([{quantity:2,productName:' '},{quantity:3,productCode:'WATER20'}]);
assert.match(html,/Produto não identificado/);
assert.match(html,/3× WATER20/);
assert.match(html,/Confira os itens deste pedido/);
html=render([]);
assert.match(html,/Itens não confirmados nesta consulta/);
assert.match(html,/Confira os itens deste pedido/);
html=render(null);
assert.match(html,/Itens não confirmados nesta consulta/);
html=render({length:10});
assert.match(html,/Itens não confirmados nesta consulta/);
html=render([{quantity:1,productName:'A'.repeat(181)}]);
assert.match(html,/Produto não identificado/);
assert.match(html,/Confira os itens deste pedido/);
html=render(Array.from({length:55},(_,i)=>({quantity:1,productCode:'P'+i})));
assert.match(html,/Confira os itens deste pedido/);
assert.doesNotMatch(html,/1× P54/);
assert.match(html,/1× P49/);
html=render([{quantity:1000000,productName:'P13'}]);
assert.match(html,/1\.000\.000× P13/);
assert.doesNotMatch(html,/Confira os itens deste pedido/);

const offer=render([{quantity:1,productName:'P13'}],{
 status:'OFFERED_TO_MERCHANT',offerExpiresAt:new Date(Date.now()+120000).toISOString()
});
assert.match(offer,/Aceitar pedido/);
assert.match(offer,/Não consigo atender/);
assert.doesNotMatch(offer,/Confira os itens deste pedido/);
const incompleteOffer=render([{quantity:null,productName:'P13'}],{
 status:'OFFERED_TO_MERCHANT',offerExpiresAt:new Date(Date.now()+120000).toISOString()
});
assert.match(incompleteOffer,/Confira os itens deste pedido/);
assert.match(incompleteOffer,/Aceitar pedido/,'server acceptance rules, not item display, retain control');
assert.doesNotMatch(code,/localStorage|supabase\.from\(|fetch\(/,
 'order card must stay a read-only projection before explicit user action');
for(const rule of ['.merchant-order-item-list','.merchant-order-items-notice',
 '@media(max-width:480px)','@media(max-width:350px)'])
 assert.ok(css.includes(rule),'missing readable mobile order-item style '+rule);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/merchant-item-integrity-v1-391.mjs'));
console.log('TAMÃO V1.391 PASS — honest quantities and product names, safe HTML, unchanged order actions, mobile item confidence.');
