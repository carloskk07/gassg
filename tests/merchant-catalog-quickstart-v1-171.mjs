import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const load=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=load('js/merchant.js'),css=load('css/components.css');
new vm.Script(source,{filename:'merchant.js'});
function excerpt(signature){
 const start=source.indexOf(signature);
 assert.ok(start>=0,'Missing function or guard: '+signature);
 const end=source.indexOf('\n}',start);
 assert.ok(end>start,'Missing closing brace: '+signature);
 return source.slice(start,end+2);
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const runtime={
 status:'ready',merchant:{memberRole:'owner'},
 catalog:[
  {productCode:'P13',productName:'Botijão 13 kg',priceCents:12000,active:true,availableStock:5,
    pricingMode:'fixed',priceConfirmedAt:'2026-10-12T12:00:00.000Z'},
  {productCode:'P45',productName:'Botijão 45 kg',priceCents:40000,active:false,availableStock:0,
    pricingMode:'range',minPriceCents:38000,maxPriceCents:45000,priceConfirmedAt:null}
 ],
 availableProducts:[{productCode:'WATER20',productName:'Água 20L',categoryName:'Água'},
  {productCode:'CUSTOMWATER',productName:'Produto <img src=x onerror=alert(1)>',categoryName:'Água'}]
};
const currency={format:v=>'R$ '+Number(v).toFixed(2)};
const globals={merchantRuntime:runtime};
const context=vm.createContext({
 globalThis:globals,esc,products:{P13:{name:'Gás P13',icon:'🔥'},
 WATER20:{name:'Água 20L',icon:'💧'},
 WOOD:{name:'Lenha',icon:'🪵'}},BRL:currency,shell:s=>s,
 merchantTimestampFresh:()=>true
});
vm.runInContext(excerpt('function merchantLiveCatalog(')+';this.renderCatalog=merchantLiveCatalog;',context);
let html=context.renderCatalog();
assert.ok(html.includes('Produtos da minha revenda'));
assert.ok(html.includes('merchant-catalog-list'));
assert.ok(html.includes('2 cadastrado(s)'),'Only configured product count is shown');
assert.ok(html.includes('Botijão 13 kg')&&html.includes('Botijão 45 kg'));
assert.ok(html.includes('Outros produtos comuns'),'Optional local templates must be available');
assert.ok(html.includes('Adicionar produto ou vasilhame'));
assert.ok(html.indexOf('Meus produtos')<html.indexOf('Adicionar produto ou vasilhame'),
 'Existing catalog precedes new product choices');
assert.ok(html.includes('live-price-P13')&&html.includes('live-stock-P13'),'Basic price and stock controls');
assert.ok(html.includes('merchant-catalog-save'));
assert.ok(html.includes('merchant-catalog-pricing'),'Advanced strategy preserved');
assert.ok(html.includes('live-pricing-mode-P13'));
assert.ok(html.includes('live-min-price-P45')&&html.includes('live-max-price-P45'));
assert.ok(html.includes('live-active-P13'),'Product activation stays opt-in');
assert.ok(html.includes('merchantLiveAddRegisteredProduct()'));
assert.ok(html.includes('merchantLiveAddGlp()')&&html.includes('merchantLiveAddContainer()'));
assert.ok(html.includes('Cadastrar produto não libera vendas automaticamente'));
assert.ok(!html.includes('<img src=x onerror=alert(1)>'),'Escaping server-supplied names');
assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
const oldItem=runtime.catalog.shift();
html=context.renderCatalog();
assert.ok(!html.slice(html.indexOf('merchant-catalog-list'),html.indexOf('merchant-catalog-extra')).includes('live-price-P13'),
 'Products absent from account should not appear among configured products');
assert.ok(html.includes('live-price-P13'),'Common products still available as optional templates');
runtime.catalog.unshift(oldItem);
runtime.merchant.memberRole='operator';
html=context.renderCatalog();
assert.ok(html.includes('Somente o proprietário ou gerente'));
assert.ok(!html.includes('live-save-product-P13'),'Operators cannot see editing controls');
runtime.merchant.memberRole='driver';
assert.ok(context.renderCatalog().includes('Somente o proprietário ou gerente'));
runtime.merchant.memberRole='manager';
assert.ok(context.renderCatalog().includes('live-save-product-P13'));
runtime.merchant.memberRole='owner';
runtime.catalog.push({productCode:"X1');alert(1);//",productName:'Evil',priceCents:100,active:true,availableStock:1});
assert.ok(!context.renderCatalog().includes('Evil'),'Unexpected server product codes cannot reach inline handlers');

const fields={
 'live-price-P13':{value:'120.00'},
 'live-stock-P13':{value:'7'},
 'live-active-P13':{checked:true},
 'live-pricing-mode-P13':{value:'fixed'},
 'live-pricing-strategy-P13':{value:'balanced'},
 'live-min-price-P13':{value:'100'},
 'live-max-price-P13':{value:'140'},
 'live-save-product-P13':{textContent:'Salvar preço e estoque',disabled:false}
};
const alerts=[];
let calls=0,finish;
let promise=new Promise(resolve=>{finish=resolve;});
const saveCtx=vm.createContext({
 document:{getElementById:id=>fields[id]||null},toast:value=>alerts.push(value),
 merchantUpdateProductLive:(...args)=>{calls++;return promise;}
});
vm.runInContext(
 'const merchantCatalogSaving=new Set();\n'+excerpt('async function merchantLiveSaveProduct(')+
 ';this.saveCatalog=merchantLiveSaveProduct;',saveCtx);
const one=saveCtx.saveCatalog('P13'),duplicate=saveCtx.saveCatalog('P13');
assert.equal(calls,1,'Double-tap cannot submit twice before server confirmation');
assert.equal(fields['live-save-product-P13'].disabled,true);
finish({});
await Promise.all([one,duplicate]);
assert.equal(fields['live-save-product-P13'].disabled,false);
assert.equal(fields['live-save-product-P13'].textContent,'Salvar preço e estoque');
assert.equal(alerts.at(-1),'Preço fixo de P13 confirmado');
fields['live-stock-P13'].value='100001';
await saveCtx.saveCatalog('P13');
assert.equal(calls,1,'Stock over backend maximum must be rejected');
fields['live-stock-P13'].value='7';
fields['live-pricing-mode-P13'].value='range';
fields['live-min-price-P13'].value='125';
fields['live-max-price-P13'].value='130';
await saveCtx.saveCatalog('P13');
assert.equal(calls,1,'Range whose minimum is above normal price must be rejected');
fields['live-pricing-mode-P13'].value='fixed';
promise=Promise.reject(new Error('Conflito de versão'));
await saveCtx.saveCatalog('P13');
assert.equal(calls,2,'Saving after failed request must remain possible');
assert.equal(fields['live-save-product-P13'].disabled,false,'Failure must restore save button');
assert.ok(alerts.some(s=>String(s).includes('Conflito de versão')));
assert.ok(css.includes('.merchant-catalog-save')&&css.includes('.merchant-catalog-kind'));
assert.ok(css.includes('@media(max-width:520px)'));
console.log('V1.171: configured-first catalog, optional categories, price-range preservation, role isolation, XSS rejection and save concurrency passed.');
