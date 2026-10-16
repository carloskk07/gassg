import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016235950_payout_review_pages_v1_336.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const audit=read('.github/workflows/audit.yml');
for(const term of [
  'platform_payout_provider_private_v1_265.read_page(',
  'p_offset integer DEFAULT 0','PAYOUT_PAGE_INVALID',
  'p_offset%30<>0','p_offset>999990',
  'order by priority,c.reported_at desc,c.claim_id limit 30 offset p_offset',
  "'pageOffset',p_offset","'pageLimit',30","'hasPrevious',p_offset>0",
  'p_offset+jsonb_array_length(v_rows)<v_total',
  "'triageV1336',true","'queueCoverage','paginated_30_prioritized'",
  'public.admin_owner_payout_provider_page_v1_336(',
  'revoke all on function public.admin_owner_payout_provider_page_v1_336',
  'revoke all on function platform_referral_payout_private_v1_265.read_page',
  'to service_role','PAYOUT_PROVIDER_READ_DENIED',
  "'readOnly',true,'noTransfers',true","'bankSettlementVerified',false",
  "'recipientVerified',false"
])assert.ok(sql.includes(term),'missing paged database contract: '+term);
assert.doesNotMatch(sql,/\b(?:delete\s+from|insert\s+into\s+public|update\s+public|drop\s+table|truncate)\b/i);
for(const term of [
 '"owner-payout-provider-page"',
 'admin_owner_payout_provider_page_v1_336',
 'PAYOUT_PAGE_HISTORY_INVALID',
 'data?.triageV1336!==true',
 'data?.pageOffset!==offset',
 'data.hasMore!==(offset+data.rows.length<data.totalClaims)',
 'data?.bankSettlementVerified!==false',
 'data?.recipientVerified!==false',
 'data?.noTransfers!==true'
])assert.ok(edge.includes(term),'missing Edge verification: '+term);
assert.match(audit,/node tests\/owner-payout-review-pagination-v1-336\.mjs/);
new vm.Script(ui);
const start=ui.indexOf('// V1.265 —');
const end=ui.indexOf('// TAMÃO V1.264 —',start);
assert.ok(start>0&&end>start);

const actor='11111111-1111-4111-8111-111111111111';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const row=n=>({claimId:uuid(n),orderId:uuid(n+200),
  priority:5,reportedAmountCents:125,paidOn:'2026-10-16',
  reportedAt:'2026-10-16T12:05:00Z',checkedAt:null,
  status:null,detail:null,referenceMatches:null,amountMatches:null,
  providerTransactionSuccess:null,successNow:false,proofPresent:false,
  voided:false,grantReversedNow:false,historicalProviderSuccessObserved:false,
  requiresReversalReview:false,payoutId:null,transactionId:null});
const base={
 source:'owner_payout_provider_reconciliation_v1_265',provider:'mercado_pago_payouts_get',
 month:'2026-10-01',timezone:'America/Sao_Paulo',readOnly:true,noTransfers:true,
 recipientVerified:false,bankSettlementVerified:false,
 providerTransactionIsBeneficiaryProof:false,externalPaidBenefitsCents:null,
 triageV1335:true,queueOrder:'priority_then_reported_at',
 historicalProviderSuccessIsBankProof:false,automaticRecoveryExecuted:false,
 activeReversedClaims:0,activeReversedReportedCents:0,
 reversedWithHistoricalProviderSuccessClaims:0,
 activeReversedWithHistoricalProviderSuccessClaims:0,
 totalClaims:35,checkedClaims:0,providerSuccessClaims:0,
 checkedUnmatchedClaims:0,unqueriedClaims:35,limit:30,truncated:true
};
const page0={...base,queueCoverage:'top_30_prioritized',
 rows:Array.from({length:30},(_,n)=>row(n+1))};
const page1={...base,queueCoverage:'paginated_30_prioritized',triageV1336:true,
 pageOffset:30,pageLimit:30,hasPrevious:true,hasMore:false,
 rows:Array.from({length:5},(_,n)=>row(n+31))};
const fields={'owner-campaign-signals-month':{value:'2026-10'}};
const calls=[],messages=[];let role='superadmin';let badNext=false;
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:id=>fields[id]||null},
 adminInvoke:async input=>{
   calls.push(input);
   if(input.action==='owner-payout-provider-read')return page0;
   if(input.action==='owner-payout-provider-page')return badNext?
     {...page1,hasMore:true}:page1;
   throw new Error('Unexpected action');
 },
 render:()=>{},toast:t=>messages.push(t),
 adminMoney:n=>'R$ '+(n/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Date,Number,String,Array
});
vm.runInContext(ui.slice(start,end),ctx);
await ctx.adminOwnerPayoutProviderLoadFromUi();
assert.deepEqual(calls[0],{action:'owner-payout-provider-read',month:'2026-10-01'});
let html=ctx.adminOwnerPayoutProviderSection();
assert.match(html,/Mostrando 1–30 de 35/);
assert.match(html,/Próxima página/);
assert.match(html,/adminOwnerPayoutProviderLoadFromUi\(30\)/);
await ctx.adminOwnerPayoutProviderLoadFromUi(30);
assert.deepEqual(calls[1],{action:'owner-payout-provider-page',month:'2026-10-01',offset:30});
html=ctx.adminOwnerPayoutProviderSection();
assert.match(html,/Mostrando 31–35 de 35/);
assert.ok(html.includes(uuid(31))&&!html.includes(uuid(1)));
assert.match(html,/adminOwnerPayoutProviderLoadFromUi\(0\)/);
assert.match(html,/Próxima página/);
await ctx.adminOwnerPayoutProviderLoadFromUi(0);
assert.match(ctx.adminOwnerPayoutProviderSection(),/Mostrando 1–30 de 35/);
const n=calls.length;
await ctx.adminOwnerPayoutProviderLoadFromUi(31);
assert.equal(calls.length,n,'unbounded page requests must not be issued');
assert.ok(messages.some(m=>m.includes('Página de revisão inválida')));
badNext=true;
await ctx.adminOwnerPayoutProviderLoadFromUi(30);
assert.ok(messages.some(m=>m.includes('Conciliação do provedor não validada')));
assert.ok(!ctx.adminOwnerPayoutProviderSection().includes(uuid(31)),'bad page fail closed');
badNext=false;
role='finance';
await ctx.adminOwnerPayoutProviderLoadFromUi(30);
assert.match(ctx.adminOwnerPayoutProviderSection(),/Mostrando 31–35/);
role='readonly';
assert.equal(ctx.adminOwnerPayoutProviderSection(),'');
console.log('V1.336 PASS: priority-sorted pagination, bounded RPC calls, previous/next, role scope, bad-response rejection, no payments.');
