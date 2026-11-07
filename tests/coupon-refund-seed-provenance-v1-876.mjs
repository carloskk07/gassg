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
const backed=withWalletEvidence(base);
const good=check(base);
assert.equal(good.couponSeedCoverage,'bounded_complete');
assert.equal(good.couponSeedCount,1);
assert.equal(good.unmatchedCouponSeedCount,0);
for(const key of ['moneyMoved','bankCreditVerified','merchantPayoutVerified',
                   'caseClosed','refundClosureAuthorized'])
 assert.equal(good[key],false,'Internal seed evidence cannot close bank case');

const reject=(state,label)=>assert.throws(()=>check(state),
 /COUPON_REFUND_HISTORY_/,label);
const seed=backed.seedEntries[0];
assert.ok(seed?.id && backed.applications[0].seed_wallet_entry_id_v1_847===seed.id);
reject({...base,seedEntries:[]},'missing invoice seed population');
reject({...base,seedEntryCount:null},'unknown seed count');
reject({...base,seedEntryCount:2},'partial seed scan');
reject({...base,seedEntries:[seed,seed]},'duplicate seed cannot be used twice');
reject({...base,seedEntries:[seed,{...seed,id:id.otherWallet,
 idempotency_key:seed.idempotency_key+':extra'}]},
 'unreferenced extra seed cannot silently credit cashback');
reject({...base,seedEntries:[{...seed,id:id.otherWallet}]},
 'correct-looking credit with wrong linked ID');
reject({...base,seedEntries:[{...seed,user_id:id.otherOrder}]},'foreign buyer');
reject({...base,seedEntries:[{...seed,order_id:id.order}]},'seed must have null order');
reject({...base,seedEntries:[{...seed,amount_cents:501}]},'face mismatch');
reject({...base,seedEntries:[{...seed,idempotency_key:'clube-paid-coupon:wrong'}]},
 'seed key mismatch');
reject({...base,seedEntries:[{...seed,metadata:{
 ...seed.metadata,source:'ordinary_cashback'}}]},'wrong seed source');
reject({...base,seedEntries:[{...seed,metadata:{
 ...seed.metadata,invoiceId:id.otherOrder}}]},'wrong invoice');
reject({...base,seedEntries:[{...seed,metadata:{
 ...seed.metadata,voucherId:id.otherVoucher}}]},'wrong voucher');
reject({...base,seedEntries:[{...seed,created_at:'2026-11-06T10:03:00Z'}]},
 'seed posted after checkout cannot count');
reject({...base,applications:[{...base.applications[0],
 seed_wallet_entry_id_v1_847:null}]},'unlinked paid seed must fail');

const secondApplication={...application(id.otherOrder,id.voucher),
 applied_at:'2026-11-06T10:02:00Z'};
const reused={...base,
 applications:[...base.applications,secondApplication],applicationCount:2,
 partnerUses:[...base.partnerUses,{...partnerUse(id.otherOrder,id.voucher),
   created_at:'2026-11-06T10:02:01Z'}],partnerUseCount:2,
 orders:[...base.orders,order(id.otherOrder,'SETTLED')]
};
const passed=check(reused);
assert.equal(passed.couponSeedCount,2);
const storedReuse=withWalletEvidence(reused);
assert.equal(storedReuse.seedEntries[1].idempotency_key,
 'clube-paid-coupon:'+id.voucher+':return:1');
reject({...reused,seedEntries:storedReuse.seedEntries.map((s,i)=>
 i===1?{...s,idempotency_key:'clube-paid-coupon:'+id.voucher}:s)},
 'reissue cannot reuse original seed key');
reject({...reused,seedEntries:storedReuse.seedEntries.map((s,i)=>
 i===1?{...s,created_at:'2026-11-06T10:00:45Z'}:s)},
 'reissue seed cannot predate original voucher return');

const legacy=check({...base,fundingMode:'platform_reimbursed',
 partnerUses:[],partnerUseCount:0,returns:[],returnCount:0,
 orders:[order(id.order,'SETTLED')]});
assert.equal(legacy.couponSeedCount,0);
assert.equal(legacy.couponSeedCoverage,'bounded_complete');

const edge=read('supabase/functions/admin-ops/index.ts');
const i=edge.indexOf('if(action==="clube-coupon-refund-merchant-history-inspect")');
const j=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',i);
assert.ok(i>0&&j>i);
const action=edge.slice(i,j);
for(const part of [
 'seed_wallet_entry_id_v1_847',
 '.eq("entry_type","cashback_seed")',
 '.contains("metadata",{invoiceId})',
 '.eq("user_id",invoice.customer_user_id)',
 'seedResult.count!==applicationsResult.data.length',
 'seedEntries:first.seedEntries',
 'seedEntryCount:first.seedEntryCount',
 'JSON.stringify(first)!==JSON.stringify(second)'
])assert.ok(action.includes(part),'server must verify complete seed population: '+part);
assert.doesNotMatch(action,/\.insert\(|\.update\(|method:"POST"|mercadoPagoFetch/,
 'read-only seed audit must not perform PSP calls or financial writes');

const ui=read('js/admin.js');
for(const part of ["r.couponSeedCoverage!=='bounded_complete'",
 'r.couponSeedCount!==(r.fundingModel===',
 'r.unmatchedCouponSeedCount!==0','Origens de créditos dos cupons conferidas'])
 assert.ok(ui.includes(part),'frontend fail-closed: '+part);

console.log('PASS #876: coupon seed IDs, original/reissued lineage, extra credits, legacy isolation, no bank claims');
