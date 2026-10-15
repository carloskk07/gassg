import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ops=read('supabase/functions/merchant-ops/index.ts');
const backend=read('js/backend.js');
const ui=read('js/merchant.js');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(ui,{filename:'merchant.js'});
new vm.Script(backend,{filename:'backend.js'});
const extract=(source,name,asyncFn=false)=>{
  const start=source.indexOf((asyncFn?'async ':'')+'function '+name+'(');
  assert.ok(start>=0,'Missing '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Unterminated '+name);
  return source.slice(start,end+2);
};

const scope=ops.slice(ops.indexOf('if(action==="catalog-history")'),ops.indexOf('if(action==="update-product")'));
assert.match(scope,/if\(!canManage\(role\)\)/);
assert.match(scope,/\.eq\("merchant_id",merchantId\)/);
assert.match(scope,/\.eq\("product_code",productCode\)/);
assert.match(scope,/\.lt\("id",beforeId\)/);
assert.match(scope,/\.order\("id",\{ascending:false\}\)/);
assert.match(scope,/\.limit\(31\)/);
assert.match(scope,/\.slice\(0,30\)/);
assert.match(scope,/Number\.isSafeInteger\(beforeId\)/);
assert.match(scope,/typeof beforeId!=="number"/);
assert.match(scope,/hasMore/);
assert.match(scope,/nextBeforeId/);
assert.doesNotMatch(scope,/\.insert\(|\.update\(|\.delete\(/);
assert.match(css,/\.merchant-catalog-history-toolbar/);
assert.match(audit,/node tests\/merchant-catalog-history-pagination-v1-281.mjs/);

const MID='00000000-0000-4000-8000-000000000003';
const OTHER='00000000-0000-4000-8000-000000000004';
const rt={status:'ready',merchant:{merchantId:MID,memberRole:'owner'},
  catalog:[{productCode:'P13',productName:'Gás P13'},{productCode:'AGUA',productName:'Água'}]};
const payloads=[];
const reply=(merchantId,extra={})=>({
  source:'merchant_catalog_history_v1_280',merchantId,readOnly:true,
  productCode:'',hasMore:false,nextBeforeId:null,events:[],...extra
});
const ctx=vm.createContext({
 merchantRuntime:rt,
 merchantInvoke:async(_fn,payload)=>{payloads.push(payload);return reply(MID,{productCode:payload.productCode||''});}
});
vm.runInContext(extract(backend,'merchantCatalogHistoryPageLive',true)+
  ';this.page=merchantCatalogHistoryPageLive;',ctx);
assert.equal((await ctx.page(MID)).events.length,0);
assert.equal(payloads[0].action,'catalog-history');
assert.equal(payloads[0].beforeId,undefined);
await ctx.page(MID,{productCode:'P13',beforeId:55});
assert.equal(payloads[1].productCode,'P13');
assert.equal(payloads[1].beforeId,55);
await assert.rejects(()=>ctx.page(MID,{beforeId:0}),/Página inválida/);
await assert.rejects(()=>ctx.page(MID,{productCode:'<script>'}),/Produto inválido/);
await assert.rejects(()=>ctx.page(OTHER),/proprietário ou gerente/);
rt.merchant.memberRole='operator';
await assert.rejects(()=>ctx.page(MID),/proprietário ou gerente/);
rt.merchant.memberRole='owner';
ctx.merchantInvoke=async()=>reply(MID,{productCode:'AGUA'});
await assert.rejects(()=>ctx.page(MID,{productCode:'P13'}),/não confirmado/);
ctx.merchantInvoke=async()=>reply(MID,{hasMore:true,nextBeforeId:0});
await assert.rejects(()=>ctx.page(MID),/não confirmado/);

const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const calls=[],draws=[];
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const browser=vm.createContext({Date,BRL:{format:n=>'R$ '+Number(n).toFixed(2)},esc,
 globalThis:{merchantRuntime:rt},render:()=>draws.push('render'),
 merchantCatalogHistoryPageLive:async(id,params)=>{
  const d=defer();calls.push({id,params,d});return d.promise;
 }});
vm.runInContext(extract(ui,'merchantCatalogHistoryView')+'\n'+
 extract(ui,'merchantQuickHistoryProductChanged')+'\n'+
 extract(ui,'merchantQuickHistoryLoad',true)+
 ';this.view=merchantCatalogHistoryView;this.select=merchantQuickHistoryProductChanged;this.load=merchantQuickHistoryLoad;',browser);
assert.match(browser.view(rt),/Todos os produtos/);
const one=browser.load();
assert.equal(calls.length,1);
assert.equal((await browser.load()),undefined,'No duplicate simultaneous query');
assert.equal(browser.globalThis.merchantCatalogHistoryState.status,'loading');
const badActor='<img src=x onerror=alert(1)>';
const event=id=>({id,productCode:'P13',actorName:badActor,
  actorRole:'manager',action:'updated',oldPriceCents:1000,newPriceCents:1200,
  oldStock:5,newStock:4,recordedAt:'2026-10-15T12:00:00Z'});
calls[0].d.resolve({events:[event(90)],hasMore:true,nextBeforeId:90});
await one;
assert.equal(browser.globalThis.merchantCatalogHistoryState.status,'ready');
let html=browser.view(rt);
assert.match(html,/Ver alterações anteriores/);
assert.match(html,/&lt;img src=x/);
assert.doesNotMatch(html,/<img src=x/);
const older=browser.load(true);
assert.equal(calls[1].params.beforeId,90);
assert.equal(browser.globalThis.merchantCatalogHistoryState.status,'paging');
assert.match(browser.view(rt),/Gás P13/);
calls[1].d.resolve({events:[event(80)],hasMore:false,nextBeforeId:null});
await older;
assert.equal(browser.globalThis.merchantCatalogHistoryState.events.length,2);
assert.doesNotMatch(browser.view(rt),/Ver alterações anteriores/);
assert.equal(await browser.load(true),undefined,'No additional query without cursor');
const changed=browser.select('AGUA');
assert.equal(calls[2].params.productCode,'AGUA');
assert.equal(calls[2].params.beforeId,null);
calls[2].d.resolve({events:[],hasMore:false,nextBeforeId:null});
await changed;
assert.match(browser.view(rt),/Não há alterações registradas para esta seleção/);
assert.match(browser.view(rt),/value="AGUA" selected/);

// An in-flight response from the previous filter must not overwrite a new selection.
const stale=browser.select('P13');
const fresh=browser.select('AGUA');
assert.equal(calls.length,5);
calls[4].d.resolve({events:[],hasMore:false,nextBeforeId:null});
await fresh;
const rendered=draws.length;
calls[3].d.resolve({events:[event(70)],hasMore:false,nextBeforeId:null});
await stale;
assert.equal(browser.globalThis.merchantCatalogHistoryState.productCode,'AGUA');
assert.equal(browser.globalThis.merchantCatalogHistoryState.events.length,0);
assert.equal(draws.length,rendered,'Do not render old filter result');
// A different merchant or lost privileges must not display old records.
const switchPending=browser.load();
rt.merchant.merchantId=OTHER;
calls[5].d.resolve({events:[event(60)],hasMore:false,nextBeforeId:null});
await switchPending;
assert.doesNotMatch(browser.view(rt),/src=x/);
rt.merchant.merchantId=MID;
rt.merchant.memberRole='driver';
assert.equal(browser.view(rt),'');
assert.equal(await browser.load(),undefined);
console.log('V1.281 PASS — bounded keyset pages, product filter, roles, cursor validation, XSS and stale responses.');
