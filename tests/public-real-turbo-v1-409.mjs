import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {writePublicLandingPages} from '../scripts/build-public-landing-pages.mjs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const customer=read('js/customer.js'),growth=read('js/growth.js');
const backend=read('js/backend.js'),admin=read('js/admin-acquisition.js');
const home=customer.slice(customer.indexOf('function tamaoHomeBenefits('),
  customer.indexOf('\nfunction customerProductName('));
const club=growth.slice(growth.indexOf('function club(){'),
  growth.indexOf('\nfunction ',growth.indexOf('function club(){')+10));
const merchant=growth.slice(growth.indexOf('function merchantsLanding(){'),
  growth.indexOf('\nfunction ',growth.indexOf('function merchantsLanding(){')+10));
for(const [name,source] of [['customer',customer],['growth',growth],
  ['backend',backend],['admin',admin]])new vm.Script(source,{filename:name+'.js'});

assert.match(home,/tamao-action-now/);
assert.match(home,/Explorar produtos/);
assert.match(home,/homeDiscoverFocus/,'CTA abre o catálogo em vez de reiniciar a página');
assert.match(home,/cashback de compras elegíveis/);
assert.match(home,/go\('earn'\)/);
assert.doesNotMatch(home,/tamao-coupon-preview|pacotes de cupons|em preparação|venda ou resgate/ig);
assert.match(club,/tamao-club-shop-now/);
assert.match(club,/Economia nas comparações/);
assert.match(club,/SEU CASHBACK DISPONÍVEL/,'Verified members retain actual cashback balance');
assert.match(club,/Encontrar produtos para comprar/);
assert.doesNotMatch(club,/tamao-club-coupon-bundles|pacotes de descontos|em preparação/ig);
assert.ok(merchant.includes('openMerchantPortal(true)'),
 'merchant primary CTA must open live registration');
assert.ok(backend.includes('function openMerchantPortal(signup=false)'));
assert.ok(backend.includes("if(signup===true)destination.hash='merchant-join';"));
assert.ok(backend.includes("destination.searchParams.set('ref',ref)"),
 'referer attribution must survive cross-origin portal handoff');
assert.match(admin,/adminSetSection\(\\'prospects\\'\)/);
assert.match(admin,/admin-clube-technical-gates/);
assert.match(admin,/Somente o Admin principal pode liberar comercialização/);
assert.ok(!read('css/marketing-premium.css').includes('.tamao-coupon-preview{'),
 'remove dead marketing styles');
assert.ok(read('css/marketing-premium.css').includes('.tamao-action-now,'));

const root=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-turbo-real-'));
try{
 writePublicLandingPages(root,{origin:'https://tamao.com.br',indexing:true});
 for(const slug of ['como-funciona','para-revendas','para-marcas','indicacoes']){
  const html=fs.readFileSync(path.join(root,slug,'index.html'),'utf8');
  assert.match(html,/data-tamao-handoff/,'existing safe routing retained');
  assert.doesNotMatch(html,/futuros? pacotes|cupons? em preparação|resgate em breve|venda de pacotes ainda não/i);
  assert.doesNotMatch(html,/economia garantida|vendas garantidas|renda garantida/i);
 }
 const buyers=fs.readFileSync(path.join(root,'como-funciona','index.html'),'utf8');
 const partners=fs.readFileSync(path.join(root,'para-revendas','index.html'),'utf8');
 assert.match(buyers,/Compare para gastar menos/);
 assert.match(buyers,/Cashback na sua conta/);
 assert.match(partners,/Novos clientes podem encontrar você/);
 assert.match(partners,/Cadastrar minha revenda/);
}finally{fs.rmSync(root,{recursive:true,force:true})}

// Hard sale switch must remain closed until there is a real issuance/redemption system.
const sql=read('supabase/migrations/20261014001000_clube_coupon_finance_preview_v1_239.sql');
assert.match(sql,/check \(sales_enabled = false\)/);
assert.match(sql,/check \(redemption_enabled = false\)/);
console.log('V1.409 PASS: real-value public funnel, direct merchant registration, no false coupon checkout and no security bypass.');
