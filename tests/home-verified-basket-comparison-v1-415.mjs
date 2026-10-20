import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const home=read('js/home-showcase.js'),customer=read('js/customer.js'),css=read('css/marketing-premium.css');
new vm.Script(home);new vm.Script(customer);
const now=Date.now(),fingerprint='exact-cart-postal-number-payment-v1';
const state={postalCode:'97300000',address:'Rua autenticada, 50',addressNumber:'50',
 cart:{P13:1,WATER20:2},checkout:{paymentMethod:'pix'}};
const mockOffers=[
 {id:'quote-a',live:true,total:124,deliveryFee:8,etaMax:35,expiresAt:new Date(now+80000).toISOString()},
 {id:'quote-b',live:true,total:119.5,deliveryFee:5,etaMax:45,expiresAt:new Date(now+110000).toISOString()}
];
const rt={postalValidated:true,commerceLaunchBlocked:false,loadingOffers:false,
 lastCityCheck:{postalCode:'97300000',regionAvailable:true},
 lastOfferFingerprint:fingerprint,lastOfferCheckedAt:now,offers:mockOffers};
const ctx=vm.createContext({state,products:{P13:{name:'Gás P13'},WATER20:{name:'Água 20 L'}},
 BRL:{format:n=>'R$ '+Number(n).toFixed(2).replace('.',',')},
 customerProductName:(code,p)=>p?.name||code,
 esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;'),
 liveOfferRequestFingerprint:()=>fingerprint,
 globalThis:{liveReady:()=>true,liveRuntime:rt},Date});
vm.runInContext(home+';this.compare=homeQuoteVerifiedComparison;this.basket=homeQuoteBasketMarkup;',ctx);
let result=ctx.compare();
assert.match(result,/Ofertas consultadas para esta cesta e endereço/);
assert.match(result,/R\$ 119,50/);
assert.ok(result.indexOf('R$ 119,50')<result.indexOf('R$ 124,00'),'sort verified totals');
assert.match(result,/Entrega: R\$ 5,00/);
assert.match(result,/Até 45 min \(estimativa\)/);
assert.match(result,/Cupons e cashback são calculados conforme a elegibilidade/);
assert.doesNotMatch(result,/economia garantida|pedido concluído|desconto aplicado/);
assert.match(ctx.basket(state.cart),/city-price-verified-list/);
rt.lastOfferFingerprint='previous-basket';assert.equal(ctx.compare(),'','fingerprint mismatch');
rt.lastOfferFingerprint=fingerprint;rt.postalValidated=false;assert.equal(ctx.compare(),'','no verified CEP');
rt.postalValidated=true;rt.commerceLaunchBlocked=true;assert.equal(ctx.compare(),'','commercial gate');
rt.commerceLaunchBlocked=false;rt.lastCityCheck.postalCode='00000000';assert.equal(ctx.compare(),'','wrong CEP evidence');
rt.lastCityCheck.postalCode='97300000';rt.lastCityCheck.regionAvailable=false;assert.equal(ctx.compare(),'','unsupported address');
rt.lastCityCheck.regionAvailable=true;rt.lastOfferCheckedAt=now-70000;assert.equal(ctx.compare(),'','stale server refresh');
rt.lastOfferCheckedAt=now;rt.loadingOffers=true;assert.equal(ctx.compare(),'','offer request in flight');
rt.loadingOffers=false;
rt.offers=[{...mockOffers[0],expiresAt:new Date(now-1000).toISOString()}];
assert.equal(ctx.compare(),'','expired offer');
rt.offers=[{...mockOffers[0],total:0},{...mockOffers[1],live:false}];
assert.equal(ctx.compare(),'','fake price or nonlive offer');
rt.offers=mockOffers;
const budgetFields=['.city-price-verified-list{','.city-price-verified-option{'];
for(const field of budgetFields)assert.ok(css.includes(field),'missing verified quote UI stylesheet');

const start=customer.indexOf('function homeQuoteSyncPostal(');
const end=customer.indexOf('function startCustomerAvailability(',start);
assert.ok(start>=0&&end>start);
let postal='90000-000',saved=0,routes=[],messages=[],invalidates=0,focus=0;
const field={get value(){return postal},focus(){focus++}};
const state2={postalCode:'97300000',address:'Rua confirmada',addressNumber:'50',cart:{P13:1}};
const runtime={offers:[{id:'prior'}],postalValidated:true,lastCityCheck:{postalCode:'97300000'},
 lastOfferFingerprint:'old',lastOfferCheckedAt:Date.now(),lastSyncAt:'old'};
const doc={querySelector:sel=>sel.startsWith('.city-price-product')?field:null,
 getElementById:()=>null,querySelectorAll:()=>[]};
const ctx2=vm.createContext({state:state2,document:doc,globalThis:{
 liveRuntime:runtime,liveInvalidateOfferAddressDraft:()=>invalidates++
},toast:t=>messages.push(t),save:()=>saved++,go:t=>routes.push(t)});
vm.runInContext(customer.slice(start,end)+';this.submit=homeQuoteGoToOrder;',ctx2);
assert.equal(ctx2.submit(),true);
assert.deepEqual(routes,['order']);
assert.equal(state2.postalCode,'90000000');
assert.equal(state2.address,'');
assert.equal(state2.addressNumber,'');
assert.equal(state2.cart.P13,1,'no change to cart quantity');
assert.equal(runtime.offers.length,0);
assert.equal(runtime.lastOfferFingerprint,null);
assert.equal(runtime.postalValidated,false);
assert.equal(invalidates,1);
assert.equal(saved,1);
postal='90000-001';assert.equal(ctx2.submit(),true);
assert.equal(state2.postalCode,'90000001');
postal='not-a-cep';routes=[];assert.equal(ctx2.submit(),false);
assert.equal(routes.length,0);assert.equal(focus,1);
assert.match(messages.at(-1),/CEP válido/);
console.log('PASS home quote comparison matches server fingerprint, CEP and expiry; basket action preserves postal without placing order.');
