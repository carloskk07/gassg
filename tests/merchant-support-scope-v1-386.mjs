import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=read('supabase/functions/merchant-orders/index.ts');
const frontend=read('js/merchant.js');
const backend=read('js/backend.js');
const css=read('css/components.css');
new vm.Script(frontend,{filename:'merchant.js'});
new vm.Script(backend,{filename:'backend.js'});
const first=server.indexOf('if(selected.member_role==="driver"){');
const next=server.indexOf('const supportEligibleIds=',first);
const ending=server.indexOf('const {data:performanceRows',next);
assert.ok(first>=0&&next>first&&ending>next);
assert.ok(server.indexOf('return json({',first)<next,'driver must return independently before support query');
const support=server.slice(next,ending);
assert.match(support,/\.filter\(\(order\)=>order.status!=="OFFERED_TO_MERCHANT"\)/);
assert.match(support,/\.select\("order_id,category,status,created_at,updated_at"\)/);
assert.match(support,/\.eq\("merchant_id",selected\.merchant_id\)/);
assert.match(support,/\.in\("order_id",supportEligibleIds\)/);
assert.match(support,/\.in\("status",\["open","in_review","resolved","closed"\]\)/);
assert.match(support,/\.limit\(100\)/);
assert.match(support,/if\(supportError\)throw supportError/);
assert.match(support,/if\(!supportEligibleIds\.includes\(item\.order_id\)\)continue/);
assert.doesNotMatch(support,/\bmessage\b|resolution_note|customer_id|customer_phone|service_role|contact|payment/);
const authorized=server.slice(server.indexOf('const {data:memberships'),first);
assert.match(authorized,/\.eq\("user_id",user\.id\)/);
assert.match(authorized,/\.eq\("active",true\)/);
assert.match(authorized,/selectMerchantMembership\(memberships,requestedMerchantId\)/);
assert.match(authorized,/if\(!selected\)return json\(\{error:"MERCHANT_ACCESS_DENIED"/);
const projection=server.slice(server.indexOf('supportSummary:{version:1'),server.indexOf('},200,origin);'));
assert.match(projection,/supportCases:o\.status==="OFFERED_TO_MERCHANT"\?\[\]:\(supportByOrder\.get\(o\.id\)\?\?\[\]\)/);
assert.doesNotMatch(projection,/supportByOrder\.get\(selected\.merchant_id\)/);
assert.ok(!server.includes('GRANT SELECT ON support_cases'),'no direct browser access allowed');

const start=frontend.indexOf('const MERCHANT_SUPPORT_LABELS=');
const end=frontend.indexOf('function merchantLiveOrder(o){',start);
assert.ok(start>=0&&end>start);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const rt={
 merchant:{memberRole:'owner',merchantId:'merchant-one'},
 supportSummary:{version:1,scope:'merchant-active-orders',maxRows:100},
 status:'ready',orders:[]
};
const ctx=vm.createContext({globalThis:{merchantRuntime:rt},esc});
vm.runInContext(frontend.slice(start,end)+
 '\nthis.group=merchantSupportCasesForOrder;this.detail=merchantSupportForOrder;'+
 'this.overview=merchantSupportOverview;this.date=merchantSupportCaseDate;',ctx);
const cases=[
 {category:'late',status:'open',createdAt:'2026-10-17T14:30:00Z'},
 {category:'delivery',status:'in_review',createdAt:'2026-10-17T14:15:00Z'},
 {category:'other',status:'resolved',createdAt:'2026-10-16T10:00:00Z'}
];
const one={orderId:'order-1',publicCode:'TAM-100',status:'PREPARING',supportCases:cases};
const other={orderId:'order-2',status:'PREPARING',
 supportCases:[{category:'wrong_item',status:'closed',createdAt:'2038-01-01T00:00:00Z'}]};
let html=ctx.overview(rt,[one,other]);
assert.match(html,/2 atendimento\(s\) pendente\(s\) em 1 pedido\(s\)/);
assert.match(html,/até 100 registros/);
assert.doesNotMatch(html,/onclick=|adminSetSupportStatus|Registrar resolução/);
html=ctx.detail(one);
assert.match(html,/Atendimentos deste pedido/);
assert.match(html,/Atraso/);
assert.match(html,/Problema na entrega/);
assert.match(html,/Em análise/);
assert.match(html,/Resolvido/);
assert.match(html,/2 pendente\(s\)/);
assert.doesNotMatch(html,/onclick=|adminSetSupportStatus|Cliente:|Telefone:/);
assert.equal(ctx.date('2038-01-01T00:00:00Z'),'');
assert.equal(ctx.date('garbled'),'');
assert.ok(ctx.date('2026-10-17T14:30:00Z').length>5);
const malicious={status:'PREPARING',supportCases:[
 {category:'__proto__',status:'constructor',message:'PRIVATE',
  createdAt:'2026-10-17T14:30:00Z',resolutionNote:'SECRET'},
 {category:'late',status:'open',message:'<img src=x onerror=alert(1)>',
  createdAt:'2026-10-17T14:30:00Z',phone:'11999999999'}
]};
html=ctx.detail(malicious);
assert.match(html,/Atraso/);
assert.doesNotMatch(html,/<img|PRIVATE|SECRET|11999999999|constructor|__proto__/);
assert.equal(ctx.group({status:'OFFERED_TO_MERCHANT',supportCases:cases}).length,0);
const savedScope=rt.supportSummary.scope;rt.supportSummary.scope='all-merchants';
assert.equal(ctx.detail(one),'');
rt.supportSummary.scope=savedScope;
for(const role of ['driver','unexpected']){
 rt.merchant.memberRole=role;
 assert.equal(ctx.detail(one),'');
 assert.equal(ctx.overview(rt,[one]),'');
}
rt.merchant.memberRole='manager';
assert.match(ctx.detail(one),/Atendimentos deste pedido/);
rt.merchant.memberRole='operator';
assert.match(ctx.detail(one),/Atendimentos deste pedido/);
rt.supportSummary=null;
assert.equal(ctx.overview(rt,[one]),'','old server without projection may not imply zero support');
assert.equal(ctx.detail(one),'');
rt.supportSummary={version:1,scope:'merchant-active-orders'};
assert.match(ctx.overview(rt,[]),/Nenhum atendimento pendente nos pedidos ativos consultados/);
const page=frontend.slice(frontend.indexOf('function merchantLivePage(){'),
  frontend.indexOf('async function merchantLiveRefresh(){'));
assert.match(page,/orderEvidence\.fresh\?merchantSupportOverview\(rt,orders\)/);
const orderView=frontend.slice(frontend.indexOf('function merchantLiveOrder(o){'),
  frontend.indexOf('async function merchantEnableAlertsFromUi(){'));
assert.match(orderView,/merchantSupportForOrder\(o\)/);
assert.doesNotMatch(frontend.slice(start,end),/fetch\(|adminPerform\(|merchantPerformAction\(/);
assert.match(backend,/supportSummary:null/);
assert.match(backend,/merchantRuntime\.supportSummary=data\.supportSummary\?\?null/);
assert.ok((backend.match(/merchantRuntime\.supportSummary=null;/g)||[]).length>=3,
 'clear scoped support projection on logout and access failures');
for(const style of ['.merchant-support-overview','.merchant-order-support',
 '.merchant-order-support summary:focus-visible','@media(max-width:620px)',
 '@media(max-width:370px)'])
 assert.ok(css.includes(style),'missing accessible merchant UI '+style);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/merchant-support-scope-v1-386.mjs'));
console.log('TAMÃO V1.386 PASS — membership + merchant + order scope, driver isolation, no PII, read-only support statuses, lifecycle resets and responsive cards.');
