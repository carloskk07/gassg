import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js');
const premium=read('css/marketing-premium.css');
new vm.Script(customer,{filename:'customer.js'});

const b=customer.indexOf('function tamaoHomeBenefits(');
const e=customer.indexOf('\nfunction customerProductName(',b);
assert.ok(b>=0&&e>b,'Benefit section must remain a standalone renderer');
const ctx=vm.createContext({});
vm.runInContext(customer.slice(b,e)+'\nthis.renderBenefits=tamaoHomeBenefits;',ctx);
const compact=ctx.renderBenefits({compact:true});
const full=ctx.renderBenefits();
assert.match(compact,/class="section tamao-value-section tamao-value-compact"/);
assert.equal((compact.match(/class="tamao-perks-panel /g)||[]).length,2);
for(const text of ['CLUBE TAMÃO','REDE TAMÃO','cashback de compras elegíveis',"go('club')","go('earn')"]){
 assert.ok(compact.includes(text),'Missing direct benefit: '+text);
}
assert.doesNotMatch(compact,/tamao-action-now|tamao-value-grid|tamao-value-actions/,
 'First visit must not repeat the same benefits in 3 more sections');
assert.match(full,/tamao-action-now/);
assert.match(full,/tamao-value-grid/);
assert.match(full,/tamao-value-actions/);
assert.doesNotMatch(full,/class="section tamao-value-section tamao-value-compact"/);
assert.equal((full.match(/class="tamao-perks-panel /g)||[]).length,2);

const h=customer.slice(customer.indexOf('function home(){'),
 customer.indexOf('\nfunction orderPage(){'));
const hero=h.indexOf('return shell(');
const discovery=h.indexOf('id="home-discover"');
const benefit=h.indexOf('tamaoHomeBenefits({compact:true})');
const steps=h.indexOf('class="home-buying-steps"');
const lead=h.indexOf('prelaunchCustomerLeadSection()');
assert.ok(hero>=0&&discovery>hero&&benefit>discovery&&steps>benefit&&lead>steps,
 'The first-visit order must be shopping → economic benefits → simple steps → availability action');
assert.ok(h.includes("!conciseHome&&typeof tamaoHomeBenefits===\"function\"?tamaoHomeBenefits():\"\""),
 'Available regions must keep full buyer benefits without duplicates');
assert.ok(!h.includes("conciseHome?tamaoHomeBenefits():tamaoHomeBenefits()"),
 'Benefit render must not accidentally duplicate');
for(const selector of [
 '.tamao-value-section.tamao-value-compact',
 '.tamao-value-compact .tamao-perks-panel',
 '.tamao-value-compact .tamao-perks-panel button',
 '@media(max-width:760px)','@media(max-width:380px)'
])assert.ok(premium.includes(selector),'Missing first-visit responsive design: '+selector);
assert.doesNotMatch(compact,/vendas garantidas|ganhos garantidos|preços garantidos/i);
console.log('V1.413 PASS — benefits shown early and once, two equal audience panels, no false rewards.');
