import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js=fs.readFileSync(new URL('../js/customer.js',import.meta.url),'utf8');
assert.doesNotThrow(()=>new vm.Script(js),'customer production JS must parse');
const start=js.indexOf('function home(){');
const end=js.indexOf('\nfunction ',start+20);
assert.ok(start>=0&&end>start);
const home=js.slice(start,end);
// This is the PRODUCTION branch, not the checkout demo. It is intentionally
// tiny to preserve the independently enforced initial JS download budget.
const begin=home.indexOf('  const o=globalThis.liveRuntime;');
const finish=home.indexOf('  if(!testDemo&&!internalPilot)',begin);
assert.ok(begin>=0&&finish>begin);
const expr=home.slice(begin,finish);
new vm.Script('(function(){'+expr+'return trackedOrderCard;})()');
assert.match(home,/if\(!testDemo&&!internalPilot\)return shell\(`\$\{trackedOrderCard\}/);
assert.ok(home.indexOf('${trackedOrderCard}')<home.indexOf('${regionalPriceSection||'),
  'The return-to-order action must appear before the new product checkout');
const id='11111111-1111-4111-8111-111111111111';
const rt={session:{user:{id:'22222222-2222-4222-8222-222222222222'}},
 orderId:id,order:{orderId:id,status:'PREPARING'}};
const ctx=vm.createContext({liveRuntime:rt,ready:true});
const display=()=>vm.runInContext('(function(){'+expr+'return trackedOrderCard;})()',ctx);
let html=display();
assert.match(html,/Ver meu pedido/);
assert.match(html,/go\('tracking'\)/);
assert.doesNotMatch(html,/11111111-1111-4111-8111-111111111111/,
 'Do not expose private order ID/PIN on the public home');
assert.doesNotMatch(html,/Pix|pagamento|cobrança/i,
 'The home action must never imply or create a new charge');
for(const status of [
 'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','OUT_FOR_DELIVERY',
 'ARRIVING','REQUOTE_REQUIRED','AT_RISK'
]){
 rt.order={orderId:id,status};
 assert.match(display(),/Ver meu pedido/);
}
for(const status of ['CANCELLED','SETTLED']){
 rt.order={orderId:id,status};
 assert.equal(display(),'','confirmed terminal does not claim an active order');
}
rt.order=null;
assert.match(display(),/Ver meu pedido/,
 'Stored order is still reachable after an interrupted reload');
rt.orderId=null;assert.equal(display(),'');
rt.orderId=id;rt.session=null;assert.equal(display(),'');
rt.session={user:{id:'22222222-2222-4222-8222-222222222222'}};
ctx.ready=false;assert.equal(display(),'');
ctx.ready=true;
// The authenticated tracking screen itself already distinguishes a saved
// reference from a freshly confirmed order, avoiding stale claims.
const track=js.slice(js.indexOf('function liveTracking(){'),
 js.indexOf('\nfunction ',js.indexOf('function liveTracking(){')+20));
assert.match(track,/Existe uma referência de pedido para consultar/);
assert.match(track,/Atualizar acompanhamento/);
assert.match(track,/liveGetOrder\(\)/);
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
assert.match(audit,/node tests\/customer-home-order-recovery-v1-959\.mjs/);
console.log('V1.959 PASS: real customer home return-to-order, login scope, terminal suppression, stale reference recovery and zero charge.');
