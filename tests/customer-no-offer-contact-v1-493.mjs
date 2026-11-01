import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js'),legal=read('js/legal.js');
const bootstrap=read('js/bootstrap.js'),workflow=read('.github/workflows/audit.yml');
const start=customer.indexOf('function requestUnavailableDelivery(){');
const end=customer.indexOf('\n}',start);
assert.ok(start>=0&&end>start,'no-offer handler must exist');
const code=customer.slice(start,end+2);
const ctx={state:{cart:{P13:2,WATER20:1},postalCode:'97300-000',addressNumber:'123'},
  products:{P13:{},WATER20:{}},
  customerProductName:code=>code==='P13'?'Gás P13':'Água 20 L',
  go:route=>{ctx.route=route},toast:msg=>{ctx.toastMessage=msg},globalThis:{}};
vm.runInNewContext(code+'\nrequestUnavailableDelivery();',ctx);
assert.equal(ctx.route,'contact');
const draft=ctx.globalThis.tamaoCartRequestDraft?.message;
assert.match(draft,/2 × Gás P13/);
assert.match(draft,/1 × Água 20 L/);
assert.match(draft,/97300-000/);
assert.match(draft,/número 123/);
assert.match(draft,/sem pedido, reserva ou cobrança/);
assert.ok(draft.length<=2000);
ctx.state.cart={};
vm.runInNewContext('requestUnavailableDelivery();',ctx);
assert.match(ctx.toastMessage,/Adicione produtos/);
const order=customer.slice(customer.indexOf('function orderPage(){'),customer.indexOf('function cartRow('));
assert.ok(order.includes('requestUnavailableDelivery()'),'CTA must be present in empty quote');
assert.match(order,/Nenhuma entrega disponível para esta cesta/);
assert.match(order,/Pedidos temporariamente indisponíveis/);
assert.match(order,/não gera compra nem cobrança/);
assert.ok(!code.includes('liveCreateOrder('),'contact cannot forge commercial order');
assert.ok(legal.includes("esc(String(globalThis.tamaoCartRequestDraft?.message||''))"),'user input must be escaped');
assert.ok(legal.includes('globalThis.publicRequestSubmit('),'use existing back-end intake');
assert.ok(legal.includes('globalThis.tamaoCartRequestDraft=null;'),'clear after backend reply');
assert.ok(bootstrap.includes('customerCheckoutFocusStep,requestUnavailableDelivery,setAddress'),'expose button');
assert.ok(workflow.includes('node tests/customer-no-offer-contact-v1-493.mjs'),'wire into Audit');
console.log('PASS #493: no-offer request carries cart to protected Admin intake without sale.');
