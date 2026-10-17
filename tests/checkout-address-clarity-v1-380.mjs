import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js');
const css=read('css/components.css');
new vm.Script(customer,{filename:'customer.js'});
const start=customer.indexOf('function customerAddressDraftGuidance(');
const finish=customer.indexOf('\nfunction formatDeliveryPhone(',start);
assert.ok(start>=0&&finish>start);
const addressCode=customer.slice(start,finish);

function fixture({postal='97300-0000',number='12',cart={WATER20:1},ready=true}={}){
  const history=[],attributes={},status={textContent:''};
  const fields={
    'postal-code':{value:postal,focus(){history.push('focus-postal')},setAttribute(k,v){attributes['postal-'+k]=v},removeAttribute(k){delete attributes['postal-'+k]}},
    'address-number':{value:number,focus(){history.push('focus-number')},setAttribute(k,v){attributes['number-'+k]=v},removeAttribute(k){delete attributes['number-'+k]}}
  };
  const runtime={
    offers:[{quoteId:'previous'}],postalValidated:true,
    lastCityCheck:{checkedAt:123},lastSyncAt:456,error:'old'
  };
  const state={postalCode:'97300000',addressNumber:'12',address:'Rua validada, 12',cart};
  const context=vm.createContext({
    state,liveRuntime:runtime,
    globalThis:{
      __CHAMA_TEST__:false,liveRuntime:runtime,
      liveInvalidateOfferAddressDraft:()=>history.push('invalidate'),
      liveReady:()=>ready,
      liveScheduleOfferRefresh:delay=>history.push(['schedule',delay])
    },
    document:{
      querySelector:selector=>selector==='#postal-code'?fields['postal-code']:
        selector==='#address-number'?fields['address-number']:
        selector==='#address-auto-status span:last-child'?status:null,
      getElementById:id=>fields[id]||null
    },
    hasCartItems:()=>Object.values(state.cart).some(x=>x>0),
    save:()=>history.push('save'),
    toast:message=>history.push(['toast',message])
  });
  vm.runInContext(addressCode+'\nthis.draft=deliveryAddressDraftChanged;this.confirm=setAddress;this.hint=customerAddressDraftGuidance;',context);
  return {context,state,runtime,history,attributes,status,fields};
}
let h=fixture();
h.context.draft();
assert.equal(h.state.postalCode,'973000000','a pasted ninth digit must remain visible for validation');
assert.equal(h.state.address,'');
assert.equal(h.runtime.offers.length,0);
assert.equal(h.runtime.postalValidated,false);
assert.equal(h.runtime.lastCityCheck,null);
assert.ok(h.history.includes('invalidate'));
assert.equal(h.history.some(x=>Array.isArray(x)&&x[0]==='schedule'),false);
assert.match(h.status.textContent,/números a mais/);
assert.equal(h.attributes['postal-aria-invalid'],'true');
await h.context.confirm();
assert.ok(h.history.includes('focus-postal'));
assert.equal(h.history.filter(x=>Array.isArray(x)&&x[0]==='toast').length,1);
assert.equal(h.history.some(x=>x==='render'),false);

h=fixture({postal:'97300-000',number:'1234567'});
h.context.draft();
assert.equal(h.state.addressNumber,'1234567','no seven-digit number truncation');
assert.equal(h.history.some(x=>Array.isArray(x)&&x[0]==='schedule'),false);
assert.equal(h.attributes['number-aria-invalid'],'true');
assert.match(h.status.textContent,/até 6 algarismos/);
await h.context.confirm();
assert.ok(h.history.includes('focus-number'));

h=fixture({postal:'97300-000',number:'13'});
h.context.draft();
assert.equal(h.state.postalCode,'97300000');
assert.equal(h.state.addressNumber,'13');
assert.ok(h.history.some(x=>Array.isArray(x)&&x[0]==='schedule'&&x[1]===650));
assert.equal(h.attributes['postal-aria-invalid'],undefined);
assert.equal(h.attributes['number-aria-invalid'],undefined);

h=fixture({postal:'97300-000',number:'13',cart:{}});
h.context.draft();
assert.match(h.status.textContent,/Escolha um produto/);
assert.equal(h.history.some(x=>Array.isArray(x)&&x[0]==='schedule'),false);

