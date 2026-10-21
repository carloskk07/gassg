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
const regional=h.indexOf('homeRegionalPriceBoard(homeRegion)');
const catalogue=h.indexOf('class="home-discover tamao-home-catalog"');
const services=h.indexOf('tamaoDiscoveryEntryHub()}');
const benefit=h.indexOf('tamaoHomeBenefits({compact:true})');
const lead=h.indexOf('prelaunchCustomerLeadSection()');
assert.ok(regional>=0&&catalogue>regional&&services>catalogue&&benefit>services&&lead>benefit,
 'Public flow must be quote -> products -> services -> benefits -> optional lead');
assert.ok(h.includes('if(!testDemo&&!internalPilot)return shell('),
 'Real visitors use one condensed public experience');
assert.ok(h.includes('return shell(`${regionalPriceSection}'),
 'Internal demo retains its original isolated customer journey');
assert.ok(!h.includes('tamaoMobilityEntryHub()'),
 'Overlapping service grids must not return');
assert.ok(premium.includes('@media(max-width:360px){.intent-grid.tamao-home-services-grid{grid-template-columns:1fr}}'),
 'Narrow phones must not create a horizontal viewport overflow from service cards');

for(const selector of [
 '.tamao-value-section.tamao-value-compact',
 '.tamao-value-compact .tamao-perks-panel',
 '.tamao-value-compact .tamao-perks-panel button',
 '@media(max-width:760px)','@media(max-width:380px)'
])assert.ok(premium.includes(selector),'Missing first-visit responsive design: '+selector);
assert.doesNotMatch(compact,/vendas garantidas|ganhos garantidos|preços garantidos/i);
console.log('V1.413 PASS — benefits shown early and once, two equal audience panels, no false rewards.');
