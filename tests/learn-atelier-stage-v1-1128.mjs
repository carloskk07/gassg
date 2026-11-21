import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/learn-premium.js');
const css=read('css/learn-premium.css');
new vm.Script(js,{filename:'js/learn-premium.js'});
const render=vm.createContext({shell:html=>html});
vm.runInContext(js+'\nthis.guide=learnPremiumPage;',render);
const markup=render.guide();

assert.equal((markup.match(/class="learn-product-tile"/g)||[]).length,3,'three illustrated real product categories');
assert.equal((markup.match(/data-learn-scene="\d"/g)||[]).length,4,'retain four real stages');
assert.match(markup,/class="learn-scene-map"/);
assert.match(markup,/class="learn-scene-review learn-scene-review-art"/);
assert.match(markup,/class="learn-scene-track learn-scene-track-art"/);
assert.match(markup,/class="learn-visual-next"/);
assert.match(markup,/data-learn-stage-cta-label/);
assert.match(markup,/onclick="learnPremiumStageAction\(\)"/);
assert.match(markup,/role="group" aria-label="Explorar as etapas do pedido"/);
assert.match(markup,/aria-live="polite"/);
assert.match(markup,/onclick="go\('tracking'\)"/);
assert.match(markup,/onclick="startHomeBrowse\(\)"/);
assert.match(markup,/id="learn-faq-search"/);
assert.doesNotMatch(markup,/entrega garantida|entregue agora|pago com sucesso|R\$ ?\d+,\d\d/);
assert.doesNotMatch(js,/fetch\(|XMLHttpRequest|localStorage|sendBeacon/);

for(const rule of [
 '.learn-scene-products-art','.learn-scene-map','.learn-scene-review-art',
 '.learn-scene-track-art','.learn-visual-next','.learn-visual-next:focus-visible',
 '@media(max-width:420px)','prefers-reduced-motion:reduce'
]) assert(css.includes(rule),'missing scoped responsive artwork: '+rule);

let handoffs=[];
const scenes=Array.from({length:4},(_,index)=>({
  step:index+1,hidden:index!==0,
  getAttribute:name=>name==='data-learn-scene'?String(this.step):null
}));
scenes.forEach(x=>{x.getAttribute=function(){return String(x.step)}});
const buttons=Array.from({length:4},(_,index)=>({
  attributes:{'aria-pressed':index===0?'true':'false'},
  setAttribute(name,value){this.attributes[name]=value},
  classList:{toggle(){}}
}));
const visual={dataset:{step:'1'}},stageLabel={textContent:'Explorar produtos'};
const stepFields=new Map([
 '[data-learn-step-count]','[data-learn-step-heading]','[data-learn-step-caption]',
 '[data-learn-step-title]','[data-learn-step-description]'
].map(key=>[key,{textContent:''}]));
const root={
 querySelector(q){
  if(q==='.learn-visual')return visual;
  if(q==='[data-learn-stage-cta-label]')return stageLabel;
  return stepFields.get(q)||null;
 },
 querySelectorAll(q){
  if(q==='.learn-phase')return buttons;
  if(q==='[data-learn-scene]')return scenes;
  return [];
 }
};
const doc={
 querySelector(q){
  if(q==='.learn-premium')return root;
  if(q==='.learn-premium .learn-visual')return visual;
  return null;
 }
};
const ctx=vm.createContext({
 shell:html=>html,document:doc,
 go:route=>handoffs.push(route),
 startHomeBrowse:()=>handoffs.push('products')
});
vm.runInContext(js+'\nthis.select=learnPremiumSelectStep;this.action=learnPremiumStageAction;',ctx);
assert.equal(ctx.select(4),true);
assert.equal(visual.dataset.step,'4');
assert.equal(stageLabel.textContent,'Acompanhar meu pedido');
assert.equal(scenes.filter(s=>!s.hidden).length,1);
assert.equal(scenes[3].hidden,false);
assert.equal(ctx.action(),'tracking');
assert.equal(handoffs.join(','),'tracking');
assert.equal(ctx.select(2),true);
assert.equal(stageLabel.textContent,'Explorar produtos');
assert.equal(ctx.action(),'products');
assert.equal(handoffs.join(','),'tracking,products');
assert.equal(ctx.select(999),false);
assert.equal(visual.dataset.step,'2');
assert.equal(ctx.select(1),true);
assert.equal(stageLabel.textContent,'Explorar produtos');
const noDocument=vm.createContext({shell:html=>html});
vm.runInContext(js+'\nthis.action=learnPremiumStageAction;',noDocument);
assert.equal(noDocument.action(),false,'guide action handles unavailable DOM');
console.log('V1.1128 PASS: illustrated stages, responsive art, accessibility and existing-only real handoffs.');
