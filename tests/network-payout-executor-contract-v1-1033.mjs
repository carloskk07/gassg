import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 normalizePixCpf, assertCents, serializePayoutBody, assertCreatePayoutResponse,
 assertGetPayoutTransaction, creditCanBeAsserted
} from '../supabase/functions/_shared/network-payout-protocol.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261116020000_network_secure_payout_executor_v1_1033.sql');
const pg=read('tests/sql/network-payout-execution-v1-1033.sql');
const edge=read('supabase/functions/network-payout-ops/index.ts');
const admin=read('js/admin.js');
const ui=read('js/admin-network-payout.js');
const acquisition=read('js/admin-acquisition.js');
const audit=read('.github/workflows/audit.yml');
const integration=read('.github/workflows/isolated-supabase-integration.yml');

const cpf='11144477735';
const ref='TAMAONET'+'A'.repeat(32);
assert.equal(normalizePixCpf('111.444.777-35'),cpf);
for(const bad of ['00000000000','11144477736','invalid','','111444777350','12345678900']){
 assert.throws(()=>normalizePixCpf(bad),/PAYOUT_PIX_CPF_INVALID/);
}
for(const bad of [0,1,99,10000001,Infinity,NaN,100.99,'100']){
 assert.throws(()=>assertCents(bad),/PAYOUT_CENTS_OUT_OF_RANGE/);
}
const payload=JSON.parse(serializePayoutBody({cpf,cents:12345,reference:ref}));
assert.equal(payload.transactions.length,1);
assert.deepEqual(payload.transactions[0].pix,{type:'CPF',chave:cpf});
assert.equal(payload.transactions[0].amount.value,123.45);
assert.equal(payload.external_reference,ref);
assert.throws(()=>serializePayoutBody({cpf,cents:100,reference:'not-a-reference'}));
const ack={
 id:'POPTESTSAFE0000000001',
 transactions:[{
  id:'TOPTESTSAFE0000000001',
  external_reference:ref,
  amount:{currency:'BRL',value:123.45}
 }]
};
assert.deepEqual(assertCreatePayoutResponse(ack,ref,12345),
 {payoutId:ack.id,transactionId:ack.transactions[0].id});
for(const altered of [
 {...ack,id:'OTHER'},
 {...ack,transactions:[]},
 {...ack,transactions:[...ack.transactions,...ack.transactions]},
 {...ack,transactions:[{...ack.transactions[0],external_reference:'FORGED'}]},
 {...ack,transactions:[{...ack.transactions[0],amount:{currency:'BRL',value:124.45}}]},
 {...ack,transactions:[{...ack.transactions[0],amount:{currency:'USD',value:123.45}}]}
])assert.throws(()=>assertCreatePayoutResponse(altered,ref,12345),/PAYOUT_CREATE_RESPONSE_MISMATCH/);
const job={
 providerTransactionId:ack.transactions[0].id,
 externalReference:ref,
 amountCents:12345
};
const tx={
 id:job.providerTransactionId,external_reference:ref,
 amount:{currency:'BRL',value:123.45},
 status:'success',status_detail:'accredited'
};
assert.deepEqual(assertGetPayoutTransaction(tx,job),
 {status:'success',detail:'accredited'});
for(const x of [
 {...tx,id:'TOPNOTMYID12345678'},
 {...tx,external_reference:'TAMAONET'+'B'.repeat(32)},
 {...tx,amount:{currency:'BRL',value:124.45}},
 {...tx,amount:{currency:'USD',value:123.45}},
 {...tx,status:';DROP'},
 {...tx,status_detail:'a'.repeat(81)}
])assert.throws(()=>assertGetPayoutTransaction(x,job));
assert.equal(creditCanBeAsserted({status:'success',detail:'accredited',receiptVerified:false}),false);
assert.equal(creditCanBeAsserted({status:'processed',detail:'approved',receiptVerified:true}),false);
assert.equal(creditCanBeAsserted({status:'success',detail:'accredited',receiptVerified:true}),true);

