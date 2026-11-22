import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const js=source('js/learn-premium.js');
const css=source('css/learn-premium.css');
new vm.Script(js,{filename:'js/learn-premium.js'});
const ctx=vm.createContext({shell:x=>x});
vm.runInContext(js+'\nthis.page=learnPremiumPage;',ctx);
const html=ctx.page();

// Asymmetric editorial gallery; real first-party photos only.
assert.match(html,/Essenciais, com outro olhar\./);
assert.equal((html.match(/class="learn-merchandise-card"/g)||[]).length,4);
for(const kind of ['gas','water','coal','firewood']){
 assert.match(html,new RegExp('learn-photo-'+kind));
}
assert.match(css,/background-image:url\('\.\.\/assets\/tamao-products-sprite\.webp'\)/);
for(const x of [
 '.learn-premium .learn-merchandise-card:nth-child(1){grid-area:1 / 1 / 3 / 3}',
 '.learn-premium .learn-merchandise-card:nth-child(2){',
 '.learn-premium .learn-merchandise-card:nth-child(3){grid-area:2 / 3 / 3 / 4}',
 '.learn-premium .learn-merchandise-card:nth-child(4){grid-area:2 / 4 / 3 / 5}',
 '@media(max-width:470px)'
]) assert.ok(css.includes(x),'Editorial layout missing: '+x);
assert.match(css,/grid-template-rows:minmax\(0,139px\) minmax\(0,115px\)/);
assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(html,/Explorar as etapas no seu tempo|Explore as etapas no seu tempo/);
assert.match(html,/O TAMÃO conecta e organiza; a revenda aceita e realiza a entrega/);
assert.equal((html.match(/data-learn-scene="[1-4]"/g)||[]).length,4);
assert.equal((html.match(/class="learn-trust-path"/g)||[]).length,3);
for(const a of [
 'onclick="startHomeBrowse()"',
 'onclick="go(\'tracking\')"',
 'onclick="go(\'contact\')"',
 'onclick="go(\'privacy\')"',
 'onclick="go(\'terms\')"',
 'id="learn-faq-search"'
])assert.ok(html.includes(a),'Route or search missing: '+a);
assert.doesNotMatch(html,/entrega garantida|mais de \d+ clientes|5 estrelas/i);
assert.doesNotMatch(js,/fetch\(|XMLHttpRequest|localStorage|sendBeacon/);
console.log('TAMÃO V1.1136 PASS: original photographic editorial layout, responsive fallback, existing functionality and truthful claims.');
