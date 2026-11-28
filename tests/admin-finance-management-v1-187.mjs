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
      entry('p2','statement_payment','approved',500),
      entry('p3','refund_recovery','approved',200),
      entry('p4','statement_payment','pending',50000),
      entry('p5','statement_payment','rejected',8000),
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
assert.equal(s.kinds.statement_payment.cents,500,'Do not include self-reported pending payments');
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
assert.ok(source.includes("adminFinanceRenderPart('Controle gerencial',()=>adminFinanceManagementView(d))"));
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
  paymentRequests:Array.from({length:300},(_,i)=>entry('x'+i,'statement_payment','pending',50))}};
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
// #493: A real production warning-only state (pending payment >24h, zero
// critical issues) must not be shown as a red "0 crítico(s)" alarm. Distinguish
// warning, critical and unverified states using the existing renderer.
const reconCtx=vm.createContext({adminMoney:dollar,esc:escape,
  adminMerchantName:()=> 'Revenda de teste'});
vm.runInContext(cut('adminBillingReconciliationMessage')+'\n'+
  cut('adminBillingReconciliationView')+
  '\nthis.reconcile=adminBillingReconciliationView;',reconCtx);
const reconciled=extra=>reconCtx.reconcile(extra);
const warningOnly=reconciled({
  healthy:false,issueCount:1,criticalCount:0,warningCount:1,
  issues:[{severity:'warning',issueType:'pending_payment_review_over_24h',
    merchantId:'ci-test',entityId:'ci-pending',expectedCents:30000,
    actualCents:0,ageHours:364}]
});
assert.match(warningOnly,/class="status-pill risk">1 alerta\(s\)<\/span>/,
  'a warning-only state must be amber and state the real warning count');
assert.doesNotMatch(warningOnly,/class="status-pill offline">0 crítico/,
  'warning-only state must not be a red zero-critical badge');
assert.match(warningOnly,/Aviso de pagamento sem conciliação exata/);
const critical=reconciled({
  healthy:false,issueCount:2,criticalCount:1,warningCount:1,
  issues:[{severity:'critical',issueType:'account_ledger_balance_mismatch'}]
});
assert.match(critical,/class="status-pill offline">1 crítico\(s\) • 1 alerta\(s\)/);
const clear=reconciled({healthy:true,issueCount:0,criticalCount:0,warningCount:0,issues:[]});
assert.match(clear,/class="status-pill online">ÍNTEGRA/);
assert.match(clear,/Conciliação fechada/);
const unverified=reconciled({healthy:false,issueCount:0,criticalCount:0,warningCount:0,issues:[]});
assert.match(unverified,/class="status-pill risk">Conferência necessária/);
assert.doesNotMatch(unverified,/Conciliação fechada/,
  'empty UI sample is not proof of financial health');

