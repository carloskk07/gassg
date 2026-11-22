import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js'),boot=read('js/bootstrap.js'),html=read('index.html');
const pageJs=read('js/earn-premium.js'),css=read('css/earn-premium.css'),sw=read('sw.js');
new vm.Script(pageJs,{filename:'earn-premium.js'});
const ctx=vm.createContext({shell:markup=>markup});
vm.runInContext(pageJs+'\nthis.page=earnPremiumPage;',ctx);
const page=ctx.page({rateLabel:'2%',exampleAmount:'R$ 2,40'});
for(const id of ['earn-signature-title','earn-process','earn-process-title','earn-value-title','earn-clarity-title'])
 assert(page.includes(id),'Missing landmark '+id);
for(const label of ['Acessar minha Rede','Código individual','Eventos verificados','Extrato com origem',
 'Primeira compra elegível','Não é saldo real','Apenas cadastrar alguém','Posso sacar imediatamente'])
 assert(page.includes(label),'Missing clear trust copy '+label);
assert.match(page,/R\$ 120,00/);
assert.match(page,/2%/);
assert.match(page,/R\$ 2,40/);
assert.equal((page.match(/<details>/g)||[]).length,5);
for(const route of ["go('refer')","go('club')","go('merchants')","go('contact')"])
 assert(page.includes(route),'Missing real action '+route);
assert.doesNotMatch(page,/(?:5 estrelas|milhares de clientes|ganho garantido|saldo fictício|lucro certo)/i);
assert.doesNotMatch(page,/https?:\/\/images|<form|onclick="checkout\(/i);
assert.match(growth,/function earn\(\)\{\s*if\(typeof earnPremiumPage/);
assert.match(growth,/rateLabel:policyPercent\(referralPilotRate\(\)\)/);
assert.match(boot,/function tamaoEnsureEarnPremium\(page\)/);
assert.match(boot,/tamaoEnsureEarnPremium\(r\)/);
assert.match(boot,/css\/earn-premium\.css/);
assert.match(boot,/js\/earn-premium\.js/);
assert.doesNotMatch(html,/<script[^>]*src="\.\/js\/earn-premium\.js"/);
for(const term of ['.earn-signature','.earn-hero','.earn-stage','.earn-step-grid','.earn-faq','@media(max-width:540px)','@media(prefers-reduced-motion:reduce)',':focus-visible'])
 assert(css.includes(term),'Missing responsive design contract '+term);
assert.match(sw,/function networkFirst\(req/);
console.log('TAMÃO Rede premium PASS: financial clarity, honest example, valid routes, lazy assets and mobile styles.');