h=fixture({postal:'97300-000',number:'13',ready:false});
h.context.draft();
assert.match(h.status.textContent,/depende da conexão/);
assert.equal(h.history.some(x=>Array.isArray(x)&&x[0]==='schedule'),false);

const pure=fixture().context.hint;
assert.match(pure('', '',{}),/Informe o CEP/);
assert.match(pure('9730','',{}),/Complete o CEP/);
assert.match(pure('97300000','',{}),/Informe o número/);
assert.match(pure('97300000','12',{hasItems:true,serviceReady:true}),/Consultando as opções/);

// Empty fields must not reuse persisted valid values while the visitor corrects them.
h=fixture({postal:'',number:'12'});
await h.context.confirm();
assert.ok(h.history.includes('focus-postal'));
assert.equal(h.state.address,'Rua validada, 12');
assert.equal(h.runtime.offers.length,1,'no server state mutation from an invalid direct submit');

const phoneBegin=customer.indexOf('function syncDeliveryDetailsFromUi(');
const phoneEnd=customer.indexOf('\nfunction deliveryDetailsChanged(){',phoneBegin);
assert.ok(phoneBegin>=0&&phoneEnd>phoneBegin);
function phoneFixture(value){
 const attrs={},events=[],field={
   value,focus(){events.push('focus')},
   setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]}
 };
 const hint={textContent:''};
 const checkout={customerPhoneDigits:'5599990000',addressComplement:'',deliveryReference:'',deliveryNotes:''};
 const context=vm.createContext({
  state:{checkout},save:()=>events.push('save'),toast:s=>events.push(['toast',s]),
  document:{getElementById:id=>id==='delivery-phone'?field:id==='delivery-phone-feedback'?hint:null}
 });
 vm.runInContext(customer.slice(phoneBegin,phoneEnd)+'\nthis.check=syncDeliveryDetailsFromUi;',context);
 return {okay:context.check({requirePhone:true}),checkout,hint,attrs,events};
}
const invalidPhone=phoneFixture('55 99999 8888 7');
assert.equal(invalidPhone.okay,false);
assert.equal(invalidPhone.checkout.customerPhoneDigits,'5599990000');
assert.equal(invalidPhone.attrs['aria-invalid'],'true');
assert.match(invalidPhone.hint.textContent,/sem números extras/);
assert.equal(invalidPhone.events.includes('save'),false);
const validPhone=phoneFixture('(55) 99999-8888');
assert.equal(validPhone.okay,true);
assert.equal(validPhone.checkout.customerPhoneDigits,'55999998888');
assert.ok(validPhone.events.includes('save'));

const order=customer.slice(customer.indexOf('function orderPage(){'),customer.indexOf('\nfunction cartRow(',customer.indexOf('function orderPage(){')));
assert.match(order,/id="postal-code"[^<]+aria-describedby="address-auto-status"/);
assert.match(order,/id="address-number"[^<]+aria-describedby="address-auto-status"/);
assert.match(order,/id="delivery-phone"[^<]+aria-describedby="delivery-phone-feedback"/);
assert.match(order,/id="delivery-phone-feedback"[^>]+role="status"/);
assert.match(order,/address-auto-status" role="status" aria-live="polite"/);
assert.equal((order.match(/address-auto-status" role="status" aria-live="polite"/g)||[]).length,2);
assert.ok(!order.includes("replace(/^(\\d{5})(\\d{0,3}).*$/"),
 'checkout must not hide extra CEP digits when the form rerenders');
for(const selector of ['.order-address-card .address-auto-status','.buyer-contact-card .input[aria-invalid="true"]',
  '@media(max-width:650px)','@media(max-width:350px)'])
 assert.ok(css.includes(selector),'missing responsive checkout error style: '+selector);
assert.ok(customer.includes('customerEligibleCheckoutOffers(os,{testDemo})'),
 'server-backed quote eligibility must remain unchanged');
console.log('TAMÃO V1.380 PASS — exact CEP and number, no stale quotes, actionable address hints, valid phone guard and accessible mobile layout.');
