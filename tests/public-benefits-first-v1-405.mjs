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

const dollar=String.fromCharCode(36);
const audienceBridge=dollar+"{!conciseHome?valueBridge:''}";
const signup=dollar+"{acquisitionOpen?prelaunchCustomerLeadSection():''}";
assert.ok(home.includes(audienceBridge),'first-time journeys must avoid duplicate audience grids');
assert.ok(home.includes('typeof tamaoHomeBenefits===') && !home.includes('!conciseHome&&typeof tamaoHomeBenefits'),
 'benefits should not disappear when there are no available offers');
assert.ok(home.includes('home-benefits-shortcuts'),'first screen should surface club and referrals');
assert.ok(home.includes('visitor-path-sponsor') && home.includes("go('sponsors')"),
 'sponsor journey must be accessible in the four-audience section');
assert.ok(home.includes('Divulgar minha marca'),'first-time visitor has sponsor path');
assert.ok(home.indexOf(signup)<home.indexOf(audienceBridge),
 'availability signup must not be buried below editorial cards');
assert.ok(home.includes("go('earn')"),'benefits lead to an actual page');
assert.ok(home.includes('homeRegionalPriceBoard(homeRegion)'),'verified regional price path must remain');
assert.ok(home.includes('citySnapshot?.real===true&&citySnapshot?.notAQuote===true'),'no invented city prices');
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
  assert.equal((html.match(/class="ed-proof-card"/g)||[]).length,3,slug+' needs three concrete advantages');
  assert.match(html,/VANTAGENS NA PRÁTICA/);
  assert.ok(html.indexOf('class="ed-proof-grid"')<html.indexOf('class="ed-steps"'),
   'benefits must appear before process instructions on '+slug);
  for(const name of benefits)assert.ok(html.includes(name),slug+' lacks '+name);
  assert.match(html,/data-tamao-handoff/);
  assert.doesNotMatch(html,/entrega garantida|renda garantida|vendas garantidas|clientes garantidos/i);
 }
 assert.match(fs.readFileSync(path.join(root,'para-marcas','index.html'),'utf8'),/Nenhuma campanha é ativada automaticamente/);
 assert.match(fs.readFileSync(path.join(root,'indicacoes','index.html'),'utf8'),/não representa promessa de renda/);
 assert.match(fs.readFileSync(path.join(root,'para-revendas','index.html'),'utf8'),/não há mensalidade/);
 assert.match(fs.readFileSync(path.join(root,'como-funciona','index.html'),'utf8'),/A revenda precisa aceitar/);
 const css=read('css/landing-editorial.css');
 assert.match(css,/\.ed-proof-card/);
 assert.match(css,/@media\(max-width:680px\)/);
 console.log('PASS: public benefits before process instructions, truthful claims and responsive visitor paths');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
