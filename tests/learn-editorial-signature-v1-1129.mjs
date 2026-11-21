import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/learn-premium.js'),css=read('css/learn-premium.css');
new vm.Script(js,{filename:'js/learn-premium.js'});
const pageEnv=vm.createContext({shell:html=>html});
vm.runInContext(js+'\nthis.page=learnPremiumPage;',pageEnv);
const page=pageEnv.page();
assert.match(page,/aria-label="Explorar as etapas do pedido" onkeydown="learnPremiumStageKeydown\(event\)"/);
assert.equal((page.match(/class="learn-step"/g)||[]).length,4);
assert.match(page,/class="learn-visual-next"/);
assert.match(page,/data-learn-stage-cta-label/);
assert.match(page,/id="learn-faq-search"/);
assert.match(page,/O TAMÃO conecta e organiza/);
assert.match(page,/A revenda confirma e entrega/);
assert.match(page,/A revenda precisa aceitar para confirmar o pedido/);
assert.match(page,/código de recebimento/);
assert.match(page,/class="learn-confidence-seal" aria-hidden="true">T\.<\/span>/);
assert.doesNotMatch(page,/entrega garantida em \d+ minutos|mais de \d+ pedidos|5 estrelas/);
for(const phrase of [
 'editorial signature','--learn-ivory','#fafaf4','#0b4233',
 '.learn-visual-flow>.learn-phase.is-active b',
 '.learn-step-grid{grid-template-columns:repeat(2,minmax(0,1fr))',
 '.learn-visual-next','@media(max-width:700px)','prefers-reduced-motion:reduce'
])assert(css.includes(phrase),'Missing editorial or responsive contract: '+phrase);
const fields=new Map();
for(const key of ['[data-learn-step-count]','[data-learn-step-heading]',
 '[data-learn-step-caption]','[data-learn-step-title]','[data-learn-step-description]'])
 fields.set(key,{textContent:''});
const visual={dataset:{step:'1'}},cta={textContent:''};
const scenes=Array.from({length:4},(_,i)=>({
  hidden:i!==0,stage:String(i+1),
  getAttribute(name){assert.equal(name,'data-learn-scene');return this.stage}
}));
let activeElement=null;
const buttons=Array.from({length:4},(_,index)=>({
  attributes:{'aria-pressed':index===0?'true':'false'},
  focus(){activeElement=this},
  setAttribute(name,value){this.attributes[name]=value},
  classList:{toggle(){}}
}));
const root={
 querySelector(q){
  if(q==='.learn-visual')return visual;
  if(q==='[data-learn-stage-cta-label]')return cta;
  return fields.get(q)||null;
 },
 querySelectorAll(q){if(q==='.learn-phase')return buttons;if(q==='[data-learn-scene]')return scenes;return []}
};
const document={
 querySelector(q){return q==='.learn-premium'?root:null},
 get activeElement(){return activeElement}
};
const group={querySelectorAll:q=>q==='.learn-phase'?buttons:[]};
const ctx=vm.createContext({document});
vm.runInContext(js+'\nthis.select=learnPremiumSelectStep;this.keyboard=learnPremiumStageKeydown;',ctx);
let blocked=0;
const key=k=>ctx.keyboard({key:k,currentTarget:group,preventDefault(){blocked++}});
assert.equal(key('ArrowRight'),false,'do not steal keyboard input from unrelated focus');
buttons[0].focus();
assert.equal(key('ArrowRight'),true);
assert.equal(visual.dataset.step,'2');
assert.equal(fields.get('[data-learn-step-count]').textContent,'02 / 04');
assert.equal(activeElement,buttons[1]);
assert.equal(buttons[1].attributes['aria-pressed'],'true');
assert.equal(key('End'),true);
assert.equal(visual.dataset.step,'4');
assert.equal(cta.textContent,'Acompanhar meu pedido');
assert.equal(activeElement,buttons[3]);
assert.equal(key('ArrowRight'),true,'arrow keys wrap from last to first');
assert.equal(visual.dataset.step,'1');
assert.equal(key('ArrowLeft'),true,'arrow keys wrap backward');
assert.equal(visual.dataset.step,'4');
assert.equal(key('Home'),true);
assert.equal(visual.dataset.step,'1');
assert.equal(key('Enter'),false);
assert.equal(visual.dataset.step,'1');
assert.equal(blocked,5,'preventDefault on handled keys only');
console.log('TAMÃO V1.1129 PASS: editorial visual system, real honest copy, and keyboard-accessible four-stage journey.');
