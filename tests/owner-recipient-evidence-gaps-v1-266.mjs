import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014235955_recipient_evidence_gaps_v1_266.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const ci=read('.github/workflows/audit.yml');
for(const s of ['platform_recipient_proof_private_v1_266.report',
 'public.admin_owner_recipient_evidence_gaps_v1_266',
 'platform_referral_provider_observations_v1_265',
 'public.order_reward_grants','public.wallet_entries',
 'e.pending_count=1','e.release_count=1','e.available_count=1',
 'e.reversal_count=0','g.referrer_user_id=c.beneficiary_user_id',
 "o.provider_status='success'","o.status_detail='accredited'",
 'o.transaction_reference=c.provider_reference',
 'order by o.checked_at desc,o.observation_id desc limit 1',
 'recipient_destination_not_independently_verified',
 "'bankSettlementVerified',false","'recipientVerified',false",
 "'externalPaidBenefitsCents',null","'noIdentityCollection',true",
 'RECIPIENT_EVIDENCE_ACL_DRIFT'])
 assert.ok(sql.includes(s),'Missing SQL contract: '+s);
const route=edge.slice(edge.indexOf('// V1.266 — privacy-preserving'),
 edge.indexOf('// V1.265 —',edge.indexOf('// V1.266 — privacy-preserving')));
for(const s of ['owner-recipient-proof-readiness',
 'admin_owner_recipient_evidence_gaps_v1_266',
 'data?.recipientVerified!==false',
 'data?.bankSettlementVerified!==false',
 'data?.externalPaidBenefitsCents!==null',
 't.readyForRecipientProof>t.providerReconciledClaims'])
 assert.ok(route.includes(s),'Missing route contract: '+s);
assert.ok(ui.includes('adminOwnerRecipientProofSection()'));
assert.ok(boot.includes('adminOwnerRecipientProofLoadFromUi'));
assert.ok(ci.includes('node tests/owner-recipient-evidence-gaps-v1-266.mjs'));
new vm.Script(ui);new vm.Script(boot);
const id='22222222-2222-4222-8222-222222222222';
const actor='11111111-1111-4111-8111-111111111111';
const totals={totalClaims:1,activeClaims:1,voidedClaims:0,eligibleClaims:1,
 walletReconciledClaims:1,internalIdentityMatches:1,documentedClaims:1,
 providerObservedClaims:1,providerReconciledClaims:1,
 readyForRecipientProof:1,beneficiaryVerifiedClaims:0,bankSettlementVerifiedClaims:0};
const row={claimId:id,amountCents:1200,provider:'mercado_pago',paidOn:'2026-10-14',
 voided:false,grantEligibleNow:true,internalRecipientMatchesGrant:true,
 walletVerified:true,proofAttached:true,providerObserved:true,providerMatchedNow:true,
 readyForRecipientProof:true,beneficiaryVerified:false,bankSettlementVerified:false,
 lastProviderCheckAt:'2026-10-14T19:25:00Z',
 missingEvidence:['recipient_destination_not_independently_verified']};
let role='superadmin',calls=[],toasts=[];
let report={source:'admin_owner_recipient_evidence_gaps_v1_266',
 scope:'owner_reported_referral_outgoing_claims',month:'2026-10-01',
 timezone:'America/Sao_Paulo',totals,rows:[row],limit:50,truncated:false,
 destinationIdentityAvailableFromProvider:false,recipientVerified:false,
 bankSettlementVerified:false,externalPaidBenefitsCents:null,
 readOnly:true,noTransfers:true,noIdentityCollection:true,newBenefitsEnabled:false};
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:()=>({value:'2026-10'})},
 adminInvoke:async x=>{calls.push(x);return report;},
 render:()=>{},toast:x=>toasts.push(x),
 adminMoney:x=>'R$ '+(x/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Array,Date
});
const a=ui.indexOf('// TAMÃO V1.266 —'),b=ui.indexOf('// V1.265 —',a);
assert.ok(a>=0&&b>a);
vm.runInContext(ui.slice(a,b),ctx);
assert.ok(!ctx.adminOwnerRecipientProofSection().includes(id));
await ctx.adminOwnerRecipientProofLoadFromUi();
assert.equal(calls[0].month,'2026-10-01');
assert.ok(ctx.adminOwnerRecipientProofSection().includes(id));
ctx.adminRuntime.session.user.id='44444444-4444-4444-8444-444444444444';
assert.ok(!ctx.adminOwnerRecipientProofSection().includes(id));
ctx.adminRuntime.session.user.id=actor;
role='support';assert.equal(ctx.adminOwnerRecipientProofSection(),'');
role='finance';
report={...report,totals:{...totals,readyForRecipientProof:3}};
await ctx.adminOwnerRecipientProofLoadFromUi();
assert.ok(toasts.some(x=>x.includes('não validada')));
assert.ok(!ctx.adminOwnerRecipientProofSection().includes(id));
console.log('V1.266 PASS: private recipient gap report, exact validations, role and session isolation.');