import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js'),legal=read('js/legal.js'),audit=read('.github/workflows/audit.yml');
const start=customer.indexOf('function requestUnavailableDelivery(){');
const end=customer.indexOf('globalThis.requestUnavailableDelivery=requestUnavailableDelivery;',start);
assert.ok(start>=0&&end>start,'customer-specific intake handoff');
const context={state:{cart:{P13:2,WATER20:1},postalCode:'97300000'},
 products:{P13:{name:'Gás P13'},WATER20:{name:'Água 20 L'}},
 globalThis:{},go:route=>{context.route=route}};
vm.runInNewContext(customer.slice(start,end)+'\nrequestUnavailableDelivery();',context);
assert.equal(context.route,'contact');
const draft=context.globalThis.tamaoCartRequestDraft;
assert.match(draft,/2 x Gás P13/);
assert.match(draft,/1 x Água 20 L/);
assert.match(draft,/97300000/);
assert.match(draft,/Não é pedido nem cobrança/);
assert.ok(draft.length<=2000);
const cStart=legal.indexOf('function contactPage(){'),cEnd=legal.indexOf('\nglobalThis.privacyPage=',cStart);
assert.ok(cStart>=0&&cEnd>cStart,'existing contact page');
const form={state:context.state,products:context.products,globalThis:context.globalThis,
 location:{search:''},URLSearchParams,shell:x=>x,legalHero:()=>'',legalNav:()=>'',legalClose:()=>'',contactPrivacyOptions:()=>'',esc:x=>String(x).replace(/</g,'&lt;')};
vm.runInNewContext(legal.slice(cStart,cEnd)+'\nthis.html=contactPage();',form);
assert.match(form.html,/2 x Gás P13/);
assert.match(form.html,/1 x Água 20 L/);
assert.match(form.html,/97300000/);
const order=customer.slice(customer.indexOf('function orderPage(){'),customer.indexOf('function cartRow('));
assert.equal(order.split('requestUnavailableDelivery()').length-1,3);
assert.match(order,/Nenhuma entrega disponível para esta cesta/);
assert.match(order,/Pedidos temporariamente indisponíveis/);
assert.match(order,/Não gera compra nem cobrança/);
assert.ok(legal.includes('globalThis.publicRequestSubmit('),'existing endpoint only');
assert.ok(legal.includes('globalThis.tamaoCartRequestDraft=null;'),'clear after successful submit');
assert.ok(customer.includes('globalThis.requestUnavailableDelivery=requestUnavailableDelivery;'));
assert.ok(!customer.slice(start,end).includes('liveCreateOrder('),'no fabricated sales');
assert.ok(audit.includes('node tests/customer-no-offer-contact-v1-493.mjs'));
console.log('PASS #493: real contact intake retains cart and CEP, never creates a sale.');
