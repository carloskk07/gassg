import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const home=read('js/home-showcase.js');
const customer=read('js/customer.js');
const backend=read('js/backend.js');
const acquisition=read('js/acquisition.js');
const css=read('css/components.css');
const core=read('js/core.js');
const index=read('index.html');
const migration=read('supabase/migrations/20261016235959_public_city_price_board_v1_341.sql');
const audit=read('.github/workflows/audit.yml');

for(const [name,script] of [['home-showcase',home],['customer',customer],
 ['backend',backend],['acquisition',acquisition],['core',core]])new vm.Script(script,{filename:name+'.js'});
assert.ok(index.indexOf('js/home-showcase.js')<index.indexOf('js/customer.js'));
for(const t of [
 'public_city_price_board_v1_341','market_city_offer_scope(v_city,v_state)',
 'merchant_basket_compliance_current(m.id,array[ci.product_code])',
 "ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'",
 'ci.available_stock>0','ci.active','m.delivery_fee_cents>=0',
 'min(estimated_total_cents)','max(estimated_total_cents)',
 'count(distinct merchant_id)','requiresPostalConfirmation',
 "'notAQuote',true","'real',true",
 'from public.merchants m','grant execute on function public.public_city_price_board_v1_341',
 'to authenticated,service_role'
])assert.ok(migration.includes(t),'Missing real-price policy: '+t);
assert.doesNotMatch(migration,/\b(?:drop\s+table|delete\s+from|insert\s+into|update\s+public\.|truncate\s+table)\b/i);
assert.ok(!migration.includes('grant execute on function public.public_city_price_board_v1_341(text,text)\n to anon'));
for(const t of [
 "liveRuntime.client.rpc('public_city_price_board_v1_341'",
 'liveRefreshCityPriceBoard({force:true})','CUSTOMER_CITY_BOARD_REFRESH_MS',
 'data?.notAQuote!==true','data?.requiresPostalConfirmation!==true',
 'data.products.length!==data.productCount','liveRuntime.cityPriceSnapshot=data',
 'globalThis.liveRefreshCityPriceBoard=liveRefreshCityPriceBoard'
])assert.ok(backend.includes(t),'Missing safe automatic update: '+t);
assert.match(audit,/node tests\/customer-city-price-showcase-v1-341\.mjs/);
assert.ok(customer.includes('homeRegionalPriceBoard(homeRegion)'));
assert.ok(customer.includes('starter-postal-optional'));
assert.ok(customer.includes('return startHomeOrder();'));
assert.ok(!customer.slice(customer.indexOf('function startCustomerAvailability(){'),
  customer.indexOf('\nfunction hasGlpCart(')).includes('return openPrelaunchCustomerLead()'));
assert.ok(core.includes("['home','learn','earn','club'"));
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
assert.ok(css.includes('.city-price-grid'));

const region={city:'São Gabriel',state:'RS',origin:'showcase'};
const mkContext=(snapshot=null)=>{
 const env=vm.createContext({
  globalThis:{liveRuntime:{cityPriceSnapshot:snapshot}},
  BRL:{format:n=>'R$ '+Number(n).toFixed(2)},
  PUBLIC_P13_REFERENCE:{minimum:115.90,usual:120,maximum:125},
  customerProductName:(code,p)=>p.name,
  products:{P13:{name:'Gás 13 kg'},WATER20:{name:'Água 20 litros'}},
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
 });
 vm.runInContext(home,env);
 return env;
};
let env=mkContext();
let html=vm.runInContext('homeRegionalPriceBoard({city:"São Gabriel",state:"RS",origin:"showcase"})',env);
assert.match(html,/R\$ 115.90/);
assert.match(html,/R\$ 120.00/);
assert.match(html,/R\$ 125.00/);
assert.equal((html.match(/REFERÊNCIA LOCAL • NÃO É OFERTA/g)||[]).length,1,
 'a single market reference must not be presented as three seller cards');
