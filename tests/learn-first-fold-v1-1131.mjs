import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/learn-premium.js'),css=read('css/learn-premium.css');
new vm.Script(source,{filename:'js/learn-premium.js'});
const cx=vm.createContext({shell:x=>x});vm.runInContext(source+'\nthis.page=learnPremiumPage;',cx);
const html=cx.page();
assert.match(html,/Consulte sem criar conta/);
assert.match(html,/Confira o valor antes do pedido/);
assert.match(html,/Revenda confirma o aceite/);
assert.match(html,/Explorar produtos/);
assert.match(html,/id="learn-faq-search"/);
assert.match(html,/class="learn-trust-path"/);
assert.equal((html.match(/class="learn-trust-path"/g)||[]).length,3);
assert.equal((html.match(/data-learn-scene="\d"/g)||[]).length,4);
assert.match(source,/Sua região, suas opções/);
assert.match(html,/Sem aceite, o pedido não é confirmado/);
assert.doesNotMatch(html,/entrega garantida|melhor preço do Brasil|clientes satisfeitos \d+/i);
assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|localStorage|sendBeacon/);
assert.match(css,/First-fold clarity: real product CTA visible/);
assert.match(css,/max-height:780px/);
assert.match(css,/\.learn-premium \.learn-hero\{[\s\S]{0,130}?min-height:0;/);
assert.match(css,/\.learn-premium \.learn-visual-scene\{min-height:115px/);
assert.match(css,/\.learn-premium \.learn-visual-next\{min-height:43px/);
for(const q of ['.learn-scene-products-art>.learn-product-tile','.learn-scene-track-art>span',
 '.learn-trust-strip>.learn-trust-path','@media(max-width:700px)',
 'prefers-reduced-motion:reduce'])
 assert.ok(css.includes(q),'responsive core missing: '+q);
console.log('TAMÃO V1.1131 PASS: visible-first CTA sizing, truthful short copy, functioning paths and FAQ preserved');
