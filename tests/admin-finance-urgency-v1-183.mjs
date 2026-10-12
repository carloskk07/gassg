import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=load('js/admin.js');
const css=load('css/components.css');
new vm.Script(src,{filename:'js/admin.js'});
function pick(name){
 const start=src.indexOf('function '+name+'(');
 assert.ok(start>=0,'Missing '+name);
 const end=src.indexOf('\n}',start);
 assert.ok(end>start,'Missing brace for '+name);
 return src.slice(start,end+2);
}
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const uuid=i=>String(i).padStart(8,'0')+'-1111-4111-8111-111111111111';
const merchant='22222222-2222-4222-8222-222222222222';
const ref=Date.now();
const hours=n=>new Date(ref-n*3600000).toISOString();
const attempt=(i,status,extras={})=>({
 id:uuid(i+80),order_id:uuid(i),merchant_id:merchant,provider:'mercadopago',
 amount_cents:11990,status,created_at:hours(40),updated_at:hours(3),...extras
});
const order=(i,state='CANCELLED')=>({
 id:uuid(i),public_code:'TAM-'+i,status:state,financial_state:'reversed'
});
const rt={saleRefundFilter:'all'};
let role='finance',renderCalls=0;
const ctx=vm.createContext({
 esc,adminRuntime:rt,render:()=>{renderCalls++},adminCurrentRole:()=>role,
 adminMerchantName:()=> 'Revenda de teste',
 adminBillingProviderName:()=> 'Mercado Pago',
 adminMoney:c=>'R$ '+(Number(c)/100).toFixed(2).replace('.',','),
 formatDateTime:()=> '12/10/2026 14:00',
 adminOpenEntity:()=>{}
});
vm.runInContext([
 pick('adminInterruptedSalePaymentUrgency'),
 pick('adminSetSaleRefundFilter'),
 pick('adminInterruptedSalePaymentRows'),
 pick('adminInterruptedSalePaymentWatch')
].join('\n')+';this.grade=adminInterruptedSalePaymentUrgency;'+
 'this.setFilter=adminSetSaleRefundFilter;this.rows=adminInterruptedSalePaymentRows;'+
 'this.watch=adminInterruptedSalePaymentWatch;',ctx);
const grade=(kind,stamp={},now=ref)=>ctx.grade({kind,attempt:stamp},now);

assert.equal(grade('conflicting').level,'critical');
assert.equal(grade('refunded').level,'done');
assert.equal(grade('approved',{approved_at:hours(25)}).level,'critical');
assert.equal(grade('approved',{approved_at:hours(24)}).level,'critical');
assert.equal(grade('approved',{approved_at:hours(5)}).level,'warning');
assert.equal(grade('approved',{approved_at:hours(1)}).level,'recent');
assert.equal(grade('review',{last_error_at:hours(26)}).level,'critical');
assert.equal(grade('review',{updated_at:hours(5)}).level,'warning');
assert.equal(grade('review',{created_at:hours(1)}).level,'recent');
assert.equal(grade('approved',{}).level,'unknown','Missing PSP approval date cannot imply overdue');
assert.equal(grade('approved',{approved_at:hours(-24)}).level,'unknown','Future dates are invalid');
assert.equal(grade('approved',{approved_at:'2030-12-30T12:00:00Z'}).level,'unknown');
assert.equal(grade('approved',{approved_at:'invalid'}).level,'unknown');
assert.equal(grade('approved',{approved_at:'2019-01-01T00:00:00Z'}).level,'unknown');
assert.ok(grade('approved',{approved_at:hours(26)}).label.includes('desde a aprovação'));
assert.ok(grade('review',{updated_at:hours(26)}).label.includes('última atualização conhecida'));
assert.ok(!grade('approved',{approved_at:hours(26)}).label.includes('prazo de reembolso'));

