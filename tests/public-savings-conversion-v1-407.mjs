import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {writePublicLandingPages} from '../scripts/build-public-landing-pages.mjs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const customer=read('js/customer.js'),growth=read('js/growth.js'),index=read('index.html');
new vm.Script(customer,{filename:'customer.js'});
new vm.Script(growth,{filename:'growth.js'});
const benefits=customer.slice(customer.indexOf('function tamaoHomeBenefits(){'),customer.indexOf('\nfunction customerProductName('));
const home=customer.slice(customer.indexOf('function home(){'),customer.indexOf('\nfunction orderPage(){'));
const club=growth.slice(growth.indexOf('function club(){'),growth.indexOf('\nfunction ',growth.indexOf('function club(){')+20));
const merchant=growth.slice(growth.indexOf('function merchantsLanding(){'),growth.indexOf('\nfunction merchantJoin(){'));
for(const phrase of [
 'Compare preços, aproveite seu Clube e compre com mais vantagem.',
 'cashback de pedidos elegíveis','go(\'club\')','tamao-action-now'
])assert.ok(benefits.includes(phrase),'customer benefit must be real: '+phrase);
for(const term of ['Compare preços','cashback','novos clientes',"go('club')","go('merchants')"]){
 assert.ok(home.toLowerCase().includes(term.toLowerCase()),'first fold missing '+term);
}
assert.doesNotMatch(benefits,/em preparação|ainda não estão disponíveis|projeto de pacotes|cupons em pacotes/i);
assert.doesNotMatch(club,/em preparação|futura campanha|pacotes de descontos para quem quer pagar menos|venda e resgate ainda não/i);
assert.ok(club.includes('tamao-club-shop-now')&&club.includes("go('home')"),
 'club must lead to live shopping, not a dead-end hypothetical package');
for(const text of ['Mais clientes descobrindo sua revenda','Mais oportunidades de pedidos',
 'Mais clientes podem encontrar você','mais chances de receber pedidos',
 'Cada nova descoberta é uma oportunidade','Sua revenda mantém autonomia']){
  assert.ok(merchant.toLowerCase().includes(text.toLowerCase()),'merchant must explain '+text);
}
const marketingCss=read('css/marketing-premium.css');
for(const selector of [
 '.home-saving-headlines','.tamao-action-now','.tamao-club-shop-now',
 '.merchant-demand-grid','@media(max-width:800px)'
])assert.ok(marketingCss.includes(selector),'missing '+selector);
assert.match(index,/Compare preços de gás, água e essenciais/);
assert.match(index,/um novo canal para alcançar clientes e receber pedidos/i);
assert.doesNotMatch(index,/Cupons já à venda|garantia de economia|vendas garantidas/i);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-savings-'));
try{
 writePublicLandingPages(tmp,{origin:'https://tamao.com.br',indexing:true});
 const buyer=fs.readFileSync(path.join(tmp,'como-funciona','index.html'),'utf8');
 const seller=fs.readFileSync(path.join(tmp,'para-revendas','index.html'),'utf8');
 assert.match(buyer,/Economize tempo e compare preços/);
 assert.match(buyer,/Cashback na sua conta/);
 assert.match(buyer,/Acompanhe do pedido à entrega/);
 assert.match(buyer,/Comparar ofertas agora/);
 assert.match(buyer,/href="\/"/);
 assert.doesNotMatch(buyer,/pacotes? de cupons? em preparação|venda de pacotes de cupons ainda não/i);
 assert.match(seller,/Seus próximos clientes podem descobrir/);
 assert.match(seller,/Mais oportunidades de pedidos/);
 assert.match(seller,/Entre por um canal adicional sem exclusividade/);
 assert.match(seller,/href="\/\?entrada=revenda"/);
 assert.equal((buyer.match(/class="ed-shell ed-savings"/g)||[]).length,1);
 assert.equal((seller.match(/class="ed-shell ed-savings"/g)||[]).length,1);
 for(const html of [buyer,seller]){
   assert.ok(html.indexOf('ed-proof-grid')<html.indexOf('ed-savings') &&
     html.indexOf('ed-savings')<html.indexOf('ed-contrast-grid'),
     'explain real advantages before mechanics');
   assert.doesNotMatch(html,/vendas garantidas|economia garantida|milhares de clientes/i);
 }
 assert.match(read('css/landing-editorial.css'),/\.ed-savings-cta:focus-visible/);
 console.log('PASS V1.407 — operational savings, merchant acquisition and no hypothetical coupon sales.');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
