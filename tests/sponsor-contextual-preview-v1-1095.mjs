import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sponsor=read('js/sponsors-premium.js');
const css=read('css/public-ux.css');
const audit=read('.github/workflows/audit.yml');
assert.doesNotThrow(()=>new vm.Script(sponsor));
assert.match(audit,/tests\\/sponsor-contextual-preview-v1-1095\\.mjs/);
assert.match(css,/\.sponsor-preview-switch button\[aria-pressed="true"\]/);
assert.match(css,/\.sponsor-premium-visual\[data-demo-placement="brands"\]/);

const entries=new Map(), storage={
 getItem:k=>entries.get(k)||null,
 setItem:(k,v)=>entries.set(k,v)
};
let backendWrites=0;
const aside={attrs:{},setAttribute(k,v){this.attrs[k]=v}};
const art={attrs:{},setAttribute(k,v){this.attrs[k]=v}};
const fields=Object.fromEntries(['brand','headline','copy','label','symbol','monogram',
 'goalLabel','context','caption'].map(key=>[key,[{textContent:''},{textContent:''}]]));
const placements=['home','brands'].map(key=>({
 key,attrs:{},
 getAttribute(name){return name==='data-sponsor-demo-placement'?key:this.attrs[name]},
 setAttribute(name,value){this.attrs[name]=value}
}));
const nameInput={value:''}, status={textContent:''};
const doc={
 getElementById(id){
  if(id==='sponsor-demo-company')return nameInput;
  if(id==='sponsor-demo-status')return status;
  return null;
 },
 querySelector(key){
  if(key==='.sponsor-premium-visual')return aside;
  if(key==='.sponsor-premium-ad-art')return art;
  return null;
 },
 querySelectorAll(key){
  const match=/^\\[data-sponsor-demo="(\\w+)"\\]$/.exec(key);
  if(match)return fields[match[1]]||[];
  if(key==='[data-sponsor-demo-placement]')return placements;
  return [];
 }
};
const context={document:doc,shell:x=>x,globalThis:{
 sessionStorage:storage,
 tamaoAdsPlannerLoad:()=>{},
 tamaoAdsPlannerSection:()=>'<div>Formulário verdadeiro</div>',
 matchMedia:()=>({matches:true})},
 liveInvoke:()=>{backendWrites++;throw Error('No live calls expected');}
};
vm.createContext(context);
vm.runInContext(sponsor+';this.show=sponsorsLandingPremium;this.switchPlacement=sponsorDemoPlacement;this.type=sponsorDemoType;',context);
const initial=context.show();
assert.match(initial,/role="group" aria-label="Ver anúncio em diferentes espaços"/);
assert.match(initial,/data-demo-placement="home"/);
assert.match(initial,/data-sponsor-demo-placement="home" aria-pressed="true"/);
assert.match(initial,/data-sponsor-demo-placement="brands" aria-pressed="false"/);
assert.match(initial,/sponsor-preview-context/);
assert.match(initial,/Descobertas perto de você/);
assert.equal(context.switchPlacement('__proto__'),false);
assert.equal(context.switchPlacement('unknown'),false);
assert.equal(context.switchPlacement('brands'),true);
assert.equal(aside.attrs['data-demo-placement'],'brands');
assert.equal(placements[0].attrs['aria-pressed'],'false');
assert.equal(placements[1].attrs['aria-pressed'],'true');
assert.equal(fields.context[0].textContent,'Marcas da nossa região');
assert.equal(status.textContent.includes('não existe'),true);
const state=JSON.parse(entries.get('tamao-sponsor-showcase-v1092'));
assert.equal(state.placement,'brands');
nameInput.value='Minha marca <img src=x onerror=alert(1)>';
assert.equal(context.type(),true);
assert.equal(fields.brand[0].textContent,nameInput.value);
const html=context.show();
assert.match(html,/data-demo-placement="brands"/);
assert.match(html,/&lt;img src=x onerror=alert\\(1\\)&gt;/);
assert.doesNotMatch(html,/<img src=x onerror=/);
assert.equal(backendWrites,0,'Changing preview must not publish, pay or count impressions');

const fresh={document:doc,shell:x=>x,globalThis:{
 sessionStorage:storage,tamaoAdsPlannerLoad:()=>{},
 tamaoAdsPlannerSection:()=>'<div>Formulário verdadeiro</div>'
}};
vm.createContext(fresh);
vm.runInContext(sponsor+';this.show=sponsorsLandingPremium;',fresh);
assert.match(fresh.show(),/data-demo-placement="brands"/);
assert.equal(backendWrites,0);
console.log('PASS V1.1095: home/brand contextual preview, secure selection, one-tab restoration, accessibility, and no live writes.');
