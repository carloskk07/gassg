import assert from 'node:assert/strict';
import fs from 'node:fs';

// Instrumentation gate, NOT commercial certification. Every canonical
// technical journey below must stay attached to a recurring PR/daily CI.
// Existing scenarios execute in the underlying workflows; this guard only
// prevents silent deletion or detachment of critical verification.
const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const audit=read('.github/workflows/audit.yml');
const isolated=read('.github/workflows/isolated-supabase-integration.yml');
const gates={
 '2_cupons':[
  ['audit','tests/clube-coupon-purchase-click-journey.mjs',
   'consent, double click, same Pix resume and account segregation'],
  ['isolated','tests/isolated-supabase-coupon-full-schema.mjs',
   'SQL-backed coupon, delivery, refund and merchant reimbursement'],
  ['isolated','tests/isolated-supabase-coupon-refund-v1-814.mjs',
   'owned refund and frozen voucher'],
  ['isolated','tests/isolated-clube-sponsored-redemption-v1-956.mjs',
   'independent owner-sponsored benefit']
 ],
 '3_financeiro':[
  ['isolated','tests/isolated-payment-entitlement-readback.mjs',
   'provider-to-benefit readback'],
  ['isolated','tests/isolated-ads-independent-full-cycle-v1-955.mjs',
   'independent advertising PSP lifecycle'],
  ['isolated','tests/isolated-mobility-fee-pix-v1-837.mjs',
   'mobility fee Pix and reversal'],
  ['isolated','tests/isolated-referral-payout-lifecycle.mjs',
   'report/void without external bank transfer']
 ],
 '4_pedidos':[
  ['isolated','tests/isolated-supabase-positive-checkout.mjs',
   'real authenticated order, browser and delivery'],
  ['isolated','tests/isolated-supabase-coupon-full-schema.mjs',
   'paid-coupon cash-on-delivery guards'],
  ['isolated','tests/isolated-support-positive-journey.mjs',
   'customer support linked to an actual local order']
 ],
 '6_revendas':[
  ['isolated','tests/isolated-supabase-positive-checkout.mjs',
   'merchant identity, compliance and real offer checkout'],
  ['isolated','tests/isolated-commercial-activation-evidence.mjs',
   'no supply means no premature commercial activation'],
  ['isolated','tests/isolated-merchant-prepaid-lifecycle-v1-953.mjs',
   'merchant plan and fee lifecycle']
 ],
 '12_rede':[
  ['isolated','tests/isolated-supabase-positive-checkout.mjs',
   'qualified referral and visible buyer/partner/admin journeys'],
  ['isolated','tests/isolated-referral-payout-lifecycle.mjs',
   'referral accounting, reversal and fake external claim'],
  ['audit','tests/growth-referral-review-v1-230.mjs',
   'referral review permissions']
 ]
};
const catalog={audit,isolated};
assert.match(isolated,/pull_request:/,
 'isolated technical test must run on PR');
assert.match(isolated,/schedule:/,
 'isolated technical regression must run periodically');
assert.match(isolated,/SUPABASE_ACCESS_TOKEN:\s*''/,
 'disposable CI cannot authenticate against commercial Supabase');
assert.match(isolated,/SUPABASE_DB_PASSWORD:\s*''/,
 'disposable CI cannot receive commercial database password');
assert.match(audit,/pull_request:/,
 'unit/UI audit must execute for PRs');
const all=[];
for(const [front,scenarios] of Object.entries(gates)){
 assert.ok(scenarios.length>=3,'front must have multiple independent gates: '+front);
 for(const [workflow,path,scope] of scenarios){
  assert.ok(fs.existsSync(new URL(path,root)),
   'required real test missing for '+front+': '+path);
  assert.ok(catalog[workflow].includes('run: node '+path),
   'required test not wired to '+workflow+' CI for '+front+': '+path);
  assert.ok(scope.length>12);
  all.push({front,workflow,path,scope});
 }
}
assert.equal(Object.keys(gates).length,5);
console.log('PASS: five technical fronts retain '+all.length+
 ' mandatory CI hooks; PR/daily isolation verified. Actual business acceptance still requires independent real-world proof.');
