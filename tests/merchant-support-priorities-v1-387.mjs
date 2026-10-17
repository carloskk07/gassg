import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const code=read('js/merchant.js'),styles=read('css/components.css'),audit=read('.github/workflows/audit.yml');
new vm.Script(code,{filename:'merchant.js'});
const cut=name=>{
  const a=code.indexOf('function '+name+'(');
  assert.ok(a>=0,'function missing: '+name);
  const b=code.indexOf('\n}',a);
  assert.ok(b>a,'function body missing: '+name);
  return code.slice(a,b+2);
};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now=Date.now();
const when=minutes=>new Date(now+minutes*60_000).toISOString();
const issue=(category,status,minutes,extra={})=>({
 category,status,createdAt:when(minutes),...extra
});
const order=(n,status='PREPARING',supportCases=[])=>({
 orderId:id(n),publicCode:'TAM-'+n,status,supportCases
});
const rt={
 status:'ready',merchant:{memberRole:'owner',merchantId:id(90)},
 selectedMerchantId:id(90),lastSyncAt:new Date(now).toISOString(),
 supportSummary:{version:1,scope:'merchant-active-orders',maxRows:100},orders:[]
};
const start=code.indexOf('const MERCHANT_SUPPORT_LABELS=');
const end=code.indexOf('function merchantLiveOrder(o){',start);
assert.ok(start>0&&end>start);
const ctx=vm.createContext({
 globalThis:{merchantRuntime:rt},esc,Date,
 merchantLiveOrder:o=>'<article data-order="'+esc(o.orderId)+'">'+esc(o.publicCode)+'</article>',
 merchantOrderAttention:()=>null,
 merchantOrderAttentionSummary:()=>'',merchantOrderScheduleDate:()=>null
});
vm.runInContext(cut('merchantOrderListEvidence')+'\n'+
 code.slice(start,end)+'\n'+cut('merchantOrderQueueView')+
 '\nthis.entries=merchantSupportPriorityEntries;this.board=merchantSupportPriorityBoard;'+
 'this.queue=merchantOrderQueueView;this.cases=merchantSupportCasesForOrder;',ctx);

const input=[
 order(1,'PREPARING',[issue('late','in_review',-120)]),
 order(2,'PREPARING',[issue('delivery','open',-24)]),
 order(3,'PREPARING',[issue('no_show','open',-200)]),
 order(4,'PREPARING',[issue('other','resolved',-300)]),
 order(5,'OFFERED_TO_MERCHANT',[issue('wrong_item','open',-999)]),
 order(6,'PREPARING',[issue('price_payment','open',-18)]),
 order(7,'PREPARING',[issue('late','open',-40)]),
 order(8,'PREPARING',[issue('wrong_item','in_review',-180)]),
 order(9,'PREPARING',[]),
 order(10,'PREPARING',[issue('other','closed',-400)])
];
rt.orders=input;
const result=Array.from(ctx.entries(rt,input));
assert.deepEqual(result.map(r=>r.order.publicCode),
 ['TAM-3','TAM-7','TAM-2','TAM-6','TAM-8','TAM-1'],
 'new cases first sorted by oldest open date then in_review');
