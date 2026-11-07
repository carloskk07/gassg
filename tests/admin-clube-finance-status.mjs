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
assert.match(edge,/\.from\("clube_coupon_refund_requests_v1_814"\)/,
 'Finance must query durable refund requests independently of paid invoice status');
assert.match(edge,/\.in\("status",\["requested","in_review"\]\)/,
 'The review queue must not hide requested refunds even when invoice is paid');
assert.match(edge,/\.select\("invoice_id,request_id,status,received_at",\{count:"exact"\}\)/,
 'Refund request count must not be inferred from a truncated page');
assert.match(edge,/COUPON_REFUND_QUEUE_INCOMPLETE/,
 'Absent or malformed refund count must fail closed, not announce zero cases');
assert.match(edge,/\.from\("clube_coupon_paid_order_applications"\)\s*\.select\("order_id",\{count:"exact",head:true\}\)/,
 'Each refund review must show the immutable lifetime application count');
assert.match(edge,/requiresHistoryReview:count>0/,
 'An originally used voucher must require human financial review after reissue');
assert.match(edge,/PARTNER_COUPON_REFUND_REVIEW/,
 'Refund disputes from #847 cannot be omitted from merchant liabilities');
assert.match(edge,/if\(action==="clube-coupon-refund-review-inspect"\)/);
const inspectionAction=edge.slice(edge.indexOf('if(action==="clube-coupon-refund-review-inspect")'),
 edge.indexOf('if(action==="clube-coupon-preview")'));
