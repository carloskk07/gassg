import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js');
const acquisition=read('js/acquisition.js');
const core=read('js/core.js');

function functionSource(content,start,end){
  const from=content.indexOf(start);
  const to=content.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,'Missing function boundaries '+start);
  return content.slice(from,to);
}
const startHome=functionSource(customer,'async function startHomeOrder(){','// Consulta ofertas reais');
const startAvailability=functionSource(customer,'function startCustomerAvailability(){','function hasGlpCart(');
const leadInterest=functionSource(acquisition,'function customerLeadInterestSelection(','function prelaunchCustomerLeadSection()');
const merchantLead=functionSource(acquisition,'function openPrelaunchMerchantLead(){','async function submitPrelaunchMerchantLead()');
const customerLead=functionSource(acquisition,'function openPrelaunchCustomerLead(){','function prelaunchTransparencyBand()');

function purchase({homePostal='97300-000',existingPostal='97300000',
 address='Rua Validada, 12',number='12',cart={WATER20:1},feature='P13'}={}){
  const calls=[];
  const state={postalCode:existingPostal,address,addressNumber:number,cart,checkout:{glpContainerMode:'needs_container'}};
  const liveRuntime={offers:[{quoteId:'quote'}],postalValidated:true,lastCityCheck:{city:'São Gabriel'},lastSyncAt:'2026-10-11',error:'stale'};
  const homeInput={value:homePostal,focus:()=>calls.push('focus')};
  const document={querySelector(sel){
    return sel==='#home-address'?homeInput
      :sel==='#home-featured-code'?{value:feature}:null;
  }};
  const globalThis={__CHAMA_TEST__:false,liveRuntime};
  const context=vm.createContext({
    state,document,globalThis,liveRuntime,
    products:{P13:{hidden:false},WATER20:{hidden:false}},
    normalizeCart:()=>({}),setCartProduct:(sku,quantity)=>{calls.push(['product',sku,quantity]);state.cart[sku]=quantity},
    save:()=>calls.push('save'),go:route=>calls.push(['route',route]),
    toast:value=>calls.push(['toast',value])
  });
  return {ctx:context,async run(){
    await vm.runInContext(startHome+';startHomeOrder()',context);
    return {state,liveRuntime,calls};
  }};
}
const retained=await purchase().run();
assert.equal(retained.state.postalCode,'97300000');
assert.equal(retained.state.address,'Rua Validada, 12');
assert.equal(retained.state.addressNumber,'12');
assert.equal(retained.state.cart.WATER20,1);
assert.equal(retained.state.cart.P13,undefined,'Existing basket must not silently become a P13 purchase');
assert.equal(retained.calls.some(x=>Array.isArray(x)&&x[0]==='product'),false,'Do not reset existing cart');
assert.equal(retained.calls.some(x=>Array.isArray(x)&&x[0]==='route'&&x[1]==='order'),true);

const changed=await purchase({homePostal:'90000-000'}).run();
assert.equal(changed.state.postalCode,'90000000');
assert.equal(changed.state.address,'','Old street cannot cross CEP boundary');
assert.equal(changed.state.addressNumber,'','Old number cannot cross CEP boundary');
assert.equal(changed.liveRuntime.offers.length,0,'Old prices must be invalidated');
assert.equal(changed.liveRuntime.lastCityCheck,null,'Old city quote proof must be invalidated');
assert.equal(changed.state.cart.WATER20,1,'Basket survives city changes so buyers can check their items');

const fresh=await purchase({cart:{},feature:'WATER20'}).run();
assert.equal(fresh.state.cart.WATER20,1,'Home highlighted category must be the SKU added to order');
assert.equal(fresh.state.cart.P13,undefined,'Water-only entry must not add gas');
const injection=await purchase({cart:{},feature:'P13<script>'}).run();
assert.equal(injection.state.cart.P13,1,'Bad SKU must fail closed to valid fallback');

const invalid=await purchase({homePostal:'9730',cart:{}}).run();
assert.equal(invalid.calls.some(x=>Array.isArray(x)&&x[0]==='route'),false);
assert.equal(invalid.calls.some(x=>Array.isArray(x)&&x[0]==='toast'),true);

function availability(value,ready){
  const calls=[];
  const input={value,focus:()=>calls.push('focus')};
  const globalThis={__CHAMA_TEST__:false,liveReady:()=>ready,
    document:{querySelector:()=>input}};
  const ctx=vm.createContext({globalThis,
    toast:t=>calls.push(['toast',t]),
    startHomeOrder:()=>calls.push('order'),
    openPrelaunchCustomerLead:()=>calls.push('notice')
  });
  vm.runInContext(startAvailability+';startCustomerAvailability()',ctx);
  return calls;
}
assert.deepEqual(availability('97300-000',true),['order']);
assert.deepEqual(availability('97300-000',false),['notice']);
assert.equal(availability('97300',true).includes('order'),false);
assert.equal(availability('',false).includes('notice'),false,'Empty CEP should not jump to an opt-in form');

const interestContext=vm.createContext({state:{cart:{}},products:{
  P13:{categoryKey:'glp'},WATER20:{categoryKey:'water'},ICE5:{categoryKey:'ice'},
  SPECIAL:{categoryKey:'other'},P13_CONTAINER:{categoryKey:'glp'}
}});
vm.runInContext(leadInterest,interestContext);
const requested=cart=>Array.from(vm.runInContext(
  'customerLeadInterestSelection('+JSON.stringify(cart)+')',interestContext)).sort();
assert.deepEqual(requested({}),['gas'],'Fallback default is an editable selection only');
assert.deepEqual(requested({WATER20:1}),['water'],'Water-only basket must not preselect gas in the alert');
assert.deepEqual(requested({WATER20:1,P13:1,P13_CONTAINER:1}),['gas','water']);
assert.deepEqual(requested({ICE5:1,SPECIAL:1}),['ice','other']);

const routeActions=[];
let route='home';
const merchantDoc={
  getElementById:()=>({scrollIntoView:()=>routeActions.push('scroll')}),
  querySelector:()=>({focus:()=>routeActions.push('focus')})
};
const mctx=vm.createContext({document:merchantDoc,route:()=>route,
  go:r=>{route=r;routeActions.push('go:'+r)},
  setTimeout:fn=>fn()});
vm.runInContext(merchantLead+';openPrelaunchMerchantLead()',mctx);
assert.deepEqual(routeActions,['go:merchants','scroll','focus'],
 'Merchant home CTA must navigate to the real form and focus without a second click');

for(const piece of [
  "id=\"home-address\"", "onkeydown=\"if(event.key==='Enter')",
  "Falta apenas informar o número",
  "Nenhuma opção encontrada para esta cesta e CEP agora.",
  "Me avise quando houver disponibilidade",
  "O servidor confirma rua, bairro e atendimento para o CEP informado",
  'openPrelaunchMerchantLead()'
])assert.ok(customer.includes(piece),'Missing seamless buyer journey: '+piece);
for(const piece of [
  "document.querySelector('#home-address')||document.querySelector('#postal-code')",
  "state.addressNumber=''",
  "state.postalCode=enteredPostal",
  "function customerLeadInterestSelection(",
  "checkedInterest('water')",
  "checkedInterest('gas')",
  "function openPrelaunchMerchantLead()"
])assert.ok(acquisition.includes(piece),'Missing opt-in continuity: '+piece);
assert.ok(core.includes("postalCode:''"),'Customer state still persists the canonical postal value');
console.log('V1.161: saved basket/address, new city quote invalidation, Enter/CEP input, relevant opt-in categories and 1-click merchant form passed.');
