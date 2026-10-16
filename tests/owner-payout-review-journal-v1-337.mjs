import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016235955_payout_review_immutable_journal_v1_337.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');

for(const token of [
  'platform_referral_payout_review_events_v1_337','generated always as identity',
  'references public.platform_referral_payout_claims_v1_263(claim_id)',
  'references auth.users(id)',
  'unique(claim_id,request_id)',
  "'in_review','awaiting_evidence','reviewed_no_bank_proof','closed_administrative'",
  'char_length(btrim(justification)) between 20 and 1000',
  'enable row level security',
  'revoke all on public.platform_referral_payout_review_events_v1_337 from public,anon,authenticated',
  'revoke all on public.platform_referral_payout_review_events_v1_337 from service_role',
  'payout_review_immutable_v1_337',
  'before update or delete',
  'PAYOUT_REVIEW_JOURNAL_IMMUTABLE',
  'admin_owner_payout_review_record_v1_337(',
  'admin_owner_payout_review_read_v1_337(',
  "a.admin_role='superadmin'",
  "a.admin_role in ('superadmin','finance')",
  'pg_catalog.pg_advisory_xact_lock',
  'PAYOUT_REVIEW_REQUEST_CONFLICT',
  'v.actor_id<>p_actor or v.review_state<>p_state or v.justification<>v_note',
  'order by event_id desc limit 100',
  "coalesce(v_latest,'not_started')",
  "'administrativeOnly',true",
  "'bankSettlementVerified',false",
  "'recipientVerified',false",
  "'moneyMoved',false",
  'revoke all on function public.admin_owner_payout_review_record_v1_337',
  'revoke all on function public.admin_owner_payout_review_read_v1_337',
  'to service_role'
])assert.ok(sql.includes(token),'Missing SQL audit requirement: '+token);

for(const token of [
  '"owner-payout-review-read"','"owner-payout-review-record"',
  '"admin_owner_payout_review_read_v1_337"',
  '"admin_owner_payout_review_record_v1_337"',
  'PAYOUT_REVIEW_HISTORY_INVALID','PAYOUT_REVIEW_RECORD_INVALID',
  "String(adminAccess.admin_role)!==\"superadmin\"",
  'data?.moneyMoved!==false','data?.bankSettlementVerified!==false',
  'data?.recipientVerified!==false'
])assert.ok(edge.includes(token),'Missing Edge behavior: '+token);
assert.match(boot,/adminPayoutReviewOpenFromUi,adminPayoutReviewRecordFromUi/);
assert.match(audit,/node tests\/owner-payout-review-journal-v1-337\.mjs/);
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});

