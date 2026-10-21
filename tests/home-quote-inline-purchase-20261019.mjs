import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const home=read('js/home-showcase.js'),customer=read('js/customer.js');
const css=read('css/marketing-premium.css');
new vm.Script(home,{filename:'home-showcase.js'});
new vm.Script(customer,{filename:'customer.js'});
assert.ok(home.includes("const copy='Clique no produto, coloque seu CEP e consulte as ofertas para o seu endereço.'"));
assert.ok(home.includes("'<h2>Tamão '+esc(place)"),'localized heading must show TAMÃO city/UF');
assert.match(css,/\.city-price-product-pick>summary:focus-visible/);
assert.match(css,/\.city-price-product-fields/);
assert.match(css,/@media\(max-width:370px\)/);
const money={format:value=>'R$ '+Number(value).toFixed(2)};
const catalog={P13:{name:'Gás P13'},WATER20:{name:'Água 20 L'},WOOD:{name:'Lenha'}};
const ctx=vm.createContext({
 globalThis:{liveRuntime:{},liveReady:()=>false},BRL:money,products:catalog,
 customerProductName:(code,p)=>p?.name||code,
 esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
});
vm.runInContext(home+';this.renderQuote=homeRegionalPriceBoard;',ctx);
const local=ctx.renderQuote({city:'São Gabriel',state:'RS'});
assert.match(local,/Tamão São Gabriel\/RS/);
assert.match(local,/Clique no produto, coloque seu CEP e consulte as ofertas para o seu endereço/);
assert.equal((local.match(/class="city-price-research-item"/g)||[]).length,3);
assert.equal((local.match(/class="city-price-product-pick"/g)||[]).length,3);
for(const code of ['P13','WATER20','WOOD']){
 assert.ok(local.includes('data-city-quote-code="'+code+'"'),'product must open own CEP: '+code);
 assert.ok(local.includes("homeQuoteSelectProduct('"+code+"',true)"),'product must use official checkout: '+code);
 assert.ok(local.includes("homeQuoteQuickAdd('"+code+"')"),'one-tap basket must be displayed: '+code);
}
assert.match(local,/Valor de pesquisa, não é oferta/);
assert.ok(!local.includes('class="city-price-card verified"'));
assert.ok(!local.includes('PREÇO DE REVENDA'));
ctx.globalThis.liveRuntime.cityPriceSnapshot={
 source:'public_city_price_board_v1_341',city:'São Gabriel',state:'RS',
 real:true,notAQuote:true,checkedAt:new Date().toISOString(),
 products:[{code:'WATER20',fromCents:1690,toCents:1690,merchantCount:1}]
};
const verified=ctx.renderQuote({city:'São Gabriel',state:'RS'});
assert.equal((verified.match(/class="city-price-product-pick"/g)||[]).length,1);
assert.match(verified,/PREÇO DE REVENDA/);
assert.match(verified,/Preço inicial informativo/);
assert.match(verified,/homeQuoteQuickAdd\('WATER20'\)/);
assert.doesNotMatch(verified,/R\$ 115.90|Pesquisa local informada/);
assert.ok(!ctx.renderQuote({city:'Santa Maria',state:'RS'}).includes('data-city-quote-code="WATER20"'),
 'quote for previous city must not spill into a new region');
const begin=customer.indexOf('function homeQuoteSelectProduct(');
const end=customer.indexOf('function startCustomerAvailability(',begin);
assert.ok(begin>=0&&end>begin);
let postal='',amount='2',feedback='',focus=[],messages=[],routes=[],writes=[];
const state={postalCode:'97300000',address:'Rua validada',addressNumber:'15',
 cart:{P13:0,WATER20:1,WOOD:0},checkout:{glpContainerMode:'exchange'}};
const runtime={offers:[{quoteId:'stale'}],postalValidated:true,lastCityCheck:{ok:true},
 lastSyncAt:42,error:'stale'};
const field=sel=>sel==='.city-price-product-postal'?{get value(){return postal},focus:()=>focus.push('postal')}
 :sel==='.city-price-product-qty'?{get value(){return amount},focus:()=>focus.push('quantity')}
 :sel==='.city-price-product-feedback'?{set textContent(v){feedback=v}}:null;
const pickContext=vm.createContext({
 state,products:catalog,document:{
   querySelector:sel=>sel.includes('data-city-quote-code=')?{querySelector:field}:null
 },
 globalThis:{liveRuntime:runtime,setTimeout:(fn)=>fn()},
 setCartProduct:(code,qty)=>{writes.push([code,qty]);state.cart[code]=qty},
 go:route=>routes.push(route),route:()=>routes.at(-1),
 toast:message=>messages.push(message)
});
vm.runInContext(customer.slice(begin,end)+';this.pick=homeQuoteSelectProduct;',pickContext);
assert.equal(pickContext.pick('bad-code!'),false);
assert.equal(writes.length,0);
assert.equal(pickContext.pick('P13',true),false,'buy must require a ZIP');
assert.equal(messages.at(-1),'Informe seu CEP para consultar as ofertas.');
assert.deepEqual(routes,[]);
postal='97300-0';assert.equal(pickContext.pick('P13',false),false);
assert.equal(writes.length,0);
postal='97300-000';amount='1.5';assert.equal(pickContext.pick('P13',false),false);
amount='21';assert.equal(pickContext.pick('P13',false),false);
amount='2';assert.equal(pickContext.pick('WATER20',false),true);
assert.equal(state.cart.WATER20,3,'basket adds instead of replacing previous purchases');
assert.equal(state.address,'Rua validada','unchanged ZIP retains verified address');
assert.match(feedback,/adicionadas à cesta/);
assert.deepEqual(routes,[]);
postal='90000-000';amount='1';
assert.equal(pickContext.pick('WOOD',true),true);
assert.equal(state.postalCode,'90000000');
assert.equal(state.address,'','new ZIP must invalidate old address');
assert.equal(state.addressNumber,'');
assert.equal(runtime.offers.length,0,'old offer cannot survive ZIP change');
assert.equal(runtime.postalValidated,false);
assert.equal(runtime.lastCityCheck,null);
assert.equal(state.cart.WATER20,3,'basket survives address change');
assert.equal(state.cart.WOOD,1);
assert.deepEqual(routes,['order'],'buyer goes to existing checkout without placing an order');
console.log('PASS quote inline ZIP, quantity, cart, buying route, price provenance and address invalidation.');
