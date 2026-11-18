import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const page=read('index.html'),customer=read('js/customer.js');
const template=page.match(/<template id="tamao-home-journeys-template">([\s\S]*?)<\/template>/);
assert.ok(template,'O painel de caminhos diretos deve existir no HTML público');
const html=template[1];
assert.match(html,/aria-labelledby="tamao-quick-paths-title"/);
assert.match(html,/O que você quer fazer hoje\?/);
for(const [link,label] of [
  ['href="/agenda/"','Agendar horário'],
  ['href="#professionals"','Encontrar profissionais'],
  ['href="#club"','Ver meus benefícios'],
  ['href="#merchants"','Tenho uma empresa'],
  ['href="#earn"','Quero indicar']
]){
  assert.ok(html.includes(link),link+' ausente');
  assert.ok(html.includes(label),label+' ausente');
}
assert.match(html,/onclick="homeDiscoverFocus\(\)"/);
assert.equal((html.match(/class="tamao-quick-path(?: tamao-quick-path-primary)?"/g)||[]).length,4,
  'Quatro escolhas, não outra lista extensa');
assert.doesNotMatch(html,/admin\.tamao\.com\.br|https:\/\/.*github\.io|simula[cç][aã]o|pagamento garantido/i);
const live=customer.slice(customer.indexOf('if(!testDemo&&!internalPilot)return shell('),
  customer.indexOf('const heroVisualCodes=',customer.indexOf('if(!testDemo&&!internalPilot)return shell(')));
assert.equal((live.match(/tamao-home-journeys-template/g)||[]).length,1,
  'Somente um painel de caminhos, na página inicial oficial');
assert.ok(live.indexOf('regionalPriceSection')<live.indexOf('tamao-home-journeys-template'),
  'Oferta e disponibilidade confirmadas devem continuar antes dos atalhos');
assert.ok(live.indexOf('home-discover-grid')<live.indexOf('tamao-home-journeys-template'),
  'Produtos devem ficar primeiro, inclusive em telas de 320px');
for(const name of ['.tamao-quick-paths-grid','.tamao-quick-path:focus-visible',
  '@media(max-width:900px)','@media(max-width:520px)','@media(prefers-reduced-motion:reduce)']){
  assert.ok(page.includes(name),'Layout responsivo e acessível: '+name);
}
const access=page.match(/<template id="tamao-participant-access-template">([\s\S]*?)<\/template>/)?.[1]||'';
assert.match(access,/href="#tracking"/);
assert.match(access,/Meus pedidos/);
assert.doesNotMatch(access,/admin\.tamao\.com\.br|Superadmin|Administraç/i);
console.log('V1.1062 PASS: rotas oficiais, compra em primeiro lugar, seis acessos, foco e mobile.');
