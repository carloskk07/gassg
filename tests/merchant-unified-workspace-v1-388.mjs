import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const merchant=read('js/merchant.js');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(merchant,{filename:'merchant.js'});
const cut=name=>{
  const start=merchant.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing '+name);
  const end=merchant.indexOf('\n}',start);
  assert.ok(end>start,'Unexpected shape '+name);
  return merchant.slice(start,end+2);
};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now=Date.now(),time=mins=>new Date(now+mins*60_000).toISOString();
const order=(n,status,extra={})=>({orderId:id(n),publicCode:'TAM-'+n,status,...extra});
const offers=[
 order(1,'OFFERED_TO_MERCHANT',{offerExpiresAt:time(20)}),
 order(2,'OFFERED_TO_MERCHANT',{offerExpiresAt:time(5)}),
 order(3,'OFFERED_TO_MERCHANT',{offerExpiresAt:null})
];
const deliveries=[
 order(4,'OUT_FOR_DELIVERY',{promisedBy:time(20)}),
 order(5,'ARRIVING',{promisedBy:time(4)})
];
const open=[{category:'late',status:'open',createdAt:time(-55)}];
const review=[{category:'wrong_item',status:'in_review',createdAt:time(-50)}];
const rt={
 status:'ready',merchant:{merchantId:id(91),memberRole:'owner'},
 selectedMerchantId:id(91),supportSummary:{version:1,scope:'merchant-active-orders',maxRows:100},
 lastSyncAt:new Date(now).toISOString(),orders:[]
};
const rows=[
 ...offers,...deliveries,
 order(6,'AT_RISK',{supportCases:open}),
 order(7,'PREPARING',{supportCases:review}),
 order(8,'PREPARING',{supportCases:open}),
 order(9,'PREPARING',{supportCases:[{category:'other',status:'resolved',createdAt:time(-140)}]})
];
rt.orders=rows;
const start=merchant.indexOf('const MERCHANT_SUPPORT_LABELS=');
const end=merchant.indexOf('function merchantLiveOrder(o){',start);
assert.ok(start>=0&&end>start);
const ctx=vm.createContext({globalThis:{merchantRuntime:rt},Date,esc,
  merchantOrderScheduleDate:raw=>raw&&Number.isFinite(Date.parse(raw))?new Date(raw):null
});
const setup=[
 cut('merchantOrderListEvidence'),
 cut('merchantDeliveryBoardModel'),
 merchant.slice(start,end),
 'this.model=merchantUnifiedOpsModel;this.view=merchantUnifiedOpsBoard;'
].join('\n');
vm.runInContext(setup,ctx);
const model=ctx.model(rt,rows,now);
assert.ok(model);
assert.equal(model.offers.count,3);
assert.equal(model.offers.valid,2);
assert.equal(model.offers.unverified,1);
assert.equal(model.offers.first.orderId,id(2),'most urgent valid offer first');
assert.equal(model.delivery.count,2);
assert.equal(model.delivery.arriving,1);
assert.equal(model.delivery.first.orderId,id(5),'arriving before on-route');
assert.equal(model.issues.count,3,'support plus risk de-duplicated by order');
assert.equal(model.issues.incidents,1);
assert.equal(model.issues.cases,3);
assert.equal(model.issues.supportVerified,true);
assert.equal(model.issues.first.orderId,id(6),'known at-risk order first');

