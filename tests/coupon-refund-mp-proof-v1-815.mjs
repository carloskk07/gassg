import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const edge=fs.readFileSync(new URL('../supabase/functions/coupon-credit-pix/index.ts',import.meta.url),'utf8');
const begin=edge.indexOf('function couponFullRefundVerified(');
const end=edge.indexOf('\nDeno.serve(',begin);
assert.ok(begin>0&&end>begin,'refund guard must be independently testable');
const functionBody=edge.slice(begin,end).replace(/:any(?=[,)])/g,'');
const ctx=vm.createContext({
 String,Array,Number,
 moneyToCents:value=>value==null?null:Math.round(Number(value)*100),
 findPix:order=>order?.transactions?.payments?.find(p=>p?.payment_method?.id==='pix')??null
});
new vm.Script(functionBody+'\nthis.verify=couponFullRefundVerified;').runInContext(ctx);
const invoice={id:'invoice-1',provider_order_id:'mp-order-1',provider_payment_id:'mp-pix-1',sale_price_cents:890};
const pix={id:'mp-pix-1',amount:'8.90',payment_method:{id:'pix',type:'bank_transfer'}};
const refund={id:'mp-refund-1',status:'processed',transaction_id:'mp-pix-1',amount:'8.90'};
const order={id:'mp-order-1',external_reference:'invoice-1',total_amount:'8.90',live_mode:true,transactions:{payments:[pix],refunds:[refund]}};
assert.equal(ctx.verify(order,invoice),true,'completed full provider refund is verified');
const altered=[
 {...order,id:'mp-other'},
 {...order,external_reference:'another-invoice'},
 {...order,live_mode:false},
 {...order,total_amount:'8.80'},
 {...order,transactions:{payments:[{...pix,amount:'8.80'}],refunds:[refund]}},
 {...order,transactions:{payments:[{...pix,id:'other'}],refunds:[refund]}},
 {...order,transactions:{payments:[pix],refunds:[]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,status:'processing'}]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,transaction_id:'other'}]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,amount:'8.00'}]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,id:''}]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,amount:'8.90'}, {...refund,id:'second',amount:'0.10'}]}}
];
for(const [idx,bad] of altered.entries())
 assert.equal(ctx.verify(bad,invoice),false,'reject partial/ambiguous refund case '+idx);
const action=edge.slice(edge.indexOf('if(operation==="request-refund")'),edge.indexOf('if(operation==="catalog")'));
assert.ok(action.includes('idempotencyKey:String(data.requestId)'), 'refund retries share one immutable provider key');
assert.ok(action.includes('couponFullRefundVerified(proof,invoice)'),'mark refunded only after fresh GET');
assert.ok(action.includes('voucherErr')&&action.includes('couponRefundNoExposureEligible(invoice,vouchers,issuedCount)'),'must require complete voucher evidence for provider refund');
assert.ok(action.includes('remoteRefundVerified=done.data?.ok===true&&done.data?.refunded===true'));
assert.ok(action.indexOf('clube_coupon_refund_request_v1_814')<action.indexOf('mercadoPagoFetch(endpoint+"/refund"'),'ownership and durable request precede PSP action');
const heldMigration=fs.readFileSync(new URL('../supabase/migrations/20261106151942_coupon_verified_hold_refund_v1_860.sql',import.meta.url),'utf8');
for(const guard of ["coupon_settlement_hold_reason_v1_853 in",
 "v_invoice.paid_at is not null","v_invoice.provider_payment_id",
 "not exists (","from public.clube_coupon_paid_issuances i",
 "'reviewHoldClosed',true","set status='refunded'",
 "REVOKE ALL ON FUNCTION public.clube_coupon_paid_payment_refund"])
 assert.ok(heldMigration.includes(guard),'#860 SQL missing '+guard);
assert.ok(heldMigration.indexOf("coupon_settlement_hold_reason_v1_853 in")<
 heldMigration.indexOf("if v_invoice.status='review_required' or v_held>0"),
 'special verified zero-issuance refund must precede manual-review fallback');

const guardStart=edge.indexOf('function couponRefundNoExposureEligible(');
const guardEnd=edge.indexOf('\n// Independent GET proof',guardStart);
assert.ok(guardStart>0&&guardEnd>guardStart);
const guardBody=edge.slice(guardStart,guardEnd).replace(/:any\[\]|:any(?=[,)])/g,'');
const guardVM=vm.createContext({Number,String,Boolean,Array});
new vm.Script(guardBody+'\nthis.eligible=couponRefundNoExposureEligible;').runInContext(guardVM);
const eligible=guardVM.eligible;
const paidInvoice={status:'paid',coupons_per_pack:3};
assert.equal(eligible(paidInvoice,[{status:'issued'},{status:'void'},{status:'issued'}],3),true);
assert.equal(eligible(paidInvoice,[{status:'issued'},{status:'void'}],3),false,
 'a truncated or partial paid voucher set must block automatic refund');
assert.equal(eligible(paidInvoice,[{status:'issued'},{status:'reserved'},{status:'issued'}],3),false);
assert.equal(eligible(paidInvoice,[{status:'issued'},{status:'void'}],2),false);
for(const reason of ['PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT','COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT']){
 const held={status:'review_required',coupon_settlement_hold_reason_v1_853:reason,
  paid_at:'2026-11-06T15:00:00Z',provider_payment_id:'provider-pix-860'};
 assert.equal(eligible(held,[],0),true,'#853 verified hold with no voucher');
 assert.equal(eligible(held,[{status:'review_required'}],1),false,
  'any earlier voucher requires manual review');
 assert.equal(eligible({...held,paid_at:null},[],0),false);
 assert.equal(eligible({...held,provider_payment_id:null},[],0),false);
 assert.equal(eligible({...held,coupon_settlement_hold_reason_v1_853:'COUPON_PROVIDER_PROOF_UNVERIFIED'},[],0),false);
}
assert.equal(eligible({status:'refunded'},[],0),false);
assert.match(edge,/\.select\("status",\{count:"exact"\}\)/);
console.log('V1.815 PASS — completed full Mercado Pago Orders refund only, no partials, replays or spent coupons.');
