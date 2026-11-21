import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const growth=read('js/growth.js'),css=read('css/learn-premium.css');
const index=read('index.html'),boot=read('js/bootstrap.js');
new vm.Script(growth,{filename:'growth.js'});
const start=growth.indexOf('function learn(){');
const end=growth.indexOf('\nasync function activateCashAccount()',start);
assert(start>=0&&end>start,'Preserve the #learn public API');
const ctx=vm.createContext({shell:html=>html});
vm.runInContext(growth.slice(start,end)+'\nthis.guide=learn;',ctx);
const page=ctx.guide();
for(const item of ['learn-hero','learn-visual','learn-trust-strip','buyer-guide-steps',
 'learn-step-grid','learn-confidence','learn-timeline','learn-benefits-grid',
 'buyer-guide-questions','learn-faq-items','learn-finish'])
 assert(page.includes(item),'Missing premium section '+item);
for(const action of ['startHomeBrowse()',"go('club')","go('earn')",
 "go('merchants')","go('contact')","publicLandingJump('buyer-guide-steps')"])
 assert(page.includes(action),'Missing working action '+action);
assert.equal((page.match(/class="learn-step"/g)||[]).length,4);
assert.match(page,/A revenda precisa aceitar/);
assert.match(page,/Sem aceite, o pedido não é confirmado/);
assert.match(page,/e-mail confirmado/);
assert.match(page,/condições de cada benefício/);
assert.doesNotMatch(page,/mais de \d+ (clientes|pedidos)|entrega garantida|5 estrelas|R\$ \d+ por pedido/i);
assert.doesNotMatch(page,/https?:\/\/|<form|checkout\(/i);
assert.match(index,/<link rel="stylesheet" href="\.\/css\/learn-premium\.css"/);
assert.match(boot,/pages=\{home,learn,earn/);
for(const item of ['.learn-premium','@media(max-width:970px)','@media(max-width:700px)',
 '@media(max-width:450px)','@media(prefers-reduced-motion:reduce)',':focus-visible'])
 assert(css.includes(item),'Missing design contract '+item);
console.log('TAMÃO learn premium PASS: honest copy, four steps, real actions and mobile accessibility.');
