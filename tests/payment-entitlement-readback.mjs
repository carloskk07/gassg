import assert from 'node:assert/strict';
import {reconcilePaymentJob} from '../supabase/functions/payment-reconcile/runner.js';
import {receiptFixture} from './helpers/payment-receipt-fixture.mjs';
const evidenceTable={coupon:'clube_coupon_paid_issuances',mobility:'mobility_fee_prepaid_lots_v1_838',
 advertising:'ads_independent_payment_events_v1_886',merchant_sale:'merchant_sale_payment_verifications'};
for(const kind of Object.keys(evidenceTable)){
 const valid=receiptFixture(kind);assert.equal((await reconcilePaymentJob(valid.job,valid.deps)).outcome,'verified');
 const missing=receiptFixture(kind);missing.tables[evidenceTable[kind]]=[];
 assert.equal((await reconcilePaymentJob(missing.job,missing.deps)).outcome,'review',
  kind+': a paid row without the actual entitlement must not close recovery');
}
{
 const f=receiptFixture('coupon');f.row.status='refunded';
 for(const voucher of f.tables.clube_coupon_paid_issuances)voucher.status='void';
 assert.equal((await reconcilePaymentJob(f.job,f.deps)).outcome,'closed');
 f.tables.clube_coupon_paid_issuances[0].status='issued';
 assert.equal((await reconcilePaymentJob(f.job,f.deps)).outcome,'review',
  'a refunded invoice cannot close while a benefit remains usable');
}
const changes=[
 ['coupon',f=>f.tables.clube_coupon_paid_issuances.pop()],
 ['coupon',f=>f.tables.clube_coupon_paid_issuances[0].customer_user_id='another-owner'],
 ['coupon',f=>f.tables.clube_coupon_paid_issuances[0].face_cents=499],
 ['coupon',f=>f.tables.clube_coupon_paid_issuances[0].status='void'],
 ['coupon',f=>f.tables.clube_coupon_paid_issuances[0].ordinal=2],
 ['mobility',f=>f.tables.mobility_fee_prepaid_lots_v1_838[0].driver_id='another-driver'],
 ['mobility',f=>f.tables.mobility_fee_prepaid_lots_v1_838[0].funded_cents=999],
 ['mobility',f=>f.tables.mobility_fee_prepaid_lots_v1_838[0].status='under_review'],
 ['mobility',f=>f.tables.mobility_fee_prepaid_lots_v1_838[0].spent_cents=900],
 ['mobility',f=>f.tables.mobility_fee_pix_evidence_v1_837[0].provider_payment_id='another-payment'],
 ['advertising',f=>f.tables.ads_independent_campaigns_v1_884[0].owner_user_id='another-owner'],
 ['advertising',f=>f.tables.ads_independent_campaigns_v1_884[0].budget_cents=999],
 ['advertising',f=>f.tables.ads_independent_payment_events_v1_886[0].payment_id='another-payment'],
 ['advertising',f=>f.tables.ads_independent_payment_events_v1_886.push({...f.tables.ads_independent_payment_events_v1_886[0],provider_status:'refunded'})],
 ['merchant_sale',f=>f.tables.merchant_sale_payment_verifications[0].amount_cents=999],
 ['merchant_sale',f=>f.tables.merchant_sale_payment_verifications[0].funds_owner='platform'],
 ['merchant_sale',f=>f.tables.merchant_sale_payment_verifications[0].provider_transaction_id='another-payment'],
 ['merchant_sale',f=>f.tables.merchant_sale_payment_verifications[0].verification_level='merchant'],
 ['merchant_sale',f=>f.tables.merchant_sale_payment_verifications.push({...f.tables.merchant_sale_payment_verifications[0]})]
];
for(const [kind,change] of changes){
 const f=receiptFixture(kind);change(f);
 assert.equal((await reconcilePaymentJob(f.job,f.deps)).outcome,'review',kind+' must refuse a contradictory persisted grant');
}
{
 const f=receiptFixture('coupon');f.tables.clube_coupon_paid_issuances[0].status='redeemed';
 assert.equal((await reconcilePaymentJob(f.job,f.deps)).outcome,'verified','a used benefit is still a valid historic grant');
}
{
 const f=receiptFixture('mobility');f.row.invoice_kind='fee';
 assert.equal((await reconcilePaymentJob(f.job,f.deps)).outcome,'verified');
 f.tables.mobility_platform_fee_accruals_v1_835[0].driver_id='another-driver';
 assert.equal((await reconcilePaymentJob(f.job,f.deps)).outcome,'review','another driver cannot fund this invoice');
 f.tables.mobility_platform_fee_accruals_v1_835[0].driver_id=f.row.driver_id;
 f.tables.mobility_fee_pix_invoice_lines_v1_837[0].fee_cents=889;
 assert.equal((await reconcilePaymentJob(f.job,f.deps)).outcome,'review','the invoice must allocate its exact amount');
}
for(const kind of Object.keys(evidenceTable)){
 const f=receiptFixture(kind);f.unavailable(evidenceTable[kind]);
 await assert.rejects(reconcilePaymentJob(f.job,f.deps),/PAYMENT_ENTITLEMENT_READ_UNAVAILABLE/,
  'outage must retry; it is not a verified payment or an invented contradiction');
}
console.log('PASS: all paid families require their actual persisted entitlement before recovery can be verified.');
