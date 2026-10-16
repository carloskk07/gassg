import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/admin-acquisition.js');
const workflow=read('.github/workflows/audit.yml');
assert.match(workflow,/node tests\/payout-global-page-recovery-v1-343\.mjs/);
new vm.Script(js,{filename:'admin-acquisition.js'});
for(const term of [
  'async function adminPayoutGlobalLoadFromUi(offset=0,recoveryAttempted=false)',
  'd.activeClaims<=offset&&d.rows.length===0&&!recoveryAttempted',
  'Math.floor((d.activeClaims-1)/30)*30:0',
  'adminPayoutGlobalState=null',
  "adminPayoutReviewState?.origin==='global'",
  'adminPayoutGlobalLoadFromUi(recoveryOffset,true)',
  'A fila mudou durante a navegação',
  '!d.rows.some(x=>x.claimId===adminPayoutReviewState.claimId)'
]) assert.ok(js.includes(term),'missing safe recovery: '+term);

const start=js.indexOf('// TAMÃO V1.340 —');
const end=js.indexOf('function adminPayoutFollowupSection(){',start);
assert.ok(start>=0&&end>start);
const actor='11111111-1111-4111-8111-111111111111';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const mk=(n)=>({
  claimId:uuid(n),orderId:uuid(n+100),claimMonth:'2026-10-01',
  paidOn:'2026-10-14',reportedAmountCents:n*10,
  reviewState:'not_started',followupDueAt:'2026-10-18T10:00:00Z',
  overdue:false,criticalReversalObserved:false,priority:2
});
const make=(total,offset)=>{
  const rows=Array.from(
    {length:Math.max(0,Math.min(30,total-offset))},
    (_,i)=>mk(offset+i+1)
  );
  return {
    source:'admin_payout_global_followup_v1_340',
    scope:'all_months',timezone:'America/Sao_Paulo',readOnly:true,
    administrativeOnly:true,bankSettlementVerified:false,
    recipientVerified:false,moneyMoved:false,
    duePolicy:'internal_guidance_not_external_SLA',
    activeClaims:total,activeOlderMonths:0,overdueClaims:0,
    criticalReversalClaims:0,unreviewedClaims:total,
    awaitingEvidenceClaims:0,distinctMonths:total?1:0,
    limit:30,truncated:total>30,rows,
    ...(offset?{
      pagedV1341:true,queueCoverage:'global_pages_30',
      pageOffset:offset,pageLimit:30,hasPrevious:true,
      hasMore:offset+30<total
    }:{})
  };
};
let plan=[],requests=[],notices=[],role='superadmin',renderCount=0;
const month={value:'2026-10'};
const ctx=vm.createContext({
  adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
  document:{getElementById:id=>id==='owner-campaign-signals-month'?month:null},
  adminInvoke:async p=>{
    requests.push(p);
    const next=plan.shift();
    assert.ok(next,'unexpected extra page request');
    assert.equal(next.action,p.action);
    if(p.action==='owner-payout-global-followup-page')
      assert.equal(p.offset,next.offset);
    return next.data;
  },
  adminPayoutReviewHistoryMarkup:()=>'',adminPayoutReviewBusy:false,
  adminPayoutReviewState:null,adminPayoutFollowupBusy:false,
  adminPayoutFollowupState:null,adminPayoutFollowupLoadFromUi:()=>{},
  render:()=>{renderCount++},toast:t=>notices.push(t),
  adminMoney:n=>'R$ '+(n/100).toFixed(2),
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  Date,Number,String,Array
});
vm.runInContext(js.slice(start,end),ctx);
const page=(offset,data)=>({
  action:offset?'owner-payout-global-followup-page':'owner-payout-global-followup-read',
  offset,data
});

// 35 -> 30: closure of the last claim leaves the old second page empty.
plan=[page(30,make(30,30)),page(0,make(30,0))];
ctx.adminPayoutReviewState={origin:'global',claimId:uuid(35),loadedFor:actor};
await ctx.adminPayoutGlobalLoadFromUi(30);
assert.equal(plan.length,0);
assert.deepEqual(requests.map(x=>x.offset??0),[30,0]);
assert.match(ctx.adminPayoutGlobalFollowupSection(),/Mostrando 1–30 de 30/);
assert.equal(ctx.adminPayoutReviewState,null,'must evict old claim journal');
assert.equal(requests.length,2,'recovery is bounded');

// 35 -> 0: all pending claims closed, show consistent empty first page.
requests=[];plan=[page(30,make(0,30)),page(0,make(0,0))];
await ctx.adminPayoutGlobalLoadFromUi(30);
assert.equal(plan.length,0);
assert.match(ctx.adminPayoutGlobalFollowupSection(),/Mostrando 0–0 de 0/);
assert.doesNotMatch(ctx.adminPayoutGlobalFollowupSection(),/31–30 de/);
assert.deepEqual(requests.map(x=>x.offset??0),[30,0]);

// The queue changes twice during recovery: never loop indefinitely or
// render a stale out-of-range page as valid.
requests=[];
plan=[page(60,make(31,60)),page(30,make(29,30))];
await ctx.adminPayoutGlobalLoadFromUi(60);
assert.equal(requests.length,2);
assert.equal(plan.length,0);
assert.ok(notices.some(x=>/A fila mudou durante a navegação/.test(x)));
assert.doesNotMatch(ctx.adminPayoutGlobalFollowupSection(),/Mostrando 61/);

// Valid empty second page with recoveryAttempted true is never considered
// evidence of an actual remaining claim; the operator needs a new refresh.
const reqCount=requests.length;
role='readonly';await ctx.adminPayoutGlobalLoadFromUi(30);
assert.equal(requests.length,reqCount,'unauthorized role never issues requests');
assert.ok(renderCount>=3);
console.log('V1.343 PASS: automatic previous-page recovery, empty-queue display, stale-review eviction and bounded fail-closed retry.');
