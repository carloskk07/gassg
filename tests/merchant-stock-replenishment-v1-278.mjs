import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/merchant.js');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
const backend=read('js/backend.js');
new vm.Script(js,{filename:'js/merchant.js'});
function pick(name,asyncFn=false){
 const a=js.indexOf((asyncFn?'async ':'')+'function '+name+'(');
 assert.ok(a>=0,'Missing '+name);
 const b=js.indexOf('\n}',a);
 assert.ok(b>a,'Unterminated '+name);
 return js.slice(a,b+2);
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fresh=new Date(Date.now()-60*1000).toISOString();
const stale=new Date(Date.now()-48*3600000).toISOString();
const catalog=[
 {productCode:'P13',productName:'Gás P13',active:true,priceCents:12990,availableStock:0,priceConfirmedAt:stale,pricingMode:'fixed'},
 {productCode:'AGUA20',productName:'Água 20L',active:true,priceCents:1900,availableStock:2,priceConfirmedAt:fresh,pricingMode:'fixed'},
 {productCode:'P45',productName:'Gás P45',active:true,priceCents:48000,availableStock:8,priceConfirmedAt:fresh,pricingMode:'fixed'},
 {productCode:'WATER2',productName:'Água <img src=x onerror=alert(1)>',active:true,priceCents:1000,availableStock:0,priceConfirmedAt:fresh,pricingMode:'fixed'},
 {productCode:'INACTIVE',active:false,priceCents:1000,availableStock:0,priceConfirmedAt:stale},
 {productCode:'MISSINGPRICE',active:true,priceCents:0,availableStock:0,priceConfirmedAt:stale},
 {productCode:'P13',active:true,priceCents:12990,availableStock:0,priceConfirmedAt:stale}
];
const rt={status:'ready',merchant:{memberRole:'owner',merchantId:'m1'},catalog,actionPending:false};
const fields={},writes=[],toasts=[];
const ctx=vm.createContext({
 esc,globalThis:{merchantRuntime:rt},
 BRL:{format:v=>'R$ '+Number(v).toFixed(2)},
 document:{getElementById:id=>fields[id]||null},
 toast:s=>toasts.push(String(s)),
 merchantUpdateProductLive:async(...args)=>{writes.push(args);}
});
vm.runInContext([
 'const merchantQuickDrafts=new Map();',pick('merchantTimestampFresh'),
 pick('merchantQuickCatalogCandidates'),
 pick('merchantQuickStockAlerts'),pick('merchantQuickCatalogVersion'),pick('merchantQuickDraftKey'),
 pick('merchantQuickDraftFor'),pick('merchantQuickRecentChanges'),pick('merchantQuickCatalogChanged'),
 pick('merchantQuickStockAdjust'),
 pick('merchantQuickCatalogView'),
 pick('merchantQuickCatalogSave',true)
].join('\n')+';this.alerts=merchantQuickStockAlerts;this.adjust=merchantQuickStockAdjust;'+
 'this.view=merchantQuickCatalogView;this.save=merchantQuickCatalogSave;',ctx);

assert.deepEqual([ctx.alerts(rt).empty,ctx.alerts(rt).low,ctx.alerts(rt).priceReview],[3,1,1],
 'Active records counted once, low excludes zero, expired price counted only when valid');
const markup=ctx.view(rt);
assert.match(markup,/3 esgotado\(s\)/);
assert.match(markup,/1 com estoque baixo/);
assert.match(markup,/1 preço\(s\) para confirmar/);
assert.match(markup,/Conferência do catálogo/);
assert.match(markup,/Sem estoque/);
assert.match(markup,/Estoque baixo \(até 3 unidades\)/);
assert.match(markup,/Preço precisa de nova confirmação/);
assert.match(markup,/merchantQuickStockAdjust\('P13',-1\)/);
assert.match(markup,/merchantQuickStockAdjust\('P13',1\)/);
assert.match(markup,/merchantQuickStockAdjust\('P13',5\)/);
assert.match(markup,/Os ajustes não são salvos automaticamente/);
assert.match(markup,/aria-live="polite"/);
assert.doesNotMatch(markup,/<img|<script|<svg/,'untrusted product names remain escaped');
assert.match(markup,/Água &lt;img/);
assert.doesNotMatch(markup,/merchantQuickStockAdjust\('INACTIVE'/);
assert.doesNotMatch(markup,/merchantQuickStockAdjust\('MISSINGPRICE'/);

fields['merchant-quick-stock-P13']={
 value:'0',disabled:false,closest:()=>({disabled:false})
};
fields['merchant-quick-feedback-P13']={textContent:''};
fields['merchant-quick-price-P13']={value:'129.90'};
assert.equal(ctx.adjust('P13',-1),false,'cannot create negative stock');
assert.equal(ctx.adjust('P13',5),true);
assert.equal(fields['merchant-quick-stock-P13'].value,'5');
assert.match(fields['merchant-quick-feedback-P13'].textContent,/Estoque ajustado para 5/);
assert.match(fields['merchant-quick-feedback-P13'].textContent,/Salvar alterações/);
assert.equal(writes.length,0,'stepper never writes to backend');
assert.equal(ctx.adjust('P13',1),true);
assert.equal(fields['merchant-quick-stock-P13'].value,'6');
assert.equal(ctx.adjust('P13',-1),true);
assert.equal(fields['merchant-quick-stock-P13'].value,'5');
assert.equal(writes.length,0);
await ctx.save('P13');
assert.equal(writes.length,1);
assert.deepEqual(Array.from(writes[0]).slice(0,4),['P13',12990,5,true]);
assert.equal(toasts.at(-1),'Preço e estoque de P13 confirmados.');

fields['merchant-quick-stock-P13'].value='100000';
assert.equal(ctx.adjust('P13',1),false);
assert.equal(ctx.adjust('P13',5),false);
assert.equal(fields['merchant-quick-stock-P13'].value,'100000');
for(const value of ['','0.5','1e4','00','abc','-1','100001']){
 fields['merchant-quick-stock-P13'].value=value;
 assert.equal(ctx.adjust('P13',1),false,'reject invalid inventory draft '+value);
}
assert.equal(writes.length,1,'invalid draft cannot submit through buttons');
fields['merchant-quick-stock-P13'].value='4';
assert.equal(ctx.adjust("P13');alert(1)//",5),false,'reject invalid product code');
assert.equal(ctx.adjust('INACTIVE',5),false,'never modify inactive items');
assert.equal(ctx.adjust('P13',2),false,'only known replenishment steps');
fields['merchant-quick-stock-P13'].disabled=true;
assert.equal(ctx.adjust('P13',1),false);
fields['merchant-quick-stock-P13'].disabled=false;
fields['merchant-quick-stock-P13'].closest=()=>({disabled:true});
assert.equal(ctx.adjust('P13',1),false);
fields['merchant-quick-stock-P13'].closest=()=>({disabled:false});

rt.actionPending=true;
assert.equal(ctx.adjust('P13',1),false);
rt.actionPending=false;
rt.merchant.memberRole='operator';
assert.equal(ctx.adjust('P13',5),false);
assert.equal(ctx.view(rt),'');
rt.merchant.memberRole='driver';
assert.equal(ctx.adjust('P13',5),false);
rt.merchant.memberRole='manager';
assert.equal(ctx.adjust('P13',5),true,'manager can prepare a stock draft');
assert.equal(writes.length,1);
rt.status='failed';
assert.equal(ctx.adjust('P13',1),false);
rt.status='ready';

const noAlerts={merchant:rt.merchant,catalog:[{
 productCode:'P13',active:true,priceCents:12000,availableStock:8,priceConfirmedAt:fresh,pricingMode:'fixed'
}]};
assert.deepEqual([ctx.alerts(noAlerts).empty,ctx.alerts(noAlerts).low,ctx.alerts(noAlerts).priceReview],[0,0,0]);
assert.match(ctx.view(noAlerts),/Ajustes rápidos para até 6 produtos ativos/);
assert.doesNotMatch(ctx.view(noAlerts),/Conferência do catálogo/);

assert.match(js,/function merchantQuickStockAdjust\(productCode,change\)/);
assert.match(backend,/action:'update-product'/);
assert.match(backend,/expectedUpdatedAt=String\(current.updatedAt\)/);
assert.match(css,/\.merchant-quick-stepper>button/);
assert.match(css,/@media\(max-width:340px\)/);
assert.match(audit,/node tests\/merchant-stock-replenishment-v1-278.mjs/);
console.log('V1.278 PASS: stock shortages, price freshness, no autosave, roles, bounds and backend confirmation.');
