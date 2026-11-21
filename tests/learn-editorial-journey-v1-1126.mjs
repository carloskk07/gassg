import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/learn-premium.js');
const css=read('css/learn-premium.css');
const bootstrap=read('js/bootstrap.js');

new vm.Script(source,{filename:'js/learn-premium.js'});
const pageCtx=vm.createContext({shell:s=>s});
vm.runInContext(source.slice(0,source.indexOf('\nfunction learnPremiumSelectStep('))+'\nthis.page=learnPremiumPage;',pageCtx);
const markup=pageCtx.page();

assert.equal((markup.match(/data-learn-scene="\d"/g)||[]).length,4);
assert.equal((markup.match(/class="learn-trust-path"/g)||[]).length,3);
assert.match(markup,/class="learn-quick-index"/);
assert.match(markup,/onclick="go\('tracking'\)"/);
assert.match(markup,/onclick="go\('club'\)"/);
assert.match(markup,/onclick="startHomeBrowse\(\)"/);
assert.match(markup,/id="learn-confidence" tabindex="-1"/);
assert.match(markup,/id="learn-benefits" tabindex="-1"/);
assert.match(markup,/A revenda ainda precisa aceitar/);
assert.match(markup,/confirme o recebimento/);
assert.match(markup,/O TAMÃO conecta e organiza/);
assert.match(markup,/A revenda confirma e entrega/);
assert.match(markup,/Você escolhe e confere/);
assert.match(bootstrap,/tracking/);
assert.doesNotMatch(markup,/mais de \d+ pedidos|milhares de clientes|entrega garantida em \d+ minutos/i);

const scenes=Array.from({length:4},(_,i)=>({
  stage:String(i+1),hidden:i>0,
  getAttribute(name){assert.equal(name,'data-learn-scene');return this.stage;}
}));
const buttons=Array.from({length:4},(_,i)=>({
  active:i===0,attributes:{'aria-pressed':i===0?'true':'false'},
  setAttribute(key,value){this.attributes[key]=value;},
  classList:{toggle(){}}
}));
const values=new Map();
for(const key of ['[data-learn-step-count]','[data-learn-step-heading]',
 '[data-learn-step-caption]','[data-learn-step-title]','[data-learn-step-description]'])
 values.set(key,{textContent:''});
const visual={dataset:{step:'1'}};
const root={
 querySelectorAll:q=>q==='.learn-phase'?buttons:q==='[data-learn-scene]'?scenes:[],
 querySelector:q=>q==='.learn-visual'?visual:values.get(q)||null
};
const jumped=[];
const targets=new Map(['learn-confidence','learn-benefits'].map(id=>[id,{
 scrollIntoView:args=>jumped.push({id,scroll:args}),
 focus:args=>jumped.push({id,focus:args})
}]));
const doc={
 querySelector:q=>q==='.learn-premium'?root:null,
 getElementById:id=>targets.get(id)||null
};
const ctx=vm.createContext({document:doc,globalThis:{matchMedia:()=>({matches:true})}});
vm.runInContext(source.slice(source.indexOf('\nfunction learnPremiumSelectStep('))+
 '\nthis.select=learnPremiumSelectStep;this.jump=learnPremiumJump;',ctx);
for(let step=1;step<=4;step++){
 assert.equal(ctx.select(step),true);
 assert.equal(visual.dataset.step,String(step));
 assert.equal(scenes.filter(x=>!x.hidden).length,1);
 assert.equal(scenes[step-1].hidden,false);
 assert.equal(buttons.filter(b=>b.attributes['aria-pressed']==='true').length,1);
}
assert.equal(ctx.select(5),false);
assert.equal(ctx.select('not-a-stage'),false);
assert.equal(visual.dataset.step,'4');
assert.equal(ctx.jump('learn-confidence'),true);
assert.equal(ctx.jump('learn-benefits'),true);
assert.equal(ctx.jump('invalid'),false);
assert.equal(jumped.length,4);
assert.ok(jumped.filter(x=>x.scroll).every(x=>x.scroll.behavior==='auto'));
assert.ok(jumped.filter(x=>x.focus).every(x=>x.focus.preventScroll===true));
for(const name of ['.learn-visual-scene[hidden]','.learn-trust-path button','.learn-quick-index button',
 '.learn-scene-track','@media(max-width:430px)','prefers-reduced-motion'])
 assert.ok(css.includes(name),'Missing editorial responsive rule '+name);
console.log('TAMÃO V1.1126 PASS: four dynamic illustrations, direct verified routes, role clarity, whitelist jumps and mobile layout.');
