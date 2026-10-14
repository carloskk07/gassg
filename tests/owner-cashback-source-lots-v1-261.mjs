import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014235000_cashback_source_lots_v1_261.sql');
const fix=read('supabase/migrations/20261014235100_cashback_trace_retention_v1_261.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const workflow=read('.github/workflows/audit.yml');
for(const part of [
 'platform_cashback_source_lots_v1_261',
 'platform_cashback_trace_events_v1_261',
 'platform_cashback_trace_flows_v1_261',
 'platform_cashback_trace_private_v1_261.capture()',
 'platform_cashback_trace_private_v1_261.summary(',
 'public.admin_owner_cashback_source_lots_v1_261',
 "when (new.bucket='cashback')",
 "new.entry_type='cashback_reserve'",
 "new.entry_type='cashback_release'",
 "new.entry_type='cashback_reversal'",
 "new.entry_type in ('cashback_seed','cashback_earn')",
 'order by issued_at,lot_id for update',
 "and f.direction='reserve'",
 "rr.direction='release'",
 "e.order_id=new.order_id",
 'v_lot.refundable',
 'exception when others then',
 "where l.user_id=new.user_id and e.order_id=new.order_id",
 "old.matched_cents=0 and new.matched_cents>=0",
 'unmatched_cents bigint generated always as',
 'wallet_entry_id uuid primary key references public.wallet_entries(id) on delete cascade',
 'walletEntries',
 "'lotAllocationMethod','fifo_bookkeeping_convention'",
 "'captureMode','forward_only_after_wallet_insert'",
 "'legacyBackfillPerformed',false",
 "'externalPaidBenefitsCents',null",
 "'readOnly',true",
 'grant execute on function public.admin_owner_cashback_source_lots_v1_261(uuid,date)',
]) assert.ok(sql.includes(part),'Missing SQL contract: '+part);
assert.ok(fix.includes('before update on public.platform_cashback_trace_events_v1_261'));
assert.ok(fix.includes('before update on public.platform_cashback_trace_flows_v1_261'));
assert.ok(!fix.includes('before update or delete'));
assert.ok(sql.includes('alter table public.platform_cashback_source_lots_v1_261 enable row level security'));
assert.ok(sql.includes('alter table public.platform_cashback_trace_events_v1_261 enable row level security'));
assert.ok(sql.includes('alter table public.platform_cashback_trace_flows_v1_261 enable row level security'));
assert.ok(edge.includes('"owner-cashback-source-lots"'));
assert.ok(edge.includes('if(action==="owner-cashback-source-lots")'));
assert.ok(edge.includes('admin_owner_cashback_source_lots_v1_261'));
assert.ok(edge.includes('data?.externalPaidBenefitsCents!==null'));
assert.ok(edge.includes('data?.lotAllocationMethod!=="fifo_bookkeeping_convention"'));
assert.ok(ui.includes('adminOwnerCashbackSourceLotsSection()'));
assert.ok(boot.includes('adminOwnerWalletReconLoadFromUi,adminOwnerSourceLotsLoadFromUi'));
assert.ok(workflow.includes('node tests/owner-cashback-source-lots-v1-261.mjs'));
new vm.Script(ui,{filename:'js/admin-acquisition.js'});
new vm.Script(boot,{filename:'js/bootstrap.js'});
const sample={
 source:'admin_owner_cashback_source_lots_v1_261',month:'2026-10-01',
 timezone:'America/Sao_Paulo',captureMode:'forward_only_after_wallet_insert',
 lotAllocationMethod:'fifo_bookkeeping_convention',walletIsAuthoritative:true,
 legacyBackfillPerformed:false,
 events:{walletEntries:4,capturedEntries:3,untrackedEntries:1,partialEntries:1,
   matchedCents:750,unmatchedCents:50},
 issuance:{newLots:2,issuedCents:700,remainingCents:250,
   seedIssuedCents:200,earnedIssuedCents:500},
 settledUse:{settledAssignedCents:300,settledPartiallyAssignedCents:100,
   settledUnassignedCents:50,fullyAssignedOrders:1,partiallyAssignedOrders:1},
 totalCampaigns:1,limit:50,truncated:false,
 rows:[{allocationId:'22222222-2222-4222-8222-222222222222',
  campaignTag:'tam-customer_cashback-202610-campanha_01',
  campaignLabel:'Campanha promocional de cashback',
  earnedIssuedCents:500,earnedRemainingCents:150}],
 readOnly:true,noTransfers:true,newBenefitsEnabled:false,
 externalPaidBenefitsCents:null,externalPayoutMeasured:false,
 bankSettlementVerified:false,profitMeasured:false,roiMeasured:false
};
let data=structuredClone(sample),role='superadmin',calls=[],messages=[];
const actor='11111111-1111-4111-8111-111111111111';
const ctx=vm.createContext({
 adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:actor}}},
 document:{getElementById:()=>({value:'2026-10'})},
 adminInvoke:async request=>{calls.push(request);return data;},
 render:()=>{},toast:x=>messages.push(x),
 adminMoney:x=>'R$ '+(x/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Array,Date
});
const start=ui.indexOf('// TAMÃO V1.261 —');
const end=ui.indexOf('// TAMÃO V1.260 —',start);
assert.ok(start>=0&&end>start,'V1.261 isolated UI section');
vm.runInContext(ui.slice(start,end),ctx);
assert.ok(!ctx.adminOwnerCashbackSourceLotsSection().includes('R$ 7.00'));
await ctx.adminOwnerSourceLotsLoadFromUi();
assert.equal(calls[0].action,'owner-cashback-source-lots');
assert.equal(calls[0].month,'2026-10-01');
let html=ctx.adminOwnerCashbackSourceLotsSection();
for(const val of ['R$ 7.00','R$ 2.50','R$ 3.00','R$ 0.50','Campanha promocional','FIFO'])
 assert.ok(html.includes(val),'missing displayed value '+val);
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerCashbackSourceLotsSection().includes('R$ 7.00'));
ctx.adminRuntime.session.user.id=actor;
role='readonly';
assert.equal(ctx.adminOwnerCashbackSourceLotsSection(),'');
await ctx.adminOwnerSourceLotsLoadFromUi();
assert.equal(calls.length,1);
role='superadmin';
data={...sample,events:{...sample.events,untrackedEntries:2}};
await ctx.adminOwnerSourceLotsLoadFromUi();
assert.ok(messages.some(x=>x.includes('não validada')));
assert.ok(!ctx.adminOwnerCashbackSourceLotsSection().includes('R$ 7.00'));
console.log('V1.261 PASS — source lot tracking, untracked alerts, role guards, no payout claims.');
