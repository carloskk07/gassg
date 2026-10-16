import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/admin-acquisition.js');
const audit=read('.github/workflows/audit.yml');
assert.match(audit,/node tests\/payout-followup-direct-review-v1-339\.mjs/);
new vm.Script(ui,{filename:'admin-acquisition.js'});
const start=ui.indexOf('// V1.265 —'),end=ui.indexOf('// TAMÃO V1.264 —',start);
assert.ok(start>0&&end>start);
const actor='11111111-1111-4111-8111-111111111111';
const claim='22222222-2222-4222-8222-222222222222';
const order='33333333-3333-4333-8333-333333333333';
const request='44444444-4444-4444-8444-444444444444';
const reason='Documento do repasse ainda precisa de validação independente.';
const followRow={
 claimId:claim,orderId:order,reportedAmountCents:350,reportedAt:'2026-10-15T14:00:00Z',
 reviewState:'not_started',lastReviewAt:null,followupDueAt:'2026-10-16T14:00:00Z',
 overdue:true,priority:0,criticalReversalObserved:true
};
const followup={
 source:'admin_payout_followup_queue_v1_338',month:'2026-10-01',
 timezone:'America/Sao_Paulo',readOnly:true,administrativeOnly:true,
 bankSettlementVerified:false,recipientVerified:false,moneyMoved:false,
 duePolicy:'internal_guidance_not_external_SLA',firstReviewHours:24,inReviewHours:48,
 awaitingEvidenceHours:72,noBankProofRecheckHours:168,
 totalClaims:1,voidedClaims:0,closedAdministrativeClaims:0,activeClaims:1,
 unreviewedClaims:1,awaitingEvidenceClaims:0,inReviewClaims:0,noBankProofClaims:0,
 overdueClaims:1,criticalReversalClaims:1,limit:30,truncated:false,rows:[followRow]
};
const emptyHistory={source:'admin_payout_review_history_v1_337',claimId:claim,
 currentAdministrativeState:'not_started',totalEvents:0,truncated:false,limit:100,
 events:[],readOnly:true,administrativeOnly:true,bankSettlementVerified:false,
 recipientVerified:false,moneyMoved:false};
let role='superadmin',activeFollowup=followup,history=emptyHistory,records=0;
const calls=[],messages=[];
const fields={
 'owner-campaign-signals-month':{value:'2026-10'},
 'admin-payout-review-status':{value:'awaiting_evidence'},
 'admin-payout-review-note':{value:reason}
};
const env=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:id=>fields[id]||null},
 adminMoney:c=>'R$ '+(c/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 crypto:{randomUUID:()=>request},
 render:()=>{},toast:t=>messages.push(t),
 adminInvoke:async data=>{
   calls.push(data);
   if(data.action==='owner-payout-followup-read')return activeFollowup;
   if(data.action==='owner-payout-review-read')return history;
   if(data.action==='owner-payout-review-record'){
     records++;
     assert.equal(data.claimId,claim);
     assert.equal(data.requestId,request);
     assert.equal(data.justification,reason);
     history={...emptyHistory,currentAdministrativeState:data.reviewState,totalEvents:1,
       events:[{eventId:'1',actorId:actor,reviewState:data.reviewState,
         justification:reason,recordedAt:'2026-10-16T15:00:00Z'}]};
     activeFollowup={...followup,unreviewedClaims:0,awaitingEvidenceClaims:1,
       overdueClaims:0,rows:[{...followRow,reviewState:data.reviewState,
         lastReviewAt:'2026-10-16T15:00:00Z',overdue:false,priority:0,
         followupDueAt:'2026-10-19T15:00:00Z'}]};
     return {source:'admin_payout_review_record_v1_337',claimId:claim,
       requestId:request,eventId:'1',reviewState:data.reviewState,
       justification:reason,recordedAt:'2026-10-16T15:00:00Z',
       administrativeOnly:true,bankSettlementVerified:false,
       recipientVerified:false,moneyMoved:false};
   }
   throw Error('Unexpected service call '+data.action);
 },
 Object,Date,Number,String,Array,BigInt
});
vm.runInContext(ui.slice(start,end),env);
await env.adminPayoutFollowupLoadFromUi();
assert.equal(calls.length,1);
assert.match(env.adminPayoutFollowupSection(),/Analisar esta pendência/);
assert.match(env.adminPayoutFollowupSection(),/Crítica — verificar estorno/);
await env.adminPayoutReviewOpenFromUi(claim,'provider');
assert.equal(calls.length,1,'missing provider page may not be used for review');
await env.adminPayoutReviewOpenFromUi(claim,'followup');
assert.equal(calls.at(-1).action,'owner-payout-review-read');
assert.match(env.adminPayoutFollowupSection(),/Histórico da declaração/);
assert.match(env.adminPayoutFollowupSection(),/Registrar análise/);
assert.doesNotMatch(env.adminOwnerPayoutProviderSection(),/Histórico da declaração/,
  'do not render duplicate form in the provider panel');
await env.adminPayoutReviewRecordFromUi(claim);
assert.equal(records,1);
assert.equal(calls.filter(c=>c.action==='owner-payout-followup-read').length,2,
  'reload latest followup counts after confirmed write');
assert.match(env.adminPayoutFollowupSection(),/Aguardando evidências/);
assert.match(env.adminPayoutFollowupSection(),/Documento do repasse ainda precisa/);
assert.ok(messages.some(m=>/Nenhum pagamento foi comprovado/.test(m)));
fields['owner-campaign-signals-month'].value='2026-09';
const oldCalls=calls.length;
await env.adminPayoutReviewOpenFromUi(claim,'followup');
await env.adminPayoutReviewRecordFromUi(claim);
assert.equal(calls.length,oldCalls,'another month must not use loaded case');
assert.doesNotMatch(env.adminPayoutFollowupSection(),/Histórico da declaração/);
fields['owner-campaign-signals-month'].value='2026-10';
role='finance';
assert.match(env.adminPayoutFollowupSection(),/Histórico da declaração/);
assert.doesNotMatch(env.adminPayoutFollowupSection(),/Registrar análise/);
await env.adminPayoutReviewRecordFromUi(claim);
assert.equal(records,1,'finance role must not write');
role='readonly';
assert.equal(env.adminPayoutFollowupSection(),'');
console.log('V1.339 PASS: direct followup-to-review, role/month fences, one safe write, live counters and single history form.');
