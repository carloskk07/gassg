import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js'),growth=read('js/growth.js');
const boot=read('js/bootstrap.js'),css=read('css/components.css');
for(const [name,source] of Object.entries({customer,growth,boot}))new vm.Script(source,{filename:name+'.js'});
const beginning=customer.indexOf('function homeProductGroup('),end=customer.indexOf('function home(){',beginning);
assert.ok(beginning>=0&&end>beginning,'grouping and finder helpers must precede homepage');
const cards=[
 {dataset:{tamaoDiscoverKind:'gas'},hidden:false},
 {dataset:{tamaoDiscoverKind:'water'},hidden:false},
 {dataset:{tamaoDiscoverKind:'gas'},hidden:false},
 {dataset:{tamaoDiscoverKind:'other'},hidden:false},
 {dataset:{tamaoDiscoverKind:'water'},hidden:false},
 {dataset:{tamaoDiscoverKind:'gas'},hidden:false},
 {dataset:{tamaoDiscoverKind:'other'},hidden:true}
];
const filters=['all','gas','water','other'].map(kind=>({
 dataset:{tamaoFilter:kind},
 setAttribute(key,value){if(key==='aria-pressed')this.pressed=value}
}));
const feedback={textContent:''};
const heading={focused:false,focus(options){this.focused=options?.preventScroll===true}};
const panel={scrolled:false,scrollIntoView(options){this.scrolled=options?.block==='start'},querySelector:selector=>selector==='h2'?heading:null};
const grid={querySelectorAll:selector=>selector==='[data-tamao-discover-kind]'?cards:[]};
let fallback=0;
const document={
 getElementById:id=>({ 'home-discover-grid':grid, 'home-discover-status':feedback,'home-discover':panel }[id]||null),
 querySelectorAll:selector=>selector==='[data-tamao-filter]'?filters:[]
};
const ctx=vm.createContext({
 document,globalThis:{matchMedia:()=>({matches:true})},startCustomerAvailability:()=>{fallback++;return true}
});
vm.runInContext(customer.slice(beginning,end),ctx);
assert.equal(vm.runInContext("homeProductGroup('P13',{categoryKey:'other'})",ctx),'other',
  'explicit server category takes precedence over fallback product-code inference');
assert.equal(vm.runInContext("homeProductGroup('P13',{})",ctx),'gas');
assert.equal(vm.runInContext("homeProductGroup('WATER20',{})",ctx),'water');
assert.equal(vm.runInContext("homeProductGroup('ICE5',{})",ctx),'other');
assert.equal(vm.runInContext("homeFilterProducts('water')",ctx),true);
assert.equal(cards.filter(x=>!x.hidden).length,2);
assert.equal(filters.find(x=>x.dataset.tamaoFilter==='water').pressed,'true');
assert.equal(filters.find(x=>x.dataset.tamaoFilter==='all').pressed,'false');
assert.match(feedback.textContent,/2 produtos nesta categoria/);
assert.equal(vm.runInContext("homeFilterProducts('all')",ctx),true);
assert.equal(cards.filter(x=>!x.hidden).length,6,'featured mode may not flood the first visit');
assert.equal(cards[6].hidden,true);
assert.equal(vm.runInContext("homeFilterProducts('other')",ctx),true);
assert.equal(cards.filter(x=>!x.hidden).length,2,'category view may reveal cards hidden in featured mode');
assert.equal(vm.runInContext("homeFilterProducts('invalid')",ctx),true);
assert.equal(cards.filter(x=>!x.hidden).length,6,'invalid filter fails to safe featured mode');
assert.equal(vm.runInContext('homeDiscoverFocus()',ctx),true);
assert.equal(heading.focused,true);
assert.equal(panel.scrolled,true);
assert.equal(fallback,0);
assert.ok(customer.includes("const primaryAction=acquisitionOpen?'homeDiscoverFocus()':'startCustomerAvailability()'"),
 'first visit must choose a product before quote; verified-offer action remains');
for(const token of [
 'aria-label="Escolha visual de produtos do catálogo, sem oferta ou disponibilidade confirmadas"',
 'id="home-discover-grid"','aria-label="Filtrar produtos por categoria"',
 'aria-pressed','data-tamao-discover-kind','home-editorial-visual',
 'Preço e entrega dependem das opções confirmadas para seu endereço.'
])assert.ok(customer.includes(token),'missing truthful premium discovery marker: '+token);
assert.ok(boot.includes('homeFilterProducts,homeDiscoverFocus'),'browser callbacks must be wired');
const merchant=growth.slice(growth.indexOf('function merchantsLanding(){'),growth.indexOf('\nfunction merchantJoin(){'));
assert.ok(merchant.includes('merchant-landing-premium-visual'));
assert.ok(merchant.indexOf('merchant-hero-actions')<merchant.indexOf('merchant-cro-steps'),
 'registration CTA should precede lengthy steps and finance explanations');
assert.ok(merchant.includes('Visão ilustrativa dos recursos.'));
assert.ok(merchant.includes('Após habilitação'));
for(const token of ['.home-editorial-visual','.home-discover-tile[hidden]',
 '.home-discover-filter button[aria-pressed="true"]','.merchant-landing-premium',
 '@media(max-width:600px)','prefers-reduced-motion'])
 assert.ok(css.includes(token),'premium design/mobile contract missing '+token);
console.log('TAMÃO V1.347 PASS — safe guided categories, focus, honest art, merchant CTA, responsive design.');
