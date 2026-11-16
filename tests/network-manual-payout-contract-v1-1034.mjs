import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261116050000_network_manual_payout_3days_v1_1034.sql');
const integrated=read('tests/sql/network-manual-payout-3days-v1-1034.sql');
const edge=read('supabase/functions/network-payout-ops/index.ts');
const client=read('js/growth.js');
const admin=read('js/admin-network-payout.js');
const audit=read('.github/workflows/audit.yml');
const ci=read('.github/workflows/isolated-supabase-integration.yml');
const pgFns=[
  'network_manual_payout_policy_set_v1_1034',
  'network_manual_payout_status_v1_1034',
  'network_manual_payout_request_v1_1034',
  'network_manual_payout_queue_v1_1034',
  'network_manual_payout_approve_v1_1034',
  'network_manual_payout_mark_paid_v1_1034',
  'network_manual_payout_cancel_v1_1034',
  'network_manual_payout_job_guard_v1_1034',
  'network_manual_payout_reservation_guard_v1_1034',
  'network_manual_payout_source_reversal_v1_1034'
];
for(const key of pgFns)assert.ok(migration.includes(key),'missing SQL '+key);
for(const phrase of [
  'minimum_cents bigint check(minimum_cents between 100 and 10000000)',
  'payment_days integer not null default 3 check(payment_days=3)',
  'state in(\'requested\',\'approved\',\'review\')',
  "v_min is null",
  'pg_advisory_xact_lock',
  "'network-payout-user:'||p_user::text",
  'network_fee_payout_allocations_v1_1031',
  'network_fee_package_offset_allocations_v1_1032',
  'floor(v_total::numeric/1000000)',
  "state='approved'",
  "state='paid'",
  "due_at=v_at+interval '3 days'",
  "p_confirm is distinct from 'CONFERI PIX EXTERNO E DESTINATARIO'",
  "v.recipient_pix_hash is distinct from p_expected_pix_hash",
  "p_receipt_sha256",
  "bank_reference text unique",
  "MANUAL_PAYOUT_CANNOT_CANCEL_AFTER_APPROVAL",
  "MANUAL_PAYOUT_RESERVATION_EXCLUSIVE",
  "MANUAL_PAYOUT_RESERVATION_LOCKED",
  "MANUAL_PAYOUT_REVERSED_NOT_HELD" // present in SQL test
].filter(x=>x!=='MANUAL_PAYOUT_REVERSED_NOT_HELD'))
 assert.ok(migration.includes(phrase),'missing safety '+phrase);
assert.ok(migration.includes('from public,anon,authenticated,service_role'));
assert.ok(migration.includes('to service_role'));
assert.doesNotMatch(migration,/grant\s+execute[^;]*to\s+(?:authenticated|anon)/i);
for(const phrase of [
  'rollback;','MANUAL_PAYOUT_ACL_PUBLIC',
  'MANUAL_PAYOUT_POLICY_FAIL_CLOSED',
  'MANUAL_PAYOUT_OWNER_ONLY',
  'MANUAL_PAYOUT_THRESHOLD_NOT_VALIDATED',
  'MANUAL_PAYOUT_IDEMPOTENCY',
  'MANUAL_PAYOUT_DOUBLE_PAID',
  'MANUAL_PAYOUT_APPROVED_WITHOUT_IDENTITY',
  'MANUAL_PAYOUT_AUTOMATED_DOUBLE_DISPATCH_ALLOWED',
  'MANUAL_PAYOUT_SLA_NOT_72_HOURS',
  'MANUAL_PAYOUT_LEGACY_CANCEL_BYPASS',
  'MANUAL_PAYOUT_RECIPIENT_MISMATCH',
  'MANUAL_PAYOUT_REVERSED_NOT_HELD'
])assert.ok(integrated.includes(phrase),'missing SQL regression '+phrase);
for(const phrase of [
  'manual-status','manual-request','manual-queue','manual-set-minimum',
  'manual-approve','manual-paid','manual-cancel',
  'network_manual_payout_status_v1_1034',
  'network_manual_payout_request_v1_1034',
  'network_manual_payout_mark_paid_v1_1034',
  'p_user:user','p_actor:user','manualOnly!==true',
  'data?.moneyMoved!==false','data?.providerApiCalled!==false'
])assert.ok(edge.includes(phrase),'missing Edge action '+phrase);
assert.ok(edge.indexOf('if(action==="manual-request")')<
  edge.indexOf('permission.admin_role!=="superadmin"'),
  'Self-request must be user-scoped and separate from Admin-only actions');
assert.ok(edge.includes('await actor(req)'));
assert.ok(edge.includes('enforceApiQuota(admin'));
for(const phrase of [
  'tamaoManualPayoutInvoke','tamaoManualPayoutRequest','tamaoManualPayoutRefresh',
  'tamaoNetworkManualPayoutPanel','liveAccessToken()',
  'network-payout-ops','3 dias corridos','manual-request',
  'automaticPayouts!==false','tamaoNetworkManualPayoutPanel()'
])assert.ok(client.includes(phrase),'missing user journey '+phrase);
for(const phrase of [
 'adminNetworkManualPayoutPanel','adminNetworkManualPayoutApprove',
 'adminNetworkManualPayoutCancel','adminNetworkManualPayoutMarkPaid',
 'adminNetworkManualPayoutMinimum','adminNetworkManualPayoutRefresh',
 'manual-payout-minimum','CONFERI PIX EXTERNO E DESTINATARIO',
 'state===\'approved\'','paymentDays!==3',
 'globalThis.adminNetworkPayoutPanel=adminNetworkManualPayoutPanel'
])assert.ok(admin.includes(phrase),'missing Admin manual queue '+phrase);
new vm.Script(client,{filename:'growth.js'});
new vm.Script(admin,{filename:'admin-network-payout.js'});
assert.ok(audit.includes('node tests/network-manual-payout-contract-v1-1034.mjs'));
assert.ok(ci.includes('tests/sql/network-manual-payout-3days-v1-1034.sql'));
console.log('PASS V1.1034 manual only, configurable minimum, 3-calendar-day approval SLA, privacy, immutable source-backed reservations, admin proof and no outgoing PSP');
