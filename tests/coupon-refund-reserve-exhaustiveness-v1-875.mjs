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
const stored=withWalletEvidence(base);
const good=check(base);
assert.equal(good.quarantineHoldCoverage,'bounded_complete');
assert.equal(good.quarantineHoldCount,1);
assert.equal(good.unmatchedQuarantineHoldCount,0);
assert.equal(good.otherCashbackReserveCount,0);
assert.equal(good.bankCreditVerified,false);
assert.equal(good.merchantPayoutVerified,false);
assert.equal(good.refundClosureAuthorized,false);
assert.equal(good.moneyMoved,false);

const rejected=(state,reason)=>assert.throws(
 ()=>check(state),/COUPON_REFUND_HISTORY_/,reason
);
const originalHold=stored.reserveEntries[0];
assert.ok(originalHold,'synthetic canonical quarantine hold');
const normalReserve={...originalHold,
 id:id.otherWallet,amount_cents:-250,
 idempotency_key:'order:'+id.order+':cashback-reserve',
 metadata:{source:'checkout_cashback_reserve'}
};
const withNormal=check({...base,
 reserveEntries:[originalHold,normalReserve]});
assert.equal(withNormal.quarantineHoldCount,1);
assert.equal(withNormal.otherCashbackReserveCount,1,
 'normal order cashback reserves are not duplicate voucher returns');
rejected({...base,reserveEntries:[]},
 'referenced return without any order-wide reserve must fail');
rejected({...base,reserveEntryCount:null},
 'missing exact count is never complete evidence');
rejected({...base,reserveEntryCount:2},
 'partial reserve population must fail count verification');
rejected({...base,reserveEntries:[originalHold,originalHold]},
 'duplicate reserve rows must fail');
rejected({...base,reserveEntries:[originalHold,{
 ...originalHold,id:id.otherWallet,
 idempotency_key:'partner-coupon:return-hold:'+id.otherOrder
}]},'extra quarantine hold with canonical key must fail');
rejected({...base,reserveEntries:[originalHold,{
 ...originalHold,id:id.otherWallet,
 idempotency_key:'unrelated-quarantine-return-hold'
}]},'extra quarantine hold bearing original source must fail');
rejected({...base,reserveEntries:[{
 ...originalHold,amount_cents:-499
}]},'order-wide reserve must agree with the referenced hold amount');
rejected({...base,reserveEntries:[{
 ...originalHold,metadata:{...originalHold.metadata,voucherId:id.otherVoucher}
}]},'order-wide reserve must agree with original voucher');
rejected({...base,reserveEntries:[{
 ...originalHold,user_id:id.otherOrder
}]},'order-wide hold cannot belong to a different user');
rejected({...base,reserveEntries:[{
 ...originalHold,created_at:'2026-11-06T10:00:04Z'
}]},'order-wide hold cannot differ on timestamp');
// No return and a normal order reserve: regular cashback must remain valid.
const active=check({...base,returns:[],returnCount:0,
 orders:[order(id.order,'SETTLED')],
 reserveEntries:[normalReserve]});
assert.equal(active.quarantineHoldCount,0);
assert.equal(active.otherCashbackReserveCount,1);

const edge=read('supabase/functions/admin-ops/index.ts');
const start=edge.indexOf('if(action==="clube-coupon-refund-merchant-history-inspect")');
const finish=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',start);
assert.ok(start>0&&finish>start);
const action=edge.slice(start,finish);
for(const fragment of [
 'reserveEntries:first.reserveEntries','reserveEntryCount:first.reserveEntryCount',
 '.eq("entry_type","cashback_reserve")',
 '.in("order_id",orderIds)','reserveResult.count>100',
 'JSON.stringify(first)!==JSON.stringify(second)'
])assert.ok(action.includes(fragment),'complete bounded reserve query: '+fragment);
assert.doesNotMatch(action,/\.insert\(|\.update\(|method:"POST"|mercadoPagoFetch/,
 'read-only reserve audit must not transfer money or write to production');
const ui=read('js/admin.js');
for(const fragment of [
 "r.quarantineHoldCoverage!=='bounded_complete'",
 'r.quarantineHoldCount!==r.returnCount',
 'r.unmatchedQuarantineHoldCount!==0',
 'r.otherCashbackReserveCount<0'
])assert.ok(ui.includes(fragment),'Admin refuses incomplete quarantine holds: '+fragment);
console.log('PASS #875: complete coupon-order cashback reserves, quarantine hold matching, regular reserves allowed, no bank settlement');
