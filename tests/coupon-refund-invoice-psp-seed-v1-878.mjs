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
const proof=withWalletEvidence(base);
const receipt=proof.invoicePayment,original=proof.seedEntries[0];
const passed=check(base);
assert.equal(passed.invoicePaymentProvenance,'bounded_complete');
assert.equal(passed.verifiedPaymentSeedCount,1);
assert.equal(passed.couponSeedCount,1);
for(const key of ['bankCreditVerified','merchantPayoutVerified',
 'refundClosureAuthorized','caseClosed','moneyMoved'])
 assert.equal(passed[key],false,'PSP invoice fields are internal metadata only');

const fails=(state,label)=>assert.throws(()=>check(state),
 /COUPON_REFUND_HISTORY_/,label);
const anchor=(change)=>({
 ...base,
 seedEntries:proof.seedEntries,
 canonicalSeedEntries:proof.canonicalSeedEntries,
 invoicePayment:{...receipt,...change}
});
fails({...base,invoicePayment:null},'invoice receipt missing');
fails(anchor({providerOrderId:null}),'provider order required');
fails(anchor({providerPaymentId:null}),'provider payment required');
fails(anchor({netProceedsReference:null}),'verified net reference required');
fails(anchor({paidAt:null}),'invoice must have paid timestamp');
fails(anchor({netProceedsVerifiedAt:null}),'net funds must have verification time');
fails(anchor({providerOrderId:'unrelated-psp-order'}),'invoice provider order mismatch');
fails(anchor({providerPaymentId:'unrelated-psp-payment'}),'invoice provider payment mismatch');
fails(anchor({netProceedsReference:'unrelated-net-reference'}),'invoice net receipt mismatch');
fails(anchor({paidAt:'2026-11-06T10:03:00Z'}),'wallet credit precedes payment');
fails(anchor({netProceedsVerifiedAt:'2026-11-06T10:02:00Z'}),
 'wallet credit precedes verified net proceeds');
fails({...base,applications:[{...base.applications[0],
 net_proceeds_reference:'unrelated-net-reference'}]},
 'immutable application net reference must equal invoice');
fails({...base,applications:[{...base.applications[0],
 net_proceeds_reference:null}]},
 'missing immutable net proceeds reference not accepted');

for(const field of ['providerOrderId','providerPaymentId','netProceedsReference']){
 const modified={...original,metadata:{...original.metadata}};
 delete modified.metadata[field];
 fails({...base,seedEntries:[modified],canonicalSeedEntries:[modified]},
  'seed cannot omit '+field);
 const stale={...original,metadata:{...original.metadata,[field]:'stale-'+field}};
 fails({...base,seedEntries:[stale],canonicalSeedEntries:[stale]},
  'seed cannot substitute stale '+field);
}
const secondApplication={...application(id.otherOrder,id.voucher),
 applied_at:'2026-11-06T10:02:00Z'};
const reused={...base,
 applications:[...base.applications,secondApplication],applicationCount:2,
 partnerUses:[...base.partnerUses,{...partnerUse(id.otherOrder,id.voucher),
 created_at:'2026-11-06T10:02:01Z'}],partnerUseCount:2,
 orders:[...base.orders,order(id.otherOrder,'SETTLED')]
};
const validReissue=check(reused);
assert.equal(validReissue.verifiedPaymentSeedCount,2);
const reuseProof=withWalletEvidence(reused);
assert.equal(reuseProof.seedEntries[1].metadata.providerPaymentId,receipt.providerPaymentId);
fails({...reused,seedEntries:reuseProof.seedEntries.map((row,n)=>
 n===1?{...row,metadata:{...row.metadata,providerPaymentId:'stale-payment'}}:row),
 canonicalSeedEntries:reuseProof.canonicalSeedEntries.map((row,n)=>
 n===1?{...row,metadata:{...row.metadata,providerPaymentId:'stale-payment'}}:row)},
 'second use must retain the same invoice payment reference');
const old=check({...base,fundingMode:'platform_reimbursed',
 partnerUses:[],partnerUseCount:0,returns:[],returnCount:0,
 orders:[order(id.order,'SETTLED')],invoicePayment:null});
assert.equal(old.invoicePaymentProvenance,'bounded_complete');
assert.equal(old.verifiedPaymentSeedCount,0);

const edge=read('supabase/functions/admin-ops/index.ts');
const start=edge.indexOf('if(action==="clube-coupon-refund-merchant-history-inspect")');
const finish=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',start);
assert.ok(start>0&&finish>start);
const action=edge.slice(start,finish);
for(const item of [
 'provider_order_id,provider_payment_id,paid_at,net_proceeds_reference,net_proceeds_verified_at',
 'seed_wallet_entry_id_v1_847,net_proceeds_reference',
 'providerOrderId:first.invoice.provider_order_id',
 'providerPaymentId:first.invoice.provider_payment_id',
 'netProceedsReference:first.invoice.net_proceeds_reference',
 'paidAt:first.invoice.paid_at',
 'netProceedsVerifiedAt:first.invoice.net_proceeds_verified_at',
 'JSON.stringify(first)!==JSON.stringify(second)'
])assert.ok(action.includes(item),'read-only receipt linkage: '+item);
assert.doesNotMatch(action,/\.update\(|\.insert\(|mercadoPagoFetch|method:"POST"/,
 'historical review cannot move money or call provider');

const ui=read('js/admin.js');
for(const item of [
 "r.invoicePaymentProvenance!=='bounded_complete'",
 'r.verifiedPaymentSeedCount!==',
 'Créditos conferidos contra comprovantes internos da fatura'
])assert.ok(ui.includes(item),'Admin refuses unverified invoice provenance '+item);
console.log('PASS #878: invoice payment identifiers, net receipt, chronology, reissue, legacy, read-only no bank assertions');