for(const name of [
 'network_payout_execution_policy_v1_1033',
 'network_payout_beneficiaries_v1_1033',
 'network_payout_jobs_v1_1033',
 'network_payout_beneficiary_register_v1_1033',
 'network_payout_set_execution_v1_1033',
 'network_payout_prepare_v1_1033',
 'network_payout_authorize_v1_1033',
 'network_payout_dispatch_begin_v1_1033',
 'network_payout_dispatch_result_v1_1033',
 'network_payout_bind_ambiguous_v1_1033',
 'network_payout_observe_v1_1033',
 'network_payout_bank_confirm_v1_1033',
 'network_payout_cancel_prepared_v1_1033',
 'network_payout_overview_v1_1033',
 'network_payout_source_review_trg_v1_1033'
])assert.ok(sql.includes(name),'missing payout SQL '+name);
for(const text of [
 "execution_enabled boolean not null default false",
 "state='dispatching'",
 "v_j.state<>'authorized'",
 "v_j.state not in('dispatching','uncertain')",
 "NETWORK_PAYOUT_DISPATCH_OR_JOB_LOCKED",
 "NETWORK_PAYOUT_ALREADY_DISPATCHED_OR_INVALID",
 "not in('uncertain','dispatching','submitted')",
 "p_confirm is distinct from 'AUTORIZO PIX'",
 "v_j.provider_status<>'success'",
 "v_j.provider_status_detail<>'accredited'",
 "receipt_hash is not null","recipientProofRequired",
 "alter table public.network_payout_jobs_v1_1033 enable row level security",
 "from public,anon,authenticated,service_role",
 "to service_role"
])assert.ok(sql.includes(text),'missing SQL safety '+text);
assert.doesNotMatch(sql,/grant execute[^;]*to\s+(?:authenticated|anon)/i);
for(const text of [
 'rollback;','NETWORK_PAYOUT_PRIVATE_ACL_LEAK','NETWORK_PAYOUT_POLICY_BYPASS',
 'NETWORK_PAYOUT_FUNDS_RELEASED_AFTER_DISPATCH',
 'NETWORK_PAYOUT_DUPLICATE_DISPATCH',
 'NETWORK_PAYOUT_UNCERTAIN_DUPLICATE_POST',
 'NETWORK_PAYOUT_RECOVERY_ROLE_BYPASS',
 'NETWORK_PAYOUT_SETTLED_WITHOUT_GET',
 'NETWORK_PAYOUT_PROVIDER_SUCCESS_NOT_PROVEN',
 'NETWORK_PAYOUT_FAKE_PROOF',
 'NETWORK_PAYOUT_SOURCE_REVERSAL_HELD'
])assert.ok(pg.includes(text),'missing SQL isolated regression '+text);
for(const text of [
 '"NETWORK_PAYOUT_LIVE_ENABLED"','"NETWORK_PAYOUT_MP_REGISTRATION_CONFIRMED"',
 '"MERCADOPAGO_PAYOUTS_WRITE_ACCESS_TOKEN"',
 '"MERCADOPAGO_PAYOUTS_ED25519_PRIVATE_KEY_PEM"',
 '"NETWORK_PAYOUT_DATA_KEY_B64"','"NETWORK_PAYOUT_HASH_KEY_B64"',
 '"AES-GCM"','"HMAC"','"Ed25519"',
 '"X-Idempotency-Key"','"X-signature"','"X-enforce-signature"',
 'network_payout_dispatch_begin_v1_1033',
 'network_payout_dispatch_result_v1_1033',
 'network_payout_bind_ambiguous_v1_1033',
 'assertGetPayoutTransaction','serializePayoutBody',
 'method:"POST"','method:"GET"'
])assert.ok(edge.includes(text),'missing Edge payout protection '+text);
const begin=edge.indexOf('network_payout_dispatch_begin_v1_1033');
const post=edge.indexOf('const payoutBody=serializePayoutBody');
assert.ok(begin>=0&&post>begin);
assert.ok(edge.includes('return respond({source:"network_payout_execution_v1_1033"'));
assert.ok(edge.includes('providerAccepted:null,recipientCredited:false'));
assert.doesNotMatch(edge,/MERCADOPAGO_ACCESS_TOKEN\b/);
for(const text of ['adminNetworkPayoutLoadOnDemand','admin-network-payout.js'])
 assert.ok(admin.includes(text),'missing Admin lazy init');
assert.ok(admin.includes('adminNetworkPayoutFallbackView()'));
assert.ok(acquisition.includes('globalThis.adminNetworkFeePackagePanel?.()'),
 'Payout panel must be placed under existing lightweight Rede finance section');
for(const text of ['adminNetworkPayoutRegister','adminNetworkPayoutReserve',
 'adminNetworkPayoutAuthorize','adminNetworkPayoutExecute',
 'adminNetworkPayoutReconcile','adminNetworkPayoutRecover',
 'adminNetworkPayoutConfirmBank','adminNetworkPayoutPolicy',
 'NÃO clique em Enviar novamente','postRetried!==false',
 'adminNetworkPayoutFileHash'])
 assert.ok(ui.includes(text),'missing Admin finance UI '+text);
assert.ok(audit.includes('node tests/network-payout-executor-contract-v1-1033.mjs'));
assert.ok(integration.includes('tests/sql/network-payout-execution-v1-1033.sql'));
console.log('PASS V1.1033 isolated Payouts validation, RLS, Ed25519, exact-match provider ACK/GET, single dispatch and independent proof');
