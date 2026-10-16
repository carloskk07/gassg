import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/admin-acquisition.js');
const workflow=read('.github/workflows/audit.yml');
assert.match(workflow,/node tests\/payout-global-direct-review-v1-342\.mjs/);
new vm.Script(ui,{filename:'admin-acquisition.js'});
const start=ui.indexOf('// V1.265 —');
const end=ui.indexOf('// TAMÃO V1.264 —',start);
assert.ok(start>0&&end>start);
for(const term of [
 "origin==='global'?adminPayoutGlobalState:null",
 "origin==='global'||!month",
 "adminPayoutGlobalLoadFromUi(adminPayoutGlobalState?.pageOffset??0)",
 "adminPayoutReviewOpenFromUi(&quot;'+esc(x.claimId)+'&quot;,&quot;global&quot;)",
 "adminPayoutReviewHistoryMarkup('global',d.rows)"
])assert.ok(ui.includes(term),'Missing direct global review protection: '+term);

const actor='11111111-1111-4111-8111-111111111111';
const claim='22222222-2222-4222-8222-222222222222';
const order='33333333-3333-4333-8333-333333333333';
const req='44444444-4444-4444-8444-444444444444';
const note='A transferência declarada exige conferência de evidências externas.';
const row={claimId:claim,orderId:order,claimMonth:'2026-09-01',
 paidOn:'2026-09-28',reportedAmountCents:720,
 reviewState:'not_started',followupDueAt:'2026-10-16T13:00:00Z',
 overdue:true,criticalReversalObserved:true,priority:0};
const sample={
 source:'admin_payout_global_followup_v1_340',scope:'all_months',
 timezone:'America/Sao_Paulo',readOnly:true,administrativeOnly:true,
 bankSettlementVerified:false,recipientVerified:false,moneyMoved:false,
 duePolicy:'internal_guidance_not_external_SLA',activeClaims:1,
 activeOlderMonths:1,overdueClaims:1,criticalReversalClaims:1,
 unreviewedClaims:1,awaitingEvidenceClaims:0,distinctMonths:1,
 limit:30,truncated:false,rows:[row]
};
const emptyHistory={source:'admin_payout_review_history_v1_337',
 claimId:claim,currentAdministrativeState:'not_started',
 totalEvents:0,truncated:false,limit:100,events:[],
 readOnly:true,administrativeOnly:true,bankSettlementVerified:false,
 recipientVerified:false,moneyMoved:false};
let history=emptyHistory,global=sample,role='superadmin',records=0;
let events=[],messages=[],requery=0,monthLoads=0;
const month={value:'2026-10'};
const fields={
 'owner-campaign-signals-month':month,
 'admin-payout-review-status':{value:'awaiting_evidence'},
 'admin-payout-review-note':{value:note}
};
const context=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:id=>fields[id]||null},
 adminPayoutFollowupBusy:false,
 adminPayoutFollowupLoadFromUi:()=>{monthLoads++},
 crypto:{randomUUID:()=>req},
 adminInvoke:async request=>{
   events.push(request);
   if(request.action==='owner-payout-global-followup-read'){requery++;return global;}
   if(request.action==='owner-payout-review-read')return history;
   if(request.action==='owner-payout-review-record'){
     records++;
     assert.equal(request.claimId,claim);
     assert.equal(request.requestId,req);
     history={...emptyHistory,currentAdministrativeState:request.reviewState,
       totalEvents:1,events:[{
         eventId:'1',actorId:actor,reviewState:request.reviewState,
         justification:request.justification,recordedAt:'2026-10-16T17:00:00Z'
       }]};
     return {source:'admin_payout_review_record_v1_337',claimId:claim,
       requestId:req,eventId:'1',reviewState:request.reviewState,
       justification:request.justification,recordedAt:'2026-10-16T17:00:00Z',
       administrativeOnly:true,bankSettlementVerified:false,
       recipientVerified:false,moneyMoved:false};
   }
   throw Error('Unexpected mutation '+request.action);
 },
 toast:x=>messages.push(x),render:()=>{},
 adminMoney:c=>'R$ '+(c/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Date,String,Number,Array,Object,BigInt
});
vm.runInContext(ui.slice(start,end),context);
await context.adminPayoutGlobalLoadFromUi();
assert.equal(requery,1);
assert.match(context.adminPayoutGlobalFollowupSection(),/Analisar esta declaração/);
assert.match(context.adminPayoutGlobalFollowupSection(),/Abrir competência para revisar/);
assert.equal(context.adminPayoutReviewSourceForClaim(actor,claim,'provider'),null);
assert.equal(context.adminPayoutReviewSourceForClaim(actor,claim,'followup'),null);
await context.adminPayoutReviewOpenFromUi(claim,'global');
assert.equal(events.at(-1).action,'owner-payout-review-read');
assert.match(context.adminPayoutGlobalFollowupSection(),/Histórico da declaração/);
assert.match(context.adminPayoutGlobalFollowupSection(),/Registrar análise/);
assert.equal(month.value,'2026-10','opening September claim must not change current month');
assert.equal(monthLoads,0);
assert.equal(
 (context.adminPayoutFollowupSection().match(/Histórico da declaração/g)||[]).length,1,
 'combined followup/global panel must render exactly one global history');
await context.adminPayoutReviewRecordFromUi(claim);
assert.equal(records,1);
assert.equal(requery,2,'successful write must refresh global priority queue');
assert.ok(events.filter(e=>e.action==='owner-payout-review-read').length===2);
assert.match(context.adminPayoutGlobalFollowupSection(),/Aguardando evidências/);
assert.ok(messages.some(m=>/Nenhum pagamento foi comprovado/.test(m)));
role='finance';
assert.match(context.adminPayoutGlobalFollowupSection(),/Histórico da declaração/);
assert.doesNotMatch(context.adminPayoutGlobalFollowupSection(),/Registrar análise/);
await context.adminPayoutReviewRecordFromUi(claim);
assert.equal(records,1,'finance role cannot write');
role='readonly';
assert.equal(context.adminPayoutGlobalFollowupSection(),'');
await context.adminPayoutReviewOpenFromUi(claim,'global');
assert.equal(records,1);
role='superadmin';
// Stale or missing claim must not allow a cross-month journal edit.
global={...sample,activeClaims:0,activeOlderMonths:0,overdueClaims:0,
 criticalReversalClaims:0,unreviewedClaims:0,distinctMonths:0,rows:[]};
await context.adminPayoutGlobalLoadFromUi();
const count=events.length;
await context.adminPayoutReviewRecordFromUi(claim);
await context.adminPayoutReviewOpenFromUi(claim,'global');
assert.equal(events.length,count,'removed claim must not be accessed with stale page');
assert.doesNotMatch(context.adminPayoutGlobalFollowupSection(),/Histórico da declaração/);
console.log('V1.342 PASS: direct cross-month claim review, owner write, finance read, refresh, stale-page denial, no payment actions.');
