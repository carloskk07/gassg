import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source=read('js/admin.js');
new vm.Script(source,{filename:'js/admin.js'});
const grab=name=>{
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Missing closure for '+name);
  return source.slice(start,end+2);
};
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const rows={
  paymentRequests:[
    {id:id(1),status:'pending',merchant_id:id(90),expected_amount_cents:12590,requested_at:'2026-10-12T14:00:00Z'},
    {id:id(2),status:'pending',merchant_id:id(91),expected_amount_cents:7500,requested_at:'2026-10-12T15:00:00Z'},
    {id:id(3),status:'approved',merchant_id:id(90),expected_amount_cents:1500}
  ],
  paymentEvents:[
    {id:id(10),status:'matched_exact',payment_request_id:id(1)},
    {id:id(11),status:'review_required',merchant_id:id(90),amount_cents:12000,received_at:'2026-10-12T13:00:00Z'},
    {id:id(12),status:'review_required',merchant_id:id(91),amount_cents:14500,received_at:'2026-10-12T14:00:00Z'},
    {id:id(13),status:'applied',amount_cents:8000}
  ],
  refunds:[
    {id:id(20),status:'review_required',merchant_id:id(90),amount_cents:4500,occurred_at:'2026-10-12T12:00:00Z'},
    {id:id(21),status:'ignored_unrelated',amount_cents:2000}
  ],
  statements:[
    {id:id(30),status:'overdue',merchant_id:id(91),amount_due_cents:2300,due_at:'2026-10-11T23:59:00Z'},
    {id:id(31),status:'paid',amount_due_cents:1500}
  ]
};
const snap={merchantBilling:rows};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const money=n=>'R$ '+(n/100).toFixed(2).replace('.',',');
const date=new Date().toISOString();
let role='finance',rendered=0,focused=[],scrolled=[],notices=[],nextDOM={};
const runtime={status:'ready',financeWorkspace:'summary',lastSyncAt:date,data:snap};
const document={getElementById:x=>nextDOM[x]||null};
const ctx=vm.createContext({
  Date,Number,Object,
  adminRuntime:runtime,
  adminMerchantName:merchantId=>merchantId===id(90)?'Revenda Alfa':'Revenda Beta',
  adminMoney:money,
  esc,formatDateTime:()=> '12/10/2026',
  adminRoleCanSection:key=>key==='finance'&&['superadmin','finance'].includes(role),
  adminFinanceDailyPriorities:()=>({fresh:true}),
  render:()=>{rendered++;},
  requestAnimationFrame:fn=>fn(),
  document,toast:msg=>notices.push(msg)
});
vm.runInContext(['adminFinanceTriageRecords','adminFinanceTriageView','adminFocusFinanceRecord']
  .map(grab).join('\n')+
  '\nthis.records=adminFinanceTriageRecords;this.view=adminFinanceTriageView;this.focus=adminFocusFinanceRecord;',ctx);
const r=ctx.records(snap);
assert.equal(r.valid,true);
assert.equal(r.total,6,'Refund + 2 review events + two pending requests + overdue statement');
assert.equal(r.items.length,6);
assert.equal(r.sampled,false);
assert.equal(r.items[0].kind,'refund');
assert.equal(r.items[1].kind,'event');
assert.equal(r.items[2].kind,'event');
assert.equal(r.items[3].kind,'request');
assert.equal(r.items[3].id,id(1),'PSP-matched pending request prioritized before overdue and manual');
assert.equal(r.items[4].kind,'statement');
assert.equal(r.items[5].id,id(2));
const html=ctx.view(snap);
assert.ok(html.includes('Conferência sem procurar registros'));
assert.ok(html.includes('6 item(ns) na amostra carregada'));
assert.ok(html.includes('R$ 125,90'));
assert.ok(html.includes('R$ 45,00'));
assert.ok(html.includes('R$ 23,00'));
assert.ok(html.includes('Nenhuma ação'));
assert.equal((html.match(/>Analisar<\/button>/g)||[]).length,6);
assert.ok(html.includes("adminFocusFinanceRecord('request','"+id(1)+"')"));
assert.ok(html.includes("adminFocusFinanceRecord('event','"+id(11)+"')"));
assert.ok(!html.includes('adminResolveBillingPaymentRequest('));
assert.ok(!html.includes('adminResolveBillingRefund('));
assert.ok(!html.includes('adminPerform('));
assert.ok(!html.includes('adminReverseOrder('));
assert.equal(ctx.records({merchantBilling:{paymentRequests:[]}}).valid,false);
assert.ok(ctx.view({merchantBilling:{paymentRequests:[]}}).includes('Fila de análise indisponível'));
assert.ok(!ctx.view({merchantBilling:{paymentRequests:[]}}).includes('Nenhum item desses tipos'));
const safeEmpty={merchantBilling:{paymentRequests:[],paymentEvents:[],refunds:[],statements:[]}};
assert.equal(ctx.records(safeEmpty).total,0);
assert.ok(ctx.view(safeEmpty).includes('Isso não comprova ausência de outras pendências'));
const invalidRefunds=Array.from({length:301},(_,i)=>({
  id:id(i+3000),status:'review_required',merchant_id:id(90),amount_cents:5,
  received_at:'2026-10-11T10:00:00Z'
}));
const limited=ctx.records({merchantBilling:{...rows,refunds:invalidRefunds}});
assert.equal(limited.total,306);
assert.equal(limited.items.length,8);
assert.equal(limited.sampled,true);
assert.ok(ctx.view({merchantBilling:{...rows,refunds:invalidRefunds}})
  .includes('Podem existir registros anteriores fora desta fila.'));