// Executive position: absent amounts and incomplete reconciliation never become a green zero.
let executiveAllowed=true;
const execCtx=vm.createContext({
  adminRoleCanSection:section=>section==='finance'&&executiveAllowed,
  adminMoney:dollar,esc:escape,
  adminRuntime:{providerHealth:null},
  adminBillingE2EState:()=>({validated:false}),
  adminExecutiveKpi:({label,value,detail,tone})=>'<p>'+label+'|'+value+'|'+detail+'|'+tone+'</p>'
});
vm.runInContext(cut('adminFinanceOverview')+'\nthis.executive=adminFinanceOverview;',execCtx);
const exec=extra=>execCtx.executive(extra);
const unknownExecutive=exec({});
assert.match(unknownExecutive,/DADOS INCOMPLETOS/);
assert.match(unknownExecutive,/D\+1 em aberto\|—\|não informado/);
assert.match(unknownExecutive,/Refunds em revisão\|—\|—/);
assert.doesNotMatch(unknownExecutive,/SEM ALERTAS NA CONSULTA|R\$ 0,00/);
const zeroMetrics={openStatementCents:0,openStatementCount:0,overdueStatementCents:0,overdueStatementCount:0,pendingPaymentCents:0,pendingPaymentCount:0,prepaidCreditBalanceCents:0,prepaidAccountCount:0,refundRecoveryOutstandingCents:0};
const zeroBilling={metrics:zeroMetrics,reconciliation:{healthy:true,issueCount:0,criticalCount:0},paymentEvents:[],refunds:[]};
const zero=exec({merchantBilling:zeroBilling});
assert.match(zero,/SEM ALERTAS NA CONSULTA/);
assert.match(zero,/D\+1 em aberto\|R\$ 0,00\|0/);
assert.match(zero,/obrigação operacional/);
assert.match(zero,/Não representa saldo bancário disponível nem lucro/);
assert.doesNotMatch(zero,/Consulta financeira incompleta/);
for(const invalid of [null,undefined,'',false,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
 const html=exec({merchantBilling:{...zeroBilling,metrics:{...zeroMetrics,openStatementCents:invalid}}});
 assert.match(html,/DADOS INCOMPLETOS/);
 assert.match(html,/D\+1 em aberto\|—/);
}
const attention=exec({merchantBilling:{...zeroBilling,reconciliation:{healthy:false,issueCount:1,criticalCount:0}}});
assert.match(attention,/EXIGE ATENÇÃO/);
assert.doesNotMatch(attention,/SEM ALERTAS NA CONSULTA/);
assert.match(exec({merchantBilling:{...zeroBilling,metrics:{...zeroMetrics,pendingPaymentCents:100,pendingPaymentCount:1}}}),/EXIGE ATENÇÃO/);
assert.match(exec({merchantBilling:{...zeroBilling,paymentEvents:undefined}}),/DADOS INCOMPLETOS/);
assert.match(exec({merchantBilling:{...zeroBilling,reconciliation:{healthy:true}}}),/DADOS INCOMPLETOS/);
executiveAllowed=false;
assert.equal(exec({merchantBilling:zeroBilling}),'');


// ERP directory must reuse the same authorized task list and never initiate transactions.
let directoryRole='superadmin';
let directoryTasks=['finance-billing','finance-reconciliation','growth-benefits','growth-budget','ads-finance','ads-refunds','finance-homologation'];
const directoryCtx=vm.createContext({
 adminRoleCanSection:section=>section==='finance'&&['superadmin','finance'].includes(directoryRole),
 adminCurrentRole:()=>directoryRole,
 adminTaskNavChoices:()=>directoryTasks.map(id=>({id})),
 ADMIN_FINANCE_WORKSPACES:[{id:'policy'},{id:'operator'}],
 esc:escape
});
vm.runInContext(cut('adminFinanceWorkflowDirectory')+'\nthis.directory=adminFinanceWorkflowDirectory;',directoryCtx);
const fullDirectory=directoryCtx.directory();
for(const id of directoryTasks)assert.ok(fullDirectory.includes("adminOpenTask('"+id+"')"));
for(const id of ['policy','operator'])assert.ok(fullDirectory.includes("adminSetFinanceWorkspace('"+id+"')"));
assert.match(fullDirectory,/Saldo bancário livre, despesas gerais, impostos e lucro líquido exigem fontes completas/);
assert.match(fullDirectory,/sem emitir novo Pix/);
assert.doesNotMatch(fullDirectory,/adminPerform\(|adminInvoke\(|fetch\(/);
directoryRole='finance';
directoryTasks=['finance-billing','finance-reconciliation','growth-benefits'];
const scoped=directoryCtx.directory();
assert.match(scoped,/adminOpenTask\('finance-billing'\)/);
assert.doesNotMatch(scoped,/adminOpenTask\('growth-budget'\)|adminOpenTask\('ads-finance'\)|adminOpenTask\('finance-homologation'\)|adminSetFinanceWorkspace\('operator'\)/);
directoryRole='operations';
assert.equal(directoryCtx.directory(),'');
assert.ok(source.includes("adminFinanceRenderPart('Mapa da controladoria',()=>adminFinanceWorkflowDirectory())"));

console.log('V1.187: financial sources, dedup, null safety, sampled receipts, role isolation, and mobile CSS passed.');
