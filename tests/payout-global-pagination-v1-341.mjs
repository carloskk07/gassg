import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=file('supabase/migrations/20261016235960_payout_global_followup_pages_v1_341.sql');
const edge=file('supabase/functions/admin-ops/index.ts');
const ui=file('js/admin-acquisition.js');
const bootstrap=file('js/bootstrap.js');
const workflow=file('.github/workflows/audit.yml');

for(const token of [
 'admin_owner_payout_global_followup_page_v1_341',
 'PAYOUT_GLOBAL_PAGE_INVALID','p_offset%30<>0',
 'p_offset<0','p_offset>999990',
 "a.active and a.admin_role in ('superadmin','finance')",
 "where not voided and review_state<>'closed_administrative'",
 'order by priority,due_at,claim_id limit 30 offset p_offset',
 "'scope','all_months'","'pagedV1341',true",
 "'pageOffset',p_offset","'pageLimit',30",
 "'hasPrevious',p_offset>0",
 'p_offset+30 from priority_cases',
 "'queueCoverage','global_pages_30'",
 "'bankSettlementVerified',false","'recipientVerified',false",
 "'moneyMoved',false","'readOnly',true,'administrativeOnly',true",
 'revoke all on function public.admin_owner_payout_global_followup_page_v1_341',
 'to service_role'
])assert.ok(sql.includes(token),'Missing SQL pagination protection: '+token);
assert.doesNotMatch(sql,/\b(?:insert\s+into|update\s+public|delete\s+from|drop\s+table|truncate\s+table)\b/i);

for(const token of [
 '"owner-payout-global-followup-page"',
 'admin_owner_payout_global_followup_page_v1_341',
 'PAYOUT_GLOBAL_PAGE_INVALID','PAYOUT_GLOBAL_PAGE_HISTORY_INVALID',
 'data?.pageOffset!==offset','data?.hasMore!==(offset+30<data.activeClaims)',
 'data?.moneyMoved!==false','data?.bankSettlementVerified!==false',
 'data.rows.length!==Math.min(30,Math.max(0,data.activeClaims-offset))'
])assert.ok(edge.includes(token),'Missing Edge read verification: '+token);
assert.match(bootstrap,/adminPayoutGlobalLoadFromUi/);
assert.match(workflow,/node tests\/payout-global-pagination-v1-341\.mjs/);
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(bootstrap,{filename:'bootstrap.js'});
const start=ui.indexOf('// TAMÃO V1.340 —'),end=ui.indexOf('function adminPayoutFollowupSection(){',start);
assert.ok(start>0&&end>start);
const actor='11111111-1111-4111-8111-111111111111';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const mk=(n,month='2026-10')=>({
 claimId:uuid(n),orderId:uuid(n+100),claimMonth:month+'-01',
 paidOn:month+'-10',reportedAmountCents:n*100,
 reviewState:'not_started',followupDueAt:'2026-10-18T14:00:00Z',
 overdue:false,criticalReversalObserved:false,priority:2
});
const firstPage=[mk(1,'2026-09'),...Array.from({length:29},(_,i)=>mk(i+2))];
const rest=Array.from({length:5},(_,i)=>mk(i+31));
const base={
 source:'admin_payout_global_followup_v1_340',scope:'all_months',
 timezone:'America/Sao_Paulo',readOnly:true,administrativeOnly:true,
 bankSettlementVerified:false,recipientVerified:false,moneyMoved:false,
 duePolicy:'internal_guidance_not_external_SLA',
 activeClaims:35,activeOlderMonths:1,overdueClaims:0,
 criticalReversalClaims:0,unreviewedClaims:35,
 awaitingEvidenceClaims:0,distinctMonths:2,limit:30,truncated:true
};
const initial={...base,rows:firstPage};
const continuation={...base,pagedV1341:true,queueCoverage:'global_pages_30',
 pageOffset:30,pageLimit:30,hasPrevious:true,hasMore:false,rows:rest};
let response=continuation,bad=false,role='superadmin',requests=[],notices=[],monthLoads=0;
const month={value:'2026-10'};
const context=vm.createContext({
 adminPayoutReviewHistoryMarkup:()=>'', // isolated global renderer; direct-review tested in V1.342,
 adminPayoutReviewBusy:false, // journal state is defined outside this isolated UI slice
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:id=>id==='owner-campaign-signals-month'?month:null},
 adminInvoke:async request=>{
   requests.push(request);
   if(request.action==='owner-payout-global-followup-read')return initial;
   if(request.action==='owner-payout-global-followup-page')
     return bad?{...continuation,hasMore:true}:response;
   throw new Error('Unexpected read action '+request.action);
 },
 adminPayoutFollowupBusy:false,adminPayoutReviewState:null,
 adminPayoutFollowupState:null,
 adminPayoutFollowupLoadFromUi:()=>{monthLoads++;},
 toast:x=>notices.push(x),render:()=>{},
 adminMoney:x=>'R$ '+(x/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Date,Number,String,Array
});
vm.runInContext(ui.slice(start,end),context);
await context.adminPayoutGlobalLoadFromUi();
assert.equal(requests[0].action,'owner-payout-global-followup-read');
let html=context.adminPayoutGlobalFollowupSection();
assert.match(html,/Mostrando 1–30 de 35/);
assert.match(html,/adminPayoutGlobalLoadFromUi\(30\)/);
assert.ok(html.includes(uuid(1)));
await context.adminPayoutGlobalLoadFromUi(30);
assert.equal(requests[1].action,'owner-payout-global-followup-page');
assert.equal(requests[1].offset,30);
html=context.adminPayoutGlobalFollowupSection();
assert.match(html,/Mostrando 31–35 de 35/);
assert.match(html,/adminPayoutGlobalLoadFromUi\(0\)/);
assert.ok(html.includes(uuid(31))&&!html.includes(uuid(1)));
assert.ok(html.includes('Abrir competência para revisar'));
context.adminPayoutGlobalOpenMonthFromUi('2026-10-01');
assert.equal(month.value,'2026-10');
assert.equal(monthLoads,1);
const before=requests.length;
await context.adminPayoutGlobalLoadFromUi(31);
assert.equal(requests.length,before,'misaligned page never reaches backend');
bad=true;
await context.adminPayoutGlobalLoadFromUi(30);
assert.ok(notices.some(x=>/não validada/.test(x)));
assert.ok(!context.adminPayoutGlobalFollowupSection().includes(uuid(31)),
  'fail closed after invalid continuation');
bad=false;role='finance';
await context.adminPayoutGlobalLoadFromUi(30);
assert.match(context.adminPayoutGlobalFollowupSection(),/Mostrando 31–35/);
role='readonly';
assert.equal(context.adminPayoutGlobalFollowupSection(),'');
const count=requests.length;
await context.adminPayoutGlobalLoadFromUi(30);
assert.equal(requests.length,count);
console.log('V1.341 PASS: global page 31+, page offsets, ACL, monthly jump, invalid data rejection and no financial effects.');
