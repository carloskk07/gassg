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
assert.match(noSupply,/tamao-home-catalog/,'public catalog remains available');
assert.match(noSupply,/tamao-home-services-grid/,'one service collection visible');
assert.match(noSupply,/home-discover-filter/,'category filters remain functional');
assert.match(noSupply,/class="intent-card tamao-home-service"/);
assert.equal((noSupply.match(/class="intent-grid tamao-home-services-grid tamao-home-support-grid"/g)||[]).length,1,
 'public visitor should see exactly one secondary service grid');
assert.equal((noSupply.match(/class="tamao-home-mobility-grid"/g)||[]).length,1,
 'mobility choices should be highlighted once rather than repeated');
assert.doesNotMatch(noSupply,/class="hero marketing-hero"/,
 'regional board already introduces products; second large hero is redundant');
assert.doesNotMatch(noSupply,/class="home-editorial-visual"/,
 'avoid showing the same products in a second photographic vitrine');
assert.doesNotMatch(noSupply,/class="home-trust-brief"/,
 'avoid repetitive educational sections');
assert.doesNotMatch(noSupply,/class="quick-grid"/,
 'do not display a second products grid');
assert.doesNotMatch(noSupply,/class="protection-band"/);
assert.match(noSupply,/id="early-access"/,
 'unserved customers must retain the lead pathway');
assert.match(noSupply,/São Gabriel/);
assert.match(noSupply,/Consulte preços e entrega pelo CEP/);
assert.match(noSupply,/\/\?modalidade=moto#mobility/);
assert.match(noSupply,/\/\?modalidade=carro#mobility/);
assert.match(noSupply,/\/\#rides/);
assert.match(noSupply,/\/\#stays/);
assert.ok(noSupply.indexOf('id="home-discover"')<noSupply.indexOf('tamao-home-services-grid'));
assert.ok(noSupply.indexOf('tamao-home-services-grid')<noSupply.indexOf('id="early-access"'));

const unavailable=render({ready:false});
assert.match(unavailable,/tamao-home-catalog/);
assert.doesNotMatch(unavailable,/class="hero marketing-hero"/);
assert.match(unavailable,/id="early-access"/);

const withOffers=render({available:true});
assert.match(withOffers,/tamao-home-catalog/);
assert.match(withOffers,/tamao-home-services-grid/);
assert.doesNotMatch(withOffers,/id="early-access"/,
 'live offers must not be replaced by a lead-only flow');
assert.doesNotMatch(withOffers,/class="hero-visual"/);
assert.doesNotMatch(withOffers,/class="quick-grid"/);
assert.match(withOffers,/Botijão de cozinha 13 kg/);

const demo=render({demo:true,ready:false});
assert.match(demo,/class="hero-visual"/);
assert.match(demo,/class="quick-grid"/);
assert.doesNotMatch(demo,/id="early-access"/);

const untrusted=render({city:'Cidade <script>alert(1)</script>',available:false});
assert.doesNotMatch(untrusted,/<script>/);
assert.match(untrusted,/Cidade &lt;script>/);

console.log('V1.167 + benefits: no pretend offers, accessible participation in pre-opening, real supply and demo preserved.');
