import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=load('supabase/migrations/20261014060000_owner_funding_evidence_v1_246.sql');
const edge=load('supabase/functions/admin-ops/index.ts');
const ui=load('js/admin-acquisition.js');
const boot=load('js/bootstrap.js');
const ci=load('.github/workflows/audit.yml');
for(const s of [
 'public.platform_owner_contributions_v1_246',
 'public.platform_owner_contribution_events_v1_246',
 'alter table public.platform_owner_contributions_v1_246 enable row level security',
 'revoke all on public.platform_owner_contributions_v1_246',
 'revoke all on public.platform_owner_contribution_events_v1_246',
 'check(funds_spendable=false)','check(coupons_enabled=false)',
 'check(payouts_enabled=false)','reviewer_id<>submitted_by',
 'manual_reconciled','pending_review','rejected','disputed',
 'platform_funding_private_v1_246.submit',
 'platform_funding_private_v1_246.review',
 'platform_funding_private_v1_246.queue',
 'public.admin_owner_evidence_submit_v1_246',
 'public.admin_owner_evidence_review_v1_246',
 'public.admin_owner_evidence_queue_v1_246',
 'pg_advisory_xact_lock',
 'OWNER_EVIDENCE_IDEMPOTENCY_CONFLICT',
 'OWNER_EVIDENCE_REVIEW_REPLAY_CONFLICT',
 'OWNER_EVIDENCE_INDEPENDENT_REVIEW_REQUIRED',
 'OWNER_EVIDENCE_PLAN_STALE',
 'OWNER_EVIDENCE_REVIEW_STALE',
 "v_plan.status<>'internally_committed'",
 'platform_owner_contribution_reference_uq_v1_246',
 'OWNER_EVIDENCE_ACL_DRIFT',
 "'bankApiConfirmed',false",
 "'fundsSpendable',false",
 "'newBenefitsEnabled',false",
 "'cashMoved',false",
 "'spendableCents',0"
])assert.ok(sql.includes(s),'Missing DB invariant: '+s);
assert.ok(!/(insert\s+into|update\s+public|delete\s+from)\s+public\.(order_reward_grants|orders|reward_policy|platform_incentive_funding_plan_v1_244|clube_package_drafts_v1_239|customer_wallet_ledger)/i.test(sql),
 'Evidence cannot touch rewards, orders, billings or club');
for(const s of [
 '"owner-evidence-queue"','"owner-evidence-submit"','"owner-evidence-review"',
 'if(action==="owner-evidence-queue")','if(action==="owner-evidence-submit")',
 'if(action==="owner-evidence-review")',
 'admin_owner_evidence_queue_v1_246','admin_owner_evidence_submit_v1_246',
 'admin_owner_evidence_review_v1_246',
 'data?.spendableCents!==0','data.bankApiConfirmed!==false',
 'data.fundsSpendable!==false','data.newBenefitsEnabled!==false',
 'data.cashMoved!==false'
])assert.ok(edge.includes(s),'Missing Edge guard: '+s);
for(const s of [
 'function adminOwnerEvidenceSection()','adminOwnerEvidenceSection(),',
 'async function adminOwnerEvidenceLoadFromUi()',
 'async function adminOwnerEvidenceSubmitFromUi()',
 'async function adminOwnerEvidenceReviewFromUi(',
 'adminOwnerEvidencePending',
 'adminOwnerFundingReaisToCents(form(\'amount\'),50000000)',
 'rec.submittedBy===actor',
 "result?.bankApiConfirmed!==false",
 'Aportes e comprovantes bancários',
 'Disponível para gastar',
 'Conciliado manualmente',
 'Nenhum aporte registrado',
 'Somente o administrador principal pode conferir o próprio aporte.'
])assert.ok(ui.includes(s),'Missing Admin controls: '+s);
for(const s of ['adminOwnerEvidenceLoadFromUi','adminOwnerEvidenceSubmitFromUi',
 'adminOwnerEvidenceReviewFromUi'])assert.ok(boot.includes(s),'Missing bootstrap callback: '+s);
assert.ok(ci.includes('node tests/owner-funding-evidence-v1-246.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const id='11111111-1111-4111-8111-111111111111';
const ctx=vm.createContext({adminCurrentRole:()=> 'superadmin',
 adminRuntime:{session:{user:{id}}},Number,String,
 adminMoney:v=>'R$ '+(v/100).toFixed(2),
 adminOwnerEvidenceState:null,adminOwnerFundingState:null,
 adminOwnerEvidenceBusy:false,adminOwnerEvidencePending:new Set(),esc});
const i=ui.indexOf('function adminOwnerEvidenceSection(){'),e=ui.indexOf('\n}',i);
assert.ok(i>=0&&e>i);
vm.runInContext(ui.slice(i,e+2)+'\nthis.section=adminOwnerEvidenceSection;',ctx);
assert.ok(ctx.section().includes('Aportes e comprovantes bancários'));
assert.ok(ctx.section().includes('Primeiro registre um orçamento interno'));
ctx.adminOwnerFundingState={loadedFor:id,rows:[{
 benefitKey:'customer_cashback',status:'internally_committed',version:1,budgetCents:10000}]};
ctx.adminOwnerEvidenceState={loadedFor:id,total:1,pendingCount:1,
 manualReconciledCents:0,rows:[{
 contributionId:'22222222-2222-4222-8222-222222222222',
 benefitKey:'customer_cashback',amountCents:10000,planVersion:1,version:1,
 transferDate:'2026-10-14',transferReference:'REF-1234567890',
 status:'pending_review',submittedBy:id,
 note:'Aporte <script>alert(1)</script>',reviewNote:null
}]};
let html=ctx.section();
assert.ok(html.includes('R$ 100.00'));
assert.ok(html.includes('&lt;script&gt;'));
assert.ok(!html.includes('<script>alert(1)</script>'));
assert.ok(html.includes('Somente o administrador principal pode conferir o próprio aporte.')===false);
assert.ok(html.includes('Registrar conferência interna'));
ctx.adminCurrentRole=()=> 'finance';
html=ctx.section();
assert.ok(html.includes('Somente o administrador principal pode conferir o próprio aporte.'));
assert.ok(!html.includes('Registrar conferência interna'));
ctx.adminOwnerEvidenceState.rows[0].submittedBy='33333333-3333-4333-8333-333333333333';
html=ctx.section();
assert.ok(html.includes('Registrar conferência interna'));
console.log('V1.246 PASS — evidence intake with V1.248 superadmin self-review, finance separation, guards and non-spendability.');
