import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const js=read('js/learn-premium.js');
const css=read('css/learn-premium.css');
const core=read('js/core.js');
const legal=read('js/legal.js');
new vm.Script(js,{filename:'js/learn-premium.js'});
const ctx=vm.createContext({shell:html=>html});
vm.runInContext(js+'\nthis.page=learnPremiumPage',ctx);
const html=ctx.page();
assert.match(html,/class="learn-trust-disclosure"/);
assert.match(html,/COMPROMISSO COM A CLAREZA/);
assert.match(html,/O TAMÃO conecta e organiza; a revenda aceita e realiza a entrega/);
assert.match(html,/O pedido só é confirmado após o aceite da revenda/);
assert.match(html,/Preços e condições são apresentados antes de solicitar/);
for(const route of ['contact','terms','privacy']){
  assert.match(html,new RegExp('onclick="go\\(\\\''+route+'\\\'\\)"'));
  assert.match(core,new RegExp('\\\''+route+'\\\''));
}
for(const page of ['contactPage','privacyPage','termsPage']){
  assert.match(legal,new RegExp('function '+page+'\\('));
}
assert.equal((html.match(/class="learn-trust-path"/g)||[]).length,3);
assert.equal((html.match(/data-learn-scene="[1-4]"/g)||[]).length,4);
assert.match(html,/id="learn-faq-search"/);
assert.match(css,/learn-trust-disclosure-links/);
assert.match(css,/@media\(max-width:700px\)/);
assert.doesNotMatch(html,/entrega garantida|melhor preço do Brasil|5 estrelas|clientes satisfeitos \d+/i);
assert.doesNotMatch(js,/fetch\(|XMLHttpRequest|localStorage|sendBeacon/);
console.log('TAMÃO V1.1132 PASS: factual transparency, official legal and support routes, and previous navigation preserved');
