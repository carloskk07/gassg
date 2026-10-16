import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016235945_payout_priority_review_queue_v1_335.sql');
const js=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
const cte=sql.slice(sql.indexOf(' with selected as ('),sql.indexOf(' return jsonb_build_object(',sql.indexOf(' with selected as (')));
for(const s of [
  'c.order_id','c.paid_on','c.amount_cents','case',
  'g.reversed_at is not null','historical.provider_transaction_success is true',
  'when v.claim_id is null and o.checked_at is null then 3',
  'when v.claim_id is null and p.claim_id is null then 4',
  'end as priority','order by priority,c.reported_at desc,c.claim_id limit 30',
  "'orderId',order_id","'priority',priority","'reportedAmountCents',amount_cents",
  'order by priority,reported_at desc,claim_id'
])assert.ok(cte.includes(s)||sql.includes(s),'Missing SQL priority feature: '+s);
for(const s of ["'triageV1335',true","'queueCoverage','top_30_prioritized'",
  "'queueOrder','priority_then_reported_at'",
  "'bankSettlementVerified',false","'recipientVerified',false",
  "'readOnly',true,'noTransfers',true",'PAYOUT_PROVIDER_READ_DENIED',
  "'externalPaidBenefitsCents',null"
])assert.ok(sql.includes(s),'SQL safety contract lost: '+s);
assert.doesNotMatch(sql,/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+public\.|DROP\s+TABLE|TRUNCATE\s+)\b/i);
assert.match(boot,/adminOwnerPayoutQueueSetFilterFromUi,adminOwnerPayoutQueuePrepareCheckFromUi/);
assert.match(audit,/node tests\/owner-payout-review-queue-v1-335\.mjs/);
new vm.Script(js,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});

