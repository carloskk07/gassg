import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261105201500_merchant_benefits_live_scope_v1_844.sql');
const contract=read('supabase/migrations/20261105181000_merchant_benefits_contract_v1_842.sql');
const ui=read('js/merchant-benefits-contract.js');
const ops=read('supabase/functions/merchant-ops/index.ts');

assert.match(migration,/CREATE OR REPLACE FUNCTION public\.merchant_benefits_contract_v1_842/);
assert.match(migration,/PARTNER_WELCOME_IMPLEMENTATION_REQUIRED/);
for(const [field,expected] of [
 ['productWelcomeCheckoutEnabled',true],
 ['productWelcomeFeeReductionEnabled',true],
 ['productWelcomeOnlyWhenApplied',true],
 ['partnerFundedPaidCouponsEnabled',false],
 ['partnerFundedOtherCashbackEnabled',false],
 ['legacyCouponRightsPreserved',true],
 ['checkoutBenefitsEnabled',false],
 ['feeReductionEnabled',false]
]){
 assert.ok(migration.includes("'"+field+"',"+expected),
  'Migrate verified capability independently: '+field);
 assert.ok(ops.includes('data.'+field+'!=='+expected),
  'Edge must reject contradictory scope: '+field);
 assert.ok(field==='legacyCouponRightsPreserved'||field==='checkoutBenefitsEnabled'||field==='feeReductionEnabled'||
  ui.includes('value.'+field+'==='+expected)||field==='productWelcomeOnlyWhenApplied'&&ui.includes('info?.'+field+'===true'),
  'UI must verify capability: '+field);
}
assert.match(ui,/Cupons pagos e cashback anterior preservam seus direitos/);
assert.match(ui,/8% vale só para o pedido/);
assert.doesNotMatch(ui,/Descontos e taxa menor ainda não foram ativados/);
assert.match(contract,/p_operation='revoke'/);
assert.doesNotMatch(migration,/\b(?:update|delete|truncate)\s+public\.(?:orders|wallet_entries|merchant_billing_plans|clube_coupon_paid_order_applications|merchant_cashback_reimbursements)\b/i);
assert.doesNotMatch(migration,/\bcreate\s+table\b/i);
// The existing contract RPC MUST still persist/revoke consent; it may update
// participation and audit tables, but this PR may not mutate money or orders.
assert.match(migration,/update public\.merchant_benefit_participations_v1_842/);
assert.match(migration,/revoke all on function public\.merchant_benefits_contract_v1_842/);
assert.match(migration,/to service_role/);
console.log('TAMÃO #844: readback scope product-only, no legacy coupon conversion or financial writes.');
