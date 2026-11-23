import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261116050000_network_manual_payout_3days_v1_1034.sql');
const integrated=read('tests/sql/network-manual-payout-3days-v1-1034.sql');
const edge=read('supabase/functions/network-payout-ops/index.ts');
const client=read('js/growth.js');
const deferred=read('js/growth-manual-payout.js');
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
  'network_manual_payout_request_with_terms_v1_1158',
  'network_manual_payout_mark_paid_v1_1034',
  'p_user:user','p_actor:user','manualOnly!==true',
  'data?.moneyMoved!==false','data?.providerApiCalled!==false'
])assert.ok(edge.includes(phrase),'missing Edge action '+phrase);
assert.ok(edge.indexOf('if(action==="manual-request")')<
  edge.indexOf('permission.admin_role!=="superadmin"'),
  'Self-request must be user-scoped and separate from Admin-only actions');
assert.ok(edge.includes('await actor(req)'));
const termsMigration=read('supabase/migrations/20261123015500_network_manual_terms_acceptance_v1_1158.sql');
assert.ok(termsMigration.includes('public.network_manual_payout_request_v1_1034(p_user,p_key)'),
  'V1.1158 must still reserve via unchanged V1.1034 financial checks');
assert.ok(edge.includes('body.termsAccepted!==true||body.termsReference!==expectedTerms'),
  'withdrawal must have explicit user consent matching exact published terms');
assert.ok(edge.includes('enforceApiQuota(admin'));
for(const phrase of [
  'tamaoManualPayoutInvoke','tamaoManualPayoutRequest','tamaoManualPayoutRefresh',
  'network-manual-terms-accept','termsAccepted:true','termsReference:TAMAO_NETWORK_REDEMPTION_TERMS_URL',
  'tamaoNetworkManualPayoutDetailsPanel','liveAccessToken()',
  'network-payout-ops','3 dias corridos','manual-request',
  'automaticPayouts!==false'
])assert.ok(deferred.includes(phrase),'missing deferred self-service '+phrase);
for(const phrase of [
  'tamaoManualPayoutLoad','tamaoManualPayoutScriptUrl',
  'growth-manual-payout.js','tamaoNetworkManualPayoutPanel()'
])assert.ok(client.includes(phrase),'missing lazy user journey '+phrase);
for(const phrase of [
 'adminNetworkManualPayoutPanel','adminNetworkManualPayoutApprove',
 'adminNetworkManualPayoutCancel','adminNetworkManualPayoutMarkPaid',
 'adminNetworkManualPayoutMinimum','adminNetworkManualPayoutRefresh',
 'manual-payout-minimum','CONFERI PIX EXTERNO E DESTINATARIO',
 'state===\'approved\'','paymentDays!==3',
 'globalThis.adminNetworkPayoutPanel=adminNetworkManualPayoutPanel'
])assert.ok(admin.includes(phrase),'missing Admin manual queue '+phrase);
new vm.Script(client,{filename:'growth.js'});
new vm.Script(deferred,{filename:'growth-manual-payout.js'});
new vm.Script(admin,{filename:'admin-network-payout.js'});
assert.ok(audit.includes('node tests/network-manual-payout-contract-v1-1034.mjs'));
assert.ok(ci.includes('tests/sql/network-manual-payout-3days-v1-1034.sql'));
// V1.1035: a delayed HTTP response and an idempotency key from account A
// must never update account B, nor block its own request / refresh.
assert.ok(deferred.includes('tamaoManualPayoutSession'));
assert.ok(deferred.includes('tamaoManualPayoutIsCurrent'));
let releaseOldStatus=null,releaseOldRequest=null;
let callCount=0,notices=0;
const fakeStatus=(cents)=>({
  source:'network_manual_payout_status_v1_1034',
  readOnly:true,mode:'manual',automaticPayouts:false,
  availableCents:cents,minimumCents:500,minimumConfigured:true,
  canRequest:true,accrualEnabled:true
});
const browser={
  liveRuntime:{session:{user:{id:'account-a'}}},
  liveReady:()=>true,liveAccessToken:async()=> 'synthetic-token',
  CHAMA_BACKEND:{url:'https://example.invalid',publishableKey:'test'},
  chamaFetch:async()=>{
    callCount++;
    if(callCount===1)return await new Promise(resolve=>{releaseOldStatus=resolve});
    if(callCount===3)return await new Promise(resolve=>{releaseOldRequest=resolve});
    return {ok:true,json:async()=>fakeStatus(750)};
  },
  route:()=> 'refer',render:()=>{},
  BRL:{format:(x)=>String(x)},esc:(x)=>String(x),
  document:{getElementById:(id)=>id==='network-manual-terms-accept'?{checked:true}:null},
  confirm:()=>true,toast:()=>{notices++},
  crypto:{randomUUID:()=> '4a52aead-abcd-4444-8888-0123456789ab'}
};
const box=vm.createContext(browser);
vm.runInContext(deferred,box,{filename:'growth-manual-payout.js'});
const oldRefresh=vm.runInContext('tamaoManualPayoutRefresh()',box);
for(let k=0;k<20&&!releaseOldStatus;k++)await Promise.resolve();
assert.ok(releaseOldStatus,'old user read must be pending');
vm.runInContext("tamaoManualWithdrawal.key='KEY-OF-ACCOUNT-A'",box);
browser.liveRuntime.session.user.id='account-b';
vm.runInContext('tamaoNetworkManualPayoutDetailsPanel()',box);
let state=vm.runInContext('tamaoManualWithdrawal',box);
assert.equal(state.userId,'account-b');
assert.equal(state.key,null,'idempotency key must not migrate between accounts');
assert.equal(state.pending,false,'prior request must not block new user');
const newRefresh=vm.runInContext('tamaoManualPayoutRefresh()',box);
await newRefresh;
releaseOldStatus({ok:true,json:async()=>fakeStatus(9999)});
await oldRefresh;
state=vm.runInContext('tamaoManualWithdrawal',box);
assert.equal(state.userId,'account-b');
assert.equal(state.status.availableCents,750,'old response must not overwrite new balance');
assert.equal(state.error,null,'old error must not leak to new user');
assert.equal(state.pending,false);
const oldRequest=vm.runInContext('tamaoManualPayoutRequest()',box);
for(let k=0;k<20&&!releaseOldRequest;k++)await Promise.resolve();
assert.ok(releaseOldRequest,'old user withdrawal POST must be pending');
browser.liveRuntime.session.user.id='account-c';
vm.runInContext('tamaoNetworkManualPayoutDetailsPanel()',box);
releaseOldRequest({ok:true,json:async()=>({
  source:'network_manual_request_v1_1034',state:'requested',moneyMoved:false
})});
await oldRequest;
state=vm.runInContext('tamaoManualWithdrawal',box);
assert.equal(state.userId,'account-c');
assert.equal(state.key,null);
assert.equal(state.status,null);
assert.equal(state.pending,false);
assert.equal(notices,0,'old account response must not display withdrawal success');
assert.equal(callCount,3,'session switch must never replay the financial request');

console.log('PASS V1.1034 manual only, configurable minimum, 3-calendar-day approval SLA, privacy, immutable source-backed reservations, admin proof and no outgoing PSP');
