import assert from 'node:assert/strict';
import fs from 'node:fs';
import {returnWalletRefs,withWalletEvidence} from './refund-wallet-fixture-v1-871.mjs';

// Pure, synthetic evidence. No database write and no payment provider request.
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const code=read('supabase/functions/admin-ops/coupon-refund-merchant-history.js');
const {couponRefundMerchantHistorySummary:reconcile}=await import(
  'data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

const id={
 invoice:'66666666-6666-4666-8666-666666666666',
 customer:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 order:'11111111-1111-4111-8111-111111111111',
 otherOrder:'99999999-9999-4999-8999-999999999999',
 merchant:'33333333-3333-4333-8333-333333333333',
 voucher:'22222222-2222-4222-8222-222222222222',
 otherVoucher:'77777777-7777-4777-8777-777777777777',
 otherWallet:'88888888-8888-4888-8888-888888888888'
};
const application=(order_id,voucher_id)=>({
 invoice_id:id.invoice,customer_user_id:id.customer,order_id,
 voucher_id,quoted_merchant_id:id.merchant,face_cents:500,
 original_order_total_cents:9500,original_order_cashback_cents:500,
 applied_at:'2026-11-06T10:00:00Z'
});
const partnerUse=(order_id,voucher_id)=>({
 invoice_id:id.invoice,customer_id:id.customer,order_id,voucher_id,
 merchant_id:id.merchant,face_cents:500,gross_cents:10000,
 net_cents:9500,fee_bps_snapshot:900,created_at:'2026-11-06T10:00:01Z'
});
const order=(orderId,status='CANCELLED',financial_reversed_at=null)=>({
 id:orderId,customer_id:id.customer,merchant_id:id.merchant,
 status,financial_state:status==='CANCELLED'?'reversed':'settled',
 financial_reversed_at,risk_reason:status==='CANCELLED'?'buyer_cancelled':null
});
const returnRecord={
 invoice_id:id.invoice,customer_id:id.customer,order_id:id.order,
 voucher_id:id.voucher,amount_cents:500,disposition:'reissued',
 cause:'order_cancelled',recorded_at:'2026-11-06T10:01:00Z',
 ...returnWalletRefs(id.order)
};
const base={
 invoiceId:id.invoice,customerId:id.customer,fundingMode:'partner_funded',
 applications:[application(id.order,id.voucher)],applicationCount:1,
 partnerUses:[partnerUse(id.order,id.voucher)],partnerUseCount:1,
 returns:[returnRecord],returnCount:1,
 orders:[order(id.order)],
 issuances:[{id:id.voucher,invoice_id:id.invoice,customer_user_id:id.customer,
   face_cents:500,ordinal:1}],
 issuanceCount:1,couponFaceCents:500,couponsPerPack:3
};
const check=state=>reconcile(withWalletEvidence(state));
const good=check(base);
assert.equal(good.cashbackReleaseCoverage,'bounded_complete');
assert.equal(good.cashbackReleaseCount,1);
assert.equal(good.unmatchedCashbackReleaseCount,0);
assert.equal(good.walletReturnNeutralized,true);
assert.equal(good.walletReturnNetCents,0);
for(const f of ['merchantPayoutVerified','bankCreditVerified',
                  'refundClosureAuthorized','caseClosed','moneyMoved'])
 assert.equal(good[f],false,'wallet consistency never certifies bank payment');
const mustReject=(state,reason)=>assert.throws(
  ()=>check(state),/COUPON_REFUND_HISTORY_/,reason
);
const stored=withWalletEvidence(base);
const rogue={
 ...stored.releaseEntries[0],id:id.otherWallet,
 order_id:id.otherOrder,created_at:'2026-11-06T10:00:04Z',
 idempotency_key:'other:cashback-release'
};
mustReject({...base,releaseEntries:[...stored.releaseEntries,rogue]},
 'unreferenced release on an active or different voucher order must fail');
mustReject({...base,releaseEntries:[rogue]},
 'a release from an unrelated order cannot substitute for the returned order');
mustReject({...base,releaseEntries:[]},
 'an otherwise valid pair is not enough if order-wide release scan is empty');
mustReject({...base,releaseEntries:[stored.releaseEntries[0],{
 ...stored.releaseEntries[0],id:id.otherWallet}]},
 'duplicate cashback release on same order must fail');
mustReject({...base,releaseEntryCount:null},
 'unknown exact count cannot authorize a complete history');
mustReject({...base,releaseEntryCount:2},
 'declared release count cannot exceed actual list');
mustReject({...base,releaseEntries:[{
 ...stored.releaseEntries[0],amount_cents:501}]},
 'snapshot and order-wide release disagree on amount');
mustReject({...base,releaseEntries:[{
 ...stored.releaseEntries[0],metadata:{reason:'different-reason'}}]},
 'snapshot and order-wide release disagree on reason');
mustReject({...base,releaseEntries:[{
 ...stored.releaseEntries[0],created_at:'2026-11-06T10:00:05Z'}]},
 'snapshot and order-wide release disagree on timestamp');
mustReject({...base,releaseEntries:[{
 ...stored.releaseEntries[0],id:id.otherWallet}]},
 'referenced wallet release does not match order-wide scanned release');
mustReject({...base,releaseEntries:[{
 ...stored.releaseEntries[0],entry_type:'cashback_seed'}]},
 'non-release wallet entry cannot appear in release population');

// #874: the same pair/IDs/amounts can be fabricated from an older wallet
// event. A cancellation credit must not precede the partner's coupon use.
const earlyRelease=withWalletEvidence({...base,walletEntries:
 stored.walletEntries.map((row,i)=>i===0?{
  ...row,created_at:'2026-11-06T10:00:00Z'
 }:row)});
assert.throws(()=>reconcile(earlyRelease),
 /COUPON_REFUND_HISTORY_RETURN_CHRONOLOGY_OR_ORDER_STATE/,
 'release before partner use must never certify a voucher return');
const sameTick=check({...base,walletEntries:stored.walletEntries.map((row,i)=>
 i===0?{...row,created_at:'2026-11-06T10:00:01Z'}:row)});
assert.equal(sameTick.walletReturnNeutralized,true,
 'equal partner-use and wallet timestamp is allowed');

// This was silently presented as "neutralized" by #871: canceled/reversed
// partner-funded order, no voucher-return record, and hence no hold.
mustReject({...base,returns:[],returnCount:0},
 'canceled partner coupon without durable return is NOT neutralized');
mustReject({...base,returns:[],returnCount:0,orders:[
 order(id.order,'SETTLED','2026-11-06T10:00:59Z')]},
 'financially reversed partner coupon must have durable voucher return');

// A legitimate active order does NOT require a return.
const inProgress=check({...base,returns:[],returnCount:0,
 orders:[order(id.order,'SETTLED')]});
assert.equal(inProgress.returnCount,0);
assert.equal(inProgress.cashbackReleaseCount,0);
assert.equal(inProgress.unmatchedCashbackReleaseCount,0);

// A second legitimate application with a separate voucher and no return
// should not produce false positives; it is included in the DB-wide scan.
const second=check({...base,
 applications:[...base.applications,application(id.otherOrder,id.otherVoucher)],
 applicationCount:2,
 partnerUses:[...base.partnerUses,partnerUse(id.otherOrder,id.otherVoucher)],
 partnerUseCount:2,
 issuances:[...base.issuances,{id:id.otherVoucher,invoice_id:id.invoice,
   customer_user_id:id.customer,face_cents:500,ordinal:2}],
 issuanceCount:2,
 orders:[order(id.order),order(id.otherOrder,'SETTLED')]
});
assert.equal(second.applicationCount,2);
assert.equal(second.cashbackReleaseCount,1);
assert.equal(second.walletReturnPairCount,1);
// A rogue credit even on the active second order must be detected.
mustReject({...base,
 applications:[...base.applications,application(id.otherOrder,id.otherVoucher)],
 applicationCount:2,
 partnerUses:[...base.partnerUses,partnerUse(id.otherOrder,id.otherVoucher)],
 partnerUseCount:2,
 issuances:[...base.issuances,{id:id.otherVoucher,invoice_id:id.invoice,
   customer_user_id:id.customer,face_cents:500,ordinal:2}],
 issuanceCount:2,orders:[order(id.order),order(id.otherOrder,'SETTLED')],
 releaseEntries:[...stored.releaseEntries,rogue]
},'unreferenced credit on a still active order requires finance review');

const edge=read('supabase/functions/admin-ops/index.ts');
const start=edge.indexOf('if(action==="clube-coupon-refund-merchant-history-inspect")');
const stop=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',start);
assert.ok(start>0&&stop>start);
const action=edge.slice(start,stop);
for(const text of [
 'releaseEntryCount','releaseEntries:first.releaseEntries',
 '.in("order_id",orderIds)', '.eq("bucket","cashback")',
 '.eq("entry_type","cashback_release")',
 'releaseResult.count!==returnsResult.data.length',
 'JSON.stringify(first)!==JSON.stringify(second)'
])assert.ok(action.includes(text),'must verify all order releases: '+text);
assert.doesNotMatch(action,/\.insert\(|\.update\(|method:"POST"|mercadoPagoFetch/,
 'read-only financial evidence must not move funds or call PSP');
const ui=read('js/admin.js');
for(const fragment of [
 "r.cashbackReleaseCoverage!=='bounded_complete'",
 'r.cashbackReleaseCount!==r.returnCount',
 'r.unmatchedCashbackReleaseCount!==0',
 'créditos adicionais não conciliados: '
])assert.ok(ui.includes(fragment),'UI must fail closed: '+fragment);
console.log('PASS #873: order-wide cashback release scan, no orphan credits, no unreturned reversed voucher, no funds moved');
