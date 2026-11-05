import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261105214500_partner_coupon_financial_conservation_v1_846.sql');
const older=read('supabase/migrations/20261105185500_paid_coupon_welcome_compat_v1_843.sql');
const prior=read('supabase/migrations/20261105212500_merchant_future_coupon_contract_v1_845.sql');
assert.ok(sql.length>44000);
for(const needle of [
 'funding_mode_v1_846',"'platform_reimbursed'","'partner_funded'",
 "CHECK(enabled=false)",'PARTNER_COUPON_SALE_NOT_RELEASED',
 'PARTNER_COUPON_APPLICATION_PROVENANCE_INVALID',
 'clube_partner_coupon_order_uses_v1_846',
 'merchant_coupon_consents_v1_845','opted_in AND terms_version=1 FOR SHARE',
 'PARTNER_COUPON_ORDER_SNAPSHOT_IMMUTABLE',
 'PARTNER_COUPON_SETTLEMENT_PROVENANCE_INVALID',
 'PARTNER_COUPON_RECEIVABLE_BASIS_CONFLICT',
 'PARTNER_COUPON_REWARD_NOT_BACKED',
 'PARTNER_FUNDED_NO_REIMBURSEMENT',
 'PARTNER_COUPON_REIMBURSEMENT_ANOMALY',
 'PARTNER_COUPON_IDEMPOTENCY_UPDATE_FAILED',
 'v_reimbursable:=v_order.cashback_reserved_cents-v_partner_discount'
]) assert.ok(sql.includes(needle),'Missing protection '+needle);
assert.match(sql,/BEFORE INSERT ON public\.clube_coupon_paid_invoices/);
assert.match(sql,/BEFORE UPDATE OF funding_mode_v1_846,funding_terms_version_v1_846/);
assert.match(sql,/AFTER INSERT ON public\.clube_coupon_paid_order_applications/);
assert.match(sql,/BEFORE UPDATE OF merchant_id,proposed_merchant_id,gross_total_cents/);
assert.match(sql,/zzzz_clube_partner_coupon_fee_before_v1_846/);
assert.match(sql,/SET cashback_reserved_cents=cashback_reserved_cents/);
assert.doesNotMatch(sql,/UPDATE public\.orders SET\s+platform_fee_bps_snapshot=/i,
 'Only safe BEFORE trigger may alter fee snapshot; rebind guard forbids direct SET');
assert.match(sql,/v_order\.cashback_reserved_cents<>new\.face_cents/,'no mixed cashback until modeled');
assert.match(sql,/v_invoice\.status<>'paid'/);
assert.match(sql,/v_invoice\.net_proceeds_verified_at IS NULL/);
assert.match(sql,/v_coupon\.net_cents<>v_order\.total_cents/);
assert.match(sql,/CASE WHEN|case when/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.grant_order_rewards\(uuid\)/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.clube_coupon_paid_create_order/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.clube_coupon_paid_order_reconciliation/);
assert.match(older,/v_order\.cashback_reserved_cents<>v_after/);
assert.match(prior,/legacy|Cupons anteriormente vendidos/i);
assert.doesNotMatch(sql,/\bupdate public\.merchant_cashback_reimbursements\b/i,
  'Never silently close historic merchant debt');
assert.doesNotMatch(sql,/\bdelete from public\.clube_coupon_paid_order_applications\b/i);
assert.doesNotMatch(sql,/\bupdate public\.clube_coupon_paid_issuances\s+set status='void'/i,
  'No mass withdrawal of previously sold coupons');
console.log('PASS #846: immutable prospective issuer classification, signed merchant consent, fee/reward/reconciliation invariants and legacy untouched.');

// Front-end financial disclosure must never represent the partner's own
// concession as an unverified reimbursement due from TAMÃO.
const merchantApi=read('supabase/functions/merchant-orders/index.ts');
const buyerApi=read('supabase/functions/get-order/index.ts');
const disclosure=read('js/merchant-order-benefits.js');
assert.match(merchantApi,/partnerCouponByOrder\.get\(o\.id\)\?\.discount\?\?0/);
assert.match(merchantApi,/couponFundingModel:partnerCouponByOrder\.has/);
assert.match(buyerApi,/partnerCouponFundedCents:partnerCoupon\?\.face_cents\?\?0/);
assert.match(buyerApi,/PARTNER_COUPON_READBACK_MISMATCH/);
const ctx={
  BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
  esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  globalThis:{}
};
vm.runInNewContext(disclosure,ctx);
const render=ctx.globalThis.merchantOrderBenefitDisclosureImpl;
const base={grossTotalCents:2200,cashbackReservedCents:500,
 totalCents:1700,couponAppliedCents:500,partnerFundedDiscountCents:0,
 partnerCouponFundedCents:500,couponFundingModel:'partner_funded',
 partnerFeeBpsSnapshot:800};
const fundedHtml=render(base);
assert.match(fundedHtml,/Cupom pago financiado por esta revenda/);
assert.match(fundedHtml,/sem ressarcimento TAMÃO/);
assert.match(fundedHtml,/8%/);
assert.doesNotMatch(fundedHtml,/Compensação à revenda: não comprovada/);
const bad=render({...base,partnerCouponFundedCents:400});
assert.match(bad,/Origem dos benefícios inconsistente/);
const legacyHtml=render({...base,partnerCouponFundedCents:0,
 couponFundingModel:'platform_reimbursed',partnerFeeBpsSnapshot:null});
assert.match(legacyHtml,/Compensação à revenda: não comprovada/);
assert.doesNotMatch(legacyHtml,/Cupom pago financiado por esta revenda/);
console.log('PASS #846: merchant and customer readbacks, true legacy refund language, correct new coupon disclosure.');

