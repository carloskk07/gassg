import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {writePublicLandingPages,PUBLIC_LANDING_SLUGS} from '../scripts/build-public-landing-pages.mjs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const customer=read('js/customer.js');
new vm.Script(customer,{filename:'customer.js'});
const benefits=customer.slice(customer.indexOf('function tamaoHomeBenefits('),customer.indexOf('\nfunction customerProductName('));
assert.ok(benefits.length>2300,'home value section exists');
for(const term of ['CLUBE TAMÃO','REDE TAMÃO','cashback de compras elegíveis','Indique amigos e amplie sua Rede TAMÃO',
 "go('club')","go('earn')",'tamao-action-now']){
 assert.ok(benefits.includes(term),'home should explain '+term);
}
assert.equal((benefits.match(/class="tamao-perks-panel /g)||[]).length,2,
 'club and referral should have separate prominent sections');
assert.doesNotMatch(benefits,/ganhos garantidos|recompensa garantida|cupons ativos para todos|R\$ ?[0-9]/i);
const home=customer.slice(customer.indexOf('function home(){'),customer.indexOf('\nfunction orderPage(){'));
assert.ok(home.includes('tamaoHomeBenefits({compact:true})')&&home.includes('!conciseHome&&typeof tamaoHomeBenefits'),
 'new benefit stage renders compact on first visits and full when city offers are verified');
const premium=read('css/marketing-premium.css');
assert.match(premium,/\.tamao-perks-stage/);
assert.match(premium,/\.tamao-perks-panel button:focus-visible/);
assert.match(premium,/@media\(max-width:760px\)/);

const out=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-next-editorial-'));
try{
 const paths=writePublicLandingPages(out,{origin:'https://tamao.com.br',indexing:true});
 assert.deepEqual(paths.map(String),[...PUBLIC_LANDING_SLUGS].map(slug=>'/'+slug+'/'));
 const scenarios={
  'como-funciona':['Quando','Em vez de correr atrás de respostas','COM O TAMÃO'],
  'para-revendas':['Sua empresa ganha uma nova vitrine','COM O TAMÃO','A habilitação é controlada'],
  'para-marcas':['Uma boa campanha conversa','COM O TAMÃO','Uma boa divulgação começa'],
  'indicacoes':['Seu convite merece mais','COM A REDE TAMÃO','Convites e remuneração']
 };
 for(const slug of PUBLIC_LANDING_SLUGS){
  const html=fs.readFileSync(path.join(out,slug,'index.html'),'utf8');
  assert.equal((html.match(/class="ed-contrast-before"/g)||[]).length,1,slug+' before panel');
  assert.equal((html.match(/class="ed-contrast-after"/g)||[]).length,1,slug+' after panel');
  assert.equal((html.match(/class="ed-related-card"/g)||[]).length,3,slug+' needs cross-public navigation');
  assert.equal((html.match(/class="ed-hero-notes"/g)||[]).length,1,'one benefit rail per page');
  assert.ok(html.includes('aria-label="Principais vantagens"'),'visitors see concrete value immediately');
  assert.ok(html.indexOf('ed-proof-grid')<html.indexOf('ed-contrast-grid') &&
    html.indexOf('ed-contrast-grid')<html.indexOf('ed-steps'),
    'value, example, mechanics should appear in that order on '+slug);
  assert.ok(html.indexOf('ed-related-grid')>html.indexOf('ed-faq-items'),
    'related pages belong after answers');
  for(const relatedSlug of PUBLIC_LANDING_SLUGS.filter(p=>p!==slug))
   assert.ok(html.includes('href="/'+relatedSlug+'/"'),'missing cross-link '+relatedSlug);
  assert.ok(!html.includes('<a class="ed-related-card" data-tamao-handoff href="/'+slug+'/">'),
   'do not promote a page to itself');
  assert.equal((html.match(/<script\b/g)||[]).length,1,
   'remain static and preserve existing only handoff script');
  for(const message of scenarios[slug])assert.ok(html.includes(message),slug+' missing '+message);
  assert.doesNotMatch(html,/renda garantida|vendas garantidas|entrega garantida|milhares de clientes|R\$[0-9]/i);
  assert.match(html,/<main id="conteudo">/);
  assert.match(html,/class="ed-btn ed-btn-primary" data-tamao-handoff/);
 }
 const css=read('css/landing-editorial.css');
 for(const token of ['.ed-contrast-grid','.ed-related-grid','.ed-related-card:focus-visible',
   '@media(max-width:680px)','@media(prefers-reduced-motion:reduce)'])
  assert.ok(css.includes(token),'missing progressive responsive style '+token);
 console.log('PASS V1.406 — benefit discovery, human use cases, cross-navigation, accessibility and truthful public claims.');
}finally{fs.rmSync(out,{recursive:true,force:true})}
