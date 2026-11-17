import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js'),growth=read('js/growth.js');
const index=read('index.html'),css=index;
new vm.Script(customer,{filename:'customer.js'});
new vm.Script(growth,{filename:'growth.js'});
const a=customer.indexOf('function tamaoHomeValueOverview(){');
const b=customer.indexOf('\nfunction customerProductName(',a);
assert.ok(a>0&&b>a,'Benefits renderer must be independent of test demo');
const match=index.match(/<template id="tamao-home-benefits-template">([\s\S]*?)<\/template>/);
assert.ok(match,'Public benefits template must exist');
const ctx=vm.createContext({document:{getElementById:id=>id==='tamao-home-benefits-template'?{innerHTML:match[1]}:null}});
vm.runInContext(customer.slice(a,b)+'\nthis.result=tamaoHomeValueOverview();',ctx);
const html=ctx.result;
assert.match(html,/Um TAMÃO de vantagens/i);
assert.equal((html.match(/class="tamao-benefit-tile"/g)||[]).length,6,
 'Six useful paths need visible cards');
for(const route of ['club','earn','professionals','merchants','sponsors']){
 assert.ok(html.includes("go('"+route+"')"),'Missing verified route: '+route);
}
for(const concept of ['Compare','Clube','cashback','Indicar','extrato','caronas','revenda','marca']){
 assert.ok(html.toLowerCase().includes(concept.toLowerCase()),'Missing public benefit: '+concept);
}
assert.ok(html.includes('homeDiscoverFocus()'));
assert.match(html,/<details class="tamao-benefits-details">/);
assert.match(html,/só são utilizados ou creditados quando estiverem habilitados/);
assert.doesNotMatch(html,/ganho garantido|renda garantida|entrega garantida/i);
const live=customer.slice(customer.indexOf('if(!testDemo&&!internalPilot)return shell('),
 customer.indexOf('const heroVisualCodes=',customer.indexOf('if(!testDemo&&!internalPilot)return shell(')));
assert.equal((live.match(/tamaoHomeValueOverview\(\)/g)||[]).length,1,
 'Overview must be on real customer homepage exactly once');
assert.ok(live.indexOf('${couponBanner}')<live.indexOf('${tamaoHomeValueOverview()}'));
assert.ok(live.includes('class="tamao-storefront-benefit-strip"'));
assert.ok(live.includes('href="#tamao-all-benefits"'));
assert.ok(index.includes('<style id="tamao-benefit-story-css">'));
assert.ok(index.includes('Mais vantagens para as suas compras!'));
for(const cssRule of ['.tamao-benefits-grid','.tamao-benefit-tile','@media(max-width:900px)','@media(max-width:650px)']){
 assert.ok(css.includes(cssRule),'Missing responsive style '+cssRule);
}
assert.match(growth,/<h1>Suas compras podem render muito mais no Clube TAMÃO/);
assert.match(growth,/<h1 class="page-title">Compartilhe o TAMÃO\. Veja sua Rede ganhar vida/);
assert.match(growth,/<details class="tamao-network-clarity">/);
assert.match(growth,/Comissões exigem eventos reais, programa habilitado e validação/);
assert.match(growth,/prima|primeira compra qualificada/i);
assert.match(growth,/Sua marca mais presente nas escolhas da cidade/);
console.log('V1.1047 PASS — real home + 6 destinations, Club, Rede, commercial pages and honest details');
