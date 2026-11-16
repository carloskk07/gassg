import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261116012000_network_fee_payout_reservations_v1_1031.sql');
const dbtest=read('tests/sql/network-fee-payout-reservations-v1-1031.sql');
const audit=read('.github/workflows/audit.yml');
const integration=read('.github/workflows/isolated-supabase-integration.yml');
const names=[
 'network_fee_payout_reservations_v1_1031',
 'network_fee_payout_allocations_v1_1031',
 'network_fee_payout_reserve_v1_1031',
 'network_fee_payout_cancel_v1_1031',
 'network_fee_payout_status_v1_1031',
 'network_fee_payout_watch_reversal_v1_1031',
 'network_fee_payout_program_overview_v1_1031',
 'network_fee_payout_reversal_guard_v1_1031'
];
for (const name of names)assert.ok(sql.includes(name),'missing migration: '+name);
for (const term of [
 'enable row level security','from public,anon,authenticated,service_role',
 "admin_role='superadmin'",'NETWORK_PAYOUT_OWNER_ONLY',
 'NETWORK_PAYOUT_TERMS_OR_POLICY_NOT_READY',
 'NETWORK_PAYOUT_INSUFFICIENT_VALIDATED_BALANCE',
 'NETWORK_PAYOUT_IDEMPOTENCY_CONFLICT',
 'pg_advisory_xact_lock','source_id=v_award.source_id',
 "r.state<>'cancelled'", "s.state='eligible'",
 'amount_microcents bigint not null','v_needed:=p_amount_cents*1000000',
 'v_needed<>0','NETWORK_PAYOUT_RESERVATION_CONSERVATION',
 "new.state='reversed'", "state='reversal_review'",
 "'moneyMoved',false", "'payoutProviderCalled',false",
 "'bankSettlementVerified',false","'recipientVerified',false",
 "'payoutsEnabled',false"
])assert.ok(sql.includes(term),'missing protective condition: '+term);
assert.doesNotMatch(sql,/wallet_entries|POST\s+\/v1\/payouts|create\s+extension\s+dblink/i);
assert.doesNotMatch(sql,/grant execute.+(?:anon|authenticated)/i);
for (const term of [
 'rollback;','NETWORK_PAYOUT_PUBLIC_ACL_DRIFT','NETWORK_PAYOUT_ROLE_BYPASS',
 'NETWORK_PAYOUT_IDEMPOTENCY_KEY_REUSED',
 'NETWORK_PAYOUT_DUPLICATE_ALLOCATION','NETWORK_PAYOUT_CANCEL_BALANCE_MISMATCH',
 'NETWORK_PAYOUT_REVERSAL_NOT_ESCALATED','NETWORK_PAYOUT_ALLOCATION_HISTORY_DELETED'
])assert.ok(dbtest.includes(term),'missing disposable regression: '+term);
assert.ok(audit.includes('node tests/network-fee-payout-reservation-contract-v1-1031.mjs'));
assert.ok(integration.includes('network-fee-payout-reservations-v1-1031.sql'));
console.log('PASS V1.1031 reserve-only, RLS, owner, idempotency, reversal, non-bank settlement contracts');
