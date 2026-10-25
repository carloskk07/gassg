import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
new vm.Script(admin,{filename:'js/admin.js'});
assert.match(edge,/if\(action==="clube-coupon-finance-status"\)/);
assert.match(edge,/if\(action==="clube-coupon-mp-release-reports"\)/);
assert.match(edge,/mercadoPagoFetch\("\/v1\/account\/release_report\/list"/);
assert.match(edge,/Deno\.env\.get\("MERCADOPAGO_ACCESS_TOKEN"\)/);
assert.match(edge,/moneyVerified:false/);
assert.match(edge,/\["superadmin","finance"\]/);
assert.doesNotMatch(edge.slice(edge.indexOf('if(action==="clube-coupon-mp-release-reports")'),
 edge.indexOf('if(action==="clube-coupon-finance-status")')),
 /mercadoPagoFetch\([^;]*method:"POST"/,
 'release reports must be read-only');
assert.match(edge,/\["superadmin","finance"\]/);
assert.match(edge,/clube_coupon_paid_order_reconciliation/);
assert.match(edge,/paymentsChecked:false/);
assert.match(edge,/invoiceWorkQueueCoverage:bounded\?"partial":"bounded_complete"/);
assert.match(edge,/invoiceWorkQueue,invoiceWorkQueueCoverage/);
assert.match(edge,/\.order\("created_at",\{ascending:false\}\)/);
const queueBlock=edge.slice(edge.indexOf('const invoiceWorkQueue='),
 edge.indexOf('const unavailableVouchers=',edge.indexOf('const invoiceWorkQueue=')));
assert.match(queueBlock,/\.slice\(0,12\)/,'invoice IDs are bounded');
assert.match(queueBlock,/needsNetProof:row.status==="paid"/);
assert.doesNotMatch(queueBlock,/customer_user_id|provider_payment_id:|provider_order_id:|email:/,
 'Admin work queue must not reveal customer identity or provider credentials');
assert.match(edge,/COUPON_FINANCE_SCHEMA_NOT_INSTALLED/);
assert.match(edge,/COUPON_CHECKOUT_SCHEMA_INCOMPLETE/);
// Execute the actual read-only Admin funding predicate, not a copied formula.
const helperFrom=edge.indexOf('const couponNetCovered=(row:any)=>');
const helperTo=edge.indexOf('const invoiceById=',helperFrom);
assert.ok(helperFrom>=0&&helperTo>helperFrom,'Admin net-coverage helper must exist');
const helper=edge.slice(helperFrom,helperTo).replace('(row:any)','(row)');
const finance=vm.createContext({Number,Date,String,Boolean});
new vm.Script(helper+';this.netCovered=couponNetCovered;').runInContext(finance);
const invoice={status:'paid',paid_at:'2026-10-24T05:00:00Z',
 provider_order_id:'ORD-test',provider_payment_id:'PAY-test',
 sale_price_cents:1200,coupon_face_cents:500,coupons_per_pack:2,
 net_proceeds_cents:1000,net_proceeds_reference:'mp-report-verified-001',
 net_proceeds_verified_at:'2026-10-24T06:00:00Z'};
assert.equal(finance.netCovered(invoice),true);
for(const bad of [
 {status:'awaiting_payment'},{status:'refunded'},{paid_at:null},
 {provider_order_id:null},{provider_payment_id:null},
 {net_proceeds_cents:null},{net_proceeds_cents:999},
 {net_proceeds_cents:1201},{net_proceeds_reference:null},
 {net_proceeds_verified_at:null},{net_proceeds_verified_at:'invalid'},
 {coupons_per_pack:16,coupon_face_cents:100}
]){
 assert.equal(finance.netCovered({...invoice,...bad}),false,
  'admin must fail closed for missing payment, full net coverage or source proof');
}
assert.match(edge,/unavailableVoucherCount:bounded\?null:unavailableVouchers/);
assert.match(edge,/financialIntegrityRisk:bounded\?null:unbackedConsumption>0/);
assert.match(edge,/coverage:bounded\|\|failedSettlement>0\|\|unbackedConsumption>0/);
assert.match(edge,/salesEnabled:Deno\.env\.get\("CLUBE_COUPON_PAID_SALES_ENABLED"\)==="true"/);
assert.match(admin,/\$\{adminClubeFinanceView\(\)\}/);
const begin=admin.indexOf('async function adminClubeFinanceRefresh(){');
const end=admin.indexOf('function adminClubeCouponPreviewView(){',begin);
assert.ok(begin>=0&&end>begin);

let payoutCalls=0,payoutPayload=null,payoutFail=false;
let role='finance';
let calls=0,mpCalls=0,renders=0,payload=null,fail=false,
 mpPayload=null,mpFail=false;
let current='11111111-1111-4111-8111-111111111111';
const runtime={
 status:'ready',session:{user:{id:current}},
 clubeFinance:{data:null,pending:false,error:null,loadedFor:null,checkedAt:null,
  reports:null,reportsPending:false,reportsError:null,reportsFor:null,reportsAt:null}
};
const state={
 adminRuntime:runtime,
 adminCurrentRole:()=>role,
 adminInvoke:async({action})=>{
   if(action==='clube-coupon-mp-release-reports'){
     mpCalls++;
     if(mpFail)throw Error('mercadopago-offline');
     return mpPayload;
   }
   if(action==='clube-coupon-mp-payout-inspect'){
     payoutCalls++;
     if(payoutFail)throw Error('payout-offline');
     return payoutPayload;
   }
   assert.equal(action,'clube-coupon-finance-status');
   calls++;
   if(fail)throw Error('not-available');
   return payload;
 },
 render:()=>{renders++},
 esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
 Date,Number,Object,String,Array
};
const ctx=vm.createContext(state);
vm.runInContext(admin.slice(begin,end)+
 ';this.query=adminClubeFinanceRefresh;this.page=adminClubeFinanceView;'+
 ';this.mpQuery=adminClubeReleaseReportsRefresh;this.mpPage=adminClubeReleaseReportsView;'+
 ';this.payoutQuery=adminClubePayoutInspect;this.payoutChanged=adminClubePayoutInputChanged;',ctx);

assert.match(ctx.page(),/Conferir situação dos cupons/);
payload={source:'clube_coupon_finance_status_v1',readOnly:true,
 schemaInstalled:false,coverage:'unavailable',salesEnabled:false,
 checkoutEnabled:false,paymentsChecked:false,reason:'COUPON_FINANCE_SCHEMA_NOT_INSTALLED'};
await ctx.query();
assert.equal(calls,1);
assert.match(ctx.page(),/Cupons pagos ainda não instalados/);
assert.doesNotMatch(ctx.page(),/Pacotes cadastrados<\/small><strong>0/);
payload.salesEnabled=true;
await ctx.query();
assert.match(ctx.page(),/Configuração incoerente/,
 'activated sales cannot be silently reported as disabled without schema');
payload.salesEnabled=false;

payload={source:'clube_coupon_finance_status_v1',readOnly:true,
 schemaInstalled:true,coverage:'bounded_under_limits',
 salesEnabled:false,checkoutEnabled:false,paymentsChecked:false,
 packageCount:1,invoiceCount:3,voucherCount:6,issuedCount:2,
 redeemedCount:4,pendingNetCount:1,unavailableVoucherCount:2,
 unbackedConsumptionCount:0,financialIntegrityRisk:false,refundReviewCount:2,
 merchantSettlementPendingCount:1,
 invoiceWorkQueueCoverage:'bounded_complete',
 invoiceWorkQueue:[
  {invoiceId:'88888888-8888-4888-8888-888888888888',status:'paid',
   needsNetProof:true,salePriceCents:1200,createdAt:'2026-10-24T12:00:00Z'},
  {invoiceId:'99999999-9999-4999-8999-999999999999',status:'review_required',
   needsNetProof:false,salePriceCents:1300,createdAt:'2026-10-24T10:00:00Z'}
 ]};
await ctx.query();
assert.match(ctx.page(),/Pacotes cadastrados/);
assert.match(ctx.page(),/Faturas de cupons/);
assert.match(ctx.page(),/Obrigações de revendas pendentes/);
assert.match(ctx.page(),/Cupons registrados aguardando lastro/);
assert.match(ctx.page(),/Faturas pagas sem cobertura líquida registrada/);
assert.match(ctx.mpPage(),/Selecionar fatura 88888888/);
assert.match(ctx.mpPage(),/Pix pago, líquido pendente/);
assert.match(ctx.mpPage(),/Revisão financeira obrigatória/);
assert.doesNotMatch(ctx.mpPage(),/Selecionar fatura 99999999/);
assert.doesNotMatch(ctx.mpPage(),/88888888-8888-4888-8888-888888888888.*@/,
 'Never expose a customer email in invoice work queue');
assert.doesNotMatch(ctx.page(),/Anomalia financeira/);
payload.financialIntegrityRisk=true;
payload.unbackedConsumptionCount=1;
await ctx.query();
assert.match(ctx.page(),/Anomalia financeira/);
assert.match(ctx.page(),/Suspenda e revise a conciliação/);
payload.financialIntegrityRisk=false;
payload.unbackedConsumptionCount=0;
assert.match(ctx.page(),/não confere o extrato de liberação/);
assert.ok(renders>0);
payload.coverage='partial';
payload.invoiceWorkQueueCoverage='partial';
await ctx.query();
assert.match(ctx.page(),/Informação incompleta/);
assert.match(ctx.mpPage(),/Fila parcial/);
assert.doesNotMatch(ctx.page(),/Pacotes cadastrados<\/small><strong>1/);
payload.readOnly=false;
await ctx.query();
assert.match(ctx.page(),/A consulta financeira não retornou dados verificáveis/);
payload.readOnly=true;
fail=true;
await ctx.query();
assert.match(ctx.page(),/not-available/);
fail=false;
role='readonly';
const oldCalls=calls;
await ctx.query();
assert.equal(calls,oldCalls);
assert.equal(ctx.page(),'');
role='finance';
runtime.session.user.id='22222222-2222-4222-8222-222222222222';
assert.doesNotMatch(ctx.page(),/not-available/);
assert.match(ctx.page(),/Use a consulta/);
assert.match(ctx.mpPage(),/Consultar relatórios do Mercado Pago/);
mpPayload={source:'mercadopago_release_reports_list_v1',readOnly:true,
 available:false,coverage:'unavailable',moneyVerified:false,reports:[]};
await ctx.mpQuery();
assert.equal(mpCalls,1);
assert.match(ctx.mpPage(),/não configurada/);
mpPayload={source:'mercadopago_release_reports_list_v1',readOnly:true,
 available:true,coverage:'list_only',moneyVerified:false,listedCount:2,
 reports:[{status:'processed',currency:'BRL',test:false},
 {status:'processed',currency:null,test:true}]};
await ctx.mpQuery();
assert.match(ctx.mpPage(),/2 relatórios listados/);
assert.match(ctx.mpPage(),/1 processados em BRL/);
assert.match(ctx.mpPage(),/não confirma o PIX líquido/);
mpPayload.coverage='partial';
await ctx.mpQuery();
assert.match(ctx.mpPage(),/Lista parcial/);
mpPayload.moneyVerified=true;
await ctx.mpQuery();
assert.match(ctx.mpPage(),/Resposta de extratos não verificada/);
mpPayload.moneyVerified=false;
mpFail=true;
await ctx.mpQuery();
assert.match(ctx.mpPage(),/mercadopago-offline/);
mpFail=false;
role='readonly';
const oldMpCalls=mpCalls;
await ctx.mpQuery();
assert.equal(mpCalls,oldMpCalls);
assert.equal(ctx.mpPage(),'');
role='finance';
runtime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.doesNotMatch(ctx.mpPage(),/mercadopago-offline/);
assert.doesNotMatch(ctx.mpPage(),/2 relatórios listados/);
assert.doesNotMatch(ctx.mpPage(),/Selecionar fatura 88888888/,
 'An old user session must not expose the previous finance queue');
// Exercise the actual Admin -> existing read-only PSP payout action, not a decorative form.
assert.match(ctx.mpPage(),/Conferir crédito de repasse/);
assert.match(ctx.mpPage(),/recebedor/i);
await ctx.payoutQuery();
assert.equal(payoutCalls,0,'invalid payout identifiers must not call the backend');
assert.match(ctx.mpPage(),/Informe identificadores desta sessão/);
const newOrder='44444444-4444-4444-8444-444444444444';
ctx.payoutChanged('payoutOrderId',newOrder);
ctx.payoutChanged('payoutBatchId','POP01KKYN1QY2SS1MKAY4KP6SSRCT');
ctx.payoutChanged('payoutTransactionId','TOP01KKYN1QY2SS1MKAY4G9DV5NK9');
assert.doesNotMatch(ctx.mpPage(),/IDs POP\/TOP válidos/,'editing IDs clears stale result');
payoutPayload={source:'coupon_merchant_payout_inspection_v1',readOnly:true,
 moneyMoved:false,available:true,providerTransactionAccredited:true,
 merchantBeneficiaryVerified:false,merchantExternalSettlementVerified:false,
 eligibleForFinancialWrite:false,reason:'COUPON_PAYOUT_BENEFICIARY_IDENTITY_REQUIRED',
 observedCents:700};
await ctx.payoutQuery();
assert.equal(payoutCalls,1);
assert.match(ctx.mpPage(),/Provedor informa crédito no destino/);
assert.match(ctx.mpPage(),/Quitação externa NÃO comprovada/);
assert.match(ctx.mpPage(),/Escrita financeira BLOQUEADA/);
assert.match(ctx.mpPage(),/7\.00/);
payoutPayload={...payoutPayload,merchantExternalSettlementVerified:true};
await ctx.payoutQuery();
assert.match(ctx.mpPage(),/sem garantias financeiras/,
 'never trust a server response that unexpectedly claims merchant receipt');
payoutPayload={...payoutPayload,merchantExternalSettlementVerified:false,
 eligibleForFinancialWrite:true};
await ctx.payoutQuery();
assert.match(ctx.mpPage(),/sem garantias financeiras/);
payoutPayload={...payoutPayload,eligibleForFinancialWrite:false,
 providerTransactionAccredited:false,reason:'COUPON_PAYOUT_NOT_ACCREDITED'};
await ctx.payoutQuery();
assert.match(ctx.mpPage(),/Crédito não confirmado pelo provedor/);
const beforeBlocked=payoutCalls;
role='readonly';
await ctx.payoutQuery();
assert.equal(payoutCalls,beforeBlocked,'nonfinancial admins cannot query payout');
assert.equal(ctx.mpPage(),'');
role='finance';
runtime.session.user.id='55555555-5555-4555-8555-555555555555';
assert.doesNotMatch(ctx.mpPage(),/Crédito não confirmado pelo provedor/,
 'new authenticated session must not see previous account payout result');
assert.doesNotMatch(ctx.mpPage(),/POP01KKYN1QY2SS1MKAY4KP6SSRCT/,
 'new admin user cannot see another session payout IDs');
const oldPayoutCalls=payoutCalls;
await ctx.payoutQuery();
assert.equal(payoutCalls,oldPayoutCalls,
 'new session must not use the previous user\'s payout identifiers');
ctx.payoutChanged('payoutOrderId',newOrder);
ctx.payoutChanged('payoutBatchId','POP01KKYN1QY2SS1MKAY4KP6SSRCT');
ctx.payoutChanged('payoutTransactionId','TOP01KKYN1QY2SS1MKAY4G9DV5NK9');
payoutFail=true;
await ctx.payoutQuery();
assert.match(ctx.mpPage(),/payout-offline/);
payoutFail=false;
assert.doesNotMatch(ctx.mpPage(),/mercadopago-access-token/i,
 'do not leak PSP secrets');
console.log('PASS: finance Admin checked net evidence, shortfall, danger, migration mismatch, read-only MP releases account isolation and merchant payout segregation.');