assert.match(html,/city-price-reference-summary/);
assert.match(html,/Não representa uma revenda/);
assert.doesNotMatch(html,/PREÇO DE REVENDA/);
assert.match(html,/São Gabriel é a vitrine inicial/);
assert.doesNotMatch(html,/quoteId|merchantId|checkout\(/i);
html=vm.runInContext('homeRegionalPriceBoard({city:"Outra Cidade",state:"RS",origin:"chosen"})',env);
assert.doesNotMatch(html,/R\$ 115.90|R\$ 120.00|R\$ 125.00/);
assert.match(html,/Não exibimos preços inventados/);
assert.match(html,/Ver outra cidade/);
const real={
 source:'public_city_price_board_v1_341',city:'São Gabriel',state:'RS',
 kind:'eligible_merchant_estimates',real:true,notAQuote:true,requiresPostalConfirmation:true,
 productCount:2,checkedAt:new Date().toISOString(),
 products:[
  {code:'P13',fromCents:11890,toCents:12600,merchantCount:2,
   updatedAt:new Date().toISOString()},
  {code:'WATER20',fromCents:1850,toCents:1850,merchantCount:1,
   updatedAt:new Date().toISOString()}
 ]
};
env=mkContext(real);
html=vm.runInContext('homeRegionalPriceBoard({city:"São Gabriel",state:"RS",origin:"confirmed"})',env);
assert.match(html,/R\$ 118.90/);
assert.match(html,/R\$ 126.00/);
assert.match(html,/R\$ 18.50/);
assert.match(html,/2 revendas elegíveis/);
assert.doesNotMatch(html,/R\$ 115.90|R\$ 120.00|R\$ 125.00/);
assert.doesNotMatch(html,/REFERÊNCIA LOCAL • NÃO É OFERTA/);
assert.match(html,/não são cotações finais/);
html=vm.runInContext('homeRegionalPriceBoard({city:"Rio Grande",state:"RS",origin:"chosen"})',env);
assert.doesNotMatch(html,/R\$ 118.90|PREÇO DE REVENDA/,
 'real prices cannot leak from previous city selection');

const key='tamao-home-region-v1-341';
const saved=new Map();
const storage={
 getItem:k=>saved.get(k)??null,
 setItem:(k,v)=>saved.set(k,String(v))
};
let known=null,chosenCity='',chosenUf='',renders=0,quoteCalls=0;
const uiCtx=vm.createContext({
 state:{postalCode:'',address:'unchanged',cart:{P13:1}},
 globalThis:{liveRuntime:{cityPriceSnapshot:real},
  liveRefreshCityPriceBoard:async()=>{quoteCalls++}},
 localStorage:storage,document:{getElementById:k=>({
   'home-city-name':{value:chosenCity},
   'home-city-uf':{value:chosenUf}
 })[k]||null},
 rememberedMarketRegion:()=>known,
 toast:()=>{throw Error('Unexpected validation error')},
 render:()=>{renders++}
});
const start=acquisition.indexOf('const TAMAO_HOME_REGION_KEY=');
const end=acquisition.indexOf('function prelaunchLeadSent(',start);
assert.ok(start>=0&&end>start);
vm.runInContext(acquisition.slice(start,end),uiCtx);
assert.equal(vm.runInContext('homeMarketRegion().origin',uiCtx),'showcase');
known={city:'Porto Alegre',state:'RS'};
assert.equal(vm.runInContext('homeMarketRegion().city',uiCtx),'Porto Alegre');
known=null;chosenCity='Caxias do Sul';chosenUf='RS';
vm.runInContext('homeChooseMarketCity()',uiCtx);
assert.equal(JSON.parse(saved.get(key)).city,'Caxias do Sul');
assert.equal(vm.runInContext('homeMarketRegion().origin',uiCtx),'chosen');
assert.equal(uiCtx.state.address,'unchanged','showcase must not overwrite delivery');
assert.equal(uiCtx.state.postalCode,'','showcase must not create fake postal');
assert.equal(quoteCalls,1);
assert.ok(renders>=1);

const caller=backend.slice(backend.indexOf('const CUSTOMER_CITY_BOARD_REFRESH_MS'),
 backend.indexOf('\nfunction prelaunchExamplesEnabled()'));
const runtime={client:{rpc:async()=>({data:real,error:null})},cityPriceSnapshot:null,lastCityPriceBoardAt:0};
let requested={city:'São Gabriel',state:'RS'},rpcCalls=0;
runtime.client.rpc=async()=>{rpcCalls++;return {data:real,error:null}};
const bctx=vm.createContext({liveRuntime:runtime,liveReady:()=>true,
 homeMarketRegion:()=>requested,Date,Number,Array,globalThis:{}});
vm.runInContext(caller,bctx);
const returned=await bctx.liveRefreshCityPriceBoard({force:true});
assert.equal(returned.productCount,2);
assert.equal(rpcCalls,1);
assert.equal((await bctx.liveRefreshCityPriceBoard()).productCount,2);
assert.equal(rpcCalls,1,'avoid wasteful polling');
requested={city:'Rio Grande',state:'RS'};
runtime.client.rpc=async()=>({data:real,error:null});
await assert.rejects(()=>bctx.liveRefreshCityPriceBoard({force:true}),/não validada/);
assert.equal(runtime.cityPriceSnapshot.city,'São Gabriel','invalid city response must not replace prior');
console.log('V1.341 PASS: real merchant-only city prices, truthful local reference fallback, region isolation, optional CEP, polling and presentation safety.');