assert.equal(result.reduce((n,r)=>n+r.pending.length,0),6);
assert.equal(input[0].orderId,id(1),'do not change authorized snapshot');
let html=ctx.board(rt,input);
assert.match(html,/6 atendimentos pendentes em 6 pedidos/);
assert.match(html,/ATENDIMENTOS QUE PRECISAM DE ATENÇÃO/);
assert.match(html,/Ver pedido/);
assert.match(html,/merchantFocusLiveOrder\('00000000-0000-4000-8000-000000000003'\)/);
assert.match(html,/Outros 1 pedidos com atendimento pendente/);
assert.match(html,/Somente pedidos ativos e registros carregados/);
assert.ok(html.indexOf('TAM-3')<html.indexOf('TAM-7'));
assert.ok(html.indexOf('TAM-7')<html.indexOf('TAM-2'));
assert.ok(!html.includes('TAM-5'),'unaccepted offer must not reveal an incident');
assert.ok(!html.includes('TAM-4'),'resolved cases must not appear as pending');
assert.doesNotMatch(html,/adminSetSupportStatus|onclick="merchantPerformAction|telefone|resolução confirmada/i);
assert.doesNotMatch(html,/private-message|secret-contact/);

const queued=ctx.queue(input);
const idx=queued.indexOf('<details class="merchant-order-queue-overflow">');
assert.ok(idx>=0,'routine overflow still works');
for(const name of ['TAM-3','TAM-7','TAM-2','TAM-6','TAM-8','TAM-1']){
 assert.ok(queued.indexOf(name)>=0,'order missing '+name);
 assert.ok(queued.indexOf(name)<idx,'pending case must stay outside overflow '+name);
}
assert.ok(queued.indexOf('merchant-order-group-offers')<queued.indexOf('merchant-order-group-preparing'),
 'offer queue remains a separate operational group');
assert.equal(ctx.cases(input[4],rt).length,0,'offer not accepted cannot surface support');
const risky=order(20,'PREPARING',[issue('late','open',-10,{
 message:'private-message',phone:'secret-contact',
 resolutionNote:'<script>alert(1)</script>'
})]);
rt.orders=[risky];html=ctx.board(rt,rt.orders);
assert.match(html,/Atraso/);
assert.doesNotMatch(html,/private-message|secret-contact|<script/);
assert.doesNotMatch(html,/onclick="merchantLiveAction\(/);
const invalid=order(21,'PREPARING',[issue('late','open',-10)]);
invalid.orderId="x');alert(1)//";
rt.orders=[invalid];
html=ctx.board(rt,rt.orders);
assert.doesNotMatch(html,/merchantFocusLiveOrder|alert\(1\)/,
 'invalid order UUID must not produce an inline handler');
const noDate=order(22,'PREPARING',[{category:'other',status:'open',createdAt:'bad'}]);
rt.orders=[noDate];html=ctx.board(rt,rt.orders);
assert.match(html,/TAM-22/);
assert.doesNotMatch(html,/NaN|desde\s*Invalid Date/);
rt.orders=[risky];rt.lastSyncAt=new Date(now-4*60_000).toISOString();
assert.equal(ctx.board(rt,rt.orders),'','stale snapshot cannot claim pending attention');
rt.lastSyncAt=new Date(now).toISOString();
rt.selectedMerchantId=id(91);
assert.equal(ctx.board(rt,rt.orders),'','other merchant selection hidden');
rt.selectedMerchantId=id(90);
assert.equal(ctx.board(rt,[risky]),'','copies cannot masquerade as verified runtime list');
rt.status='unavailable';
assert.equal(ctx.board(rt,rt.orders),'','failed backend read hidden');
rt.status='ready';
rt.supportSummary=null;
assert.equal(ctx.board(rt,rt.orders),'','old API must not imply pending case absence');
rt.supportSummary={version:1,scope:'all-merchants'};
assert.equal(ctx.board(rt,rt.orders),'','unknown scope hidden');
rt.supportSummary={version:1,scope:'merchant-active-orders'};
for(const role of ['driver','unknown']){
 rt.merchant.memberRole=role;
 assert.equal(ctx.board(rt,rt.orders),'','role without access hidden');
}
rt.merchant.memberRole='manager';
assert.match(ctx.board(rt,rt.orders),/Atraso/);
rt.merchant.memberRole='operator';
assert.match(ctx.board(rt,rt.orders),/Atraso/);

const page=cut('merchantLivePage');
assert.match(page,/orderEvidence\.fresh\?merchantSupportPriorityBoard\(rt,orders\)/);
const critical=page.indexOf('merchantSupportPriorityBoard(rt,orders)');
assert.ok(critical>page.indexOf('id="merchant-live-orders"')&&
 critical<page.indexOf('merchantOrderQueueView(orders)'));
assert.ok(page.includes('orderEvidence.fresh?merchantSupportOverview(rt,orders)'),
 'retain prior V1.386 overview and API fallback');
assert.ok(!/support_cases|supabase\.from\(|fetch\(/.test(code.slice(start,end)),
 'read-only UI must use already-authorized merchant-orders snapshot');
assert.ok(!/adminSetSupportStatus|support-case-status|merchantPerformAction/.test(
 code.slice(code.indexOf('function merchantSupportPriorityEntries('),
 code.indexOf('function merchantLiveOrder(o){'))));
for(const style of ['.merchant-support-priority-board',
 '.merchant-support-priority-row button:focus-visible',
 '.merchant-support-priority-row',
 '@media(max-width:620px)','@media(max-width:350px)',
 '@media(prefers-reduced-motion:reduce)'])
 assert.ok(styles.includes(style),'missing attention style '+style);
assert.ok(audit.includes('node tests/merchant-support-priorities-v1-387.mjs'));
console.log('TAMÃO V1.387 PASS — active case priority, grouped queue visibility, merchant scope, stale snapshot, role, privacy and mobile keyboard access.');
