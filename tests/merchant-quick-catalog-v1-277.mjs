import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/merchant.js'),css=read('css/components.css');
const audit=read('.github/workflows/audit.yml'),backend=read('js/backend.js');
new vm.Script(js,{filename:'js/merchant.js'});
function take(name,asyncFn=false){
 const start=js.indexOf((asyncFn?'async ':'')+'function '+name+'(');
 assert.ok(start>=0,'missing '+name);
 const end=js.indexOf('\n}',start);assert.ok(end>start,'unterminated '+name);
 return js.slice(start,end+2);
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const original=[
 {productCode:'P13',productName:'GLP P13',active:true,priceCents:11990,availableStock:3,pricingMode:'fixed'},
 {productCode:'AGUA20',productName:'Água 20L <img src=x onerror=alert(1)>',active:true,priceCents:1600,availableStock:0,pricingMode:'fixed'},
 {productCode:'P45',productName:'P45 gás',active:true,priceCents:47000,availableStock:4,pricingMode:'range',
  minPriceCents:45000,maxPriceCents:49000,pricingStrategy:'balanced'},
 {productCode:'INACTIVE',active:false,priceCents:3500,availableStock:9},
 {productCode:'bad\' onclick="alert(1)',active:true,priceCents:1000,availableStock:9},
 {productCode:'MISSING_PRICE',active:true,availableStock:1},
 {productCode:'DUP',active:true,priceCents:900,availableStock:1},
 {productCode:'DUP',active:true,priceCents:900,availableStock:2},
 {productCode:'RANGE_BAD',active:true,priceCents:8000,availableStock:7,pricingMode:'range',
  minPriceCents:9000,maxPriceCents:10000},
 ...Array.from({length:6},(_,i)=>({productCode:'OTHER'+i,active:true,
  productName:'Outro '+i,priceCents:1200+i*10,availableStock:2}))
];
const rt={status:'ready',merchant:{memberRole:'owner',merchantId:'m-1'},
 catalog:original,actionPending:false};
const els={},opened=[],routes=[],messages=[],writes=[];
const ctx=vm.createContext({esc,globalThis:{merchantRuntime:rt},
 BRL:{format:x=>'R$ '+Number(x).toFixed(2)},
 document:{
   getElementById:id=>els[id]||null
 },
 merchantRevealControl:selector=>{opened.push(selector);return true;},
 go:path=>routes.push(path),
 toast:msg=>messages.push(String(msg)),
 merchantUpdateProductLive:async(...args)=>{writes.push(args);}
});
vm.runInContext([
 take('merchantQuickCatalogCandidates'),take('merchantQuickCatalogView'),
 take('merchantAvailabilityGo'),take('merchantQuickCatalogSave',true)
].join('\n')+';this.candidates=merchantQuickCatalogCandidates;this.view=merchantQuickCatalogView;'+
 'this.navigate=merchantAvailabilityGo;this.save=merchantQuickCatalogSave;',ctx);

const list=Array.from(ctx.candidates(rt));
assert.equal(list.length,6,'max six active valid products');
assert.equal(list[0].productCode,'P13');
assert.equal(list[1].productCode,'AGUA20','empty stock prioritized for restock');
assert.equal(list.filter(x=>x.productCode==='DUP').length,1);
assert.equal(original.length,15,'never modify server-owned catalog');
assert.ok(!list.some(x=>x.productCode==='INACTIVE'||x.productCode.startsWith('bad')||x.productCode==='MISSING_PRICE'));
let markup=ctx.view(rt);
assert.match(markup,/<details id="merchant-quick-catalog"/);
assert.match(markup,/Preço normal \(R\$\)/);
assert.match(markup,/Em estoque/);
assert.match(markup,/merchantQuickCatalogSave\('P13'\)/);
assert.match(markup,/merchantQuickCatalogSave\('AGUA20'\)/);
assert.match(markup,/value="0"/);
assert.match(markup,/Faixa autorizada:/);
assert.match(markup,/A faixa precisa ser revisada no catálogo/);
assert.match(markup,/merchant-quick-product-fields" disabled/,'invalid ranges must be uneditable');
assert.doesNotMatch(markup,/<img|<script|bad&#39; onclick/,'escape any untrusted merchant data');
assert.match(markup,/Água 20L &lt;img/);
assert.doesNotMatch(markup,/merchantQuickCatalogSave\('INACTIVE'\)/);
assert.equal((markup.match(/merchant-quick-product-fields/g)||[]).length,6);

assert.equal(ctx.navigate('stock'),true);
assert.deepEqual(opened,['#merchant-quick-catalog .merchant-quick-price']);
assert.equal(routes.length,0);
assert.equal(ctx.navigate('delivery'),true);
assert.equal(ctx.navigate('other'),false);
assert.equal(ctx.navigate('stock')&&opened.length,3);
rt.catalog=[...original.filter(x=>x.active===false)];
assert.equal(ctx.navigate('stock'),true,'fallback to full catalog when no active products');
assert.equal(routes.at(-1),'catalog');
rt.catalog=original;

els['merchant-quick-price-P13']={value:'119.90'};
els['merchant-quick-stock-P13']={value:'0'};
await ctx.save('P13');
assert.equal(writes.length,1);
assert.deepEqual(Array.from(writes[0]).slice(0,4),['P13',11990,0,true]);
assert.equal(messages.at(-1),'Preço e estoque de P13 confirmados.','server confirmation only after success');
els['merchant-quick-price-AGUA20']={value:'18.50'};
els['merchant-quick-stock-AGUA20']={value:'10'};
await ctx.save('AGUA20');
assert.equal(writes.length,2);
assert.deepEqual(Array.from(writes[1]).slice(0,4),['AGUA20',1850,10,true]);
els['merchant-quick-price-P45']={value:'460.00'};
els['merchant-quick-stock-P45']={value:'8'};
await ctx.save('P45');
assert.equal(writes.length,3);
assert.equal(writes.at(-1)[0],'P45');
assert.equal(writes.at(-1)[1],46000);
assert.equal(writes.at(-1)[2],8);
assert.equal(writes.at(-1)[4].pricingMode,'range');
assert.equal(writes.at(-1)[4].minPriceCents,45000);
assert.equal(writes.at(-1)[4].maxPriceCents,49000);
assert.equal(writes.at(-1)[4].pricingStrategy,'balanced');
els['merchant-quick-price-P45'].value='550.00';
await ctx.save('P45');
assert.equal(writes.length,3,'outside range must never submit');
assert.match(messages.at(-1),/respeitar a faixa atual/);
els['merchant-quick-price-P45'].value='460.00';

const failCases=[
 {price:'',stock:'2'}, {price:'0',stock:'1'},{price:'NaN',stock:'3'},
 {price:'10100',stock:'4'},{price:'2.55',stock:''},{price:'2.55',stock:'-1'},
 {price:'2.55',stock:'1.5'},{price:'2.55',stock:'100001'}
];
for(const v of failCases){
 els['merchant-quick-price-P13'].value=v.price;
 els['merchant-quick-stock-P13'].value=v.stock;
 await ctx.save('P13');
 assert.equal(writes.length,3,'invalid price/stock blocked '+JSON.stringify(v));
}
assert.match(messages.at(-1),/Revise o preço e o estoque/);
await ctx.save("P13');alert(1)//");
assert.equal(writes.length,3);
await ctx.save('INACTIVE');
assert.equal(writes.length,3);

rt.merchant.memberRole='operator';
assert.equal(ctx.view(rt),'');
await ctx.save('AGUA20');
assert.equal(writes.length,3,'operator cannot update price');
assert.equal(ctx.navigate('stock'),false);
rt.merchant.memberRole='driver';
assert.equal(ctx.view(rt),'');
await ctx.save('P13');
assert.equal(writes.length,3);
rt.merchant.memberRole='owner';
rt.actionPending=true;
markup=ctx.view(rt);
assert.match(markup,/merchant-quick-product-fields" disabled/);
await ctx.save('P13');
assert.equal(writes.length,3);
rt.actionPending=false;rt.status='error';
await ctx.save('P13');
assert.equal(writes.length,3);
rt.status='ready';

els['merchant-quick-price-P13'].value='120.00';
els['merchant-quick-stock-P13'].value='5';
ctx.merchantUpdateProductLive=async()=>{throw Error('CONFLICT');};
await ctx.save('P13');
assert.equal(writes.length,3);
assert.equal(messages.at(-1),'CONFLICT','no false success on failed update');

// Integrity: one place on the merchant page, all writes through guarded backend, no duplicate stale legacy form.
const live=js.slice(js.indexOf('function merchantLivePage('),js.indexOf('\nfunction merchantScheduledDispatchState(',js.indexOf('function merchantLivePage(')));
assert.ok(live.indexOf('merchantQuickCatalogView(rt)')<live.indexOf('merchantDailyOverview(rt,orders)'));
assert.equal((live.match(/id="live-p13-price"/g)||[]).length,0);
assert.match(js,/function merchantQuickCatalogSave\(productCode\)/);
assert.match(backend,/body\.expectedUpdatedAt=String\(current.updatedAt\)/);
assert.match(backend,/action:'update-product'/);
assert.match(css,/\.merchant-quick-product-fields/);
assert.match(css,/@media\(max-width:600px\)/);
assert.match(audit,/node tests\/merchant-quick-catalog-v1-277.mjs/);
console.log('V1.277 PASS — quick active product edits, stock zero, ranges, roles, conflicts, escaping and no extra mutation path.');
