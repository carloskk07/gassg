import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('js/merchant.js'),css=read('css/components.css'),audit=read('.github/workflows/audit.yml');
new vm.Script(ui,{filename:'js/merchant.js'});
const take=(name,async=false)=>{
 const start=ui.indexOf((async?'async ':'')+'function '+name+'(');
 assert.ok(start>=0,'missing '+name);
 const end=ui.indexOf('\n}',start);
 assert.ok(end>start,name+' closing brace');
 return ui.slice(start,end+2);
};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
 .replaceAll('"','&quot;').replaceAll("'",'&#39;');
const registry={
 status:'ready',merchant:{memberRole:'owner'},
 catalog:[],
 availableProducts:[
  {productCode:'WATER20',categoryName:'Água',productName:'Água mineral 20 litros'},
  {productCode:'WATERVIT',categoryName:'Água',productName:'Água sem gás'},
  {productCode:'WOODBAG',categoryName:'Lenha',productName:'Lenha em saco'},
  {productCode:'COAL5',categoryName:'Carvão',productName:'Carvão 5kg'},
  {productCode:'GLP34',categoryName:'Gás',productName:'Gás não autorizado via registro'},
  {productCode:'P20',categoryName:'Gás',productName:'GLP 20kg no fluxo errado'},
  {productCode:"X1');alert(1)//",categoryName:'Ataque',productName:'Ataque'},
  {productCode:'BADNAME',categoryName:'<svg onload=alert(1)>',productName:'<img src=x onerror=alert(1)>'}
 ]
};
const products={P13:{name:'Gás P13',icon:'🔥'}};
const ctx=vm.createContext({globalThis:{merchantRuntime:registry},products,esc,
 BRL:{format:n=>'R$ '+Number(n).toFixed(2)},shell:s=>s,merchantTimestampFresh:()=>true});
vm.runInContext(['merchantCatalogAvailableChoices','merchantCatalogFilterChoices','merchantCatalogGasOptions','merchantLiveCatalog']
 .map(x=>take(x)).join('\n')+';this.choices=merchantCatalogAvailableChoices;this.filter=merchantCatalogFilterChoices;this.gas=merchantCatalogGasOptions;this.page=merchantLiveCatalog;',ctx);
const all=ctx.choices(registry);
assert.equal(all.length,6,'all approved safe registry entries, minus GLP and injected SKU');
assert.equal(all.some(x=>x.productCode==='P20'),false,'GLP must stay in regulated flow');
assert.equal(all.some(x=>x.productCode==="X1');alert(1)//"),false,'untrusted SKU must be rejected');
assert.equal(ctx.filter(all,'Água','').length,2,'filter by category');
assert.equal(ctx.filter(all,'','agua').length,2,'accent-insensitive search');
assert.equal(ctx.filter(all,'','CARVAO').length,1,'case+accent-insensitive search');
assert.equal(ctx.filter(all,'','foo').length,0,'no fabricated fallback');
assert.equal(ctx.filter(all,'Lenha','carvão').length,0,'combined filters');
registry.catalog=[{productCode:'WATER20'}];
assert.equal(ctx.choices(registry).some(p=>p.productCode==='WATER20'),false,'no duplicate registered SKU');
registry.catalog=[];
let page=ctx.page();
for(const marker of ['live-new-registry-category','live-new-registry-search','live-new-registry-product',
 'merchantCatalogFilterRegistry()','live-new-registry-add','live-new-registry-count',
 'live-new-glp-code','live-new-container-code']){
 assert.ok(page.includes(marker),marker);
}
assert.ok(page.includes('<optgroup label="Água">'));
assert.ok(page.includes('value="P13"'),'gas select contains common 13kg size');
assert.ok(!page.includes('<svg onload=alert(1)>'),'category escaped');
assert.ok(!page.includes('<img src=x onerror=alert(1)>'),'product text escaped');
assert.ok(page.includes('&lt;svg onload=alert(1)&gt;'),'escaped category visible');