const actor='11111111-1111-4111-8111-111111111111';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pop='POP01KKYN1QY2SS1MKAY4KP6SSRCT';
const top='TOP01KKYN1QY2SS1MKAY4G9DV5NK9';
const row=(n,changes={})=>({
 claimId:id(n),orderId:id(n+100),reportedAmountCents:n*100,
 paidOn:'2026-10-14',reportedAt:'2026-10-14T12:00:00Z',
 checkedAt:'2026-10-15T10:00:00Z',
 status:'pending',detail:'in_process',referenceMatches:true,amountMatches:true,
 providerTransactionSuccess:false,successNow:false,
 proofPresent:true,voided:false,grantReversedNow:false,
 historicalProviderSuccessObserved:false,requiresReversalReview:false,
 priority:5,payoutId:pop,transactionId:top,...changes
});
const rows=[
 row(1,{priority:0,grantReversedNow:true,historicalProviderSuccessObserved:true,
   requiresReversalReview:true,providerTransactionSuccess:true,status:'success',detail:'accredited'}),
 row(2,{priority:1,grantReversedNow:true}),
 row(3,{priority:2,referenceMatches:false}),
 row(4,{priority:3,checkedAt:null,status:null,detail:null,referenceMatches:null,
   amountMatches:null,providerTransactionSuccess:null,payoutId:null,transactionId:null}),
 row(5,{priority:4,proofPresent:false,providerTransactionSuccess:true,successNow:true,
   status:'success',detail:'accredited'}),
 row(6,{priority:5,voided:true,checkedAt:null,status:null,detail:null,
   referenceMatches:null,amountMatches:null,providerTransactionSuccess:null,payoutId:null,transactionId:null})
];
const sample={
 source:'owner_payout_provider_reconciliation_v1_265',
 provider:'mercado_pago_payouts_get',timezone:'America/Sao_Paulo',
 month:'2026-10-01',readOnly:true,noTransfers:true,
 recipientVerified:false,bankSettlementVerified:false,
 providerTransactionIsBeneficiaryProof:false,externalPaidBenefitsCents:null,
 triageV1335:true,queueCoverage:'top_30_prioritized',
 queueOrder:'priority_then_reported_at',
 historicalProviderSuccessIsBankProof:false,automaticRecoveryExecuted:false,
 totalClaims:6,checkedClaims:4,providerSuccessClaims:1,
 checkedUnmatchedClaims:3,unqueriedClaims:2,limit:30,truncated:false,
 activeReversedClaims:2,activeReversedReportedCents:300,
 reversedWithHistoricalProviderSuccessClaims:1,
 activeReversedWithHistoricalProviderSuccessClaims:1,rows
};
let role='superadmin',calls=[],messages=[],renders=0,data=sample;
const elements={
 'owner-campaign-signals-month':{value:'2026-10'},
 'owner-provider-claim':{value:''},
 'owner-provider-payout':{value:''},
 'owner-provider-transaction':{value:''}
};
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},
 adminCurrentRole:()=>role,adminInvoke:async args=>{calls.push(args);return data;},
 document:{getElementById:id=>elements[id]||null},
 render:()=>{renders++;},toast:t=>messages.push(t),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 adminMoney:c=>`R$ ${(c/100).toFixed(2)}`,String,Number,Array,Date
});
const start=js.indexOf('// V1.265 —');
const end=js.indexOf('// TAMÃO V1.264 —',start);
assert.ok(start>=0&&end>start);
vm.runInContext(js.slice(start,end),ctx,{filename:'admin-payout-review-section'});
await ctx.adminOwnerPayoutProviderLoadFromUi();
assert.equal(calls.length,1);
assert.equal(calls[0].action,'owner-payout-provider-read');
let html=ctx.adminOwnerPayoutProviderSection();
for(const value of [
 'Central de revisão','Estorno após sucesso observado','Pedido',
 'Valor declarado','Comprovante privado','Próximo passo',
 'até 30 registros priorizados','2','3','Beneficiário'
])assert.ok(html.toLowerCase().includes(value.toLowerCase()),'UI missing '+value);
assert.ok(html.indexOf(id(1))<html.indexOf(id(2)));
assert.ok(html.indexOf(id(2))<html.indexOf(id(3)));
assert.ok(html.includes('Preparar conferência externa'));
ctx.adminOwnerPayoutQueueSetFilterFromUi('critical');
html=ctx.adminOwnerPayoutProviderSection();
assert.ok(html.includes(id(1))&&html.includes(id(2)));
assert.ok(!html.includes(id(3))&&!html.includes(id(4)));
ctx.adminOwnerPayoutQueueSetFilterFromUi('pending');
html=ctx.adminOwnerPayoutProviderSection();
assert.ok(html.includes(id(5)));
assert.ok(!html.includes(id(6)));
ctx.adminOwnerPayoutQueueSetFilterFromUi('all');
ctx.adminOwnerPayoutQueuePrepareCheckFromUi(id(1));
assert.equal(elements['owner-provider-claim'].value,id(1));
assert.equal(elements['owner-provider-payout'].value,pop);
assert.equal(elements['owner-provider-transaction'].value,top);
assert.equal(calls.length,1,'prefill MUST NOT call the PSP or admin service');
ctx.adminOwnerPayoutQueuePrepareCheckFromUi(id(4));
assert.equal(calls.length,1,'missing identifiers MUST NOT trigger external lookup');
assert.ok(messages.some(x=>/não possui os IDs externos/.test(x)));
role='finance';
assert.ok(!ctx.adminOwnerPayoutProviderSection().includes('Preparar conferência externa'));
ctx.adminOwnerPayoutQueuePrepareCheckFromUi(id(1));
assert.equal(calls.length,1);
role='readonly';
assert.equal(ctx.adminOwnerPayoutProviderSection(),'');
role='superadmin';
data={...sample,activeReversedWithHistoricalProviderSuccessClaims:3};
await ctx.adminOwnerPayoutProviderLoadFromUi();
assert.ok(messages.some(x=>/não validada/.test(x)),'reject inconsistent aggregate counts');
assert.ok(!ctx.adminOwnerPayoutProviderSection().includes(id(1)));
data={...sample,rows:sample.rows.map((r,i)=>i===0?{...r,requiresReversalReview:false}:r)};
await ctx.adminOwnerPayoutProviderLoadFromUi();
assert.ok(!ctx.adminOwnerPayoutProviderSection().includes(id(1)));
assert.ok(renders>0);
console.log('V1.335 PASS: priority-first read-only queue, account ACL, risk filters, safe PSP form, no money movement, fail-closed contract.');
