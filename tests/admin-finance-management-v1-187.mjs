import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin.js');
new vm.Script(source,{filename:'js/admin.js'});
function cut(name){
  const at=source.indexOf('function '+name+'(');
  assert.ok(at>=0,'Missing '+name);
  const end=source.indexOf('\n}',at);
  assert.ok(end>at,'No closing brace for '+name);
  return source.slice(at,end+2);
}
const dollar=n=>'R$ '+(n/100).toFixed(2).replace('.',',');
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
let role='finance';
const ctx=vm.createContext({
  adminRoleCanSection:section=>section==='finance'&&['superadmin','finance'].includes(role),
  adminMoney:dollar,esc:escape,
  formatDateTime:()=> '12/10/2026 17:15',
  adminRuntime:{lastSyncAt:'2026-10-12T20:15:00Z'}
});
vm.runInContext(['billedDirect','adminFinanceManagementSnapshot','adminFinanceManagementView']
  .map(cut).join('\n')+
  '\nthis.snapshot=adminFinanceManagementSnapshot;this.view=adminFinanceManagementView;',ctx);
const entry=(id,request_kind,status,received_amount_cents)=>({
  id,request_kind,status,received_amount_cents
});
const d={
  businessMetrics:{platformFeeGeneratedCents30d:32000},
  merchantBilling:{
    metrics:{openStatementCents:9000,overdueStatementCents:2500,pendingPaymentCents:7000},
    reconciliation:{issueCount:2},
    paymentRequests:[
      entry('p1','package_purchase','approved',10000),
      entry('p2','daily_statement','approved',500),
      entry('p3','refund_recovery','approved',200),
      entry('p4','daily_statement','pending',50000),
      entry('p5','daily_statement','rejected',8000),
      entry('p1','package_purchase','approved',10000),
      entry('p6','package_purchase','approved',null),
      entry('p7','unknown_type','approved',9999)
    ]
  },
  merchantPayments:{
    fundsOwner:'merchant',tamaoReceivesSaleProceeds:false,
    attempts:[{id:'sale1',amount_cents:910000,status:'approved'}]
  }
};
const s=ctx.snapshot(d);
assert.equal(s.generated30d,32000,'Accrued platform fee is an independent server metric');
assert.equal(s.openDaily,9000);
assert.equal(s.overdueDaily,2500);
assert.equal(s.pendingReview,7000);
assert.equal(s.disputes,2);
assert.equal(s.kinds.package_purchase.count,2);
assert.equal(s.kinds.package_purchase.cents,10000,'Do not double-count duplicate IDs or unknown amounts');
assert.equal(s.kinds.daily_statement.cents,500,'Do not include self-reported pending payments');
assert.equal(s.kinds.refund_recovery.cents,200,'Recovery is not a new platform sale');
assert.equal(s.approvedCount,4);
assert.equal(s.amountUnavailable,1);
assert.equal(s.directMerchantPayments,true);
assert.equal(s.totalsAvailable,true);
const html=ctx.view(d);
for(const label of [
  'CONTROLE GERENCIAL','Taxas TAMÃO geradas','Recebimentos registrados por finalidade',
  'Pacotes de crédito','Cobranças diárias D+1','Recuperações de refund',
  '12/10/2026 17:15','Não some os dois valores','não é extrato bancário',
  'não inicia cobranças, repasses ou estornos','Não entram na receita do TAMÃO'
])assert.ok(html.includes(label),'Missing meaning / source: '+label);
assert.ok(html.includes('R$ 320,00'));
assert.ok(html.includes('R$ 100,00'));
assert.ok(html.includes('R$ 5,00'));
assert.ok(html.includes('R$ 2,00'));
assert.ok(!html.includes('R$ 9.100,00'),'Do not blend merchant sales into platform receipts');
assert.ok(!html.includes('R$ 500,00'),'Pending payments are not confirmed receipts');
assert.ok(source.includes('    $'+'{adminFinanceManagementView(d)}'));
assert.ok(!html.includes('onclick='),'Management summary must stay read-only');
const withoutMetrics={...d,businessMetrics:null,merchantBilling:{...d.merchantBilling,metrics:null,reconciliation:null}};
const missing=ctx.snapshot(withoutMetrics);
assert.equal(missing.generated30d,null);
assert.equal(missing.openDaily,null);
assert.equal(missing.disputes,null);
assert.equal(missing.totalsAvailable,false);
assert.ok(ctx.view(withoutMetrics).includes('Indicadores completos indisponíveis'));
assert.ok(ctx.view(withoutMetrics).includes('—'),'Missing cannot become zero');
const unproven=ctx.view({...d,merchantPayments:{fundsOwner:'platform',tamaoReceivesSaleProceeds:true}});
assert.ok(unproven.includes('Rota de fundos sem confirmação'));
const cappedData={...d,merchantBilling:{...d.merchantBilling,
  paymentRequests:Array.from({length:300},(_,i)=>entry('x'+i,'daily_statement','pending',50))}};
assert.equal(ctx.snapshot(cappedData).recordsCapped,true);
assert.ok(ctx.view(cappedData).includes('Há registros anteriores fora da amostra'));
role='readonly';
assert.equal(ctx.view(d),'','Read-only audit role cannot view this restricted finance panel');
role='operations';
assert.equal(ctx.view(d),'','Operations cannot view finance management');
const css=read('css/components.css');
assert.ok(css.includes('.admin-managerial-grid'));
assert.ok(css.includes('@media(max-width:420px)'));
assert.ok(read('.github/workflows/audit.yml')
  .includes('node tests/admin-finance-management-v1-187.mjs'));
console.log('V1.187: financial sources, dedup, null safety, sampled receipts, role isolation, and mobile CSS passed.');
