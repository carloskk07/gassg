import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { writePublicLandingPages } from '../scripts/build-public-landing-pages.mjs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const customer=read('js/customer.js');
const home=customer.slice(customer.indexOf('function home(){'),customer.indexOf('\nfunction orderPage(){'));
new vm.Script(customer,{filename:'customer.js'});

assert.ok(home.includes('$'+'{valueBridge}'),'visitor paths must show before offers are available');
assert.ok(home.includes('typeof tamaoHomeBenefits===') && !home.includes('!conciseHome&&typeof tamaoHomeBenefits'),
  'customer benefits must not disappear on first visits');
assert.ok(home.includes('home-benefits-shortcuts'),'first screen should show club and referral discovery');
assert.ok(home.includes('visitor-path-sponsor') && home.includes("go('sponsors')"),
  'the sponsor should also have a public journey');
assert.ok(home.indexOf("${acquisitionOpen?prelaunchCustomerLeadSection():''}")<home.indexOf("${valueBridge}"),
  'availability signup should not be buried below editorial sections');
assert.ok(home.includes("go('earn')"),'benefit discovery CTA must use real route');
assert.ok(home.includes('homeRegionalPriceBoard(homeRegion)'),'regional verified prices remain');
assert.ok(home.includes('citySnapshot?.real===true&&citySnapshot?.notAQuote===true'),
  'no fabricated public price information');
assert.ok(!home.includes("!conciseHome?valueBridge"),'no hiding merchant and referral value on pre-opening');
assert.match(read('css/marketing-premium.css'),/\.home-benefits-shortcuts button:focus-visible/);
const index=read('index.html');
assert.match(index,/Clube e indicações/);
assert.match(index,/mais oportunidades para vender/);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-benefits-first-'));
try {
 const slugs=writePublicLandingPages(root);
 assert.equal(slugs.length,4);
 const expected=[
  ['como-funciona','A cesta é sua','O valor antes do pedido','A entrega acompanhada'],
  ['para-revendas','Seus produtos, suas regras','Recebimento sob seu controle','Sem exclusividade'],
  ['para-marcas','Divulgação regional','Ações com benefícios','Comércio local'],
  ['indicacoes','Convide pessoas','Apresente revendas','Acompanhe convites']
 ];
 for(const [slug,...benefits] of expected){
  const html=fs.readFileSync(path.join(root,slug,'index.html'),'utf8');
  assert.equal((html.match(/class="ed-proof-card"/g)||[]).length,3,slug+' should highlight exactly three benefits');
  assert.match(html,/VANTAGENS NA PRÁTICA/);
  assert.match(html,/ed-proof-grid/);
  assert.match(html,/class="ed-steps"/);
  assert.ok(html.indexOf('class="ed-proof-grid"')<html.indexOf('class="ed-steps"'),
   'benefits must be communicated before mechanics on '+slug);
  for(const title of benefits)assert.ok(html.includes(title),slug+' missing '+title);
  assert.match(html,/data-tamao-handoff/);
  assert.doesNotMatch(html,/entrega garantida|renda garantida|vendas garantidas|clientes garantidos/i);
 }
 const sponsor=fs.readFileSync(path.join(root,'para-marcas','index.html'),'utf8');
 assert.match(sponsor,/Nenhuma campanha é ativada automaticamente/);
 const refer=fs.readFileSync(path.join(root,'indicacoes','index.html'),'utf8');
 assert.match(refer,/não representa promessa de renda/);
 const merchant=fs.readFileSync(path.join(root,'para-revendas','index.html'),'utf8');
 assert.match(merchant,/não há mensalidade/);
 const buyer=fs.readFileSync(path.join(root,'como-funciona','index.html'),'utf8');
 assert.match(buyer,/A revenda precisa aceitar/);
 const css=read('css/landing-editorial.css');
 assert.match(css,/\.ed-proof-card/);
 assert.match(css,/@media\(max-width:680px\)/);
 console.log('PASS: benefits-first public acquisition, all four audience pages, truthful claims and mobile layouts');
} finally {
 fs.rmSync(root,{recursive:true,force:true});
}
