import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js'),css=read('css/components.css');
const bootstrap=read('js/bootstrap.js'),ci=read('.github/workflows/audit.yml');
for(const [name,src] of [['customer.js',customer],['bootstrap.js',bootstrap]])
  new vm.Script(src,{filename:name});
const extract=(name)=>{
  const start=customer.indexOf('function '+name+'(');
  const end=customer.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'cannot extract '+name);
  return customer.slice(start,end+2);
};
const script=extract('customerCheckoutJourney')+'\n'+extract('customerCheckoutFocusStep')+
 '\nthis.journey=customerCheckoutJourney;this.focusStep=customerCheckoutFocusStep;';
let focused=0,scrolled=0,opened=false,behavior='';
const nodes={
 'customer-cart':{closest:()=>null,scrollIntoView:x=>{scrolled++;behavior=x.behavior}},
 'customer-address':{closest:()=>null,scrollIntoView:()=>{scrolled++}},
 'customer-contact':{closest:()=>({set open(x){opened=x}}),scrollIntoView:()=>{scrolled++}},
 'customer-offers':{closest:()=>null,scrollIntoView:()=>{scrolled++}},
 'postal-code':{focus:()=>{focused++}},
 'delivery-phone':{focus:()=>{focused++}}
};
const context=vm.createContext({document:{getElementById:id=>nodes[id]||null},
 globalThis:{matchMedia:()=>({matches:true})}});
vm.runInContext(script,context);
const html=params=>context.journey(params);
assert.match(html({}),/0 de 4 prontos/);
assert.match(html({}),/Escolha o que você precisa/);
assert.match(html({}),/customerCheckoutFocusStep\('cart'\)/);
assert.match(html({}),/disabled aria-current="false"/);
assert.match(html({hasItems:true}),/1 de 4 prontos/);
assert.match(html({hasItems:true}),/Confirme onde quer receber/);
assert.match(html({hasItems:true,hasAddress:true}),/2 de 4 prontos/);
assert.match(html({hasItems:true,hasAddress:true}),/Informe um telefone/);
assert.match(html({hasItems:true,hasAddress:true,hasPhone:true}),/3 de 4 prontos/);
assert.match(html({hasItems:true,hasAddress:true,hasPhone:true,loadingOffers:true}),/Consultando opções reais/);
assert.match(html({hasItems:true,hasAddress:true,hasPhone:true,hasOffers:true}),/4 de 4 prontos/);
assert.match(html({hasItems:true,hasAddress:true,hasPhone:true,hasOffers:true}),/A revenda ainda precisará aceitar/);
assert.match(html({pendingOrder:true}),/go\('tracking'\)/);
assert.doesNotMatch(html({pendingOrder:true}),/4 de 4 prontos/);
assert.equal(context.focusStep('cart'),true);assert.equal(behavior,'auto');
assert.equal(context.focusStep('address'),true);
assert.equal(context.focusStep('contact'),true);assert.equal(opened,true);
assert.equal(focused,2);
assert.equal(context.focusStep('offers'),true);assert.equal(scrolled,4);
assert.equal(context.focusStep('not-valid'),false);
delete nodes['customer-offers'];assert.equal(context.focusStep('offers'),false);

const start=customer.indexOf('function orderPage(){'),end=customer.indexOf('\nfunction cartRow(',start);
const page=customer.slice(start,end);
assert.ok(start>=0&&end>start);
for(const marker of [
 'customerCheckoutJourney(', 'buyerGuide', 'id="customer-cart"', 'id="customer-address"',
 'id="customer-contact"', 'id="customer-offers"', 'id="delivery-phone"',
 'id="address-complement"', 'id="delivery-reference"', 'id="delivery-notes"',
 'buyer-extra-details','deliveryAddressDraftChanged()','deliveryDetailsChanged()',
 'paymentBlock','deliveryScheduleBlock()','containerBlock','offerBlock',
 'commerceLaunchBlocked','paymentMethodUnavailable',
 'pendingOrder','hasItems','hasAddress',
 'Date.parse(String(o.expiresAt))>Date.now()+1000'
])assert.ok(page.includes(marker),'existing checkout flow lost '+marker);
assert.ok(page.indexOf('id="delivery-phone"')<page.indexOf('buyer-extra-details'));
assert.ok(page.indexOf('id="customer-cart"')<page.indexOf('id="customer-offers"'));
assert.ok(bootstrap.includes('customerCheckoutFocusStep,'));
for(const marker of ['.buyer-journey','.buyer-journey-steps','.buyer-journey-next',
 '.buyer-extra-details','scroll-margin-top:100px',
 '@media(max-width:650px)','@media(max-width:350px)'])
 assert.ok(css.includes(marker),'missing mobile style '+marker);
assert.ok(ci.includes('node tests/buyer-checkout-journey-v1-302.mjs'));
const checkout=extract('checkout');
assert.ok(checkout.includes('syncDeliveryDetailsFromUi({requirePhone:true})'));
assert.ok(checkout.includes('await liveCreateOrder(mid)'));
assert.ok(checkout.includes('if(!globalThis.liveReady?.())'));
assert.ok(customer.includes('globalThis.liveInvalidateOfferAddressDraft?.()'));
console.log('V1.302 PASS — adaptive buyer steps, keyboard focus, phone validation and existing checkout authority.');
