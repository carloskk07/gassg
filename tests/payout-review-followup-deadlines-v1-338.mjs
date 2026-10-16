import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016235958_payout_followup_queue_v1_338.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const t of [
 'admin_owner_payout_followup_read_v1_338',
 "a.active and a.admin_role in ('superadmin','finance')",
 'PAYOUT_FOLLOWUP_READ_DENIED','PAYOUT_FOLLOWUP_MONTH_INVALID',
 'platform_referral_payout_review_events_v1_337',
 'order by r.event_id desc limit 1',
 "when 'not_started' then reported_at+interval '24 hours'",
 "when 'in_review' then last_review_at+interval '48 hours'",
 "when 'awaiting_evidence' then last_review_at+interval '72 hours'",
 "when 'reviewed_no_bank_proof' then last_review_at+interval '168 hours'",
 "review_state<>'closed_administrative'",
 'from due where not voided',
 'obs.provider_transaction_success is true',
 'order by priority,followup_due_at,claim_id limit 30',
 "'duePolicy','internal_guidance_not_external_SLA'",
 "'bankSettlementVerified',false","'recipientVerified',false",
 "'moneyMoved',false","'readOnly',true,'administrativeOnly',true",
 'revoke all on function public.admin_owner_payout_followup_read_v1_338',
 'to service_role'
])assert.ok(sql.includes(t),'SQL requirement missing '+t);
assert.doesNotMatch(sql,/\b(?:drop\s+table|truncate\s+table|insert\s+into|delete\s+from|update\s+public\.)\b/i);
assert.match(edge,/if\(action==="owner-payout-followup-read"\)/);
assert.match(edge,/admin_owner_payout_followup_read_v1_338/);
assert.match(edge,/PAYOUT_FOLLOWUP_HISTORY_INVALID/);
assert.match(edge,/data.totalClaims!==data.voidedClaims\+data.closedAdministrativeClaims\+data.activeClaims/);
assert.match(edge,/data\?\.moneyMoved!==false/);
assert.match(boot,/adminPayoutFollowupLoadFromUi/);
assert.match(audit,/node tests\/payout-review-followup-deadlines-v1-338\.mjs/);
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const start=ui.indexOf('// TAMÃO V1.338 —'),end=ui.indexOf('function adminOwnerPayoutProviderSection(){',start);
assert.ok(start>0&&end>start);
const actor='11111111-1111-4111-8111-111111111111';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const item=(n,patch={})=>({
 claimId:uuid(n),orderId:uuid(n+100),reportedAmountCents:100*n,
 reportedAt:'2026-10-14T14:00:00Z',reviewState:'not_started',
 lastReviewAt:null,followupDueAt:'2026-10-17T14:00:00Z',
 overdue:false,priority:2,criticalReversalObserved:false,...patch
});
const payload={
 source:'admin_payout_followup_queue_v1_338',
 month:'2026-10-01',timezone:'America/Sao_Paulo',
 readOnly:true,administrativeOnly:true,bankSettlementVerified:false,
 recipientVerified:false,moneyMoved:false,
 duePolicy:'internal_guidance_not_external_SLA',
 firstReviewHours:24,inReviewHours:48,awaitingEvidenceHours:72,noBankProofRecheckHours:168,
 totalClaims:3,voidedClaims:0,closedAdministrativeClaims:0,
 activeClaims:3,unreviewedClaims:1,awaitingEvidenceClaims:1,
 inReviewClaims:1,noBankProofClaims:0,overdueClaims:1,criticalReversalClaims:1,
 limit:30,truncated:false,
 rows:[
   item(1,{reviewState:'in_review',lastReviewAt:'2026-10-16T14:00:00Z',
     priority:0,criticalReversalObserved:true}),
   item(2,{priority:1,overdue:true,followupDueAt:'2026-10-15T14:00:00Z'}),
   item(3,{reviewState:'awaiting_evidence',lastReviewAt:'2026-10-16T14:00:00Z'})
 ]
};
let response=payload,role='superadmin',calls=0,renders=0,messages=[];
const fields={'owner-campaign-signals-month':{value:'2026-10'}};
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:id=>fields[id]||null},
 adminInvoke:async req=>{
   calls++;
   assert.equal(req.action,'owner-payout-followup-read');
   assert.equal(req.month,'2026-10-01');
   return response;
 },
 toast:t=>messages.push(t),render:()=>{renders++},
 adminMoney:c=>'R$ '+(c/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Date,Number,String,Array
});
vm.runInContext(ui.slice(start,end),ctx);
assert.match(ctx.adminPayoutFollowupSection(),/Carregue a competência/);
await ctx.adminPayoutFollowupLoadFromUi();
assert.equal(calls,1);
let html=ctx.adminPayoutFollowupSection();
for(const t of ['Prazo das revisões financeiras','prazos de pagamento',
 'Revisões com prazo interno vencido','Declarações sem análise',
 'Aguardando evidências','Pedido','Declaração','Próxima conferência sugerida',
 'Crítica','Prazo interno vencido'])
 assert.ok(html.includes(t),'UI missing '+t);
assert.ok(html.indexOf(uuid(1))<html.indexOf(uuid(2)));
assert.ok(html.indexOf(uuid(2))<html.indexOf(uuid(3)));
role='readonly';
assert.equal(ctx.adminPayoutFollowupSection(),'');
role='finance';
assert.match(ctx.adminPayoutFollowupSection(),/Prazo das revisões financeiras/);
fields['owner-campaign-signals-month'].value='2026-09';
assert.doesNotMatch(ctx.adminPayoutFollowupSection(),/Crítica — verificar estorno e repasse/);
fields['owner-campaign-signals-month'].value='2026-10';
response={...payload,moneyMoved:true};
await ctx.adminPayoutFollowupLoadFromUi();
assert.ok(messages.some(t=>/não validado/.test(t)));
assert.doesNotMatch(ctx.adminPayoutFollowupSection(),/Crítica — verificar estorno e repasse/);
response={...payload,totalClaims:10};
await ctx.adminPayoutFollowupLoadFromUi();
assert.doesNotMatch(ctx.adminPayoutFollowupSection(),/Crítica — verificar estorno e repasse/);
response={...payload,rows:payload.rows.map((r,i)=>i===1?{...r,priority:0}:r)};
await ctx.adminPayoutFollowupLoadFromUi();
assert.doesNotMatch(ctx.adminPayoutFollowupSection(),/Crítica — verificar estorno e repasse/);
assert.ok(renders>0);
console.log('V1.338 PASS: suggested followup deadlines, priority and ACL, month fences, no fake bank confirmation.');