assert.ok(ctx.view({merchantBilling:{...rows,refunds:invalidRefunds}})
  .includes('Exibindo 8 de 306'));
const duped={merchantBilling:{...rows,paymentEvents:[rows.paymentEvents[1],rows.paymentEvents[1]]}};
assert.equal(ctx.records(duped).total,5);
const invalidId={merchantBilling:{...rows,refunds:[
  {id:'<img src=x onerror=alert(1)>',status:'review_required',amount_cents:5}
]}};
assert.ok(!ctx.view(invalidId).includes('<img'));
role='operations';
assert.equal(ctx.view(snap),'');
ctx.focus('request',id(1));
assert.equal(rendered,0,'No non-finance navigation');
role='readonly';
assert.equal(ctx.view(snap),'');
role='superadmin';
const target={
  focus:opts=>focused.push(opts),
  scrollIntoView:opts=>scrolled.push(opts)
};
nextDOM['admin-finance-request-'+id(1)]=target;
ctx.focus('request',id(1));
assert.equal(runtime.financeWorkspace,'billing');
assert.equal(rendered,1);
assert.equal(focused.length,1);
assert.equal(scrolled.length,1);
assert.equal(scrolled[0].block,'center');
assert.equal(scrolled[0].behavior,'instant');
assert.equal(focused[0].preventScroll,true);
ctx.focus('event',id(10));
assert.equal(rendered,1,'Matched event not actionable in event-review list');
ctx.focus('request',id(3));
assert.equal(rendered,1,'Approved request cannot use pending quick link');
ctx.focus('request','../../logout');
assert.equal(rendered,1,'Invalid route not accepted');
ctx.focus('__proto__',id(1));
assert.equal(rendered,1,'Unknown kind blocked');
ctx.focus('refund',id(20));
assert.equal(rendered,2);
assert.ok(notices.at(-1).includes('não está visível'));
role='operations';
assert.equal(ctx.view(snap),'');
runtime.status='unauthenticated';
role='finance';
ctx.focus('request',id(1));
assert.equal(rendered,2);
runtime.status='ready';
runtime.data={merchantBilling:{...rows,paymentRequests:[]}};
ctx.focus('request',id(1));
assert.equal(rendered,2);
assert.ok(notices.at(-1).includes('saiu da fila'));
runtime.data=snap;
ctx.focus('request',id(1));
assert.equal(rendered,3);
runtime.status='no-access';
assert.equal(focused.length,1,'No focus if role/session changed before callback');
runtime.status='ready';
const markers=[
  ["adminBillingPaymentRequestCard",'request','request.id'],
  ["adminBillingPaymentEventCard",'event','event.id'],
  ["adminBillingRefundCard",'refund','refund.id'],
  ["adminBillingStatementCard",'statement','statement.id']
];
for(const [fn,kind,value] of markers){
  const body=grab(fn);
  assert.ok(body.includes('id="admin-finance-'+kind+'-'),'Missing target id in '+fn);
  assert.ok(body.includes('tabindex="-1"'));
  assert.ok(body.includes('esc('+value+')'),'Target ID must be escaped');
}
assert.ok(source.includes('adminFinanceTriageView(d)'));
assert.ok(source.includes('globalThis.adminFocusFinanceRecord=adminFocusFinanceRecord;'));
assert.ok(!source.includes('admin_finance_merchant_performance_v1_190'),
  'V1.193 must not depend on pending V1.190');
const css=read('css/components.css');
assert.ok(css.includes('.admin-finance-triage-list'));
assert.ok(css.includes('article[id^="admin-finance-"][tabindex="-1"]:focus'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-oneclick-v1-193.mjs'));
console.log('V1.193 triage: exact bounded rows, integrity, RBAC, UUID, target DOM, no money movement, mobile focus passed.');
