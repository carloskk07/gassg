import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const historical=load('supabase/migrations/20261014060000_owner_funding_evidence_v1_246.sql');
const upgrade=load('supabase/migrations/20261014110000_owner_funding_self_review_v1_248.sql');
const ui=load('js/admin-acquisition.js');
const edge=load('supabase/functions/admin-ops/index.ts');
const audit=load('.github/workflows/audit.yml');

assert.ok(historical.includes('reviewer_id<>submitted_by'), 'V1.246 history stays unchanged');
assert.ok(upgrade.includes('create or replace function platform_funding_private_v1_246.review('));
assert.ok(upgrade.includes('alter table public.platform_owner_contributions_v1_246 drop constraint %I'));
assert.ok(upgrade.includes("OWNER_EVIDENCE_SELF_REVIEW_CONSTRAINT_DRIFT"));
assert.match(upgrade,/v_prev\.submitted_by=p_actor\s+and\s+not exists\([\s\S]+?a\.user_id=p_actor and a\.active and a\.admin_role='superadmin'/);
for(const required of [
  "a.admin_role in ('superadmin','finance')",
  'OWNER_EVIDENCE_INDEPENDENT_REVIEW_REQUIRED',
  'OWNER_EVIDENCE_REVIEW_REPLAY_CONFLICT',
  'OWNER_EVIDENCE_REVIEW_STALE',
  'OWNER_EVIDENCE_REVIEW_INVALID',
  'pg_advisory_xact_lock',
  "'bankApiConfirmed',false",
  "'fundsSpendable',false",
  "'newBenefitsEnabled',false",
  "'cashMoved',false",
  "OWNER_EVIDENCE_V1_248_ACL_DRIFT",
  "grant execute on function platform_funding_private_v1_246.review("
]) assert.ok(upgrade.includes(required), 'Critical control missing: '+required);
assert.ok(!/(insert\s+into|update\s+public|delete\s+from)\s+public\.(orders|order_reward_grants|customer_wallet_ledger|platform_owner_budget_allocations_v1_247)/i.test(upgrade),
  'Review cannot move money or issue a benefit');
assert.ok(ui.includes("(rec.submittedBy===actor&&adminCurrentRole()!=='superadmin')"));
assert.ok(ui.includes("const reviewable=(role==='superadmin'||another)"));
assert.ok(ui.includes('Somente o administrador principal pode conferir o próprio aporte.'));
assert.ok(ui.includes('O administrador principal pode fazer a própria conferência'));
assert.ok(edge.includes('if(action==="owner-evidence-review")'));
assert.ok(edge.includes('"superadmin","finance"'));
assert.ok(edge.includes('admin_owner_evidence_review_v1_246'));
assert.ok(audit.includes('node tests/owner-funding-self-review-v1-248.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});

const escape=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
.replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const actor='11111111-1111-4111-8111-111111111111';
const ctx=vm.createContext({
  adminCurrentRole:()=> 'superadmin',
  adminRuntime:{session:{user:{id:actor}}},
  adminMoney:v=>'R$ '+(v/100).toFixed(2),
  adminOwnerEvidenceBusy:false,
  adminOwnerEvidencePending:new Set(),
  adminOwnerFundingState:{loadedFor:actor,rows:[{
    benefitKey:'customer_cashback',status:'internally_committed',version:1,budgetCents:20000
  }]},
  adminOwnerEvidenceState:{loadedFor:actor,total:1,pendingCount:1,
    manualReconciledCents:0,rows:[{
      contributionId:'22222222-2222-4222-8222-222222222222',
      benefitKey:'customer_cashback',amountCents:10000,planVersion:1,version:1,
      transferDate:'2026-10-14',transferReference:'BANK-123456789012',
      status:'pending_review',submittedBy:actor,
      note:'Aporte real conferido no extrato',reviewNote:null
    }]
  },
  esc:escape
});
const i=ui.indexOf('function adminOwnerEvidenceSection(){');
const e=ui.indexOf('\n}',i);
assert.ok(i>=0&&e>i);
vm.runInContext(ui.slice(i,e+2)+'\nthis.section=adminOwnerEvidenceSection;',ctx);
let html=ctx.section();
assert.ok(html.includes('Registrar conferência interna'),
  'Superadmin must be able to review self-declared evidence');
assert.ok(html.includes('Referência da operação no extrato'));
ctx.adminCurrentRole=()=> 'finance';
html=ctx.section();
assert.ok(html.includes('Somente o administrador principal pode conferir o próprio aporte.'));
assert.ok(!html.includes('Registrar conferência interna'),
  'Finance user cannot review their own entry');
ctx.adminOwnerEvidenceState.rows[0].submittedBy='33333333-3333-4333-8333-333333333333';
html=ctx.section();
assert.ok(html.includes('Registrar conferência interna'),
  'Finance user can review a different actor');
ctx.adminCurrentRole=()=> 'readonly';
assert.equal(ctx.section(),'');
console.log('V1.248 PASS — superadmin self-review, finance separation, audit, no new money actions.');
