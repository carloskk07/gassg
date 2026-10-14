import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014235900_owner_referral_external_payout_evidence_v1_263.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const phrase of [
 'public.platform_referral_payout_claims_v1_263',
 'public.platform_referral_payout_voids_v1_263',
 'alter table public.platform_referral_payout_claims_v1_263 enable row level security',
 'alter table public.platform_referral_payout_voids_v1_263 enable row level security',
 'unique(provider,provider_reference)',
 'order_id uuid not null references public.order_reward_grants(order_id)',
 'platform_referral_payout_private_v1_263.assert_owner',
 "admin_role='superadmin'",
 'platform_referral_payout_private_v1_263.record_claim',
 'platform_referral_payout_private_v1_263.void_claim',
 'platform_referral_payout_private_v1_263.read_claims',
 "v_grant.matured_at is null",
 'v_grant.reversed_at is not null',
 'p_amount_cents<>v_grant.referral_pending_cents',
 'p_paid_on<(v_grant.matured_at',
 'PAYOUT_ACTIVE_CLAIM_EXISTS',
 'PAYOUT_REFERENCE_ALREADY_USED',
 'PAYOUT_GRANT_NOT_ELIGIBLE',
 'PAYOUT_VOID_INVALID',
 'alreadyVoided',
 'providerSettlementConfirmed',
 'owner_reported_external_claims_not_bank_verified',
 "'externalPaidBenefitsCents',null",
 "'externalPayoutMeasured',false",
 "'bankSettlementVerified',false",
 "'noTransfers',true",
 'public.admin_owner_referral_payout_record_v1_263',
 'public.admin_owner_referral_payout_void_v1_263',
 'public.admin_owner_referral_payout_claims_v1_263',
 'PAYOUT_V1_263_ACL_DRIFT'
])assert.ok(sql.includes(phrase),'Missing payout guard: '+phrase);
assert.ok(edge.includes('"owner-benefit-payout-read"'));
for(const action of ['owner-benefit-payout-read','owner-benefit-payout-record','owner-benefit-payout-void'])
 assert.ok(edge.includes('if(action==="'+action+'")'));
assert.ok(edge.includes('data?.bankSettlementVerified!==false'));
assert.ok(edge.includes('data.bankVerified!==false'));
assert.ok(edge.includes('data.transferExecuted!==false'));
assert.ok(edge.includes('data?.externalPaidBenefitsCents!==null'));
assert.ok(ui.includes('adminOwnerPayoutEvidenceSection()'));
assert.ok(boot.includes('adminOwnerPayoutReadFromUi,adminOwnerPayoutRecordFromUi,adminOwnerPayoutVoidFromUi'));
assert.ok(audit.includes('node tests/owner-referral-payout-evidence-v1-263.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});

const actor='11111111-1111-4111-8111-111111111111';
const claimId='22222222-2222-4222-8222-222222222222';
const orderId='33333333-3333-4333-8333-333333333333';
const sample={
 source:'admin_owner_referral_payout_claims_v1_263',
 month:'2026-10-01',timezone:'America/Sao_Paulo',
 reportedByOwnerOnly:true,providerSettlementConfirmed:false,
 reportMetricMeaning:'owner_reported_external_claims_not_bank_verified',
 metrics:{totalClaims:1,activeClaims:1,voidedClaims:0,reportedActiveCents:1200,
  reportedEligibleNowCents:1200,reportedNowIneligibleCents:0,
  reportedVoidedCents:0,activeWithoutProofFingerprint:1},
 totalRecords:1,limit:30,truncated:false,
 rows:[{claimId,orderId,amountCents:1200,provider:'pix',referenceMasked:'E111…9999',
  paidOn:'2026-10-14',proofFingerprintPresent:false,voided:false,eligibleNow:true}],
 externalPaidBenefitsCents:null,externalPayoutMeasured:false,
 bankSettlementVerified:false,profitMeasured:false,roiMeasured:false,
 readOnly:true,noTransfers:true,newBenefitsEnabled:false
};
const fields={
 'owner-campaign-signals-month':'2026-10','owner-payout-order':orderId,
 'owner-payout-amount':'12,00','owner-payout-provider':'pix',
 'owner-payout-reference':'E111222233339999',
 'owner-payout-date':'2026-10-14','owner-payout-sha':''
};
let data=structuredClone(sample),role='superadmin',calls=[],messages=[];
const context=vm.createContext({
 adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:actor}}},
 document:{getElementById:id=>({value:fields[id]||''})},
 adminInvoke:async arg=>{
  calls.push(arg);
  if(arg.action==='owner-benefit-payout-record')
   return {source:'admin_owner_referral_payout_claim_v1_263',claimId,
     alreadyRecorded:false,bankVerified:false,transferExecuted:false};
  if(arg.action==='owner-benefit-payout-void')
   return {source:'admin_owner_referral_payout_void_v1_263',claimId,
     alreadyVoided:false,transferExecuted:false};
  return data;
 },
 render:()=>{},toast:x=>messages.push(x),window:{prompt:()=> 'Declaração informada incorretamente'},
 adminMoney:x=>'R$ '+(x/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Date,Array
});
const begin=ui.indexOf('// TAMÃO V1.263 —'),end=ui.indexOf('// V1.262:',begin);
assert.ok(begin>=0&&end>begin);
vm.runInContext(ui.slice(begin,end),context);
assert.ok(!context.adminOwnerPayoutEvidenceSection().includes('R$ 12.00'));
await context.adminOwnerPayoutReadFromUi();
assert.equal(calls[0].action,'owner-benefit-payout-read');
assert.equal(calls[0].month,'2026-10-01');
let html=context.adminOwnerPayoutEvidenceSection();
assert.ok(html.includes('R$ 12.00'));
assert.ok(html.includes('não são liquidações confirmadas'));
assert.ok(html.includes('Retificar declaração'));
await context.adminOwnerPayoutRecordFromUi();
assert.equal(calls[1].action,'owner-benefit-payout-record');
assert.equal(calls[1].amountCents,1200);
assert.equal(calls[1].reference,'E111222233339999');
assert.ok(messages.some(x=>x.includes('Ainda não existe confirmação bancária')));
await context.adminOwnerPayoutVoidFromUi(claimId);
assert.equal(calls[2].action,'owner-benefit-payout-void');
assert.ok(calls[2].reason.length>=12);
context.adminRuntime.session.user.id='44444444-4444-4444-8444-444444444444';
assert.ok(!context.adminOwnerPayoutEvidenceSection().includes('R$ 12.00'));
context.adminRuntime.session.user.id=actor;
role='finance';
assert.ok(!context.adminOwnerPayoutEvidenceSection().includes('Registrar declaração'));
await context.adminOwnerPayoutRecordFromUi();
assert.equal(calls.length,3);
role='support';
assert.equal(context.adminOwnerPayoutEvidenceSection(),'');
role='superadmin';
data={...sample,metrics:{...sample.metrics,reportedActiveCents:1201}};
await context.adminOwnerPayoutReadFromUi();
assert.ok(messages.some(x=>x.includes('não validado')));
assert.ok(!context.adminOwnerPayoutEvidenceSection().includes('R$ 12.01'));
console.log('V1.263 PASS: claim intake, append-only correction, owner permissions, bank verification never assumed.');
