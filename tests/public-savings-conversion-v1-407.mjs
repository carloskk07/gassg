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
for(const text of [
 'Compare preços para economizar','Cashback','PACOTES DE CUPONS TAMÃO','venda ou resgate',
 'Pacotes de cupons TAMÃO','go(\'club\')','tamao-coupon-preview-ticket'
])assert.ok(benefits.toLowerCase().includes(text.toLowerCase()),'customer must discover '+text);
for(const text of ['Compare preços','cashback','novos clientes','go(\'club\')','go(\'merchants\')']){
 assert.ok(home.toLowerCase().includes(text.toLowerCase()),'top fold missing '+text);
}
assert.ok(benefits.includes('Projeto em desenvolvimento. Sem compra disponível.'));
assert.ok(benefits.includes('Pacotes ainda não estão disponíveis para compra.'));
assert.ok(club.includes('Pacotes de descontos para quem quer pagar menos.'));
assert.ok(club.includes('Venda e resgate ainda não disponíveis.'));
assert.ok(club.includes('Nenhuma cobrança é feita nesta página.'));
assert.doesNotMatch(club,/onclick="(?:checkout|purchaseCoupon|buyCoupon)/i);
for(const text of ['Mais clientes descobrindo sua revenda','Mais oportunidades de pedidos',
 'Mais clientes podem encontrar você','mais chances de receber pedidos',
 'não volume de vendas garantido','Campanhas com cupons e descontos patrocinados estão em preparação']){
  assert.ok(merchant.toLowerCase().includes(text.toLowerCase()),'merchant must explain '+text);
}
const marketingCss=read('css/marketing-premium.css');
for(const selector of [
 '.home-saving-headlines','.tamao-coupon-preview','.tamao-coupon-preview-ticket',
 '.tamao-club-coupon-bundles','.merchant-demand-grid','@media(max-width:800px)'
])assert.ok(marketingCss.includes(selector),'missing '+selector);
assert.match(index,/Compare preços e encontre oportunidades de economia/);
assert.match(index,/mais visibilidade e oportunidades de receber pedidos/i);
assert.doesNotMatch(index,/Cupons já à venda|garantia de economia|vendas garantidas/i);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-savings-'));
try{
 writePublicLandingPages(tmp,{origin:'https://tamao.com.br',indexing:true});
 const buyer=fs.readFileSync(path.join(tmp,'como-funciona','index.html'),'utf8');
 const seller=fs.readFileSync(path.join(tmp,'para-revendas','index.html'),'utf8');
 assert.match(buyer,/Compare preços, encontre economia/);
 assert.match(buyer,/Cashback e descontos/);
 assert.match(buyer,/Pacotes de cupons TAMÃO/);
 assert.match(buyer,/venda de pacotes de cupons ainda não está disponível/);
 assert.match(buyer,/href="\/#club"/);
 assert.match(seller,/Mais clientes conhecendo sua revenda/);
 assert.match(seller,/Mais oportunidades de pedidos/);
 assert.match(seller,/não garante número de pedidos ou clientes/);
 assert.match(seller,/href="\/\?entrada=revenda"/);
 assert.equal((buyer.match(/class="ed-savings"/g)||[]).length,1);
 assert.equal((seller.match(/class="ed-savings"/g)||[]).length,1);
 for(const html of [buyer,seller]){
   assert.ok(html.indexOf('ed-proof-grid')<html.indexOf('ed-savings') &&
     html.indexOf('ed-savings')<html.indexOf('ed-contrast-grid'),
     'clarify economic advantages before storytelling');
   assert.doesNotMatch(html,/vendas garantidas|economia garantida|milhares de clientes/i);
 }
 assert.match(read('css/landing-editorial.css'),/\.ed-savings-cta:focus-visible/);
 console.log('PASS V1.407 — savings-first buyer story, merchant acquisition and coupon-pack prelaunch without checkout claims');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