function node(tag){
 return {tagName:tag.toUpperCase(),children:[],appendChild(child){this.children.push(child)},
  replaceChildren(child){this.children=child.children},
  set value(v){this._value=String(v)},get value(){return this._value||''}};
}
const fields={
 'live-new-registry-product':node('select'),
 'live-new-registry-category':{value:'Água'},
 'live-new-registry-search':{value:'mineral'},
 'live-new-registry-count':{textContent:''},
 'live-new-registry-add':{disabled:false,textContent:'Adicionar produto'}
};
const document={
 getElementById:id=>fields[id]??null,
 createDocumentFragment:()=>node('fragment'),createElement:tag=>node(tag)
};
const filterCtx=vm.createContext({document,globalThis:{merchantRuntime:registry},products});
vm.runInContext([take('merchantCatalogAvailableChoices'),take('merchantCatalogFilterChoices'),
 take('merchantCatalogFilterRegistry')].join('\n')+';this.refresh=merchantCatalogFilterRegistry;',filterCtx);
filterCtx.refresh();
let children=fields['live-new-registry-product'].children;
assert.equal(children.length,1,'one matching category optgroup');
assert.equal(children[0].label,'Água');
assert.equal(children[0].children.length,1,'one filtered product');
assert.equal(children[0].children[0].value,'WATER20');
assert.equal(fields['live-new-registry-count'].textContent,'1 produto(s) para escolher');
fields['live-new-registry-search'].value='<script>';
filterCtx.refresh();
assert.equal(fields['live-new-registry-add'].disabled,true,'no-result cannot be submitted');
children=fields['live-new-registry-product'].children;
assert.equal(children[0].textContent,'Nenhum produto encontrado');
fields['live-new-registry-search'].value='';
fields['live-new-registry-category'].value='';
filterCtx.refresh();
assert.equal(fields['live-new-registry-add'].disabled,false);
assert.equal(fields['live-new-registry-product'].children.length,5,'categories populated from real registry');
assert.ok(fields['live-new-registry-product'].children.some(c=>c.label==='<svg onload=alert(1)>'),'DOM API text, not innerHTML');
const sizes=ctx.gas(registry,false);
assert.ok(sizes.includes('value="P13"'));
assert.ok(sizes.includes('value="P90"'));
assert.ok(sizes.includes('13 kg (P13)'));
registry.catalog=[{productCode:'P13'},{productCode:'P20_CONTAINER'}];
assert.ok(!ctx.gas(registry,false).includes('value="P13"'));
assert.ok(!ctx.gas(registry,true).includes('value="P20"'));
registry.catalog=[];

fields['live-new-registry-product'].value='WATER20';
fields['live-new-registry-price']={value:'19.90'};
fields['live-new-registry-stock']={value:'4'};
let calls=0,finish,sideEffects=[];
let pending=new Promise(resolve=>{finish=resolve});
const addContext=vm.createContext({
 document,globalThis:{merchantRuntime:registry},products,toast:v=>sideEffects.push(String(v)),
 merchantUpdateProductLive:(...args)=>{calls++;return pending}
});
vm.runInContext('const merchantCatalogSaving=new Set();\n'+take('merchantCatalogAvailableChoices')+
 '\n'+take('merchantLiveAddRegisteredProduct',true)+
 ';this.add=merchantLiveAddRegisteredProduct;',addContext);
const first=addContext.add(),twice=addContext.add();
assert.equal(calls,1,'double-tap submits once');
assert.equal(fields['live-new-registry-add'].disabled,true);
finish({ok:true});
await Promise.all([first,twice]);
assert.equal(fields['live-new-registry-add'].disabled,false);
assert.equal(fields['live-new-registry-add'].textContent,'Adicionar produto');
assert.ok(sideEffects.some(x=>x.includes('adicionado ao catálogo')));
fields['live-new-registry-product'].value='INVALIDSKU';
await addContext.add();
assert.equal(calls,1,'unlisted product cannot be submitted');
fields['live-new-registry-product'].value='WATER20';
fields['live-new-registry-stock'].value='100001';
await addContext.add();
assert.equal(calls,1,'invalid stock cannot submit');
fields['live-new-registry-stock'].value='4';
pending=Promise.reject(new Error('Conflito de versão'));
await addContext.add();
assert.equal(calls,2);
assert.equal(fields['live-new-registry-add'].disabled,false,'error cannot permanently lock action');
assert.ok(sideEffects.includes('Conflito de versão'));
assert.ok(css.includes('.merchant-catalog-chooser'));
assert.ok(css.includes('@media(max-width:560px)'));
assert.ok(audit.includes('node tests/merchant-category-chooser-v1-172.mjs'));
console.log('V1.172 passou: registro autorizado, busca por categoria/acentos, seleção segura, controle de tamanho GLP, erro e duplo clique.');
