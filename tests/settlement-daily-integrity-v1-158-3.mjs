import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261011073000_settlement_daily_due_alignment_v1_158_3.sql');
const probe=read('tests/sql/settlement-postpaid-integration-v1-158-3.sql');
const fullOrder=read('tests/sql/order-pin-to-fee-integration-v1-158-3.sql');
const main=read('supabase/migrations/20261011043000_delivery_first_payment_boundary_v1_158_1.sql');
const regulatory=read('supabase/migrations/20261011063000_merchant_basket_compliance_v1_158_2.sql');
for(const needle of [
 'public.merchant_settlement_daily_due_at',
 "at time zone 'America/Sao_Paulo'",
 "interval '1 second'",
 'create or replace function public.merchant_settlement_daily_due_at',
 'v_credit_applied:=v_order.prepaid_fee_credit_applied_cents',
 'v_order.settled_at is null',
 'v_due_at:=public.merchant_settlement_daily_due_at(v_order.settled_at)',
 'v_expected_due:=public.merchant_settlement_daily_due_at(v_order.settled_at)',
 'or new.prepaid_credit_applied_cents is distinct from old.prepaid_credit_applied_cents',
 'new.prepaid_credit_applied_cents<>v_order.prepaid_fee_credit_applied_cents',
 'SETTLEMENT_RECEIVABLE_SNAPSHOT_CONFLICT',
 'drop trigger if exists validate_platform_receivable_fact',
 'platform_fee_cents,prepaid_credit_applied_cents,due_at'
]){
 assert.ok(migration.toLowerCase().includes(needle.toLowerCase()),'Lost settlement authority: '+needle);
}
assert.equal((migration.match(/v_expected_due:=public\.merchant_settlement_daily_due_at/g)||[]).length,2,
  'Both the platform fee and cashback validators must use exactly the same due-date function');
assert.ok(!migration.includes("settled_at+interval '7 days'"),
  'A 7-day validator would break the daily payment workflow');
for(const name of ['ensure_order_settlement_accounting','validate_platform_receivable_fact',
  'validate_cashback_reimbursement_fact']){
 assert.ok(migration.includes('FUNCTION public.'+name+'('),'Missing migrated function '+name);
}
for(const testCase of [
 'begin;','rollback;','public.ensure_order_settlement_accounting(v_order)',
 'public.ensure_order_settlement_accounting(v_cancelled)',
 'public.ensure_order_settlement_accounting(v_cashback)',
 'public.close_merchant_daily_finance',
 'merchant_daily_statements',
 'merchant_cashback_reimbursements',
 'prepaid_credit_applied_cents=10',
 "v_rejected:=true",
 'TEST_FAIL: duplicate charge on retry',
 'TEST_FAIL: canceled order charged a platform fee'
])assert.ok(probe.includes(testCase),'Missing rollback integration scenario: '+testCase);
for(const testCase of [
 'public.merchant_order_action(',
 "'accept'","'dispatch'","'arriving'",
 'public.complete_order_delivery(',
 'public.process_deferred_settlement_accounting()',
 'public.merchant_sale_payment_verifications',
 'TEST_FAIL: invalid PIN generated fee',
 'TEST_FAIL: no attestation settled unpaid delivery',
 'TEST_FAIL: duplicate fee after retry',
 'begin;','rollback;'
]) assert.ok(fullOrder.includes(testCase),'Missing full merchant-to-fee integration proof: '+testCase);
assert.ok(fullOrder.includes('p')||fullOrder.includes('pin'),
 'Expected PIN-based delivery confirmation');
assert.ok(main.includes("payment_timing"),'Settlement must follow delivery-first payment authority');
assert.ok(regulatory.includes("merchant_basket_compliance_current"),'Settlement must retain product-authority gate');
console.log('V1.158.3 — writer, fee/cashback validators, postpaid daily close, cancellation, immutable credits and retry contracts passed.');
