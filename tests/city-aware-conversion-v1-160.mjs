import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js');
const backend=read('js/backend.js');
const acquisition=read('js/acquisition.js');
const core=read('js/core.js');
const offers=read('supabase/functions/get-offers/index.ts');
const styles=read('css/components.css');

const regionFunctions=acquisition.match(/function rememberedMarketRegion\([\s\S]*?(?=function prelaunchLeadSent\()/)?.[0];
assert.ok(regionFunctions,'Expected exact-CEP city cache helpers');
const entries=new Map(),localStorage={
  getItem:key=>entries.has(key)?entries.get(key):null,
  setItem:(key,value)=>entries.set(key,String(value))
};
const state={postalCode:'97300000'};
const ctx=vm.createContext({localStorage,state});
vm.runInContext(regionFunctions,ctx);
const extract=(expr)=>JSON.parse(vm.runInContext('JSON.stringify('+expr+')',ctx));
assert.equal(extract('rememberedMarketRegion()'),null,'unknown city must not be guessed');
vm.runInContext("rememberMarketRegion({city:'São Gabriel',state:'RS'},'97300000')",ctx);
assert.deepEqual(extract('rememberedMarketRegion()'),{city:'São Gabriel',state:'RS'});
assert.equal(extract("rememberedMarketRegion('98000000')"),null,'prior CEP cannot personalize another city');
vm.runInContext("rememberMarketRegion({city:'Porto Alegre',state:'RS'},'90000000')",ctx);
assert.equal(extract('rememberedMarketRegion()'),null,'saved CEP mismatch cannot leak another region');
state.postalCode='90000000';
assert.deepEqual(extract('rememberedMarketRegion()'),{city:'Porto Alegre',state:'RS'});
vm.runInContext("rememberMarketRegion({city:'',state:'RS'},'90000000')",ctx);
assert.deepEqual(extract('rememberedMarketRegion()'),{city:'Porto Alegre',state:'RS'},'invalid updates ignored');

const fn=customer.match(/function startHomeOrder\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(fn,'Missing home purchase starter');
function simulateStart(featured,ready=true){
  const state={address:'',postalCode:'',addressNumber:'',cart:{},checkout:{glpContainerMode:''}};
  const calls=[];
  const document={
    querySelector(sel){
      if(sel==='#home-address')return {value:'97300-000'};
      if(sel==='#home-featured-code')return featured==null?null:{value:featured};
      return null;
    }
  };
  const context=vm.createContext({document,state,globalThis:{__CHAMA_TEST__:false,liveReady:()=>ready},
    products:{P13:{hidden:false},WATER20:{hidden:false},HIDDEN:{hidden:true}},
    normalizeCart:()=>({}),setCartProduct:(code,qty)=>calls.push([code,qty]),
    save:()=>{},go:route=>calls.push(['route',route]),toast:()=>{throw Error('Unexpected toast')}
  });
  vm.runInContext(fn,context);
  vm.runInContext('startHomeOrder()',context);
  return {sku:calls[0][0],postal:state.postalCode,route:calls[1][1]};
}
assert.deepEqual(simulateStart('WATER20'),{sku:'WATER20',postal:'97300000',route:'order'});
assert.equal(simulateStart('HIDDEN').sku,'P13');
assert.equal(simulateStart('INVALID<script>').sku,'P13');
assert.equal(simulateStart(null).sku,'P13');

for(const snippet of [
  "const hasConfirmedCityOffers=cityChecked",
  "cityEvidence.postalCode===String(state.postalCode",
  "Date.now()-Number(cityEvidence.checkedAt||0)<10*60*1000",
  "Date.parse(o.expiresAt)>Date.now()",
  "outsideOriginalMarket&&!hasConfirmedCityOffers",
  "globalThis.liveRuntime?.marketMode==='single_supplier'",
  "Number(globalThis.liveRuntime?.eligibleMerchantCount||0)===1",
  "cityChecked&&!hasConfirmedCityOffers",
  "visibleCodes.includes('P13')",
  'id="home-featured-code"',
  'regional-action',
  'Sem opção para meu CEP? Quero receber um aviso',
  "esc(rememberedRegion.city)",
  "esc(eyebrow)",
  'Nenhuma oferta elegível apareceu para este CEP',
  "disabled&&!acquisitionOpen"
])assert.ok(customer.includes(snippet),'Missing city-accurate CTA condition: '+snippet);

for(const snippet of [
  "lastCityCheck:null",
  "liveRuntime.postalValidated=data?.postalValidated===true",
  "serviceCity",
  "serviceState",
  "regionAvailable:data?.regionAvailable===true",
  "postalCode:postalCodeSnapshot",
  "rememberMarketRegion({city:confirmedCity,state:confirmedState},postalCodeSnapshot)",
  "liveRuntime.lastCityCheck=null",
  "liveRuntime.offerRequestSeq"
])assert.ok(backend.includes(snippet),'Missing verified city quotation evidence: '+snippet);

assert.ok(!customer.includes('market?.availableNow&&Number(market?.availableMerchantCount||0)===1'),
 'Global single-merchant status cannot imply one seller for a different city');
assert.ok(offers.includes('serviceCity:postal.city')&&offers.includes('serviceState:postal.state'),
 'City identity must originate in server-side postal validation');
assert.ok(core.includes("const locality=region?esc(region.city)+'/'+esc(region.state):'Consulte sua região'"),
 'Footer must be localized only from verified region');
assert.ok(acquisition.includes('enteredPostal.length===8&&enteredPostal!==leadPostalDigits(state.postalCode'),
 'New CEP must invalidate an old city notification success state');
assert.ok(acquisition.includes('const friendlyCity=verifiedRegion?esc(verifiedRegion.city)'),
 'Lead copy must use HTML-escaped verified region');
assert.ok(styles.includes('.local-welcome')&&styles.includes('.regional-action'),
 'Responsive regional UI must exist');

console.log('V1.160: exact-CEP personalization, anti-leak city cache, no global supply misrepresentation, SKU selection and no-offer opt-in passed.');
