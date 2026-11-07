import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js');
const prices=read('js/welcome-bonus.js');
const backend=read('supabase/migrations/20261104220000_clube_public_prices_v1_820.sql');
const begin=growth.indexOf('function club(){');
const end=growth.indexOf('  const purchases=',begin);
assert.ok(begin>=0&&end>begin,'Club visitor branch must exist');

// Exercise the actual guest rendering, not just inspect the HTML literal.
const guestCode=growth.slice(begin,end)+'  return "";\n}';
const context={
 globalThis:{__CHAMA_TEST__:false,document:null,liveReady:()=>false},
 shell:html=>html,render(){},console
};
vm.runInNewContext(guestCode+'\nthis.clubGuest=club;',context);
const html=context.clubGuest();
assert.match(html,/class="tamao-coupon-price-board"/);
for(const field of ['data-coupon-price','data-coupon-face','data-coupon-minimum','data-coupon-availability'])
 assert.ok(html.includes(field),field+' must be populated from public catalog');
assert.match(html,/onsubmit="return tamaoWelcomeRegister\(event\)"/,
 'Guest can register before protected coupon checkout');
assert.match(html,/Ter um pacote não garante ofertas ou revendas disponíveis no seu CEP/);
assert.doesNotMatch(html,/R\$\s*8,90|onclick="clubeCouponBuy|pixCode|qrImageDataUri/,
 'Price cannot be hardcoded and guest cannot trigger Pix');
assert.ok(backend.includes('clube_coupon_home_prices_v1_820()'));
assert.ok(prices.includes("fetch(config.url+'/rest/v1/rpc/clube_coupon_home_prices_v1_820'"));
assert.ok(prices.includes("document.querySelectorAll('.tamao-coupon-price-board')"));

// The actual existing renderer must show validated public prices and fail closed.
const start=prices.indexOf('function tamaoCouponHomeRender(){');
const stop=prices.indexOf('\nasync function tamaoCouponHomeRefresh()',start);
assert.ok(start>=0&&stop>start,'public coupon renderer must exist');
const fields=Object.fromEntries(
 ['[data-coupon-price]','[data-coupon-face]','[data-coupon-minimum]','[data-coupon-availability]']
 .map(key=>[key,{textContent:''}]));
const card={hidden:true,querySelector:selector=>fields[selector]??null};
const state={
 tamaoCouponHome:{package:{
   key:'all_products_3x5_sponsor',priceCents:890,faceCents:500,
   couponCount:3,minOrderCents:5000,validDays:180,databaseReleased:true
 }},
 document:{querySelectorAll:selector=>{
   assert.equal(selector,'.tamao-coupon-price-board');
   return [card];
 }},Intl,Number,Object
};
vm.runInNewContext(prices.slice(start,stop)+'\nthis.showPrice=tamaoCouponHomeRender;',state);
state.showPrice();
assert.equal(card.hidden,false,'valid public catalog reveals price');
assert.match(fields['[data-coupon-price]'].textContent,/8,90/);
assert.match(fields['[data-coupon-face]'].textContent,/3 cupons de R\$\s*5,00/);
assert.match(fields['[data-coupon-minimum]'].textContent,/R\$\s*50,00/);
state.tamaoCouponHome.package={...state.tamaoCouponHome.package,priceCents:0};
state.showPrice();
assert.equal(card.hidden,true,'invalid or missing public prices cannot show a false offer');
state.tamaoCouponHome.package=null;
state.showPrice();
assert.equal(card.hidden,true,'catalog failure hides card');
console.log('TAMÃO V1.879: guest sees only verified public coupon prices and authenticated signup path.');
