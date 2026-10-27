import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('supabase/functions/admin-ops/coupon-merchant-payout-evidence.js');
const {couponMerchantPayoutEvidence,couponMerchantRecipientReadiness}=await import(
 'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const admin=read('supabase/functions/admin-ops/index.ts');
const audit=read('.github/workflows/audit.yml');
const id='11111111-1111-4111-8111-111111111111';
const merchant='22222222-2222-4222-8222-222222222222';
const customer='44444444-4444-4444-8444-444444444444';
const voucherId='55555555-5555-4555-8555-555555555555';
const invoiceId='33333333-3333-4333-8333-333333333333';
const netRef='mp-release:release-report-prod.csv:payment-1';
const base={
 payoutId:'POP01KKYN1QY2SS1MKAY4KP6SSRCT',
 transactionId:'TOP01KKYN1QY2SS1MKAY4G9DV5NK9',
 order:{id,merchant_id:merchant,customer_id:customer,status:'SETTLED',
  financial_state:'settled',financial_reversed_at:null,
  gross_total_cents:1500,total_cents:800,cashback_reserved_cents:700},
 application:{order_id:id,invoice_id:invoiceId,voucher_id:voucherId,
  customer_user_id:customer,quoted_merchant_id:merchant,face_cents:500,
  original_order_cashback_cents:700,original_order_total_cents:800,
  net_proceeds_reference:netRef},
 invoice:{id:invoiceId,customer_user_id:customer,
  status:'paid',paid_at:'2026-10-25T02:00:00Z',
  provider_order_id:'ORD12345',provider_payment_id:'payment-1',
  sale_price_cents:1200,coupon_face_cents:500,coupons_per_pack:2,
  net_proceeds_cents:1100,net_proceeds_reference:netRef,
  net_proceeds_verified_at:'2026-10-25T03:00:00Z'},
 voucher:{id:voucherId,invoice_id:invoiceId,customer_user_id:customer,
  face_cents:500,status:'redeemed',redeemed_order_id:id},
 reimbursement:{order_id:id,merchant_id:merchant,cashback_cents:700,status:'open'},
 transaction:{id:'TOP01KKYN1QY2SS1MKAY4G9DV5NK9',external_reference:id,
  status:'success',status_detail:'accredited',amount:{value:'7.00',currency:'BRL'}}
};
const check=(overrides={})=>couponMerchantPayoutEvidence(
 {...base,...overrides});
// An onboarded checkout/payments account is NOT a payout beneficiary proof.
const recipientBase={
 merchant:{id:merchant,cnpj:'12345678000190'},
 account:{merchant_id:merchant,provider:'mercadopago',
  provider_account_id:'MP123456789',status:'active',connection_mode:'oauth',
  verification_level:'provider',connected_at:'2026-10-25T08:00:00Z',
  revoked_at:null,access_token_ciphertext:'NEVER-EXPOSE-ME',
  metadata:{bankAccountNumber:'NEVER-EXPOSE-ME'}}
};
const recipientOk=couponMerchantRecipientReadiness(recipientBase);
assert.equal(recipientOk.legalDocumentOnFile,true);
assert.equal(recipientOk.merchantProviderAccountPresent,true);
assert.equal(recipientOk.merchantProviderAccountConnected,true);
assert.equal(recipientOk.payoutRecipientVerified,false);
assert.equal(recipientOk.independentBankCreditVerified,false);
assert.equal(recipientOk.eligibleForFinancialWrite,false);
assert.equal(recipientOk.blockingReasons.includes('COUPON_PAYOUT_BENEFICIARY_IDENTITY_REQUIRED'),true);
assert.doesNotMatch(JSON.stringify(recipientOk),/12345678000190|MP123456789|NEVER-EXPOSE-ME/);
for(const variant of [
 {merchant:recipientBase.merchant,account:null},
 {merchant:{id:merchant,cnpj:null},account:recipientBase.account},
 {merchant:recipientBase.merchant,account:{...recipientBase.account,merchant_id:'other'}},
 {merchant:recipientBase.merchant,account:{...recipientBase.account,status:'pending'}},
 {merchant:recipientBase.merchant,account:{...recipientBase.account,verification_level:'device'}},
 {merchant:recipientBase.merchant,account:{...recipientBase.account,connection_mode:'manual'}},
 {merchant:recipientBase.merchant,account:{...recipientBase.account,revoked_at:'2026-10-25T10:00:00Z'}},
 {merchant:recipientBase.merchant,account:{...recipientBase.account,connected_at:null}}
]){
 const preflight=couponMerchantRecipientReadiness(variant);
 assert.equal(preflight.payoutRecipientVerified,false);
 assert.equal(preflight.independentBankCreditVerified,false);
 assert.equal(preflight.eligibleForFinancialWrite,false);
 if(variant.account?.status!=='active'||variant.account?.merchant_id!=='22222222-2222-4222-8222-222222222222'
    ||variant.account?.verification_level!=='provider'||variant.account?.connection_mode==='manual'
    ||variant.account?.revoked_at||!variant.account?.connected_at)
  assert.equal(preflight.merchantProviderAccountConnected,false);
}

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
 [{application:{...base.application,face_cents:701}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{application:{...base.application,customer_user_id:merchant}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{order:{...base.order,customer_id:merchant}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{invoice:{...base.invoice,customer_user_id:merchant}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{application:{...base.application,voucher_id:merchant}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{voucher:{...base.voucher,redeemed_order_id:merchant}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{voucher:{...base.voucher,status:'issued'}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{voucher:{...base.voucher,invoice_id:merchant}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{voucher:{...base.voucher,customer_user_id:merchant}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{voucher:{...base.voucher,face_cents:400}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{application:{...base.application,net_proceeds_reference:'other'}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{invoice:{...base.invoice,net_proceeds_reference:null}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{invoice:{...base.invoice,net_proceeds_cents:999}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{invoice:{...base.invoice,net_proceeds_cents:1300}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{invoice:{...base.invoice,provider_payment_id:null}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{application:{...base.application,original_order_cashback_cents:500}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE'],
 [{application:{...base.application,original_order_total_cents:801}},'COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE']
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
assert.ok(admin.includes('import {couponMerchantPayoutEvidence,couponMerchantRecipientReadiness} from "./coupon-merchant-payout-evidence.js";'));
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
assert.match(action,/admin\.from\("merchant_payment_provider_accounts"\)/);
assert.match(action,/admin\.from\("merchants"\)/);
assert.match(action,/recipientReadiness/);
assert.match(action,/admin\.from\("clube_coupon_paid_issuances"\)/,
 'payout inspection must check actual redeemed voucher');
assert.match(action,/\.eq\("id",application\.voucher_id\)\.maybeSingle\(\)/);
assert.match(action,/voucher:voucherResult\.data/);
assert.match(action,/net_proceeds_reference,original_order_cashback_cents,original_order_total_cents/);
assert.match(action,/customer_user_id,sale_price_cents,coupon_face_cents,coupons_per_pack,net_proceeds_cents/);
assert.match(action,/merchant_id,customer_id,gross_total_cents,total_cents,cashback_reserved_cents/);
assert.doesNotMatch(action,/access_token_ciphertext|refresh_token_ciphertext|credential_bundle_ciphertext|\.select\("\*"\)/,
 'payout readiness must NEVER fetch or reveal provider secrets or extra merchant fields');
assert.match(action,/mercadoPagoFetch\(/);
assert.doesNotMatch(action,/(?:\.rpc\(|\.insert\(|\.update\(|\.delete\(|method:"POST")/);
assert.ok(audit.includes('node tests/coupon-mp-merchant-payout-evidence.mjs'),
 'CI must not silently omit Payouts safety regression');
// No manual shortcut can mark a coupon-financed merchant reimbursement paid.
// Both the exposed Admin Edge and the privileged RPC must fail closed.
const settlementGuard=read('supabase/migrations/20261025130000_coupon_reimbursement_bank_proof_guard.sql');
const cashbackBranch=settlementGuard.slice(
  settlementGuard.indexOf("elsif p_kind='cashback_reimbursement' then"),
  settlementGuard.indexOf("elsif p_kind='settlement_adjustment' then")
);
assert.match(cashbackBranch,/clube_coupon_paid_order_applications/);
assert.match(cashbackBranch,/COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED/);
assert.ok(cashbackBranch.indexOf('COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED')<
 cashbackBranch.indexOf('update public.merchant_cashback_reimbursements'),
 'the bank proof guard must execute BEFORE setting cashback reimbursed as paid');
assert.match(settlementGuard,/grant execute on function public\.admin_financial_action\(uuid,text,uuid,text,text\)\s+to service_role;/);
assert.match(settlementGuard,/revoke all on function public\.admin_financial_action\(uuid,text,uuid,text,text\)\s+from public, anon, authenticated;/);
const edgeFinancial=admin.slice(
 admin.indexOf('}else if(action==="financial-action"){'),
 admin.indexOf('}else if(action==="merchant-billing-action"){')
);
assert.match(edgeFinancial,/clube_coupon_paid_order_applications/);
assert.match(edgeFinancial,/COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED/);
assert.ok(edgeFinancial.indexOf('COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED')<
 edgeFinancial.indexOf('payload={'), 'reject manual coupon paid before calling financial RPC');

console.log('PASS: MP payouts GET credited status vs merchant identity separation, amounts, refunds, mismatches and read-only admin route plus coupon manual-settlement fail-closed.');
