import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js'),legal=read('js/legal.js'),audit=read('.github/workflows/audit.yml');
const start=legal.indexOf('function contactPage(){'),end=legal.indexOf('\nglobalThis.privacyPage=',start);
assert.ok(start>=0&&end>start,'existing contact page available');
const ctx={state:{cart:{P13:2,WATER20:1},postalCode:'97300000'},
  products:{P13:{name:'Gás P13'},WATER20:{name:'Água 20 L'}},
  globalThis:{tamaoCartRequestDraft:true},location:{search:''},URLSearchParams,
  shell:x=>x,legalHero:(k,title,lead)=>title+lead,legalNav:()=>'',legalClose:()=>'',contactPrivacyOptions:()=>'',esc:x=>String(x).replace(/</g,'&lt;')};
vm.runInNewContext(legal.slice(start,end)+'\nthis.html=contactPage();',ctx);
assert.match(ctx.html,/Solicitar atendimento/);
assert.match(ctx.html,/2 x Gás P13/);
assert.match(ctx.html,/1 x Água 20 L/);
assert.match(ctx.html,/97300000/);
assert.match(ctx.html,/Não é um pedido nem cobrança/);
const order=customer.slice(customer.indexOf('function orderPage(){'),customer.indexOf('function cartRow('));
assert.equal(order.split('tamaoCartRequestDraft=true;go(').length-1,3,'three no-offer contact CTAs');
assert.match(order,/Nenhuma entrega disponível para esta cesta/);
assert.match(order,/Pedidos temporariamente indisponíveis/);
assert.match(order,/Não gera compra nem cobrança/);
assert.ok(legal.includes('globalThis.publicRequestSubmit('),'existing back-end intake');
assert.ok(legal.includes('globalThis.tamaoCartRequestDraft=null;'),'clear only after backend response');
assert.ok(!order.includes("requestUnavailableDelivery("),'no new initial JS action');
assert.ok(audit.includes('node tests/customer-no-offer-contact-v1-493.mjs'));
console.log('PASS #493: empty-market checkout goes to existing contact intake with cart context.');
