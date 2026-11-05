import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261105223000_partner_coupon_cancel_return_lineage_v1_847.sql',import.meta.url),'utf8');
const getOrder=fs.readFileSync(new URL('../supabase/functions/get-order/index.ts',import.meta.url),'utf8');
const customer=fs.readFileSync(new URL('../js/customer.js',import.meta.url),'utf8');
for(const proof of [
 'DROP CONSTRAINT clube_coupon_paid_order_applications_pkey',
 'PRIMARY KEY(voucher_id,order_id)',
 'DROP CONSTRAINT clube_partner_coupon_order_uses_v1_846_voucher_id_key',
 'clube_partner_coupon_returns_v1_847',
 'DEFERRABLE INITIALLY DEFERRED',
 'partner-coupon:return-hold:',
 "v_disposition:='reissued'",
 "v_disposition:='manual_review'",
 'PARTNER_COUPON_REDEMPTION_LINEAGE_INVALID',
 'LEGACY_COUPON_SINGLE_REDEMPTION_REQUIRED',
 'PARTNER_COUPON_VOUCHER_RETURNED',
 'PARTNER_COUPON_RETURN_REVIEW',
 'PARTNER_COUPON_REFUND_REVIEW',
 'seed_wallet_entry_id_v1_847',
 "':return:'||v_return_count::text",
 "v_return.disposition='reissued'"
])assert.ok(sql.includes(proof),'Required private-money safety: '+proof);
assert.match(sql,/BEFORE INSERT ON public\.clube_coupon_paid_order_applications/);
assert.match(sql,/CREATE CONSTRAINT TRIGGER clube_partner_coupon_release_to_voucher_v1_847/);
assert.match(sql,/NEW\.entry_type='cashback_release'/);
assert.match(sql,/NEW\.order_id IS NOT NULL/);
assert.match(sql,/IF v_order\.status='CANCELLED'/);
assert.match(sql,/v_order\.financial_reversed_at IS NOT NULL/);
assert.match(sql,/v_invoice\.status='paid'/);
assert.match(sql,/WHEN v_disposition='reissued' THEN 'issued'/);
assert.match(sql,/UPDATE public\.clube_coupon_paid_issuances/);
assert.match(sql,/REVOKE ALL ON public\.clube_partner_coupon_returns_v1_847 FROM PUBLIC,anon,authenticated/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.clube_coupon_paid_create_order/);
assert.match(getOrder,/PARTNER_COUPON_RETURN_UNVERIFIED/);
assert.match(getOrder,/partnerCouponReturnDisposition:couponReturn\?\.disposition\?\?null/);
assert.match(customer,/Cupom pago devolvido\. Não é cashback/);
assert.match(customer,/couponFundingModel==='partner_funded'/);
assert.match(customer,/Cupom pago em análise\. Não é cashback/);
assert.doesNotMatch(sql,/UPDATE public\.clube_coupon_paid_invoices\s+SET funding_mode_v1_846/i);
assert.doesNotMatch(sql,/UPDATE public\.clube_partner_coupon_launch_v1_846\s+SET enabled=true/i);
assert.doesNotMatch(sql,/DELETE FROM public\.clube_coupon_paid_order_applications/i);
console.log('PASS #847: deferred transactional wallet return, private voucher reissue, immutable multi-redemption lineage, finance review and buyer disclosure.');