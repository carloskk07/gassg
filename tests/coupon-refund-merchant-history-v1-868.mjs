import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('supabase/functions/admin-ops/coupon-refund-merchant-history.js');
const ctx=vm.createContext({Map,Set,Error,Number,String,Array,JSON});
new vm.Script(source.replace('export function couponRefundMerchantHistorySummary',
  'function couponRefundMerchantHistorySummary')+
  '\nthis.summarize=couponRefundMerchantHistorySummary;').runInContext(ctx);
const summarize=ctx.summarize;
const id={
 invoice:'66666666-6666-4666-8666-666666666666',
 customer:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 order:'11111111-1111-4111-8111-111111111111',
 voucher:'22222222-2222-4222-8222-222222222222',
 merchant:'33333333-3333-4333-8333-333333333333'
};
const application={
 invoice_id:id.invoice,customer_user_id:id.customer,order_id:id.order,
 voucher_id:id.voucher,quoted_merchant_id:id.merchant,face_cents:500,
 original_order_total_cents:9500,original_order_cashback_cents:500,
 applied_at:'2026-11-06T10:00:00Z'
};
const partnerUse={
 invoice_id:id.invoice,customer_id:id.customer,order_id:id.order,
 voucher_id:id.voucher,merchant_id:id.merchant,face_cents:500,
 gross_cents:10000,net_cents:9500,fee_bps_snapshot:900,
 created_at:'2026-11-06T10:00:01Z'
};
const returned={invoice_id:id.invoice,customer_id:id.customer,
 order_id:id.order,voucher_id:id.voucher,amount_cents:500,
 disposition:'reissued',cause:'order_cancelled',
 recorded_at:'2026-11-06T10:01:00Z'};
const order={id:id.order,customer_id:id.customer,merchant_id:id.merchant,
 status:'CANCELLED',financial_state:'reversed',financial_reversed_at:null};
const sample={
 invoiceId:id.invoice,customerId:id.customer,fundingMode:'partner_funded',
 applications:[application],applicationCount:1,
 partnerUses:[partnerUse],partnerUseCount:1,
 returns:[returned],returnCount:1,orders:[order]
};
const p=summarize(sample);
assert.equal(p.source,'clube_coupon_merchant_history_v1_868');
assert.equal(p.readOnly,true);
assert.equal(p.historicalDiscountCents,500);
assert.equal(p.applicationCount,1);
assert.equal(p.partnerUseCount,1);
assert.equal(p.returnCount,1);
assert.equal(p.entries[0].orderStatus,'CANCELLED');
assert.equal(p.entries[0].returnDisposition,'reissued');
assert.equal(p.nominalDiscountNotPayableDebt,true);
assert.equal(p.merchantPayoutVerified,false);
assert.equal(p.bankCreditVerified,false);
assert.equal(p.refundClosureAuthorized,false);
assert.equal(p.caseClosed,false);
assert.equal(p.moneyMoved,false);
const platform=summarize({...sample,fundingMode:'platform_reimbursed',
 partnerUses:[],partnerUseCount:0,returns:[],returnCount:0});
assert.equal(platform.historicalDiscountCents,500);
assert.equal(platform.entries[0].partnerUseRecorded,false);
assert.equal(platform.entries[0].returnRecorded,false);
const rejected=[
 {...sample,applicationCount:2},
 {...sample,applicationCount:26},
 {...sample,applications:[{...application,invoice_id:'99999999-9999-4999-8999-999999999999'}]},
 {...sample,applications:[{...application,customer_user_id:'99999999-9999-4999-8999-999999999999'}]},
 {...sample,applications:[{...application,face_cents:501}]},
 {...sample,applications:[application,application],applicationCount:2},
 {...sample,applications:[]},
 {...sample,orders:[]},
 {...sample,orders:[{...order,customer_id:'99999999-9999-4999-8999-999999999999'}]},
 {...sample,orders:[{...order,merchant_id:'99999999-9999-4999-8999-999999999999'}]},
 {...sample,partnerUses:[],partnerUseCount:0},
 {...sample,partnerUses:[{...partnerUse,merchant_id:'99999999-9999-4999-8999-999999999999'}]},
 {...sample,partnerUses:[{...partnerUse,net_cents:9501}]},
 {...sample,partnerUses:[{...partnerUse,fee_bps_snapshot:0}]},
 {...sample,returns:[{...returned,amount_cents:300}]},
 {...sample,returns:[{...returned,cause:'unverified'}]},
 {...sample,returns:[returned,returned],returnCount:2},
 {...sample,fundingMode:'unknown'},
 {...sample,fundingMode:'platform_reimbursed'},
 {...sample,partnerUses:[],partnerUseCount:0,returns:[returned],returnCount:1,fundingMode:'platform_reimbursed'}
];
for(const item of rejected)assert.throws(()=>summarize(item),
 /COUPON_REFUND_HISTORY_/, 'Incomplete or mismatched history must fail closed');

const edge=read('supabase/functions/admin-ops/index.ts');
const a=edge.indexOf('if(action==="clube-coupon-refund-merchant-history-inspect")');
const b=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',a);
assert.ok(a>0&&b>a);
const action=edge.slice(a,b);
assert.match(action,/enforceApiQuota/);
assert.match(action,/couponRefundMerchantHistorySummary/);
assert.match(action,/clube_coupon_paid_order_applications/);
assert.match(action,/clube_partner_coupon_order_uses_v1_846/);
assert.match(action,/clube_partner_coupon_returns_v1_847/);
assert.match(action,/COUPON_MERCHANT_HISTORY_CHANGED/);
assert.match(action,/JSON.stringify\(first\)!==JSON.stringify\(second\)/);
assert.match(action,/limit\(26\)/);
assert.doesNotMatch(action,/method:"POST"|mercadoPagoFetch|\.update\(|\.insert\(|clube_coupon_paid_payment_refund/,
 'Read-only history must never change bank state, voucher or merchant ledger');
const ui=read('js/admin.js');
assert.match(ui,/async function adminClubeRefundMerchantHistoryInspect\(/);
assert.match(ui,/Conferir histórico de descontos e revendas/);
assert.match(ui,/Este valor não é dívida líquida apurada/);
assert.match(ui,/A baixa e o encerramento permanecem bloqueados/);
console.log('PASS #868: immutable uses, partner sponsorship, cancellation return, immutable amounts, no false debt or settlement.');
