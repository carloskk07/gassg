import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016235959_payout_global_followup_v1_340.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const admin=read('js/admin-acquisition.js');
const bootstrap=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');

for(const term of [
 'admin_owner_payout_global_followup_v1_340',
 "a.active and a.admin_role in ('superadmin','finance')",
 'PAYOUT_GLOBAL_FOLLOWUP_READ_DENIED',
 'from public.platform_referral_payout_claims_v1_263 c',
 'from public.platform_referral_payout_review_events_v1_337 r',
 'order by r.event_id desc limit 1',
 "when 'not_started' then reported_at+interval '24 hours'",
 "when 'in_review' then last_review_at+interval '48 hours'",
 "when 'awaiting_evidence' then last_review_at+interval '72 hours'",
 "when 'reviewed_no_bank_proof' then last_review_at+interval '168 hours'",
 "where not voided and review_state<>'closed_administrative'",
 'obs.provider_transaction_success is true',
 "'scope','all_months'","'activeOlderMonths'",
 "order by priority,due_at,claim_id limit 30",
 "'bankSettlementVerified',false","'recipientVerified',false",
 "'moneyMoved',false","'readOnly',true,'administrativeOnly',true",
 'revoke all on function public.admin_owner_payout_global_followup_v1_340',
 'to service_role'
])assert.ok(sql.includes(term),'SQL contract missing '+term);
assert.doesNotMatch(sql,/where c\.paid_on>=v_month|where c\.paid_on<\(v_month/i,
 'must not filter old months out');
assert.doesNotMatch(sql,/\b(?:insert\s+into|update\s+public|delete\s+from|drop\s+table|truncate\s+table)\b/i);
for(const term of ['"owner-payout-global-followup-read"',
 'admin_owner_payout_global_followup_v1_340',
 'PAYOUT_GLOBAL_HISTORY_INVALID',
 'data?.bankSettlementVerified!==false',
 'data?.moneyMoved!==false',
 'data.rows.length!==Math.min(30,data.activeClaims)'
])assert.ok(edge.includes(term),'missing Edge read guard: '+term);
assert.match(bootstrap,/adminPayoutGlobalLoadFromUi,adminPayoutGlobalOpenMonthFromUi/);
assert.match(audit,/node tests\/payout-global-followup-v1-340\.mjs/);
new vm.Script(admin,{filename:'admin-acquisition.js'});
new vm.Script(bootstrap,{filename:'bootstrap.js'});

const start=admin.indexOf('// TAMÃO V1.340 —');
const end=admin.indexOf('function adminPayoutFollowupSection(){',start);
assert.ok(start>0&&end>start);
const actor='11111111-1111-4111-8111-111111111111';
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const row=(n,month,paidOn,extra={})=>({
 claimId:uid(n),orderId:uid(n+10),claimMonth:month,
 paidOn,reportedAmountCents:100*n,
 reviewState:'not_started',followupDueAt:'2026-10-16T16:00:00Z',
 overdue:false,criticalReversalObserved:false,priority:2,...extra
});
const base={
 source:'admin_payout_global_followup_v1_340',scope:'all_months',
 timezone:'America/Sao_Paulo',readOnly:true,administrativeOnly:true,
 bankSettlementVerified:false,recipientVerified:false,moneyMoved:false,
 duePolicy:'internal_guidance_not_external_SLA',
 activeClaims:2,activeOlderMonths:1,overdueClaims:1,criticalReversalClaims:1,
 unreviewedClaims:1,awaitingEvidenceClaims:1,distinctMonths:2,
 limit:30,truncated:false,
 rows:[
  row(1,'2026-09-01','2026-09-25',{
    priority:0,criticalReversalObserved:true}),
  row(2,'2026-10-01','2026-10-15',{
    priority:1,overdue:true,reviewState:'awaiting_evidence'})
 ]
};
let role='superadmin',response=base,calls=[],notifications=[],rendered=0,monthOpen=0;
const monthInput={value:'2026-10'};
const context=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:id=>id==='owner-campaign-signals-month'?monthInput:null},
 adminInvoke:async request=>{calls.push(request);return response;},
 adminPayoutFollowupBusy:false,adminPayoutReviewState:{claimId:'old'},
 adminPayoutFollowupState:{loadedFor:actor},
 adminPayoutFollowupLoadFromUi:()=>{monthOpen++;},
 toast:t=>notifications.push(t),render:()=>{rendered++;},
 adminMoney:n=>'R$ '+(n/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Date,Number,String,Array
});
vm.runInContext(admin.slice(start,end),context);
assert.match(context.adminPayoutGlobalFollowupSection(),/todos os meses/i);
await context.adminPayoutGlobalLoadFromUi();
assert.equal(calls.length,1);
assert.equal(calls[0].action,'owner-payout-global-followup-read');
let html=context.adminPayoutGlobalFollowupSection();
for(const term of ['Casos de meses anteriores','Prazos internos vencidos',
 'Estornos com sucesso observado','2026-09','2026-10',
 'Abrir competência para revisar'])assert.ok(html.includes(term),'Missing '+term);
assert.ok(html.indexOf(uid(1))<html.indexOf(uid(2)));
context.adminPayoutGlobalOpenMonthFromUi('2026-09-01');
assert.equal(monthInput.value,'2026-09');
assert.equal(monthOpen,1);
assert.equal(context.adminPayoutReviewState,null);
assert.equal(context.adminPayoutFollowupState,null);
context.adminPayoutGlobalOpenMonthFromUi('2026-08-01');
assert.equal(monthOpen,1,'unsupported month must not trigger a read');
role='readonly';
assert.equal(context.adminPayoutGlobalFollowupSection(),'');
await context.adminPayoutGlobalLoadFromUi();
assert.equal(calls.length,1,'unauthorized cannot query');
role='finance';
response={...base,bankSettlementVerified:true};
await context.adminPayoutGlobalLoadFromUi();
assert.ok(notifications.some(x=>/não validada/.test(x)));
assert.doesNotMatch(context.adminPayoutGlobalFollowupSection(),/Abrir competência para revisar/);
response={...base,activeOlderMonths:5};
await context.adminPayoutGlobalLoadFromUi();
assert.doesNotMatch(context.adminPayoutGlobalFollowupSection(),/Abrir competência para revisar/);
response={...base,rows:base.rows.map((r,i)=>i===1?{...r,priority:0}:r)};
await context.adminPayoutGlobalLoadFromUi();
assert.doesNotMatch(context.adminPayoutGlobalFollowupSection(),/Abrir competência para revisar/);
assert.ok(rendered>0);
console.log('V1.340 PASS: all-month backlog, September carry-over, priority, explicit month drill-down, access and no bank claims.');
