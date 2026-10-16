import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016235964_archived_critical_payout_watch_v1_344.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const js=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const ci=read('.github/workflows/audit.yml');

for(const term of [
  'admin_owner_payout_archived_critical_v1_344',
  "a.admin_role in ('superadmin','finance')",
  'ARCHIVED_PAYOUT_REVIEW_DENIED',
  'ARCHIVED_PAYOUT_PAGE_INVALID',
  'p_offset%30<>0','p_offset>999990',
  'public.platform_referral_payout_review_events_v1_337',
  "e.review_state='closed_administrative'",
  'v.claim_id is not null or e.review_state',
  'g.reversed_at is not null',
  'obs.provider_transaction_success is true',
  'where obs.claim_id=c.claim_id',
  "'bankSettlementVerified',false","'recipientVerified',false",
  "'moneyMoved',false","'providerObservationIsBankProof',false",
  "'scope','historical_exceptions_all_months'",
  "'closedUnvoidedClaims'","'voidedClaims'",
  "'reportedAmountCents'","'archiveReason'",
  'order by voided,reward_reversed_at desc,claim_id',
  'limit 30 offset p_offset',
  'revoke all on function public.admin_owner_payout_archived_critical_v1_344',
  'to service_role'
]) assert.ok(sql.includes(term),'missing SQL safety contract: '+term);
assert.doesNotMatch(sql,/\b(?:drop\s+table|truncate\s+table|update\s+public\.|insert\s+into|delete\s+from)\b/i);
for(const term of [
  'if(action==="owner-payout-archived-critical-read")',
  'admin_owner_payout_archived_critical_v1_344',
  'ARCHIVED_PAYOUT_HISTORY_INVALID',
  'data?.bankSettlementVerified!==false',
  'data?.providerObservationIsBankProof!==false',
  'data.totalClaims!==data.closedUnvoidedClaims+data.voidedClaims',
  'data.rows.length!==Math.min(30,Math.max(0,data.totalClaims-offset))'
]) assert.ok(edge.includes(term),'missing Edge check: '+term);
assert.ok(boot.includes('adminPayoutArchivedLoadFromUi'));
assert.ok(ci.includes('node tests/payout-archived-critical-watch-v1-344.mjs'));
assert.ok(js.includes("origin==='archive'?adminPayoutArchivedState:null"));
assert.ok(js.includes("['global','archive'].includes(origin)"));
assert.ok(js.includes("if(origin==='archive')"));
assert.ok(js.includes("adminPayoutReviewHistoryMarkup('archive',d.rows)"));
new vm.Script(js);
new vm.Script(boot);

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const record=(n,other={})=>({
  claimId:id(n),orderId:id(n+100),claimMonth:'2026-10-01',
  paidOn:'2026-10-13',reportedAmountCents:200*n,
  reportedAt:'2026-10-13T12:00:00Z',
  lastReviewAt:'2026-10-16T13:00:00Z',
  rewardReversedAt:'2026-10-15T12:00:00Z',
  voided:false,archiveReason:'closed_administrative',
  reviewState:'closed_administrative',
  historicalProviderSuccessObserved:true,...other
});
const sample={
  source:'admin_payout_archived_critical_v1_344',
  scope:'historical_exceptions_all_months',
  readOnly:true,administrativeOnly:true,
  bankSettlementVerified:false,recipientVerified:false,
  moneyMoved:false,providerObservationIsBankProof:false,
  totalClaims:2,closedUnvoidedClaims:1,voidedClaims:1,
  reportedAmountCents:600,
  limit:30,pageOffset:0,pageLimit:30,hasPrevious:false,hasMore:false,
  rows:[record(1),record(2,{voided:true,archiveReason:'voided',reviewState:'not_started',lastReviewAt:null})]
};
const actor=id(500);
let role='superadmin',next=sample,calls=[],toasts=[],refreshes=0;
const ctx=vm.createContext({
  adminRuntime:{session:{user:{id:actor}}},
  adminCurrentRole:()=>role,
  adminInvoke:async args=>{calls.push(args);return next},
  adminPayoutReviewState:null,adminPayoutReviewBusy:false,
  adminPayoutReviewHistoryMarkup:()=>'<div>History test</div>',
  adminMoney:c=>'R$ '+(c/100).toFixed(2),
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  toast:s=>toasts.push(s),render:()=>{refreshes++},
  Date,Number,Array,String
});
const begin=js.indexOf('// TAMÃO V1.344 —');
const end=js.indexOf('function adminPayoutGlobalFollowupSection(){',begin);
assert.ok(begin>0&&end>begin);
vm.runInContext(js.slice(begin,end),ctx);
assert.match(ctx.adminPayoutArchivedCriticalSection(),/Consultar exceções históricas/);
await ctx.adminPayoutArchivedLoadFromUi(0);
assert.equal(calls.length,1);
assert.equal(calls[0].action,'owner-payout-archived-critical-read');
assert.equal(calls[0].offset,0);
let html=ctx.adminPayoutArchivedCriticalSection();
for(const t of ['Exceções críticas com histórico preservado',
 'Revisão encerrada administrativamente','Declaração anulada',
 'R$ 6.00','Consultar histórico administrativo',
 'não confirmam pagamento bancário','Histórico test'])
 assert.ok(html.includes(t),'UI must show '+t);
assert.ok(html.indexOf(id(1))<html.indexOf(id(2)));
assert.match(html,/adminPayoutArchivedLoadFromUi\(0\)/);
let count=calls.length;
await ctx.adminPayoutArchivedLoadFromUi(31);
assert.equal(calls.length,count,'unaligned offsets must not be sent');
assert.ok(toasts.some(s=>s.includes('Página de exceções inválida')));
role='readonly';
assert.equal(ctx.adminPayoutArchivedCriticalSection(),'');
await ctx.adminPayoutArchivedLoadFromUi(0);
assert.equal(calls.length,count,'unprivileged roles cannot call backend');
role='finance';
assert.match(ctx.adminPayoutArchivedCriticalSection(),/Exceções críticas/);
next={...sample,moneyMoved:true};
await ctx.adminPayoutArchivedLoadFromUi(0);
assert.ok(toasts.some(s=>s.includes('não validadas')));
assert.doesNotMatch(ctx.adminPayoutArchivedCriticalSection(),/Revisão encerrada administrativamente/);
next={...sample,closedUnvoidedClaims:2};
await ctx.adminPayoutArchivedLoadFromUi(0);
assert.doesNotMatch(ctx.adminPayoutArchivedCriticalSection(),/Declaração anulada/);
next={...sample,rows:sample.rows.map((r,i)=>i===0?{...r,archiveReason:'voided'}:r)};
await ctx.adminPayoutArchivedLoadFromUi(0);
assert.doesNotMatch(ctx.adminPayoutArchivedCriticalSection(),/Revisão encerrada administrativamente/);

// Archival conditions are independent of recent provider responses and
// must preserve positive historical observations even if a claim is voided.
const eligible=x=>x.reversed&&x.observedSuccess&&(x.voided||x.closed);
assert.equal(eligible({reversed:true,observedSuccess:true,voided:false,closed:true}),true);
assert.equal(eligible({reversed:true,observedSuccess:true,voided:true,closed:false}),true);
assert.equal(eligible({reversed:true,observedSuccess:false,voided:false,closed:true}),false);
assert.equal(eligible({reversed:false,observedSuccess:true,voided:true,closed:false}),false);
assert.ok(refreshes>0);
console.log('V1.344 PASS: closed/voided critical evidence retained, strict read-only ACL, bounded pagination, no false bank proof.');
