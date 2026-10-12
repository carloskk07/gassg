import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/admin.js'),ops=read('supabase/functions/admin-ops/index.ts'),css=read('css/components.css');
new vm.Script(js,{filename:'js/admin.js'});
const cut=name=>{
  const start=js.indexOf('function '+name+'(');
  assert.ok(start>=0,'missing '+name);
  const end=js.indexOf('\n}',start);
  assert.ok(end>start,'missing closing brace '+name);
  return js.slice(start,end+2);
};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const id=i=>String(i).padStart(8,'0')+'-1111-4111-8111-111111111111';
const merchant='22222222-2222-4222-8222-222222222222';
const recorded=new Date(Date.now()-3600000).toISOString();
const attempt=(i,status,more={})=>({
 id:id(i+80),order_id:id(i),merchant_id:merchant,provider:'mercadopago',
 amount_cents:11990,status,created_at:recorded,updated_at:recorded,approved_at:recorded,...more
});
const ord=(i,status,more={})=>({
 id:id(i),public_code:'TAM-'+i,status,financial_state:'reversed',financial_reversed_at:recorded,...more
});
const rows=[
 attempt(1,'approved'),
 attempt(2,'review_required'),
 attempt(3,'approved',{refunded_at:recorded}),
 attempt(4,'refunded',{refunded_at:recorded}),
 attempt(5,'approved'),
 attempt(6,'approved',{provider:'<img src=x onerror=alert(1)>',amount_cents:15999}),
 attempt(8,'refunded',{refunded_at:recorded})
];
const data={merchantPayments:{
 attempts:rows,
 interruptedOrders:[ord(1,'CANCELLED'),ord(2,'REASSIGNING'),ord(3,'CANCELLED'),
   ord(4,'CANCELLED'),ord(5,'PREPARING'),ord(6,'CANCELLED',{public_code:'<svg onload=alert(1)>'})],
 reviewSampleLimited:false
}};
let role='finance';
const adminRuntime={saleRefundFilter:'all'};
const ctx=vm.createContext({adminRuntime,render:()=>{},

 esc,adminCurrentRole:()=>role,adminMerchantName:()=>'Revenda autorizada',
 adminBillingProviderName:p=>p==='mercadopago'?'Mercado Pago':String(p),
 adminMoney:c=>'R$ '+(Number(c)/100).toFixed(2).replace('.',','),
 formatDateTime:()=> '12/10/2026 14:00',
 adminOpenEntity:()=>{}
});
vm.runInContext(cut('adminInterruptedSalePaymentUrgency')+'\n'+cut('adminInterruptedSalePaymentRows')+'\n'+cut('adminInterruptedSalePaymentWatch')+
 ';this.rows=adminInterruptedSalePaymentRows;this.watch=adminInterruptedSalePaymentWatch;',ctx);
const classified=ctx.rows(data);
assert.equal(classified.length,5,'Only payment attempts linked to interrupted orders in returned server set');
assert.equal(classified[0].kind,'conflicting');
assert.equal(classified[1].kind,'approved');
assert.equal(classified[2].kind,'approved');
assert.equal(classified[3].kind,'review');
assert.equal(classified[4].kind,'refunded');
assert.ok(!classified.some(x=>x.order.id===id(5)),'In-flight order must never appear');
assert.ok(!classified.some(x=>x.order.id===id(8)),'Unknown order must never be invented');
let html=ctx.watch(data);
assert.ok(html.includes('Pagamentos de pedidos interrompidos'));
assert.ok(html.includes('4 PARA CONFERIR'));
assert.ok(html.includes('Aprovados sem estorno registrado</span><strong>2'));
assert.ok(html.includes('Resultado em revisão</span><strong>1'));
assert.ok(html.includes('Divergências</span><strong>1'));
assert.ok(html.includes('Reembolsos registrados</span><strong>1'));
assert.ok(html.includes('APROVADO • CONFERIR ESTORNO'));
assert.ok(html.includes('RESULTADO EM REVISÃO'));
assert.ok(html.includes('REGISTROS INCONSISTENTES'));
assert.ok(html.includes('REEMBOLSO REGISTRADO'));
assert.ok(html.includes('Conferir pedido'));
assert.ok(html.includes('Isto não comprova estorno')||html.includes('não comprova estorno da venda.'));
assert.ok(!html.includes('<svg onload=alert(1)>')&&!html.includes('<img src=x onerror=alert(1)>'),'Untrusted merchant/provider escaped');
assert.ok(!html.includes('Marcar reembolso')&&!html.includes('Executar estorno'));
assert.ok(!html.includes('adminPerform('),'No financial mutation in visual queue');
assert.ok(html.includes('não integra o caixa TAMÃO'),'Merchant proceeds do not mix with platform billing');
assert.ok(html.includes('conta da própria revenda'));
role='readonly';
assert.ok(ctx.watch(data).includes('Conferir pedido'),'Readonly sees report');
role='support';
assert.equal(ctx.watch(data),'','Support cannot receive merchant payment panel');
role='operations';
assert.equal(ctx.watch(data),'','Operations cannot receive payment panel');
role='compliance';
assert.equal(ctx.watch(data),'','Compliance cannot receive payment panel');
role='finance';

const truncated={merchantPayments:{...data.merchantPayments,reviewSampleLimited:true}};
html=ctx.watch(truncated);
assert.ok(html.includes('Amostra limitada às 500 tentativas de pagamento mais recentes'));
assert.ok(html.includes('não representam a totalidade da base'));
html=ctx.watch({merchantPayments:{attempts:[],interruptedOrders:[],reviewSampleLimited:false}});
assert.ok(html.includes('Nenhum registro nesta amostra exige conferência'));
assert.ok(html.includes('Conferência com base nas tentativas retornadas'));
const onlyDone={merchantPayments:{attempts:[attempt(4,'refunded')],interruptedOrders:[ord(4,'CANCELLED')]}};
html=ctx.watch(onlyDone);
assert.ok(html.includes('0 PARA CONFERIR'));
assert.ok(html.includes('Reembolsos registrados</span><strong>1'));

const segment=ops.slice(ops.indexOf('// V1.182: bounded'),ops.indexOf('const controlOrders='));
assert.ok(segment.includes('.in("id",saleAttemptIds)'));
assert.ok(segment.includes('.in("status",["CANCELLED","REASSIGNING"])'));
assert.ok(segment.includes('.select("id,public_code,status,financial_state,financial_reversed_at,updated_at")'));
assert.ok(!segment.includes('customer_phone')&&!segment.includes('customer_id'));
assert.ok(segment.includes('.limit(500)'),'Query must be bounded');
assert.ok(ops.includes('interruptedOrders:interruptedSaleOrders.data??[]'));
assert.ok(ops.includes('reviewSampleLimited:(merchantSaleAttempts.data??[]).length>=500'));
assert.equal((ops.match(/attempts:\[\],interruptedOrders:\[\],reviewSampleLimited:false/g)||[]).length,3,'RBAC redacts operations/support/compliance');
assert.ok(js.includes('${adminInterruptedSalePaymentWatch(d)}'),'Finance section calls panel');
assert.ok(js.includes("for(const row of adminInterruptedSalePaymentRows(d).filter(x=>x.kind!=='refunded').slice(0,10))"),'Attention center surfaces review cases');
assert.ok(css.includes('.admin-sale-refund-watch'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-sale-refund-watch-v1-182.mjs'));
console.log('V1.182: closed-sale review classifications, RBAC, sample limits, privacy, no refund mutation and attention escalation passed.');
