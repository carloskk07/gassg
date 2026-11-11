import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js=fs.readFileSync(new URL('../js/customer.js',import.meta.url),'utf8');
const start=js.indexOf('function customerHomeOrderRecovery(){');
const end=js.indexOf('\nfunction home(){',start);
assert.ok(start>=0&&end>start,'Home order recovery must be located beside the real home renderer');
new vm.Script(js);
const actual=js.slice(start,end);
const ORDER='11111111-1111-4111-8111-111111111111';
const NOW=Date.now();
const rt={
  session:{user:{id:'22222222-2222-4222-8222-222222222222'}},
  orderId:ORDER,orderCheckedId:ORDER,orderCheckedAt:new Date(NOW).toISOString(),
  error:null,order:{orderId:ORDER,status:'PREPARING',version:5}
};
let ready=true;
const ctx=vm.createContext({liveRuntime:rt,liveReady:()=>ready,Date,String,Number});
vm.runInContext(actual+'\nthis.homeRecovery=customerHomeOrderRecovery;',ctx);
const render=()=>ctx.homeRecovery();

let html=render();
assert.match(html,/Seu pedido está em andamento/);
assert.match(html,/Acompanhar meu pedido/);
assert.match(html,/go\('tracking'\)/);
assert.doesNotMatch(html,/11111111-1111-4111-8111-111111111111/,
 'Do not put private order identifiers or a stale PIN in marketing DOM');
assert.doesNotMatch(html,/Pix|gerar|pagamento/i,'Navigation must not create or imply a charge');

// The same order remains discoverable after leaving checkout or reloading.
rt.order.status='OFFERED_TO_MERCHANT';assert.match(render(),/Acompanhar meu pedido/);
rt.order.status='OUT_FOR_DELIVERY';assert.match(render(),/Acompanhar meu pedido/);
rt.order.status='REQUOTE_REQUIRED';assert.match(render(),/Acompanhar meu pedido/);
// A settled order is historical; do not advertise an active delivery.
for(const status of ['CANCELLED','SETTLED']){
 rt.order.status=status;assert.equal(render(),'');
}
// A saved localStorage order is NOT fresh server evidence, but it must be
// retrievable via the existing tracking route and its authenticated GET.
rt.order=null;html=render();
assert.match(html,/Consultar o pedido salvo/);
assert.match(html,/Verificar meu pedido/);
assert.doesNotMatch(html,/Seu pedido está em andamento/);
rt.order={orderId:ORDER,status:'PREPARING'};
rt.orderCheckedAt=new Date(NOW-121000).toISOString();
assert.match(render(),/Consultar o pedido salvo/);
rt.orderCheckedAt=new Date(NOW).toISOString();
rt.orderCheckedId='33333333-3333-4333-8333-333333333333';
assert.match(render(),/Consultar o pedido salvo/);
rt.orderCheckedId=ORDER;rt.error='timeout';
assert.match(render(),/Consultar o pedido salvo/);

// Another session, malformed stored ID or no authenticated session must not
// reveal any prior order, even when an old local readback is still in memory.
rt.error=null;rt.session=null;assert.equal(render(),'');
rt.session={user:{id:'22222222-2222-4222-8222-222222222222'}};
rt.orderId='not-an-uuid';assert.equal(render(),'');
rt.orderId=ORDER;
ready=false;assert.equal(render(),'');
ready=true;
rt.orderId=null;assert.equal(render(),'');

// Marketing's real production route (not only the demo/checkout) must show
// the status CTA BEFORE product offers and never make an external request.
const home=js.slice(js.indexOf('function home(){'),js.indexOf('\nfunction ',js.indexOf('function home(){')+20));
assert.match(home,/const trackedOrderCard=!testDemo\?customerHomeOrderRecovery\(\):''/);
assert.match(home,/if\(!testDemo&&!internalPilot\)return shell\(`\$\{trackedOrderCard\}/);
assert.match(home,/return shell\(`\$\{trackedOrderCard\}\n\$\{regionalPriceSection\}/);
const checkoutRecovery=js.slice(js.indexOf('function liveTracking(){'),js.indexOf('\nfunction ',js.indexOf('function liveTracking(){')+20));
assert.match(checkoutRecovery,/Existe uma referência de pedido para consultar/);
assert.match(checkoutRecovery,/Atualizar acompanhamento/);
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
assert.match(audit,/node tests\/customer-home-order-recovery-v1-959\.mjs/);
console.log('V1.959 PASS: real home preserves authenticated tracked order, fresh vs stale status, terminal suppression, account isolation and zero payment actions.');