const data={merchantPayments:{
 reviewSampleLimited:false,
 attempts:[
  attempt(1,'approved',{approved_at:hours(48)}),
  attempt(2,'approved',{approved_at:hours(8)}),
  attempt(3,'review_required',{last_error_at:hours(1)}),
  attempt(4,'approved',{approved_at:null}),
  attempt(5,'approved',{refunded_at:hours(1)}),
  attempt(6,'refunded',{refunded_at:hours(1)}),
  attempt(7,'approved',{approved_at:hours(1)}),
  attempt(8,'approved',{approved_at:hours(60)})
 ],
 interruptedOrders:[
  order(1),order(2,'REASSIGNING'),order(3),order(4),order(5),order(6),order(7),
  order(8,'OUT_FOR_DELIVERY')
 ]
}};
const rows=ctx.rows(data);
assert.equal(rows.length,7,'Active delivery attempt excluded');
assert.equal(rows[0].kind,'conflicting','Contradictions first');
assert.equal(rows[1].order.id,uuid(1),'Approved >24h before warning');
assert.equal(rows[2].order.id,uuid(2),'Approved >4h next');
assert.equal(rows[rows.length-1].kind,'refunded','Refunded history last');

let html=ctx.watch(data);
assert.ok(html.includes('5 PARA CONFERIR')===false,'Guard against stale expected count');
assert.ok(html.includes('6 PARA CONFERIR'));
assert.ok(html.includes('Prioridade de conferência</span><strong>2'));
assert.ok(html.includes('Atenção após 4h</span><strong>1'));
assert.ok(html.includes('Filtrar pendências financeiras'));
assert.ok(html.includes("adminSetSaleRefundFilter('critical')"));
assert.ok(html.includes('aria-pressed="true"'));
assert.ok(html.includes('Horário da pendência não comprovado'));
assert.ok(html.includes('Mais de 24h desde a aprovação'));
assert.ok(html.includes('Mais de 4h desde a aprovação'));
assert.ok(html.includes('Divergência de registros — conferir já'));
assert.ok(html.includes('não integra o caixa TAMÃO'));
assert.ok(!html.includes('Executar estorno')&&!html.includes('adminPerform('));

ctx.setFilter('critical');
assert.equal(rt.saleRefundFilter,'critical');
assert.equal(renderCalls,1,'Changing filter rerenders and does not call server mutation');
html=ctx.watch(data);
assert.ok(html.includes('2 PARA CONFERIR')===false,'Counters remain unfiltered');
assert.ok(html.includes('6 PARA CONFERIR'),'Counters show whole sample');
assert.ok(html.includes('TAM-5')&&html.includes('TAM-1'));
assert.ok(!html.includes('TAM-2')&&!html.includes('TAM-3')&&!html.includes('TAM-4'));
assert.ok(html.includes('aria-pressed="true" onclick="adminSetSaleRefundFilter(\'critical\')"'));
ctx.setFilter('approved');
html=ctx.watch(data);
assert.ok(html.includes('TAM-5')&&html.includes('TAM-1')&&html.includes('TAM-4'));
assert.ok(!html.includes('TAM-3'));
ctx.setFilter('review');
html=ctx.watch(data);
assert.ok(html.includes('TAM-3')&&!html.includes('TAM-1'));
ctx.setFilter('bogus');
assert.equal(rt.saleRefundFilter,'review','Unknown filters rejected');
role='support';
ctx.setFilter('all');
assert.equal(rt.saleRefundFilter,'review','Non-finance role cannot change filter');
assert.equal(ctx.watch(data),'','Unauthorized user cannot see finance queue');
role='finance';
ctx.setFilter('all');

const limited={merchantPayments:{...data.merchantPayments,reviewSampleLimited:true}};
html=ctx.watch(limited);
assert.ok(html.includes('amostra'));
assert.ok(html.includes('não representam a totalidade da base'));
assert.ok(css.includes('.admin-sale-refund-filters button.selected'));
assert.ok(css.includes('.admin-sale-refund-urgency.critical'));
assert.ok(css.includes('@media(max-width:560px)'));
assert.ok(load('.github/workflows/audit.yml').includes('node tests/admin-finance-urgency-v1-183.mjs'));
assert.ok(src.includes('const urgency=adminInterruptedSalePaymentUrgency(row);'));
console.log('V1.183: financial review aging, approved-time authority, unknown timestamps, critical attention, readonly filters and no refund mutation passed.');