const actor='11111111-1111-4111-8111-111111111111';
const claimId='22222222-2222-4222-8222-222222222222';
const orderId='33333333-3333-4333-8333-333333333333';
const requestId='44444444-4444-4444-8444-444444444444';
const sample={
 source:'owner_payout_provider_reconciliation_v1_265',provider:'mercado_pago_payouts_get',
 timezone:'America/Sao_Paulo',month:'2026-10-01',readOnly:true,noTransfers:true,
 bankSettlementVerified:false,recipientVerified:false,
 providerTransactionIsBeneficiaryProof:false,externalPaidBenefitsCents:null,
 triageV1335:true,queueOrder:'priority_then_reported_at',
 queueCoverage:'top_30_prioritized',historicalProviderSuccessIsBankProof:false,
 automaticRecoveryExecuted:false,activeReversedClaims:1,
 activeReversedReportedCents:100,
 reversedWithHistoricalProviderSuccessClaims:1,
 activeReversedWithHistoricalProviderSuccessClaims:1,
 totalClaims:1,checkedClaims:0,providerSuccessClaims:0,
 checkedUnmatchedClaims:0,unqueriedClaims:1,limit:30,truncated:false,
 rows:[{claimId,orderId,priority:0,reportedAmountCents:100,paidOn:'2026-10-16',
  reportedAt:'2026-10-16T12:00:00Z',checkedAt:null,
  status:null,detail:null,referenceMatches:null,amountMatches:null,
  providerTransactionSuccess:null,successNow:false,proofPresent:false,
  voided:false,grantReversedNow:true,historicalProviderSuccessObserved:true,
  requiresReversalReview:true,payoutId:null,transactionId:null}]
};
const empty={
 source:'admin_payout_review_history_v1_337',claimId,
 currentAdministrativeState:'not_started',totalEvents:0,truncated:false,limit:100,
 events:[],readOnly:true,administrativeOnly:true,bankSettlementVerified:false,
 recipientVerified:false,moneyMoved:false
};
const note='Conferir o documento anexado e a divergência antes do encerramento.';
let history=empty,role='superadmin',calls=[],messages=[],renders=0,records=0;
const fields={
 'owner-campaign-signals-month':{value:'2026-10'},
 'admin-payout-review-status':{value:'awaiting_evidence'},
 'admin-payout-review-note':{value:note}
};
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:id=>fields[id]||null},
 adminInvoke:async d=>{
   calls.push(d);
   if(d.action==='owner-payout-provider-read')return sample;
   if(d.action==='owner-payout-review-read')return history;
   if(d.action==='owner-payout-review-record'){
     records++;
     const result={source:'admin_payout_review_record_v1_337',
       claimId,requestId:d.requestId,eventId:String(records),reviewState:d.reviewState,
       justification:d.justification,recordedAt:'2026-10-16T16:00:00Z',
       administrativeOnly:true,bankSettlementVerified:false,
       recipientVerified:false,moneyMoved:false};
     history={...empty,currentAdministrativeState:d.reviewState,totalEvents:records,
       events:[{eventId:result.eventId,actorId:actor,reviewState:d.reviewState,
         justification:d.justification,recordedAt:result.recordedAt}]};
     return result;
   }
   throw new Error('Unexpected side effect: '+d.action);
 },
 crypto:{randomUUID:()=>requestId},
 render:()=>{renders++;},toast:msg=>messages.push(msg),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 adminMoney:x=>'R$ '+(x/100).toFixed(2),
 Object,BigInt,Date,Array,Number,String
});
const a=ui.indexOf('// V1.265 —'),b=ui.indexOf('// TAMÃO V1.264 —',a);
assert.ok(a>=0&&b>a);
vm.runInContext(ui.slice(a,b),ctx);
await ctx.adminOwnerPayoutProviderLoadFromUi();
assert.match(ctx.adminOwnerPayoutProviderSection(),/Ver histórico \/ revisar/);
await ctx.adminPayoutReviewOpenFromUi(claimId);
assert.equal(calls.at(-1).action,'owner-payout-review-read');
assert.match(ctx.adminOwnerPayoutProviderSection(),/Nenhuma revisão registrada/);
await ctx.adminPayoutReviewRecordFromUi(claimId);
assert.equal(records,1,'one write only');
assert.equal(calls.filter(c=>c.action==='owner-payout-review-record').length,1);
assert.equal(calls.find(c=>c.action==='owner-payout-review-record').requestId,requestId);
assert.match(ctx.adminOwnerPayoutProviderSection(),/Aguardando evidências/);
assert.match(ctx.adminOwnerPayoutProviderSection(),/Conferir o documento anexado/);
assert.ok(messages.some(x=>/Nenhum pagamento foi comprovado/.test(x)));
assert.equal(calls.filter(c=>c.action==='owner-payout-review-read').length,2);
role='finance';
assert.ok(ctx.adminOwnerPayoutProviderSection().includes('Histórico da declaração'));
assert.ok(!ctx.adminOwnerPayoutProviderSection().includes('Registrar análise'));
await ctx.adminPayoutReviewRecordFromUi(claimId);
assert.equal(records,1,'finance may not record a review');
role='readonly';
assert.equal(ctx.adminOwnerPayoutProviderSection(),'');
role='superadmin';history={...empty,bankSettlementVerified:true};
await ctx.adminPayoutReviewOpenFromUi(claimId);
assert.ok(messages.some(x=>/não validado/.test(x)),'fail closed on invented bank verification');
assert.ok(!ctx.adminOwnerPayoutProviderSection().includes(note),'invalid history must not remain visible');
assert.ok(renders>0);
console.log('V1.337 PASS: immutable journal SQL contract, owner writes, finance-only reading, audit timeline, no bank claims.');