assert.match(inspectionAction,/COUPON_REFUND_CASE_EVIDENCE_INCOMPLETE/);
assert.match(inspectionAction,/COUPON_REFUND_CASE_RECONCILIATION_INCOMPLETE/);
assert.match(inspectionAction,/clube_coupon_paid_order_applications/);
assert.match(inspectionAction,/clube_coupon_paid_order_reconciliation/);
assert.match(inspectionAction,/providerRefundVerified:false/);
assert.match(inspectionAction,/refundClosureAuthorized:false/);
assert.match(inspectionAction,/historyCount>25\?"partial":"bounded_complete"/);
assert.doesNotMatch(inspectionAction,/mercadoPagoFetch|method:"POST"|\.update\(|\.insert\(|clube_coupon_paid_payment_refund/,
 'Case inspection must not refund, write or close a financial request');


const claimEdge=edge.slice(edge.indexOf('if(action==="clube-coupon-refund-review-start")'),
 edge.indexOf('if(action==="clube-coupon-refund-triage-record")'));
assert.match(claimEdge,/admin_clube_coupon_refund_review_start_v1_865/);
assert.match(claimEdge,/COUPON_REVIEW_READBACK_UNVERIFIED/);
assert.match(claimEdge,/clube_coupon_refund_requests_v1_814/);
assert.match(claimEdge,/platform_admin_audit/);
assert.doesNotMatch(claimEdge,/mercadoPagoFetch|clube_coupon_paid_payment_refund|method:"POST"/);
const claimSQL=read('supabase/migrations/20261106202000_coupon_refund_review_claim_v1_865.sql');
assert.match(claimSQL,/FOR UPDATE/g);
assert.match(claimSQL,/clube_coupon_review_started_v1_865/);
assert.match(claimSQL,/COUPON_REVIEW_IDEMPOTENCY_CONFLICT/);
assert.match(claimSQL,/AND admin_role IN \('superadmin','finance'\)/);
assert.match(claimSQL,/REVOKE ALL ON FUNCTION public.admin_clube_coupon_refund_review_start_v1_865/);
assert.match(claimSQL,/TO service_role/);
assert.doesNotMatch(claimSQL,/clube_coupon_paid_payment_refund|mercadoPagoFetch/);

const triageEdge=edge.slice(edge.indexOf('if(action==="clube-coupon-refund-triage-record")'),
 edge.indexOf('if(action==="clube-coupon-refund-provider-inspect")'));
assert.match(triageEdge,/admin_clube_coupon_refund_triage_v1_866/);
assert.match(triageEdge,/COUPON_TRIAGE_READBACK_UNVERIFIED/);
assert.match(triageEdge,/platform_admin_audit/);
assert.doesNotMatch(triageEdge,/mercadoPagoFetch|clube_coupon_paid_payment_refund|method:"POST"/);
const triageSQL=read('supabase/migrations/20261106223000_coupon_refund_triage_decision_v1_866.sql');
assert.match(triageSQL,/FOR UPDATE/);
assert.match(triageSQL,/COUPON_TRIAGE_HISTORY_REQUIRES_MERCHANT_REVIEW/);
assert.match(triageSQL,/COUPON_TRIAGE_ALREADY_RECORDED/);
assert.match(triageSQL,/COUPON_TRIAGE_IDEMPOTENCY_CONFLICT/);
assert.match(triageSQL,/REVOKE ALL ON FUNCTION public.admin_clube_coupon_refund_triage_v1_866/);
assert.match(triageSQL,/TO service_role/);
assert.doesNotMatch(triageSQL,/UPDATE public\.clube_coupon_paid_invoices|UPDATE public\.clube_coupon_refund_requests_v1_814/);

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
const verifiedSponsorIds=new Set();
const finance=vm.createContext({Number,Date,String,Boolean,verifiedSponsorIds});
new vm.Script(helper+';this.netCovered=couponNetCovered;').runInContext(finance);
const invoice={status:'paid',paid_at:'2026-10-24T05:00:00Z',
 provider_order_id:'ORD-test',provider_payment_id:'PAY-test',
 sale_price_cents:1200,coupon_face_cents:500,coupons_per_pack:2,
 net_proceeds_cents:1000,net_proceeds_reference:'mp-report-verified-001',
 net_proceeds_verified_at:'2026-10-24T06:00:00Z'};
assert.equal(finance.netCovered(invoice),true);
const sponsored={...invoice,id:'sponsored-invoice-1',sale_price_cents:890,
 coupon_face_cents:500,coupons_per_pack:3,net_proceeds_cents:840,
 sponsor_covered_cents:1500};
assert.equal(finance.netCovered(sponsored),false,
 'an invoice field alone cannot establish escrow evidence');
verifiedSponsorIds.add(sponsored.id);
assert.equal(finance.netCovered(sponsored),true,
 'owner escrow independently verified in PostgreSQL covers net below face');
assert.equal(finance.netCovered({...sponsored,sponsor_covered_cents:1499}),false,
 'partial sponsor coverage may not count as fully funded');
assert.equal(finance.netCovered({...sponsored,net_proceeds_cents:0}),false,
 'escrow alone does not replace a real paid Pix net report');
assert.ok(edge.includes('couponOwnerSponsorVerified(admin,row)'),
 'finance must verify each sponsored paid invoice in the real database');
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
assert.match(edge,/salesEnabled:couponSalesEnabled/);
assert.match(edge,/const couponSalesEnabled=release\?\.enabled===true/);
assert.match(admin,/\$\{adminFinanceRenderPart\('Clube financeiro',\(\)=>adminClubeFinanceView\(\)\)\}/);
const begin=admin.indexOf('async function adminClubeFinanceRefresh(){');
const end=admin.indexOf('function adminClubeCouponPreviewView(){',begin);
assert.ok(begin>=0&&end>begin);

let historyCalls=0,historyPayload=null,historyFail=false;
let providerCalls=0,providerPayload=null,providerFail=false;
let triageCalls=0,triagePayload=null,triageAttemptUsed=null,triageFail=false;
let claimCalls=0,claimPayload=null,claimFail=false,claimAttemptUsed=null;
let inspectCalls=0,inspectPayload=null,inspectFail=false;
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
const testUUIDs=['dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
let testUUIDCounter=0;
const state={
 adminRuntime:runtime,
 adminCurrentRole:()=>role,
 adminInvoke:async({action,...args})=>{
   if(action==='clube-coupon-refund-merchant-history-inspect'){
     historyCalls++;
     if(historyFail)throw Error('historico-revenda-indisponivel');
     return historyPayload;
   }
   if(action==='clube-coupon-refund-provider-inspect'){
     providerCalls++;
     if(providerFail)throw Error('consulta-psp-indisponivel');
     return providerPayload;
   }
   if(action==='clube-coupon-refund-triage-record'){
     triageCalls++;
     triageAttemptUsed=args.attemptId;
     if(triageFail)throw Error('triagem-indisponivel');
     if(triagePayload?.readbackVerified===true){
       inspectPayload.triageDecision=args.decision;
       inspectPayload.triageAt='2026-11-06T22:50:01Z';
       inspectPayload.triageAuditId=args.attemptId;
     }
     return triagePayload;
   }
   if(action==='clube-coupon-refund-review-start'){
     claimCalls++;
     claimAttemptUsed=args.attemptId;
     if(claimFail)throw Error('revisao-indisponivel');
     if(claimPayload?.readbackVerified===true){
       payload.refundWorkQueue[0].status='in_review';
       inspectPayload.requestStatus='in_review';
       inspectPayload.reviewClaimed=true;
       inspectPayload.reviewerCanTriage=true;
       inspectPayload.reviewAssignedAt='2026-11-06T20:20:01Z';
     }
     return claimPayload;
   }
   if(action==='clube-coupon-refund-review-inspect'){
     inspectCalls++;
     if(inspectFail)throw Error('historico-indisponivel');
     return inspectPayload;
   }
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
 crypto:{randomUUID:()=>testUUIDs[Math.min(testUUIDCounter++,testUUIDs.length-1)]},
 confirm:()=>true,
 esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
 Date,Number,Object,String,Array
};
const ctx=vm.createContext(state);
vm.runInContext(admin.slice(begin,end)+
 ';this.query=adminClubeFinanceRefresh;this.page=adminClubeFinanceView;'+
 ';this.refundInspect=adminClubeRefundInspect;this.refundClaim=adminClubeRefundClaim;this.refundTriage=adminClubeRefundTriage;this.providerInspect=adminClubeRefundProviderInspect;this.merchantHistoryInspect=adminClubeRefundMerchantHistoryInspect;this.mpQuery=adminClubeReleaseReportsRefresh;this.mpPage=adminClubeReleaseReportsView;'+
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
 merchantSettlementPendingCount:1,refundRequestPendingCount:2,
 refundWorkQueueCoverage:'bounded_complete',
 refundWorkQueue:[
  {invoiceId:'66666666-6666-4666-8666-666666666666',
   requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   status:'requested',receivedAt:'2026-11-06T18:00:00Z',
   historicalOrderCount:2,requiresHistoryReview:true},
  {invoiceId:'77777777-7777-4777-8777-777777777777',
   requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   status:'in_review',receivedAt:'2026-11-06T18:10:00Z',
   historicalOrderCount:0,requiresHistoryReview:false}
 ],
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
assert.match(ctx.page(),/Reembolsos de cupons aguardando análise/);
assert.match(ctx.page(),/Solicitações de reembolso aguardando análise/);
assert.match(ctx.page(),/2<\/strong> protocolos abertos/);
assert.match(ctx.page(),/Fatura 66666666/);
assert.match(ctx.page(),/Fatura 77777777/);
assert.match(ctx.page(),/Histórico: 2 pedido\(s\) com cupom/);
assert.match(ctx.page(),/Reembolso automático bloqueado/);
assert.match(ctx.page(),/Nenhum pedido anterior localizado/);
assert.match(ctx.page(),/Examinar histórico/);
inspectPayload={ok:true,source:'clube_coupon_refund_case_inspection_v1',
 readOnly:true,moneyMoved:false,writeAuthorized:false,
 refundClosureAuthorized:false,providerRefundVerified:false,
 invoiceId:'66666666-6666-4666-8666-666666666666',
 requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 requestStatus:'requested',invoiceStatus:'paid',salePriceCents:890,
 paymentReferencePresent:true,
 reviewClaimed:false,reviewerCanTriage:false,reviewAssignedAt:null,
 triageDecision:null,triageAt:null,triageAuditId:null,
 voucherCount:3,voucherStatuses:{issued:2,reserved:0,redeemed:1,void:0,review_required:0},
 historicalOrderCount:2,historyCoverage:'bounded_complete',
 orderReconciliations:[{orderId:'11111111-1111-4111-8111-111111111111',status:'PARTNER_COUPON_REFUND_REVIEW'}],
 closureBlockers:['PROVIDER_REFUND_PROOF_REQUIRED','HISTORICAL_DISCOUNTS_REQUIRE_REVIEW']};
await ctx.refundInspect(inspectPayload.invoiceId,inspectPayload.requestId);
assert.equal(inspectCalls,1);
assert.match(ctx.page(),/Detalhamento financeiro/);
assert.match(ctx.page(),/Histórico permanente/);
assert.match(ctx.page(),/PARTNER_COUPON_REFUND_REVIEW/);
assert.match(ctx.page(),/Encerramento bloqueado/);
inspectPayload={...inspectPayload,refundClosureAuthorized:true};
await ctx.refundInspect(inspectPayload.invoiceId,inspectPayload.requestId);
assert.match(ctx.page(),/não apresentou garantias financeiras suficientes/);
inspectPayload={...inspectPayload,refundClosureAuthorized:false};
await ctx.refundInspect(inspectPayload.invoiceId,inspectPayload.requestId);
assert.match(ctx.page(),/Assumir análise auditada/);
claimPayload={ok:true,source:'clube_coupon_review_start_v1_865',
 invoiceId:inspectPayload.invoiceId,requestId:inspectPayload.requestId,
 auditId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',status:'in_review',
 reviewStartedAt:'2026-11-06T20:20:01Z',replayed:false,
 readbackVerified:false,moneyMoved:false,refundConfirmed:false,caseClosed:false};
await ctx.refundClaim(inspectPayload.invoiceId,inspectPayload.requestId);
assert.equal(claimCalls,1);
assert.match(ctx.page(),/não foi confirmada pelo histórico financeiro/);
assert.equal(payload.refundWorkQueue[0].status,'requested',
 'A rejected claim acknowledgement cannot prematurely change local state');
claimPayload.readbackVerified=true;
await ctx.refundClaim(inspectPayload.invoiceId,inspectPayload.requestId);
assert.equal(claimCalls,2);
assert.equal(claimAttemptUsed,'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'Retry after ambiguous acknowledgement must preserve the same attempt UUID');
assert.equal(payload.refundWorkQueue[0].status,'in_review');
assert.match(ctx.page(),/Análise assumida e registrada/);
assert.match(ctx.page(),/Nenhum valor foi devolvido ou quitado/);
assert.doesNotMatch(ctx.page(),/Assumir análise auditada/,
 'An already claimed case must not offer another claim button');
assert.match(ctx.page(),/Revisar descontos e revenda/);
assert.doesNotMatch(ctx.page(),/Exigir prova do provedor/);
await ctx.refundTriage('provider_refund_proof_pending');
assert.equal(triageCalls,0,'Previously used coupon cannot get provider-only triage');
triagePayload={ok:true,source:'clube_coupon_refund_triage_v1_866',
 invoiceId:inspectPayload.invoiceId,requestId:inspectPayload.requestId,
 auditId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 decision:'merchant_history_review',historicalOrderCount:2,
 recordedAt:'2026-11-06T22:50:01Z',replayed:false,
 readbackVerified:false,moneyMoved:false,providerRefundVerified:false,caseClosed:false};
await ctx.refundTriage('merchant_history_review');
assert.equal(triageCalls,1);
assert.match(ctx.page(),/triagem não foi confirmada pelo histórico financeiro/);
assert.equal(inspectPayload.triageDecision,null);
triagePayload.readbackVerified=true;
await ctx.refundTriage('merchant_history_review');
assert.equal(triageCalls,2);
assert.equal(triageAttemptUsed,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 'An ambiguous triage retry must reuse the same UUID');
assert.match(ctx.page(),/Classificação registrada/);
assert.match(ctx.page(),/Histórico de descontos e obrigações da revenda em análise/);
assert.match(ctx.page(),/O caso permanece aberto/);
assert.doesNotMatch(ctx.page(),/Revisar descontos e revenda<\/button>/);

await ctx.refundInspect(inspectPayload.invoiceId,inspectPayload.requestId);
assert.match(ctx.page(),/Conferir estorno no Mercado Pago/);
providerPayload={ok:true,source:'clube_coupon_refund_provider_get_v1_867',
 invoiceId:inspectPayload.invoiceId,requestId:inspectPayload.requestId,
 caseStatus:'in_review',invoiceStatus:'paid',readOnly:true,
 providerQuerySucceeded:true,providerOrderBound:true,
 providerRefundVerified:true,providerRefundReason:'PROVIDER_FULL_REFUND_CONFIRMED',
 refundAmountCents:890,refundTransactionCount:1,
 historicalOrderCount:2,merchantHistoryRequiresReview:true,
 merchantSettlementVerified:false,refundClosureAuthorized:false,
 caseClosed:false,moneyMoved:false,providerMutationPerformed:false,
 checkedAt:'2026-11-06T23:55:00Z'};
await ctx.providerInspect(inspectPayload.invoiceId,inspectPayload.requestId);
assert.equal(providerCalls,1);
assert.match(ctx.page(),/Mercado Pago indica estorno integral processado/);
assert.match(ctx.page(),/obrigações da revenda não conciliadas/);
assert.match(ctx.page(),/Não comprova crédito bancário ao comprador/);
assert.match(ctx.page(),/não permite encerrar o protocolo/);
providerPayload={...providerPayload,refundClosureAuthorized:true};
await ctx.providerInspect(inspectPayload.invoiceId,inspectPayload.requestId);
assert.equal(providerCalls,2);
assert.match(ctx.page(),/não retornou comprovação financeira consistente/);
assert.doesNotMatch(ctx.page(),/Mercado Pago indica estorno integral processado/,
 'Provider output claiming authorization to close must be discarded');

assert.match(ctx.page(),/Conferir histórico de descontos e revendas/);
historyPayload={
 ok:true,source:'clube_coupon_merchant_history_v1_868',
 invoiceId:inspectPayload.invoiceId,requestId:inspectPayload.requestId,
 caseStatus:'in_review',invoiceStatus:'paid',readOnly:true,
 historyCoverage:'bounded_complete',fundingModel:'partner_funded',
 applicationCount:2,partnerUseCount:2,returnCount:1,historicalDiscountCents:1000,
 uniqueVoucherCount:2,uniqueVoucherFaceCents:1000,historicalReusedDiscountCents:0,
 walletReturnPairCount:1,walletReturnNetCents:0,walletReturnNeutralized:true,
 cashbackReleaseCount:1,cashbackReleaseCoverage:'bounded_complete',
 unmatchedCashbackReleaseCount:0,
 quarantineHoldCoverage:'bounded_complete',quarantineHoldCount:1,
 unmatchedQuarantineHoldCount:0,otherCashbackReserveCount:1,
 couponSeedCoverage:'bounded_complete',couponSeedCount:2,
 unmatchedCouponSeedCount:0,
 canonicalSeedCoverage:'bounded_complete',canonicalSeedCount:2,
 unmatchedCanonicalSeedCount:0,
 invoicePaymentProvenance:'bounded_complete',verifiedPaymentSeedCount:2,
 nominalDiscountNotPayableDebt:true,merchantPayoutVerified:false,
 bankCreditVerified:false,refundClosureAuthorized:false,
 caseClosed:false,moneyMoved:false,checkedAt:'2026-11-06T23:56:00Z',
 entries:[
  {orderId:'11111111-1111-4111-8111-111111111111',
   voucherId:'55555555-5555-4555-8555-555555555555',merchantId:'33333333-3333-4333-8333-333333333333',
   discountCents:500,originalOrderCents:9500,orderStatus:'cancelled',
   financialState:'reversed',partnerUseRecorded:true,returnRecorded:true,
   walletReturnNeutralized:true,
   returnDisposition:'reissued',contractFeeBps:900},
  {orderId:'22222222-2222-4222-8222-222222222222',
   voucherId:'66666666-6666-4666-8666-666666666666',merchantId:'44444444-4444-4444-8444-444444444444',
   discountCents:500,originalOrderCents:9500,orderStatus:'delivered',
   financialState:'settlement_pending',partnerUseRecorded:true,returnRecorded:false,
   walletReturnNeutralized:false,
   returnDisposition:null,contractFeeBps:900}
 ]
};
await ctx.merchantHistoryInspect(inspectPayload.invoiceId,inspectPayload.requestId);
assert.equal(historyCalls,1);
assert.match(ctx.page(),/Histórico financeiro dos descontos/);
assert.match(ctx.page(),/R\$ 10.00 em 2 pedido/);
assert.match(ctx.page(),/Este valor não é dívida líquida apurada/);
assert.match(ctx.page(),/Devoluções de benefícios registradas: 1/);
assert.match(ctx.page(),/Contrapartidas de carteira conferidas:/);
assert.match(ctx.page(),/Essa conferência interna não comprova crédito bancário/);
assert.match(ctx.page(),/créditos adicionais não conciliados: 0/);
assert.match(ctx.page(),/reservas de quarentena não conciliadas: 0/);
assert.match(ctx.page(),/outras reservas de cashback nos pedidos: 1/i);
assert.match(ctx.page(),/Cupons distintos utilizados/);
assert.match(ctx.page(),/Reutilizações históricas após devolução: R\$ 0.00/);
assert.match(ctx.page(),/A baixa e o encerramento permanecem bloqueados/);
historyPayload={...historyPayload,merchantPayoutVerified:true};
await ctx.merchantHistoryInspect(inspectPayload.invoiceId,inspectPayload.requestId);
assert.equal(historyCalls,2);
assert.match(ctx.page(),/O histórico não foi confirmado de forma consistente/);
assert.doesNotMatch(ctx.page(),/Este valor não é dívida líquida apurada/,
 'Provider claim of merchant payment must invalidate the whole report');




assert.doesNotMatch(ctx.page(),/merchant-access-token|@example\.invalid/,
 'Finance queue must not reveal provider secrets or buyer emails');

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
payload.refundWorkQueueCoverage='partial';
await ctx.query();
assert.match(ctx.page(),/Há outros protocolos a conferir/,
 'Truncated refund queue must warn about missing older cases');
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
assert.doesNotMatch(ctx.page(),/Fatura 66666666/,
 'A refund request from another admin session cannot remain in the view');
assert.doesNotMatch(ctx.page(),/Detalhamento financeiro/,
 'Case evidence cannot be retained after account swap');
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
payoutPayload={...payoutPayload,
 recipientReadiness:{legalDocumentOnFile:true,merchantProviderAccountPresent:true,
  merchantProviderAccountConnected:true,payoutRecipientVerified:false,
  independentBankCreditVerified:false,eligibleForFinancialWrite:false,
  blockingReasons:['COUPON_PAYOUT_BENEFICIARY_IDENTITY_REQUIRED']}};
await ctx.payoutQuery();
assert.match(ctx.mpPage(),/CNPJ cadastrado: sim/);
assert.match(ctx.mpPage(),/Conta Mercado Pago conectada\/validada: sim/);
assert.match(ctx.mpPage(),/não prova destinatário do Pix/);
assert.match(ctx.mpPage(),/Quitação externa NÃO comprovada/);
payoutPayload={...payoutPayload,
 recipientReadiness:{...payoutPayload.recipientReadiness,payoutRecipientVerified:true}};
await ctx.payoutQuery();
assert.match(ctx.mpPage(),/sem garantias financeiras/,
 'forged recipient verification may never be accepted by Admin');
assert.doesNotMatch(ctx.mpPage(),/mercadopago-access-token/i,
 'do not leak PSP secrets');

// Reimbursement rows show the real coupon origin, not a generic fake Paid
// button. Missing status intentionally fails closed for stale Admin state.
const reimbursementUiFrom=admin.indexOf('function adminReimbursementRow(x){');
const reimbursementUiTo=admin.indexOf('function adminAdjustmentRow(x){',reimbursementUiFrom);
assert.ok(reimbursementUiFrom>0&&reimbursementUiTo>reimbursementUiFrom);
const reimbursementCtx=vm.createContext({
  esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
  adminMerchantName:()=> 'Revenda de teste',
  adminMoney:cents=>'R$ '+(cents/100).toFixed(2)
});
new vm.Script(admin.slice(reimbursementUiFrom,reimbursementUiTo)+
 ';this.item=adminReimbursementRow;', {filename:'admin-reimbursement-ui.js'}).runInContext(reimbursementCtx);
const sampleReimbursement={order_id:'11111111-1111-4111-8111-111111111111',
 merchant_id:'22222222-2222-4222-8222-222222222222',cashback_cents:500};
const couponPendingHtml=reimbursementCtx.item({...sampleReimbursement,couponBacked:true});
assert.match(couponPendingHtml,/aguardando identidade do recebedor e crédito bancário comprovado/);
assert.doesNotMatch(couponPendingHtml,/onclick="adminFinancial/);
assert.doesNotMatch(reimbursementCtx.item(sampleReimbursement),/onclick="adminFinancial/,
 'missing backend classification must not re-enable a paid action');
const legacyHtml=reimbursementCtx.item({...sampleReimbursement,couponBacked:false});
assert.match(legacyHtml,/Registrar quitação/);
assert.match(legacyHtml,/onclick="adminFinancial/);
const originBlock=edge.slice(edge.indexOf('const openReimbursementOrderIds='),
 edge.indexOf('const currentAdmin=',edge.indexOf('const openReimbursementOrderIds=')));
assert.match(originBlock,/clube_coupon_paid_order_applications/);
assert.match(originBlock,/COUPON_REIMBURSEMENT_CLASSIFICATION_UNAVAILABLE/);
assert.match(edge,/couponBacked:couponReimbursementOrders\.has\(String\(row\.order_id\)\)/,
 'backend must derive coupon origin from canonical finance facts');
const tableGuard=read('supabase/migrations/20261025143000_coupon_reimbursement_status_table_guard.sql');
assert.match(tableGuard,/create or replace function public\.validate_cashback_reimbursement_fact\(\)/i);
assert.match(tableGuard,/new\.status in \('paid','offset'\)/);
assert.match(tableGuard,/clube_coupon_paid_order_applications/);
assert.match(tableGuard,/COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED/);
assert.match(tableGuard,/before insert or update of order_id,merchant_id,cashback_cents,due_at,status,paid_at,offset_at/);

console.log('PASS: finance Admin checked net evidence, shortfall, danger, migration mismatch, read-only MP releases account isolation and merchant payout segregation.');