let html=ctx.view(rt,rows);
assert.match(html,/VISÃO DE TRABALHO/);
assert.match(html,/O que precisa da sua atenção agora/);
assert.match(html,/NOVOS PEDIDOS/);
assert.match(html,/ENTREGAS/);
assert.match(html,/ATENÇÃO/);
assert.match(html,/3<\/strong>/);
assert.match(html,/2<\/strong>/);
assert.match(html,/1 oferta sem prazo válido/);
assert.match(html,/2 com prazo confirmado nesta consulta/);
assert.match(html,/2 com chegada informada|1 com chegada informada/);
assert.match(html,/3 atendimento\(s\) pendente\(s\)/);
assert.match(html,/merchantFocusLiveOrder\('00000000-0000-4000-8000-000000000002'\)/);
assert.match(html,/merchantFocusLiveOrder\('00000000-0000-4000-8000-000000000005'\)/);
assert.match(html,/merchantFocusLiveOrder\('00000000-0000-4000-8000-000000000006'\)/);
assert.match(html,/Atualizar fila/);
assert.match(html,/nenhuma ação é confirmada automaticamente/i);
assert.doesNotMatch(html,/merchantLiveAction\(|merchantLiveDeliver\(|adminSetSupportStatus|paymentCapture/);
const o=order(10,'OFFERED_TO_MERCHANT',{offerExpiresAt:time(4),
  publicCode:'<img src=x onerror=alert(1)>'});
rt.orders=[o];
html=ctx.view(rt,rt.orders);
assert.doesNotMatch(html,/<img|alert\(1\)/,'no dynamic order names in actionable HTML');
assert.equal(ctx.model(rt,rt.orders,now).offers.valid,1);

// Invalid UUIDs must never be embedded in executable navigation code.
const bad=order(12,'ARRIVING');bad.orderId="');alert(1)//";
rt.orders=[bad];
html=ctx.view(rt,rt.orders);
assert.doesNotMatch(html,/alert\(1\)|merchantFocusLiveOrder\(/);
assert.match(html,/merchantFocusOrderGroup\('delivery'\)/);

// No support projection means unknown support status, not zero incidents.
rt.orders=[order(15,'AT_RISK')];
rt.supportSummary=null;
html=ctx.view(rt,rt.orders);
assert.match(html,/Situação dos atendimentos indisponível/);
assert.equal(ctx.model(rt,rt.orders,now).issues.supportVerified,false);
rt.supportSummary={version:1,scope:'merchant-active-orders'};
rt.orders=[order(20,'PREPARING',{supportCases:[{category:'late',status:'open',message:'private-secret'}]})];
html=ctx.view(rt,rt.orders);
assert.match(html,/Ver pedido com problema/);
assert.doesNotMatch(html,/private-secret/,'support private messages never in summary');

// Never display actionable cards from an earlier or mismatched merchant snapshot.
rt.lastSyncAt=time(-5);
assert.equal(ctx.view(rt,rt.orders),'');
rt.lastSyncAt=time(0);
rt.selectedMerchantId=id(99);
assert.equal(ctx.view(rt,rt.orders),'');
rt.selectedMerchantId=id(91);
assert.equal(ctx.view(rt,rt.orders.slice()),'');
rt.status='error';
assert.equal(ctx.view(rt,rt.orders),'');
rt.status='ready';
rt.error='failed read';
assert.equal(ctx.view(rt,rt.orders),'');
rt.error=null;
for(const role of ['driver','finance','unknown']){
  rt.merchant.memberRole=role;
  assert.equal(ctx.view(rt,rt.orders),'',role+' cannot see order operations hub');
}
rt.merchant.memberRole='manager';
assert.match(ctx.view(rt,rt.orders),/VISÃO DE TRABALHO/);
rt.merchant.memberRole='operator';
assert.match(ctx.view(rt,rt.orders),/VISÃO DE TRABALHO/);

const page=cut('merchantLivePage');
assert.ok(page.includes('orderEvidence.fresh?merchantUnifiedOpsBoard(rt,orders)'));
assert.ok(page.includes('merchant-operation-insights'));
assert.ok(page.indexOf('merchantUnifiedOpsBoard(rt,orders)') <
  page.indexOf('merchantOrderQueueView(orders)'),'three-card hub before order details');
for(const prior of ['merchantDailyOverview(rt,orders)','merchantDeliveryBoardView(rt,orders)',
  'merchantSupportOverview(rt,orders)','merchantSupportPriorityBoard(rt,orders)',
  'merchantDeliveryAttentionView(rt)']){
 assert.ok(page.includes(prior),'retain proven existing workflows: '+prior);
}
const advanced=page.slice(page.indexOf('<details class="merchant-operation-insights"'),
  page.indexOf('</details>',page.indexOf('<details class="merchant-operation-insights"')));
assert.ok(advanced.includes('merchantDeliveryBoardView(rt,orders)'));
assert.ok(advanced.includes('merchantSupportPriorityBoard(rt,orders)'));
assert.ok(!advanced.includes(' open'),'advanced metrics should start collapsed');
assert.ok(css.includes('.merchant-unified-grid')&&css.includes('.merchant-unified-action'));
assert.ok(css.includes('@media(max-width:480px)'));
assert.ok(css.includes('.merchant-operation-insights>summary:focus-visible'));
assert.ok(audit.includes('node tests/merchant-unified-workspace-v1-388.mjs'));
console.log('TAMÃO V1.388 PASS — single buyer-independent three-lane merchant hub, strict snapshot/role/PII checks and mobile accessible shortcuts.');
