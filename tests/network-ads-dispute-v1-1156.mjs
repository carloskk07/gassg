import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261122232026_network_ads_dispute_hold_v1_1156.sql');
const test=read('tests/sql/network-ads-pool-v1-1154.sql');
const admin=read('js/admin.js');
for(const needle of [
"elsif not v_safe then","state='pending',matured_at=null",
"ads_hold_reason='FINANCIAL_REVIEW'","old.state='eligible' and new.state='pending'",
"network_fee_payout_reservations_v1_1031","network_manual_payout_requests_v1_1034",
"network_fee_package_offsets_v1_1032","network_payout_jobs_v1_1033",
"network_ads_pool_dispute_guard_trg_v1_1156",
"where state='pending' and ads_hold_reason='FINANCIAL_REVIEW'",
"'heldForReview',held_count","'heldMicrocents',held_amount"
])assert.ok(sql.includes(needle),'Missing dispute protection: '+needle);
for(const needle of [
'ADS_DISPUTE_DID_NOT_SUSPEND_MATURED_FUNDS',
'ADS_DISPUTED_AMOUNTS_NOT_VISIBLE_IN_ADMIN',
'ADS_DISPUTE_RESOLUTION_OR_ANTIREPLAY_FAILED',
'ADS_REFUND_REVERSAL_NOT_CONSERVED','rollback;'
])assert.ok(test.includes(needle),'Missing isolated proof: '+needle);
assert.match(admin,/Bloqueado por contestação/);
assert.match(admin,/Number\(x\.heldForReview\)/);
assert.match(admin,/Number\(x\.heldMicrocents\)/);
assert.match(read('.github/workflows/audit.yml'),/network-ads-dispute-v1-1156\.mjs/);
assert.match(read('.github/workflows/isolated-supabase-integration.yml'),/--file=tests\/sql\/network-ads-pool-v1-1154\.sql/);
console.log('V1.1156 PASS — Ads frozen/refund review drops eligible state, puts reservations under review, preserves NET proof and no Pix');
