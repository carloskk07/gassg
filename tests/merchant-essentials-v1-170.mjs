import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('js/merchant.js'),css=read('css/components.css');
new vm.Script(ui,{filename:'js/merchant.js'});
const extract=name=>{
 const start=ui.indexOf('function '+name+'(');
 assert.ok(start>=0,'Missing '+name);
 const end=ui.indexOf('\n}',start);
 assert.ok(end>start,'Missing end '+name);
 return ui.slice(start,end+2);
};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const now=new Date().toISOString();
const stale='2020-01-01T00:00:00Z';
const fresh=value=>Boolean(value&&value!==stale);
const runtime={
 status:'ready',merchant:{merchantId:'merchant-1',memberRole:'owner',acceptsCitywide:true,
  deliveryFeeConfirmedAt:now,paymentMethods:{pix:true,card:false,cash:false}},
 catalog:[{productCode:'P13',productName:'Botijão 13 kg',priceCents:12000,availableStock:5,active:true,priceConfirmedAt:now}],
 paymentRoutes:[{paymentMethod:'pix',active:true}]
};
const base={
 esc,merchantTimestampFresh:fresh,
 globalThis:{merchantRuntime:runtime},BRL:{format:x=>'R$ '+Number(x).toFixed(2)},
 products:{P13:{name:'Botijão 13 kg',icon:'🔥'},WATER20:{name:'Água',icon:'💧'}},
 shell:html=>html,document:null
};
const sandbox=vm.createContext(base);
vm.runInContext(['merchantSetupSnapshot','merchantSetupView','merchantRevealControl','merchantSetupGo','merchantCatalogAvailableChoices','merchantCatalogGasOptions','merchantLiveCatalog']
 .map(extract).join('\n')+';this.snapshot=merchantSetupSnapshot;this.renderSetup=merchantSetupView;this.renderCatalog=merchantLiveCatalog;this.show=merchantRevealControl;this.goSetup=merchantSetupGo;',sandbox);
const evaluate=expr=>vm.runInContext(expr,sandbox);
const steps=JSON.parse(evaluate('JSON.stringify(snapshot(globalThis.merchantRuntime))'));
assert.equal(steps.length,3);
assert.equal(steps.filter(step=>step.done).length,3,'All 3 setup fields from genuine local state');
const view=sandbox.renderSetup(runtime);
assert.ok(view.includes('3 de 3 preenchidos'));
assert.ok(view.includes('Esses ajustes não liberam vendas automaticamente'));
assert.ok(!view.includes('Ativada automaticamente'),'No auto activation promise');
assert.ok(view.includes("merchantSetupGo('products')")&&view.includes("merchantSetupGo('delivery')")&&view.includes("merchantSetupGo('payment')"));
runtime.merchant.memberRole='driver';
assert.equal(sandbox.renderSetup(runtime),'','Driver cannot see seller setup');
runtime.merchant.memberRole='operator';
assert.equal(sandbox.renderSetup(runtime),'','Operator cannot manage account settings');
runtime.merchant.memberRole='owner';
runtime.catalog[0].priceConfirmedAt=stale;
runtime.merchant.deliveryFeeConfirmedAt=stale;
runtime.paymentRoutes[0].active=false;
assert.equal(sandbox.snapshot(runtime).filter(s=>s.done).length,0,'Expired stock/delivery and inactive route should not be counted ready');
assert.ok(sandbox.renderSetup(runtime).includes('0 de 3 preenchidos'));
runtime.catalog[0].active=false;
runtime.catalog[0].priceConfirmedAt=now;
assert.equal(sandbox.snapshot(runtime)[0].done,false,'Inactive SKU cannot count as configured');
runtime.catalog[0].active=true;
runtime.catalog[0].availableStock=0;
assert.equal(sandbox.snapshot(runtime)[0].done,false,'Zero stock cannot count as available');
runtime.catalog[0].availableStock=5;
runtime.merchant.deliveryFeeConfirmedAt=now;
runtime.paymentRoutes[0].active=true;

const root={tagName:'DETAILS',open:false,parentElement:null};
const inner={tagName:'DETAILS',open:false,parentElement:root};
const field={parentElement:inner,focus(){this.focused=true},scrollIntoView(){this.scrolled=true}};
let navigation='',notices=[];
sandbox.document={querySelector:key=>key==='#live-payment-pix'?field:null};
sandbox.go=key=>navigation=key;
sandbox.toast=message=>notices.push(message);
assert.equal(sandbox.show('#live-payment-pix'),true);
assert.equal(inner.open,true,'Inner collapsed section opened');
assert.equal(root.open,true,'Outer collapsed section opened');
assert.equal(field.focused,true,'Control focused');
sandbox.goSetup('products');
assert.equal(navigation,'catalog','Product setup uses existing catalog route');
sandbox.goSetup('unknown');
assert.equal(notices.length,0,'Unexpected setup keys ignored');

const catalog=sandbox.renderCatalog();
assert.ok(catalog.includes('Produtos da minha revenda'));
assert.ok(catalog.includes('merchant-catalog-entry'));
assert.ok(catalog.includes('merchant-catalog-extra'));
assert.ok(catalog.includes('live-price-P13')&&catalog.includes('merchantLiveSaveProduct'));
assert.ok(catalog.includes('Adicionar outro produto ou vasilhame'));
assert.ok(catalog.indexOf('merchant-catalog-list')<catalog.indexOf('merchant-catalog-extra'),
 'Price and stock edits precede optional new product types');
runtime.catalog[0].productName='<img src=x onerror=alert(1)>';
const safe=sandbox.renderCatalog();
assert.ok(safe.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!safe.includes('<img src=x onerror=alert(1)>'),'Catalog must not inject product name');
const page=extract('merchantLivePage');
assert.ok(page.indexOf('merchantSetupView(rt)')<page.indexOf('merchantBillingLiveView(rt)'),
 'Essentials must appear before finance controls');
assert.ok(page.indexOf('id="merchant-live-orders"')<page.indexOf('merchantBillingLiveView(rt)'),
 'Orders need priority over financial settings');
assert.ok(page.includes('id="merchant-operation-settings"'));
assert.ok(page.includes('merchant-settings-advanced'),'Optional controls kept available');
assert.ok(page.includes('merchantEnablementAssistantView(rt)'),'Real eligibility diagnostics preserved');
assert.ok(page.includes('merchantLiveSavePaymentMethods()'),'Saving payment methods preserved');
assert.ok(page.includes('merchantLiveSaveCapacity()'),'Capacity options retained');
assert.ok(page.includes('merchantLiveSaveScheduling()'),'Scheduling retained');
assert.ok(ui.includes("if(key==='inventory'){go('catalog');return}"));
assert.ok(ui.includes('if(!merchantRevealControl(selectors[key]))'),'Existing diagnostics can reveal collapsed settings');
assert.ok(css.includes('.merchant-essentials-grid')&&css.includes('@media(max-width:520px)'));
console.log('V1.170: three verified setup steps, role isolation, stale/route gates, collapsed focus, catalog security and mobile layout passed.');
