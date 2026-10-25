import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('supabase/functions/admin-ops/coupon-merchant-payout-evidence.js');
const {couponMerchantPayoutEvidence}=await import(
 'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const admin=read('supabase/functions/admin-ops/index.ts');
const audit=read('.github/workflows/audit.yml');
const id='11111111-1111-4111-8111-111111111111';
const merchant='22222222-2222-4222-8222-222222222222';
const base={
 payoutId:'POP01KKYN1QY2SS1MKAY4KP6SSRCT',
 transactionId:'TOP01KKYN1QY2SS1MKAY4G9DV5NK9',
 order:{id,merchant_id:merchant,status:'SETTLED',financial_state:'settled',
  financial_reversed_at:null,cashback_reserved_cents:700},
 application:{order_id:id,invoice_id:'33333333-3333-4333-8333-333333333333',
  quoted_merchant_id:merchant,face_cents:500},
 invoice:{id:'33333333-3333-4333-8333-333333333333',
  status:'paid',net_proceeds_verified_at:'2026-10-25T03:00:00Z'},
 reimbursement:{order_id:id,merchant_id:merchant,cashback_cents:700,status:'open'},
 transaction:{id:'TOP01KKYN1QY2SS1MKAY4G9DV5NK9',external_reference:id,
  status:'success',status_detail:'accredited',amount:{value:'7.00',currency:'BRL'}}
};
const check=(overrides={})=>couponMerchantPayoutEvidence(
 {...base,...overrides});
const credited=check();
assert.equal(credited.providerTransactionAccredited,true,
 'MP success/accredited with matching order + exact BRL money is externally reported credited');
assert.equal(credited.reason,'COUPON_PAYOUT_BENEFICIARY_IDENTITY_REQUIRED',
 'Payout GET does not prove which merchant received funds');
for(const r of [credited,check({transaction:{...base.transaction,status:'approved'}})]){
 assert.equal(r.merchantBeneficiaryVerified,false);
 assert.equal(r.merchantExternalSettlementVerified,false);
 assert.equal(r.eligibleForFinancialWrite,false);
 assert.equal(r.moneyMoved,false);
 assert.equal(r.readOnly,true);
}
for(const [overrides,reason] of [
 [{transaction:{...base.transaction,status:'approved',status_detail:'approved'}},'COUPON_PAYOUT_NOT_ACCREDITED'],
 [{transaction:{...base.transaction,status:'success',status_detail:'in_progress'}},'COUPON_PAYOUT_NOT_ACCREDITED'],
 [{transaction:{...base.transaction,status:'processed',status_detail:'approved'}},'COUPON_PAYOUT_NOT_ACCREDITED'],
 [{transaction:{...base.transaction,status:'refunded',status_detail:'refunded'}},'COUPON_PAYOUT_NOT_ACCREDITED'],
 [{transaction:{...base.transaction,status:'success',status_detail:'partially_refunded'}},'COUPON_PAYOUT_NOT_ACCREDITED'],
 [{transaction:{...base.transaction,external_reference:'other-order'}},'COUPON_PAYOUT_PROVIDER_BINDING_MISMATCH'],
 [{transaction:{...base.transaction,id:'different-transaction'}},'COUPON_PAYOUT_PROVIDER_BINDING_MISMATCH'],
 [{transaction:{...base.transaction,amount:{value:'6.99',currency:'BRL'}}},'COUPON_PAYOUT_PROVIDER_BINDING_MISMATCH'],
 [{transaction:{...base.transaction,amount:{value:'7.001',currency:'BRL'}}},'COUPON_PAYOUT_PROVIDER_BINDING_MISMATCH'],
 [{transaction:{...base.transaction,amount:{value:'7e0',currency:'BRL'}}},'COUPON_PAYOUT_PROVIDER_BINDING_MISMATCH'],
 [{transaction:{...base.transaction,amount:{value:7,currency:'USD'}}},'COUPON_PAYOUT_PROVIDER_BINDING_MISMATCH'],
 [{order:{...base.order,financial_state:'reversed'}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{order:{...base.order,financial_reversed_at:'2026-10-25T05:00:00Z'}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{invoice:{...base.invoice,status:'review_required'}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{reimbursement:{...base.reimbursement,merchant_id:'other'}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{application:{...base.application,quoted_merchant_id:'other'}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{application:{...base.application,face_cents:701}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE']
]){
 const r=check(overrides);
 assert.equal(r.reason,reason,JSON.stringify(overrides));
 assert.equal(r.providerTransactionAccredited,false);
 assert.equal(r.eligibleForFinancialWrite,false);
 assert.equal(r.merchantExternalSettlementVerified,false);
}
// Assert production wiring: finance permission, GET-only PSP, rate limit,
// invoice + reimbursement + application from trusted service-role DB, and
// no override to a verified beneficiary or privileged financial write.
assert.ok(admin.includes('import {couponMerchantPayoutEvidence} from "./coupon-merchant-payout-evidence.js";'));
assert.ok(admin.includes('"clube-coupon-mp-payout-inspect"'));
const i=admin.indexOf('if(action==="clube-coupon-mp-payout-inspect"){');
const e=admin.indexOf('if(action==="clube-coupon-mp-release-inspect"||',i);
assert.ok(i>0&&e>i,'full read-only action must be reached before release report');
const action=admin.slice(i,e);
assert.match(action,/admin-coupon-mp-payout-inspect/);
assert.match(action,/limit:5,windowSeconds:600/);
assert.match(action,/method:"GET"/);
assert.match(action,/admin\.from\("clube_coupon_paid_order_applications"\)/);
assert.match(action,/admin\.from\("merchant_cashback_reimbursements"\)/);
assert.match(action,/mercadoPagoFetch\(/);
assert.doesNotMatch(action,/(?:\.rpc\(|\.insert\(|\.update\(|\.delete\(|method:"POST")/);
assert.ok(audit.includes('node tests/coupon-mp-merchant-payout-evidence.mjs'),
 'CI must not silently omit Payouts safety regression');
console.log('PASS: MP payouts GET credited status vs merchant identity separation, amounts, refunds, mismatches and read-only admin route.');
