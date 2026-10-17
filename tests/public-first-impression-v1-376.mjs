import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const index=read('index.html');
const bootstrap=read('js/bootstrap.js');
const growth=read('js/growth.js');
const showcase=read('js/home-showcase.js');
const core=read('js/core.js');
const css=read('css/marketing-premium.css');
const sw=read('sw.js');

for(const [file,code] of Object.entries({bootstrap,growth,showcase,core})){
  new vm.Script(code,{filename:file+'.js'});
}
assert.match(index,/<div id="app">\s*<section class="tamao-preboot"/,
  'static first paint should be meaningful before javascript is ready');
assert.match(index,/<h1>Faltou em casa\? <em>Tá na mão\.<\/em><\/h1>/);
assert.match(index,/GÁS, ÁGUA E ESSENCIAIS PERTO DE VOCÊ/);
assert.match(index,/O atendimento depende da disponibilidade da sua região/);
assert.match(index,/href="\/\?entrada=revenda"/);
assert.match(index,/href="\/\?entrada=marca"/);
assert.match(index,/<noscript>/);
assert.ok(!index.includes('Pedidos garantidos'));
assert.match(bootstrap,/window\.addEventListener\('DOMContentLoaded',\(\)=>\{/,
  'public initial render should not wait for the last image');
assert.ok(bootstrap.includes("window.addEventListener('load',async()=>{"),
  'protected portals keep authentication callback consumption before their initial render');
assert.match(bootstrap,/if\(globalThis\.adminPortalRequested\?\.\(\)\|\|globalThis\.merchantPortalRequested\?\.\(\)\)return;/);
assert.match(core,/>Indicações<\/button>/);
assert.match(core,/>Para marcas<\/button>/);

assert.match(showcase,/snapshot\.real===true/);
assert.match(showcase,/snapshot\.notAQuote===true/);
assert.match(showcase,/real\.slice\(0,6\)/);
assert.match(showcase,/class="city-price-card verified"/);
assert.match(showcase,/class="city-price-card reference city-price-reference-summary"/);
assert.ok(!showcase.includes("references=localP13?["),
  'unverified price references may not become three pseudo-seller cards');
assert.ok(showcase.includes('PUBLIC_P13_REFERENCE.usual')&&showcase.includes('PUBLIC_P13_REFERENCE.minimum')&&showcase.includes('PUBLIC_P13_REFERENCE.maximum'));
assert.match(showcase,/Não representa uma revenda, um preço disponível/);
assert.match(showcase,/A consulta não cria pedido/);
assert.match(showcase,/onclick="startCustomerAvailability\(\)"/);

const sponsor=growth.slice(growth.indexOf('function sponsorsLanding(){'),growth.indexOf('function merchantsLanding(){'));
const merchant=growth.slice(growth.indexOf('function merchantsLanding(){'),growth.indexOf('function merchantJoin(){'));
assert.match(sponsor,/sponsor-format-grid/);
assert.match(sponsor,/public-sponsor-selector-intro/);
assert.equal((sponsor.match(/class="sponsor-format-grid"/g)||[]).length,1);
assert.ok(!sponsor.includes('ONDE SUA MARCA PODE PARTICIPAR'),
  'do not repeat format grid as a second near-identical 3-card section');
for(const type of ['visibility','relationship','local'])
  assert.ok(sponsor.includes("openSponsorContact('"+type+"')"));
assert.match(sponsor,/Não é campanha ativa/);
assert.match(merchant,/merchant-conversion-start/);
assert.equal((merchant.match(/prelaunchMerchantLeadSection\(\)/g)||[]).length,1);
const rail=merchant.slice(merchant.indexOf('merchant-jump-rail'),merchant.indexOf('merchant-cro-steps'));
assert.equal((rail.match(/<button type="button"/g)||[]).length,2,
  'the repeated register action should not compete with the immediate form');
assert.match(rail,/publicLandingJump\('merchant-margin'\)/);
assert.match(rail,/publicLandingJump\('merchant-how'\)/);
for(const token of ['.tamao-preboot','.city-price-reference-summary','.merchant-jump-rail','@media(max-width:620px)','a:focus-visible'])
  assert.ok(css.includes(token),token);
assert.match(sw,/const CACHE='tamao-sg-v1\.370'/);
console.log('TAMÃO V1.376 PASS — static first paint, honest market references, focused landing pages and accessible mobile layout.');
