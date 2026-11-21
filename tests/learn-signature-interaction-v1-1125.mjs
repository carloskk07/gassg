import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/learn-premium.js');
const css=read('css/learn-premium.css');
new vm.Script(source,{filename:'js/learn-premium.js'});
const pageCtx=vm.createContext({shell:markup=>markup});
vm.runInContext(source.slice(0,source.indexOf('\nfunction learnPremiumSelectStep('))+'\nthis.page=learnPremiumPage;',pageCtx);
const markup=pageCtx.page();

assert.equal((markup.match(/class="learn-phase(?: is-active)?"/g)||[]).length,4,'four accessible selector buttons');
assert.equal((markup.match(/aria-pressed="true"/g)||[]).length,1,'one active step');
assert.equal((markup.match(/aria-pressed="false"/g)||[]).length,3);
assert.equal((markup.match(/class="learn-step"/g)||[]).length,4,'original journey must remain intact');
assert.equal((markup.match(/class="learn-step-art" aria-hidden="true"><svg /g)||[]).length,4,'all four journey steps must retain their own SVG illustration');
assert.match(markup,/aria-label="Explorar as etapas do pedido"/);
assert.match(markup,/aria-live="polite"/);
assert.match(markup,/data-learn-step-title/);
assert.match(markup,/class="learn-trust-intro"/);
assert.match(markup,/id="buyer-guide-steps" tabindex="-1"/);
assert.match(markup,/id="buyer-guide-questions" tabindex="-1"/);
assert.match(markup,/onclick="startHomeBrowse\(\)"/);
assert.match(markup,/onclick="go\('contact'\)"/);
assert.match(markup,/onclick="go\('club'\)"/);
assert.match(markup,/onclick="go\('earn'\)"/);
assert.doesNotMatch(markup,/clientes garantidos|entrega garantida|preço fixo garantido|pedido fictício/i);

const values=new Map();
for(const selector of ['[data-learn-step-count]','[data-learn-step-heading]','[data-learn-step-caption]',
 '[data-learn-step-title]','[data-learn-step-description]'])values.set(selector,{textContent:''});
const buttons=Array.from({length:4},(_,index)=>({
 pressed:index===0,
 attributes:{'aria-pressed':index===0?'true':'false'},
 setAttribute(name,value){this.attributes[name]=value;},
 classList:{toggle(name,active){if(name!=='is-active')throw Error('unexpected class');}}
}));
const visual={dataset:{step:'1'}};
const root={
 querySelectorAll:selector=>selector==='.learn-phase'?buttons:[],
 querySelector:selector=>selector==='.learn-visual'?visual:values.get(selector)||null
};
const ctx=vm.createContext({document:{querySelector:selector=>selector==='.learn-premium'?root:null}});
const action=source.slice(source.indexOf('\nfunction learnPremiumSelectStep('));
vm.runInContext(action+'\nthis.select=learnPremiumSelectStep;',ctx);
assert.equal(ctx.select(3),true);
assert.deepEqual(buttons.map(b=>b.attributes['aria-pressed']),['false','false','true','false']);
assert.equal(visual.dataset.step,'3');
assert.equal(values.get('[data-learn-step-count]').textContent,'03 / 04');
assert.match(values.get('[data-learn-step-title]').textContent,/depende do aceite/);
assert.equal(ctx.select(4),true);
assert.equal(values.get('[data-learn-step-count]').textContent,'04 / 04');
assert.match(values.get('[data-learn-step-description]').textContent,/confirme o recebimento/);
assert.equal(ctx.select(0),false);
assert.equal(ctx.select('invalid'),false);
assert.equal(ctx.select(5),false);
assert.equal(visual.dataset.step,'4','invalid input cannot mutate state');
for(const rule of ['.learn-phase.is-active','.learn-step-art svg','.learn-confidence-seal',
 '.learn-trust-intro','@media(max-width:450px)','prefers-reduced-motion:reduce',':focus-visible'])
 assert(css.includes(rule),'missing premium presentation rule '+rule);
console.log('TAMÃO V1.1125 PASS: accessible interactive buyer guide, truthful steps, four SVGs and scoped mobile design.');
