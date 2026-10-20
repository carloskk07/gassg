import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const home=read('js/home-showcase.js');
const customer=read('js/customer.js');
const css=read('css/marketing-premium.css');
new vm.Script(home,{filename:'js/home-showcase.js'});
new vm.Script(customer,{filename:'js/customer.js'});
assert.ok(!home.includes('Os preços reais substituem as referências automaticamente'));
assert.match(home,/tamao-home-coupon-rail/);
assert.match(home,/Ver cupons e Clube/);
assert.match(home,/Consulta por CEP|consulta por CEP|consulte ofertas|consulte as ofertas/i);
assert.match(home,/snapshot.real===true/);
assert.match(home,/snapshot.notAQuote===true/);
assert.ok(home.indexOf('city-price-grid')<home.indexOf('tamao-home-coupon-rail'),
  'price comparison must precede coupon CTA');
const from=customer.indexOf('function home(){');
const to=customer.indexOf('\nfunction orderPage(){',from);
const homePage=customer.slice(from,to);
assert.ok(from>=0&&to>from);
assert.match(homePage,/COMPRE BEM. ECONOMIZE MAIS. COMPARTILHE./);
assert.ok(!homePage.includes('PRIMEIRO ESCOLHA. DEPOIS, CONFIRA A ENTREGA.'));
assert.ok(homePage.indexOf('homeRegionalPriceBoard(homeRegion)')<
  homePage.indexOf('home-discover-grid'),'quotes must appear before full catalog');
assert.match(homePage,/Cupons, cashback e Clube/);
for(const rule of ['.tamao-home-coupon-rail','.city-price-research-grid',
  '.tamao-home-checkout-compare']){
  assert.ok(css.includes(rule),'missing responsive CSS '+rule);
}

const money={format:value=>'R$ '+Number(value).toFixed(2)};
const quoteContext=vm.createContext({
  globalThis:{liveRuntime:{},liveReady:()=>false},
  BRL:money,
  PUBLIC_P13_REFERENCE:{minimum:115.90,usual:120,maximum:125},
  products:{P13:{name:'Gás P13'},WATER20:{name:'Água 20 L'},WOOD:{name:'Lenha'}},
  customerProductName:(code,obj)=>obj?.name||code,
  esc:x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  Date
});
vm.runInContext(home+';this.priceBoard=homeRegionalPriceBoard;',quoteContext);
const local=quoteContext.priceBoard({city:'São Gabriel',state:'RS'});
for(const expected of ['R$ 115.90','R$ 15.90','R$ 25.00','15/10/2026',
  'REFERÊNCIA LOCAL','não é oferta de revenda','Ver cupons e Clube']){
  assert.ok(local.includes(expected),'local research missing '+expected);
}
assert.ok(!local.includes('Os preços reais substituem as referências'));
assert.ok(!local.includes('class="city-price-card verified"'));
const elsewhere=quoteContext.priceBoard({city:'Santa Maria',state:'RS'});
assert.ok(!elsewhere.includes('R$ 115.90'),'research must not be used as other-city price');
quoteContext.globalThis.liveRuntime.cityPriceSnapshot={
 source:'public_city_price_board_v1_341',city:'São Gabriel',state:'RS',
 real:true,notAQuote:true,checkedAt:new Date().toISOString(),
 products:[{code:'WATER20',fromCents:1690,toCents:1690,merchantCount:1}]
};
const eligible=quoteContext.priceBoard({city:'São Gabriel',state:'RS'});
assert.match(eligible,/class="city-price-card verified"/);
assert.match(eligible,/R\$ 16\.90/);
assert.ok(!eligible.includes('Pesquisa local informada em 15/10/2026.'),
 'eligible current data must replace local research');
quoteContext.globalThis.liveRuntime.cityPriceSnapshot.real=false;
assert.ok(!quoteContext.priceBoard({city:'São Gabriel',state:'RS'})
  .includes('class="city-price-card verified"'),
  'unverified source must not be presented as an offer');

const offerStart=customer.indexOf('function offerCard(o,facts={}){');
const offerEnd=customer.indexOf('// V1.380',offerStart);
assert.ok(offerStart>=0&&offerEnd>offerStart);
const state={user:{cashback:10},checkout:{useCashback:true,paymentMethod:'pix'}};
const offerContext=vm.createContext({
 state,globalThis:{liveRuntime:{},CHAMA_INTERNAL_PILOT:false},
 BRL:money,roundMoney:x=>Math.round(x*100)/100,paymentLabel:()=> 'Pix',
 esc:x=>String(x??'')
});
vm.runInContext(customer.slice(offerStart,offerEnd)+';this.card=offerCard;',offerContext);
const quote={id:'test-quote',total:150,deliveryFee:10,eta:30,etaMax:45,roles:[]};
const selected=offerContext.card(quote);
assert.match(selected,/SEM BENEFÍCIO/);
assert.match(selected,/COM CASHBACK TAMÃO/);
assert.match(selected,/R\$ 150\.00/);
assert.match(selected,/R\$ 140\.00/);
state.checkout.useCashback=false;
const preview=offerContext.card(quote);
assert.match(preview,/ative o uso do saldo acima/);
assert.ok(!preview.includes('Cashback solicitado (estimativa)'),
  'unselected cashback preview is not an applied discount');
state.user.cashback=0;
const empty=offerContext.card(quote);
assert.match(empty,/Sem desconto aplicado/);
assert.ok(!empty.includes('COM CASHBACK TAMÃO'));
assert.ok(!offerContext.card({id:'invalid',eta:30,roles:[]})
  .includes('class="tamao-home-checkout-compare"'));
console.log('PASS: production-safe home research/verified offers, coupon CTA, cashback comparison and empty state.');
