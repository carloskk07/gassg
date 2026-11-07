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
const stored=withWalletEvidence(base),seed=stored.canonicalSeedEntries[0];
assert.ok(seed&&seed.id===stored.seedEntries[0].id);
const good=check(base);
assert.equal(good.canonicalSeedCoverage,'bounded_complete');
assert.equal(good.canonicalSeedCount,1);
assert.equal(good.unmatchedCanonicalSeedCount,0);
assert.equal(good.couponSeedCount,1);
for(const key of ['moneyMoved','bankCreditVerified','merchantPayoutVerified',
 'caseClosed','refundClosureAuthorized'])
 assert.equal(good[key],false,'Internal canonical seed evidence is NOT bank proof');
const fail=(state,label)=>assert.throws(()=>check(state),
 /COUPON_REFUND_HISTORY_/,label);
fail({...base,canonicalSeedEntries:[]},'indexed lookup cannot omit source seed');
fail({...base,canonicalSeedEntryCount:null},'null count is not complete');
fail({...base,canonicalSeedEntryCount:2},'partial count cannot certify');
fail({...base,canonicalSeedEntries:[seed,seed]},'duplicate canonical rows rejected');
fail({...base,canonicalSeedEntries:[{...seed,id:id.otherWallet}]},
 'canonical seed with unexpected ledger ID fails');
fail({...base,canonicalSeedEntries:[{...seed,user_id:id.otherOrder}]},
 'same-key credit appearing in foreign wallet fails');
fail({...base,canonicalSeedEntries:[{...seed,amount_cents:1000}]},
 'canonical credit with wrong amount fails');
fail({...base,canonicalSeedEntries:[{...seed,metadata:{
 ...seed.metadata,invoiceId:id.otherOrder}}]},
 'canonical credit with wrong invoice fails');
fail({...base,canonicalSeedEntries:[{...seed,entry_type:'cashback_release'}]},
 'wrong ledger type under the canonical key fails');
fail({...base,canonicalSeedEntries:[{...seed,created_at:'2026-11-06T09:00:00Z'}]},
 'two immutable reads disagree on timestamp');
fail({...base,canonicalSeedEntries:[seed,{...seed,id:id.otherWallet,
 user_id:id.otherOrder,idempotency_key:'clube-paid-coupon:'+id.otherVoucher,
 metadata:{...seed.metadata,voucherId:id.otherVoucher}}]},
 'unused voucher credited to another wallet must block financial reconciliation');
const extraIssuance={id:id.otherVoucher,invoice_id:id.invoice,
 customer_user_id:id.customer,face_cents:500,ordinal:2};
fail({...base,issuances:[...base.issuances,extraIssuance],issuanceCount:2,
 canonicalSeedEntries:[seed,{...seed,id:id.otherWallet,
 user_id:id.otherOrder,idempotency_key:'clube-paid-coupon:'+id.otherVoucher,
 metadata:{...seed.metadata,voucherId:id.otherVoucher}}]},
 "unused voucher of real invoice cannot have foreign wallet canonical seed");
const secondApplication={...application(id.otherOrder,id.voucher),
 applied_at:'2026-11-06T10:02:00Z'};
const reused={...base,
 applications:[...base.applications,secondApplication],applicationCount:2,
 partnerUses:[...base.partnerUses,{...partnerUse(id.otherOrder,id.voucher),
 created_at:'2026-11-06T10:02:01Z'}],partnerUseCount:2,
 orders:[...base.orders,order(id.otherOrder,'SETTLED')]
};
const double=check(reused);
assert.equal(double.canonicalSeedCount,2,
 'original and reissued coupon must each have an indexed canonical key');
const two=withWalletEvidence(reused);
fail({...reused,canonicalSeedEntries:two.canonicalSeedEntries.slice(0,1)},
 'missing reissue canonical seed fails');
fail({...reused,canonicalSeedEntries:two.canonicalSeedEntries.map((s,i)=>
 i===1?{...s,idempotency_key:s.idempotency_key+':other'}:s)},
 'wrong reissue canonical idempotency key fails');

const old=check({...base,fundingMode:'platform_reimbursed',partnerUses:[],
 partnerUseCount:0,returns:[],returnCount:0,
 orders:[order(id.order,'SETTLED')]});
assert.equal(old.canonicalSeedCount,0);
assert.equal(old.canonicalSeedCoverage,'bounded_complete');

const edge=read('supabase/functions/admin-ops/index.ts');
const start=edge.indexOf('if(action==="clube-coupon-refund-merchant-history-inspect")');
const stop=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',start);
assert.ok(start>0&&stop>start);
const action=edge.slice(start,stop);
for(const fragment of [
 'reissuedCountByVoucher','issuancesResult.data',
 'canonicalKeys.push("clube-paid-coupon:"+voucherId)',
 '.in("idempotency_key",canonicalKeys)',
 'new Set(canonicalKeys).size',
 'canonicalResult.count!==applicationsResult.data.length',
 'canonicalSeedEntries:first.canonicalSeedEntries',
 'canonicalSeedEntryCount:first.canonicalSeedEntryCount',
 'JSON.stringify(first)!==JSON.stringify(second)'
])assert.ok(action.includes(fragment),'complete indexed cross-wallet proof: '+fragment);
assert.doesNotMatch(action,/\.insert\(|\.update\(|method:"POST"|mercadoPagoFetch/,
 'read-only canonical lookup must not write funds or call PSP');
const ui=read('js/admin.js');
for(const fragment of [
 "r.canonicalSeedCoverage!=='bounded_complete'",
 'r.canonicalSeedCount!==r.couponSeedCount',
 'r.unmatchedCanonicalSeedCount!==0',
 'Chaves canônicas verificadas em todas as carteiras'
])assert.ok(ui.includes(fragment),'Admin fails closed without canonical proof: '+fragment);
console.log('PASS #877: indexed global canonical seed checks; foreign wallet and unused voucher rejected, legacy safe, no bank claims');
