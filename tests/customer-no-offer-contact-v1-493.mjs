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
// Checkout's in-memory cart request must appear in the priority support queue.
// Previously the option defaulted to 'general' because no tamao_help URL param
// was added by go('contact'), so Admin's support-only triage missed this request.
assert.match(form.html,/<option value="support" selected>Suporte<\/option>/);
const normal={...form,globalThis:{tamaoCartRequestDraft:null}};
vm.runInNewContext(legal.slice(cStart,cEnd)+'\nthis.html=contactPage();',normal);
assert.doesNotMatch(normal.html,/<option value="support" selected>/,
  'ordinary contact must remain general by default');
const help={...form,globalThis:{tamaoCartRequestDraft:null},location:{search:'?tamao_help=revenda'}};
vm.runInNewContext(legal.slice(cStart,cEnd)+'\nthis.html=contactPage();',help);
assert.match(help.html,/<option value="support" selected>Suporte<\/option>/,
  'existing help deep links must continue to select support');

const nodes={
  '#public-request-submit':{disabled:false,textContent:'Enviar solicitação'},
  '#public-request-result':{textContent:'',className:''},
  '#public-request-kind':{value:'support'},
  '#public-privacy-action':{value:''},
  '#public-contact-name':{value:'Cliente Teste'},
  '#public-contact-channel':{value:'email'},
  '#public-contact-value':{value:'fixture@example.invalid'},
  '#public-request-message':{value:draft},
  '#public-request-website':{value:''},
  '#public-request-ack':{checked:true}
};
let submitted=null;
const sendCtx={
  document:{querySelector:selector=>nodes[selector]||null},
  globalThis:{tamaoCartRequestDraft:draft,publicRequestSubmit:async payload=>{
    submitted=payload;return {ok:true,protocol:'DEADBEEF',message:'Recebida'};
  }},
  toast:message=>{throw new Error('unexpected validation error: '+message)}
};
const submitStart=legal.indexOf('async function submitPublicRequest(){');
assert.ok(submitStart>=0&&submitStart<cStart);
vm.runInNewContext(legal.slice(submitStart,cStart)+'\nthis.submit=submitPublicRequest;',sendCtx);
await sendCtx.submit();
assert.equal(submitted.requestKind,'support','the actual contact submission must reach support triage');
assert.match(submitted.message,/2 x Gás P13/);
assert.equal(submitted.acknowledged,true);
assert.equal(sendCtx.globalThis.tamaoCartRequestDraft,null);
assert.match(nodes['#public-request-result'].textContent,/DEADBEEF/);
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
