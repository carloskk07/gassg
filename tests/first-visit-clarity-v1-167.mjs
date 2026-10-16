import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const customer=fs.readFileSync(new URL('../js/customer.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../css/components.css',import.meta.url),'utf8');
const start=customer.indexOf('function home(){');
const end=customer.indexOf('\nfunction orderPage(){',start);
assert.ok(start>=0&&end>start,'Home must be present');
const homeHelpers=customer.slice(customer.indexOf('function homeProductGroup('),start);
const homeSource=customer.slice(start,end);
assert.ok(css.includes('.home-first-visit .hero-grid')&&css.includes('.first-visit-intent-grid'),
 'Concise home must have responsive layout');

function render({ready=true,available=false,city='São Gabriel',postalCode='97300000',demo=false}={}){
 const market={realSupplyConfigured:available,productCodes:available?['P13']:[],
   commercialPolicy:{platformFeeBps:750}};
 const marketStatus=ready?market:null;
 const runtime={
   status:ready?'ready':'unavailable',
   marketStatus,
   lastCityCheck:available?{postalCode,checkedAt:Date.now(),offerCount:1}:null,
   offers:available?[{expiresAt:new Date(Date.now()+600000).toISOString()}]:[],
   eligibleMerchantCount:available?1:0,
   lastOrderTemplate:null,
   reorderPrediction:null
 };
 const state={postalCode,address:'',cart:{},user:{}};
 const context=vm.createContext({
   state,
   products:{P13:{name:'Botijão de cozinha 13 kg',icon:'🔥',hidden:false,sortOrder:1},WATER20:{name:'Água 20 L',icon:'💧',hidden:false,sortOrder:2}},
   globalThis:{
     __CHAMA_TEST__:demo,CHAMA_INTERNAL_PILOT:false,
     liveReady:()=>ready,prelaunchExamplesEnabled:()=>false,
     liveRuntime:runtime
   },
   rememberedMarketRegion:()=>({city,state:'RS'}),
   minPrice:()=>120,
   customerProductName:(code,product)=>product?.name||code,
   tamaoProductArt:(code)=>'<span class="test-product-art">'+code+'</span>',
   BRL:{format:value=>'R$ '+Number(value).toFixed(2)},
   PUBLIC_P13_REFERENCE:{usual:120},
   esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
   publicP13PriceReference:()=>'<div class="reference-p13">Preço de referência, não é oferta</div>',
   prelaunchCustomerLeadSection:()=>'<section id="early-access"><input id="prelaunch-postal"></section>',
   prelaunchTransparencyBand:()=>'<section class="prelaunch-transparency"></section>',
   shell:html=>html
 });
 vm.runInContext(homeHelpers+'\n'+homeSource,context,{timeout:1000});
 return vm.runInContext('home()',context,{timeout:1000});
}
const noSupply=render();
assert.match(noSupply,/home-first-visit/);
assert.match(noSupply,/home-editorial-visual/);
assert.match(noSupply,/home-discover-filter/);
assert.match(noSupply,/Consultar meu CEP|Escolher produtos →/);
assert.match(noSupply,/São Gabriel/);
assert.match(noSupply,/Quer saber mais ou tem uma revenda\?/);
assert.match(noSupply,/Cadastrar minha empresa/);
assert.match(noSupply,/id="early-access"/);
assert.match(noSupply,/id="prelaunch-postal"/);
assert.match(noSupply,/Consulta por CEP/);
assert.doesNotMatch(noSupply,/class="hero-visual"/,
 'No fake live-looking order showcase without supply');
assert.doesNotMatch(noSupply,/class="quick-grid"/,
 'No product buttons implying inventory without verified offers');
assert.doesNotMatch(noSupply,/class="protection-band"/,
 'No duplicated explanations on the first visit');
assert.doesNotMatch(noSupply,/class="prelaunch-transparency"/,
 'No redundant three-step lecture next to the real CEP form');
assert.doesNotMatch(noSupply,/Quero vender no TAMÃO/,
 'Partner path should be clear and short, without a second promotional section');
assert.ok((noSupply.match(/class="section /g)||[]).length<=2,
 'Unserved region must focus on main CTA, signup and simple paths');

const unavailable=render({ready:false});
assert.match(unavailable,/Consultar meu CEP|Escolher produtos →/);
assert.doesNotMatch(unavailable,/class="quick-grid"/);
assert.doesNotMatch(unavailable,/class="hero-visual"/);
assert.match(unavailable,/Os preços de revendas aparecem após confirmação|Confira seu CEP/,
 'Browsing remains inviting; checkout still verifies real service availability');

const withOffers=render({available:true});
assert.doesNotMatch(withOffers,/home-first-visit/);
assert.match(withOffers,/class="hero-visual"/);
assert.match(withOffers,/class="quick-grid"/);
assert.match(withOffers,/Botijão de cozinha 13 kg/);
assert.match(withOffers,/Conferir ofertas do meu CEP/);
assert.doesNotMatch(withOffers,/id="early-access"/,
 'A city with a verified valid offer must not be put into lead-only flow');

const demo=render({demo:true,ready:false});
assert.doesNotMatch(demo,/home-first-visit/);
assert.match(demo,/class="hero-visual"/);
assert.match(demo,/class="quick-grid"/);
assert.doesNotMatch(demo,/id="early-access"/,
 'Internal demo must remain isolated from live lead capture');

const untrusted=render({city:'Cidade <script>alert(1)</script>',available:false});
assert.doesNotMatch(untrusted,/<script>/);
assert.match(untrusted,/Cidade &lt;script>/,
 'Untrusted city name must remain escaped in user-facing text');

console.log('V1.167: unserved region concise; no pretend offers; real supply and internal demo preserved.');
