import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const js=read('js/merchant.js'),css=read('css/components.css'),audit=read('.github/workflows/audit.yml');
new vm.Script(js,{filename:'js/merchant.js'});
function extract(name){
  const start=js.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing function '+name);
  const end=js.indexOf('\n}',start);
  assert.ok(end>start,name+' closure');
  return js.slice(start,end+2);
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const now=new Date().toISOString();
const stale=new Date(Date.now()-30*3600000).toISOString();
const rt={status:'ready',merchant:{memberRole:'owner'},availableProducts:[],
 catalog:[
  {productCode:'P13',productName:'Botijão P13',priceCents:12000,active:true,availableStock:4,
   pricingMode:'fixed',priceConfirmedAt:stale},
  {productCode:'P45',productName:'Botijão P45',priceCents:45000,active:true,availableStock:0,
   pricingMode:'fixed',priceConfirmedAt:now},
  {productCode:'P20',productName:'Botijão P20',priceCents:21000,active:false,availableStock:0,
   pricingMode:'fixed',priceConfirmedAt:stale},
  {productCode:'WOOD',productName:'Lenha',priceCents:2300,active:true,availableStock:6,
   pricingMode:'fixed',priceConfirmedAt:now}
 ]};
const ctx=vm.createContext({globalThis:{merchantRuntime:rt},
 products:{P13:{name:'Botijão',icon:'🔥'},WOOD:{name:'Lenha',icon:'🪵'}},
 esc,BRL:{format:num=>'R$ '+Number(num).toFixed(2)},shell:s=>s});
vm.runInContext([
 'merchantTimestampFresh','merchantCatalogAvailableChoices','merchantCatalogGasOptions','merchantLiveCatalog'
].map(extract).join('\n')+';this.renderCatalog=merchantLiveCatalog;',ctx);
let page=ctx.renderCatalog();
assert.ok(page.includes('Produtos que precisam de atenção'));
assert.ok(page.includes('2 para revisar'));
const alertText=page.split('<section class="merchant-catalog-attention"')[1].split('</section>')[0];
assert.ok(alertText.includes('Botijão P13')&&alertText.includes('Preço precisa de confirmação'));
assert.ok(alertText.includes('Botijão P45')&&alertText.includes('Sem estoque'));
assert.ok(!alertText.includes('Botijão P20'),'Intentionally inactive items are not flagged');
assert.ok(!alertText.includes('Lenha'),'Healthy items are not flagged');
assert.ok(alertText.includes('Nenhuma alteração será enviada sem você salvar'));
assert.ok(alertText.includes("merchantCatalogFocus('P13','price')"));
assert.ok(alertText.includes("merchantCatalogFocus('P45','stock')"));
const list=page.split('<div class="merchant-catalog-list">')[1].split('<details class="merchant-catalog-extra">')[0];
assert.ok(list.indexOf('merchant-catalog-item-P13')<list.indexOf('merchant-catalog-item-WOOD'));
assert.ok(list.indexOf('merchant-catalog-item-P45')<list.indexOf('merchant-catalog-item-WOOD'));
assert.ok(page.includes('merchantCatalogAdjustStock(\'P13\',-1)'));
assert.ok(page.includes('merchantCatalogAdjustStock(\'P13\',1)'));
assert.ok(page.includes("merchantCatalogMarkEdited('P13')"));
assert.ok(page.includes('merchant-catalog-pending-P13'));
assert.ok(page.includes('live-save-product-P13'));
assert.ok(page.includes('merchantLiveSaveProduct(\'P13\')'),'Only explicit Save commits modifications');
assert.ok(page.includes('Preço automático e limites (opcional)'),'Advanced pricing retained');
rt.catalog[0].priceConfirmedAt=now;rt.catalog[1].availableStock=3;
page=ctx.renderCatalog();
assert.ok(page.includes('Sem pendências nos produtos ativos.'));
assert.ok(!page.includes('2 para revisar'));
rt.catalog.splice(0);page=ctx.renderCatalog();
assert.ok(page.includes('Adicione seu primeiro produto para começar.'));
rt.catalog=[{productCode:'P13',productName:'<img src=x onerror=alert(1)>',priceCents:12000,
 active:true,availableStock:0,priceConfirmedAt:stale}];
page=ctx.renderCatalog();
assert.ok(page.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!page.includes('<img src=x onerror=alert(1)>'),'Names escaped in both attention card and input aria');

const note={textContent:'',parentElement:null};
const field={value:'0',focus(){this.focused=true},scrollIntoView(){this.scrolled=true}};
const card={open:false,parentElement:null};
const parent={tagName:'DETAILS',open:false,parentElement:null};
card.parentElement=parent;
const elements={
 'live-stock-P13':field,
 'live-price-P13':{focus(){this.focused=true},scrollIntoView(){this.scrolled=true}},
 'merchant-catalog-item-P13':card,
 'merchant-catalog-pending-P13':note
};
const toasts=[];
const dom=vm.createContext({document:{getElementById:id=>elements[id]||null},toast:v=>toasts.push(String(v))});
vm.runInContext(['merchantCatalogFocus','merchantCatalogAdjustStock','merchantCatalogMarkEdited']
 .map(extract).join('\n')+
 ';this.focusItem=merchantCatalogFocus;this.adjust=merchantCatalogAdjustStock;this.mark=merchantCatalogMarkEdited;',dom);
assert.equal(dom.focusItem('P13','stock'),true);
assert.equal(card.open,true);
assert.equal(parent.open,true);
assert.equal(field.focused,true);
assert.equal(dom.focusItem("P13');alert(1);//",'stock'),false,'Unsafe ID rejected');
assert.equal(dom.adjust('P13',1),true);
assert.equal(field.value,'1');
assert.ok(note.textContent.includes('ainda não salva'));
assert.equal(dom.adjust('P13',-1),true);
assert.equal(field.value,'0');
assert.equal(dom.adjust('P13',-1),false,'Never negative');
assert.equal(field.value,'0');
field.value='100000';
assert.equal(dom.adjust('P13',1),false,'Never exceed backend maximum');
field.value='1.5';
assert.equal(dom.adjust('P13',1),false,'No fractional stock');
field.value='-1';
assert.equal(dom.adjust('P13',1),false,'No invalid negative stock');
field.value='4a';
assert.equal(dom.adjust('P13',1),false,'No malformed stock');
field.value='2';
assert.equal(dom.adjust('P13',4),false,'Unexpected adjustment rejected');
assert.equal(dom.adjust("P13');alert(1);//",1),false,'Unsafe SKU rejected');
assert.ok(toasts.length>=3);
note.textContent='';
dom.mark('P13');
assert.ok(note.textContent.includes('ainda não salva'));
assert.equal(typeof dom.focusItem('P13','price'),'boolean');
assert.ok(elements['live-price-P13'].focused);
rt.merchant.memberRole='driver';
assert.ok(ctx.renderCatalog().includes('Somente o proprietário ou gerente'));
assert.ok(!ctx.renderCatalog().includes('merchant-catalog-attention'));
assert.ok(css.includes('.merchant-catalog-stock-controls'));
assert.ok(css.includes('.merchant-catalog-attention-item'));
assert.ok(audit.includes('node tests/merchant-catalog-maintenance-v1-173.mjs'));
console.log('V1.173: needs-review queue, freshness, inactive exceptions, stock bounds, no implicit writes, focus, role restrictions and XSS passed.');
