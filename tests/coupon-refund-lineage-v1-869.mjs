import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('supabase/functions/admin-ops/coupon-refund-merchant-history.js');
const {couponRefundMerchantHistorySummary:reconcile}=await import(
  'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

const id={
 invoice:'66666666-6666-4666-8666-666666666666',
 customer:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 first:'11111111-1111-4111-8111-111111111111',
 second:'99999999-9999-4999-8999-999999999999',
 voucher:'22222222-2222-4222-8222-222222222222',
 merchant:'33333333-3333-4333-8333-333333333333'
};
const app=(order_id,applied_at)=>({
 invoice_id:id.invoice,customer_user_id:id.customer,order_id,
 voucher_id:id.voucher,quoted_merchant_id:id.merchant,
 face_cents:500,original_order_total_cents:9500,
 original_order_cashback_cents:500,applied_at
});
const use=(order_id,created_at)=>({
 invoice_id:id.invoice,customer_id:id.customer,order_id,
 voucher_id:id.voucher,merchant_id:id.merchant,face_cents:500,
 gross_cents:10000,net_cents:9500,fee_bps_snapshot:900,created_at
});
const back=(order_id,recorded_at,disposition='reissued',cause='order_cancelled')=>({
 invoice_id:id.invoice,customer_id:id.customer,order_id,
 voucher_id:id.voucher,amount_cents:500,recorded_at,disposition,cause
});
const order=(orderId,status,financial_reversed_at=null)=>({
 id:orderId,customer_id:id.customer,merchant_id:id.merchant,
 status,financial_state:status==='CANCELLED'?'reversed':'settled',
 financial_reversed_at
});
const base={
 invoiceId:id.invoice,customerId:id.customer,fundingMode:'partner_funded',
 applications:[app(id.first,'2026-11-06T10:00:00Z'),
               app(id.second,'2026-11-06T10:03:00Z')],
 applicationCount:2,
 partnerUses:[use(id.first,'2026-11-06T10:00:01Z'),
              use(id.second,'2026-11-06T10:03:01Z')],
 partnerUseCount:2,
 returns:[back(id.first,'2026-11-06T10:01:00Z')],returnCount:1,
 orders:[order(id.first,'CANCELLED'),order(id.second,'SETTLED')],
 couponFaceCents:500,couponsPerPack:3,issuanceCount:1,
 issuances:[{id:id.voucher,invoice_id:id.invoice,customer_user_id:id.customer,face_cents:500,ordinal:1}]
};
const good=reconcile(base);
assert.equal(good.applicationCount,2);
assert.equal(good.partnerUseCount,2);
assert.equal(good.returnCount,1);
assert.equal(good.historicalDiscountCents,1000);
assert.equal(good.uniqueVoucherCount,1);
assert.equal(good.uniqueVoucherFaceCents,500);
assert.equal(good.historicalReusedDiscountCents,500);
assert.equal(good.entries[0].returnDisposition,'reissued');
assert.equal(good.entries[1].returnRecorded,false);
for(const flag of ['merchantPayoutVerified','bankCreditVerified',
                   'refundClosureAuthorized','caseClosed','moneyMoved'])
 assert.equal(good[flag],false,'read-only proof cannot authorize '+flag);

const mustReject=(state,label)=>assert.throws(()=>reconcile(state),
 /COUPON_REFUND_HISTORY_/,label);
mustReject({...base,returns:[],returnCount:0},
 'second redemption without its prior reissue must be rejected');
mustReject({...base,returns:[back(id.first,'2026-11-06T10:01:00Z','manual_review')]},
 'voucher held in manual review cannot be spent again');
mustReject({...base,returns:[back(id.first,'2026-11-06T10:04:00Z')]},
 'return recorded after second use cannot justify earlier reissue');
mustReject({...base,returns:[back(id.first,'2026-11-06T09:59:00Z')]},
 'return before original application is invalid');
mustReject({...base,partnerUses:[use(id.first,'2026-11-06T09:59:00Z'),base.partnerUses[1]]},
 'partner benefit before original coupon application is invalid');
mustReject({...base,orders:[order(id.first,'SETTLED'),order(id.second,'SETTLED')]},
 'order-cancelled return cannot exist on an uncanceled order');
mustReject({...base,partnerUses:[{...base.partnerUses[0],net_cents:9499},base.partnerUses[1]]},
 'merchant financed net amount must equal original discounted order');
mustReject({...base,partnerUses:[{...base.partnerUses[0],gross_cents:10001},base.partnerUses[1]]},
 'merchant gross amount must equal net plus exact coupon face');
mustReject({...base,applications:[{...base.applications[0],applied_at:null},base.applications[1]]},
 'application without immutable time must be rejected');
mustReject({...base,returns:[{...base.returns[0],recorded_at:null}]},
 'return without immutable time must be rejected');
mustReject({...base,fundingMode:'platform_reimbursed',
 partnerUses:[],partnerUseCount:0,returns:[],returnCount:0},
 'legacy platform-funded voucher cannot be reused');
const postSettlement={...base,
 returns:[back(id.first,'2026-11-06T10:01:00Z','manual_review',
               'post_settlement_financial_reversal')],
 applications:[base.applications[0]],applicationCount:1,
 partnerUses:[base.partnerUses[0]],partnerUseCount:1,
 orders:[order(id.first,'SETTLED')]};
mustReject(postSettlement,'financial reversal requires durable reversal timestamp');
const audited=reconcile({...postSettlement,orders:[
 order(id.first,'SETTLED','2026-11-06T10:00:59Z')]});
assert.equal(audited.entries[0].returnDisposition,'manual_review');
assert.equal(audited.refundClosureAuthorized,false);

const edge=read('supabase/functions/admin-ops/index.ts');
const start=edge.indexOf('if(action==="clube-coupon-refund-merchant-history-inspect")');
const end=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',start);
assert.ok(start>=0&&end>start);
const action=edge.slice(start,end);
for(const column of ['applied_at','created_at','recorded_at','financial_reversed_at'])
 assert.match(action,new RegExp(column),
  'history snapshot must load immutable chronology '+column);
assert.match(action,/JSON.stringify\(first\)!==JSON.stringify\(second\)/);
assert.doesNotMatch(action,/\.update\(|\.insert\(|method:"POST"/);
console.log('PASS #869: per-voucher immutable reissue chain, partner gross/net, cancellation/reversal, no financial write');
