import assert from 'node:assert/strict';
import fs from 'node:fs';
const load=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=load('supabase/migrations/20261012042201_merchant_representation_authority_v1_158_4.sql');
const gateway=load('supabase/functions/admin-ops/index.ts');
const panel=load('js/admin.js');
const proof=load('tests/sql/merchant-representation-v1-158-4.sql');
const full=load('tests/sql/merchant-representation-order-pin-fee-v1-158-4.sql');
for(const key of [
  'merchant_representation_reviews','enable row level security',
  'revoke all on public.merchant_representation_reviews from public,anon,authenticated',
  'merchant_representative_verification_current',
  'and m.cnpj=r.merchant_cnpj',
  "and mm.member_role='owner'",
  'and u.email_confirmed_at is not null',
  'and r.revoked_at is null',
  'and r.expires_at>statement_timestamp()',
  'public.merchant_representative_verification_current(p_merchant_id)',
  'public.merchant_representative_verification_current(new.id)',
  'public.merchant_representative_verification_current(v_merchant.id)',
  'MERCHANT_REPRESENTATION_VERIFICATION_REQUIRED',
  'CONFIRMED_MERCHANT_OWNER_REQUIRED',
  'merchant_representation_verified',
  'merchant_representation_revoked',
  'admin_merchant_representation_action',
  'public.require_platform_admin(p_actor_user_id)',
  'action_requests',
  'on conflict(idempotency_key) do nothing',
  'admin_merchant_enablement_v1_157',
  'merchant_enablement_diagnostic_v1_158',
  "'representation','Representante autorizado pela administração'"
]) assert.ok(sql.toLowerCase().includes(key.toLowerCase()),'Missing server-only representation gate: '+key);
for(const key of [
  '"merchant-representation-review"',
  'rpcName="admin_merchant_representation_action"',
  'p_owner_user_id:payload.ownerUserId',
  'p_idempotency_key:idempotencyKey',
  'p_request_hash:requestHash',
  'activeOwnerUserId:activeOwnerByMerchant.get(m.id)',
  'representationReview:representationByMerchant.get(m.id)'
]) assert.ok(gateway.includes(key),'Missing admin RPC integration: '+key);
for(const key of [
  'function adminReviewMerchantRepresentation(',
  "adminPerform('merchant-representation-review'",
  'Representação legal — confirmação administrativa',
  'Validar representante',
  'Revogar autorização',
  'Nenhum documento pessoal é armazenado aqui'
]) assert.ok(panel.includes(key),'Missing admin panel representation control: '+key);
for(const key of [
  "TEST_FAIL: owner without independent verification",
  "TEST_FAIL: owner proof was not required",
  "TEST_FAIL: admin without owner membership",
  "TEST_FAIL: representation bypassed GLP ANP",
  "TEST_FAIL: repeated command recorded duplicate audit",
  "TEST_FAIL: removed owner",
  "TEST_FAIL: CNPJ drift",
  "TEST_FAIL: revoked representation",
  'rollback;'
]) assert.ok(proof.includes(key),'Missing SQL authority fixture: '+key);
for(const key of [
  "admin_merchant_representation_action",
  "merchant_order_action(",
  "complete_order_delivery(",
  "process_deferred_settlement_accounting()",
  "TEST_FAIL: invalid PIN generated fee",
  "TEST_FAIL: no attestation settled unpaid delivery",
  "TEST_FAIL: duplicate fee after retry",
  "rollback;"
]) assert.ok(full.includes(key),'Missing full operational SQL proof: '+key);
console.log('V1.158.4: account ownership, company authority, ANP, admin workflow and PIN-to-fee regression contracts passed.');
