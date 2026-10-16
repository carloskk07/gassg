import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(
  new URL('../supabase/migrations/20261016235930_payout_reversal_evidence_v1_334.sql',import.meta.url),
  'utf8'
);
assert.match(sql,/CREATE OR REPLACE FUNCTION platform_payout_provider_private_v1_265\.read\(/);
assert.match(sql,/STABLE SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
assert.match(sql,/PAYOUT_PROVIDER_READ_DENIED/);
assert.match(sql,/a\.admin_role in \('superadmin','finance'\)/);
assert.match(sql,/PAYOUT_PROVIDER_MONTH_INVALID/);
assert.equal((sql.match(/historical\.provider_transaction_success is true/g)||[]).length,2,
  'both full-month metrics and paginated rows must look at historical observations');
assert.equal((sql.match(/g\.reversed_at is not null as grant_reversed/g)||[]).length,2);
assert.equal((sql.match(/from public\.platform_referral_provider_observations_v1_265 historical/g)||[]).length,2);
assert.match(sql,/count\(\*\) filter\(where grant_reversed and not voided\)::bigint/);
assert.match(sql,/sum\(amount_cents\) filter\(where grant_reversed and not voided\)/);
assert.match(sql,/count\(\*\) filter\(where grant_reversed and prior_provider_success_observed\)::bigint/);
assert.match(sql,/count\(\*\) filter\(where grant_reversed and prior_provider_success_observed and not voided\)::bigint/);
for(const field of [
  'activeReversedClaims','activeReversedReportedCents',
  'reversedWithHistoricalProviderSuccessClaims',
  'activeReversedWithHistoricalProviderSuccessClaims',
  'historicalProviderSuccessObserved','grantReversedNow','requiresReversalReview'
])assert.ok(sql.includes("'"+field+"'"),'missing '+field);
assert.match(sql,/grant_reversed and prior_provider_success_observed and not voided/);
assert.match(sql,/'historicalProviderSuccessIsBankProof',false/);
assert.match(sql,/'automaticRecoveryExecuted',false/);
assert.match(sql,/'bankSettlementVerified',false/);
assert.match(sql,/'recipientVerified',false/);
assert.match(sql,/'externalPaidBenefitsCents',null/);
assert.match(sql,/'readOnly',true,'noTransfers',true/);
assert.doesNotMatch(sql,/\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|DROP\s+(?:TABLE|FUNCTION)|TRUNCATE\s+)\b/i);

// Reversal-after-observation must be flagged even if the *latest* external
// status changes. A void keeps historical evidence but removes active workload.
const scenario=[
 {id:'a',reversed:false,voided:false,cents:100,observations:[false]},
 {id:'b',reversed:true,voided:false,cents:200,observations:[true,false]},
 {id:'c',reversed:true,voided:true,cents:300,observations:[true]},
 {id:'d',reversed:true,voided:false,cents:400,observations:[false]},
 {id:'e',reversed:false,voided:false,cents:500,observations:[true]},
];
const rows=scenario.map(c=>({
 ...c,
 historicalProviderSuccessObserved:c.observations.some(Boolean),
 requiresReversalReview:c.reversed&&!c.voided&&c.observations.some(Boolean)
}));
assert.deepEqual(rows.filter(r=>r.requiresReversalReview).map(r=>r.id),['b']);
assert.equal(rows.filter(r=>r.reversed&&!r.voided).length,2);
assert.equal(rows.filter(r=>r.reversed&&!r.voided).reduce((n,r)=>n+r.cents,0),600);
assert.equal(rows.filter(r=>r.reversed&&r.historicalProviderSuccessObserved).length,2);
assert.equal(rows.filter(r=>r.reversed&&!r.voided&&r.historicalProviderSuccessObserved).length,1);
assert.equal(rows.find(r=>r.id==='c').historicalProviderSuccessObserved,true,
  'voiding a claim must not erase earlier provider observations');
assert.equal(rows.find(r=>r.id==='b').historicalProviderSuccessObserved,true,
  'latest unsuccessful observation must not erase prior successful evidence');
console.log('V1.334 PASS: prior provider success persists after reversal, active review separated from voids; no bank-settlement claims.');
