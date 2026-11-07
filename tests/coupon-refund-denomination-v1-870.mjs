import assert from 'node:assert/strict';
import fs from 'node:fs';
import {returnWalletRefs,withWalletEvidence} from './refund-wallet-fixture-v1-871.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const code=read('supabase/functions/admin-ops/coupon-refund-merchant-history.js');
const {couponRefundMerchantHistorySummary:rawCheck}=await import(
 'data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const check=state=>rawCheck(withWalletEvidence(state));
const id={invoice:'66666666-6666-4666-8666-666666666666',
 customer:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 voucher:'22222222-2222-4222-8222-222222222222',
 secondVoucher:'77777777-7777-4777-8777-777777777777',
 first:'11111111-1111-4111-8111-111111111111',
 second:'99999999-9999-4999-8999-999999999999',
 merchant:'33333333-3333-4333-8333-333333333333'};
const app=(order_id,applied_at,face_cents=500,voucher_id=id.voucher)=>({
 order_id,applied_at,face_cents,voucher_id,invoice_id:id.invoice,
 customer_user_id:id.customer,quoted_merchant_id:id.merchant,
 original_order_total_cents:9500,original_order_cashback_cents:face_cents});
const use=(order_id,created_at,face_cents=500,voucher_id=id.voucher)=>({
 order_id,created_at,face_cents,voucher_id,invoice_id:id.invoice,
 customer_id:id.customer,merchant_id:id.merchant,gross_cents:9500+face_cents,
 net_cents:9500,fee_bps_snapshot:900});
const issuance=(v,ordinal,face_cents=500)=>({id:v,ordinal,face_cents,
 invoice_id:id.invoice,customer_user_id:id.customer});
const base={
 invoiceId:id.invoice,customerId:id.customer,fundingMode:'partner_funded',
 couponFaceCents:500,couponsPerPack:3,
 issuances:[issuance(id.voucher,1)],issuanceCount:1,
 applications:[app(id.first,'2026-11-06T10:00:00Z'),
               app(id.second,'2026-11-06T10:03:00Z')],
 applicationCount:2,
 partnerUses:[use(id.first,'2026-11-06T10:00:01Z'),
              use(id.second,'2026-11-06T10:03:01Z')],
 partnerUseCount:2,
 returns:[{order_id:id.first,voucher_id:id.voucher,
   invoice_id:id.invoice,customer_id:id.customer,amount_cents:500,
   disposition:'reissued',cause:'order_cancelled',
   ...returnWalletRefs(id.first),
   recorded_at:'2026-11-06T10:01:00Z'}],returnCount:1,
 orders:[{id:id.first,customer_id:id.customer,merchant_id:id.merchant,
   status:'CANCELLED',risk_reason:'buyer_cancelled',financial_state:'reversed',financial_reversed_at:null},
  {id:id.second,customer_id:id.customer,merchant_id:id.merchant,
   status:'SETTLED',financial_state:'settled',financial_reversed_at:null}]
};
const a=check(base);
assert.equal(a.historicalDiscountCents,1000);
assert.equal(a.uniqueVoucherFaceCents,500);
assert.equal(a.historicalReusedDiscountCents,500);
assert.equal(a.uniqueVoucherCount,1);
assert.equal(a.walletReturnPairCount,1);
assert.equal(a.walletReturnNetCents,0);
assert.equal(a.nominalDiscountNotPayableDebt,true);
for(const f of ['merchantPayoutVerified','bankCreditVerified','refundClosureAuthorized',
 'caseClosed','moneyMoved'])assert.equal(a[f],false,f);
const bad=(state,message)=>assert.throws(()=>check(state),
 /COUPON_REFUND_HISTORY_/,message);
bad({...base,issuances:[],issuanceCount:0},'application without issuance');
bad({...base,issuances:[issuance(id.secondVoucher,1)]},'different issued voucher');
bad({...base,issuanceCount:2},'incomplete list');
bad({...base,issuances:[issuance(id.voucher,1,300)]},'forged face value');
bad({...base,couponFaceCents:300},'invoice face mismatch');
bad({...base,couponsPerPack:0},'invalid immutable package count');
bad({...base,couponsPerPack:16},'unbounded package count');
bad({...base,issuances:[{...issuance(id.voucher,1),customer_user_id:id.first}]},
 'issuance must be owned by purchaser');
bad({...base,issuances:[{...issuance(id.voucher,1),invoice_id:id.second}]},
 'issuance invoice must match');
bad({...base,issuances:[issuance(id.voucher,1),issuance(id.secondVoucher,1)],
 issuanceCount:2},'duplicate ordinal within invoice');
bad({...base,issuances:[issuance(id.voucher,4)]},'ordinal beyond package');
bad({...base,applications:[base.applications[0],
 {...base.applications[1],face_cents:300}],
 partnerUses:[base.partnerUses[0],
 {...base.partnerUses[1],face_cents:300,gross_cents:9800}]},
 'reused face value must stay immutable');
const separate=check({...base,
 applications:[base.applications[0],
   app(id.second,'2026-11-06T10:03:00Z',500,id.secondVoucher)],
 partnerUses:[base.partnerUses[0],
   use(id.second,'2026-11-06T10:03:01Z',500,id.secondVoucher)],
 issuances:[issuance(id.voucher,1),issuance(id.secondVoucher,2)],
 issuanceCount:2,returns:[],returnCount:0,
 orders:[{...base.orders[0],status:'SETTLED',financial_state:'settled',
   risk_reason:null,financial_reversed_at:null},base.orders[1]]});
assert.equal(separate.uniqueVoucherCount,2);
assert.equal(separate.uniqueVoucherFaceCents,1000);
assert.equal(separate.historicalReusedDiscountCents,0);
const edge=read('supabase/functions/admin-ops/index.ts');
const start=edge.indexOf('if(action==="clube-coupon-refund-merchant-history-inspect")');
const finish=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',start);
assert.ok(start>0&&finish>start);
const action=edge.slice(start,finish);
for(const fragment of ['clube_coupon_paid_issuances','coupon_face_cents',
 'coupons_per_pack','issuanceCount:iCount','issuances:first.issuances',
 'JSON.stringify(first)!==JSON.stringify(second)'])
 assert.ok(action.includes(fragment),'must verify '+fragment);
assert.doesNotMatch(action,/\.insert\(|\.update\(|method:"POST"/);
const ui=read('js/admin.js');
assert.match(ui,/uniqueVoucherFaceCents/);
assert.match(ui,/historicalReusedDiscountCents/);
assert.match(ui,/distinctVoucherFaces\.get\(x\.voucherId\)!==x\.discountCents/);
assert.match(ui,/Reutilização não significa novo cupom vendido nem dívida adicional/);
console.log('PASS #870: unique voucher face and historic reuse not double booked; immutable issuance and package validated without settlement');
