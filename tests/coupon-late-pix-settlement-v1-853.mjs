import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261106134039_coupon_late_partner_pix_settlement_review_v1_853.sql');
const webhook=read('supabase/functions/billing-payment-webhook-mercadopago/index.ts');
const coupon=read('supabase/functions/coupon-credit-pix/index.ts');
const adminEdge=read('supabase/functions/admin-ops/index.ts');
const shop=read('js/clube-coupon-shop.js');
const adminUi=read('js/admin.js');
const fixture=read('tests/fixtures/coupon-late-pix-settlement-v1-853.sql');
const replaySql=read('supabase/migrations/20261106143928_coupon_review_pix_replay_v1_859.sql');
assert.match(replaySql,/v_invoice.status='review_required'/);
assert.match(replaySql,/v_invoice.provider_payment_id=p_payment_id/);
assert.match(replaySql,/v_invoice.paid_at IS NOT NULL/);
assert.match(replaySql,/v_invoice.coupon_settlement_hold_reason_v1_853/);
assert.ok(replaySql.includes('NOT EXISTS (') && replaySql.includes('FROM public.clube_coupon_paid_issuances i'));
assert.match(replaySql,/COUPON_PAYMENT_REVIEW_STATE_UNVERIFIED/);
assert.match(fixture,/CI_859_REPLAY_RESURRECTED_WITHDRAWN_COUPONS/);
assert.match(fixture,/CI_859_CONFLICTING_PIX_ACKED/);
assert.match(fixture,/CI_859_REFUND_FIRST_REPLAY_UNSAFE/);

for (const guard of [
 'FOR UPDATE','COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT',
 'PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT',
 "v_invoice.package_key='partner_general_3x5_849'",
 'clube_partner_coupon_sale_readiness_v1_849',
 'clube_partner_coupon_postal_supply_v1_850',
 'coupon_settlement_hold_reason_v1_853',
 "status='review_required'",
 'provider_payment_id=p_payment_id,paid_at=clock_timestamp()',
 "status='paid'",
 'ON CONFLICT(invoice_id,ordinal) DO NOTHING',
 'REVOKE ALL ON FUNCTION public.clube_coupon_paid_payment_verify',
 'GRANT EXECUTE ON FUNCTION public.clube_coupon_paid_payment_verify'
])assert.ok(sql.includes(guard),'Missing settlement invariant '+guard);
assert.match(sql,/EXISTS\(SELECT 1 FROM public\.clube_coupon_refund_requests_v1_814/);
assert.match(sql,/UPDATE public\.clube_coupon_paid_issuances\s+SET status='review_required'/);
assert.match(sql,/IF v_reason IS NOT NULL THEN[\s\S]*?RETURN pg_catalog\.jsonb_build_object\([\s\S]*?'issued',0/);
assert.doesNotMatch(sql,/UPDATE public\.platform_launch_control\s+SET commerce_enabled=true/);
assert.match(fixture,/BEGIN;/);
assert.match(fixture,/ROLLBACK;/);
assert.match(fixture,/SET LOCAL session_replication_role = origin;/);
for(const code of [coupon,adminEdge])
 assert.match(code,/coupon_settlement_hold_reason_v1_853/,'review cause must appear in authorized read-only API');
assert.match(shop,/Pagamento Pix identificado\. Os cupons não foram liberados/);
assert.match(adminUi,/Pix recebido após indisponibilidade da revenda/);
assert.match(adminUi,/Pix recebido após solicitação de cancelamento/);
assert.match(webhook,/COUPON_SETTLEMENT_READBACK_UNVERIFIED/);

const start=webhook.indexOf('async function handlePaidCouponOrder(');
const end=webhook.indexOf('\nasync function handleWebhookProbe(',start);
assert.ok(start>0&&end>start);
const snippet=webhook.slice(start,end).replace(/:(?:any|string|number)(?=[,)\s])/g,'');
new vm.Script(snippet);
const payment={
 id:'provider-pix-853',status:'processed',amount:'8.90',payment_method:{id:'pix',type:'bank_transfer'},
 live_mode:true
};
const providerOrder={
 id:'provider-order-853',external_reference:'invoice-853',total_amount:'8.90',
 status:'processed',live_mode:true,
 transactions:{payments:[payment],refunds:[]}
};
const invoice={id:'invoice-853',sale_price_cents:890,status:'awaiting_payment'};
const rpcCalls=[];
let dbResult={ok:false,reviewRequired:true,providerPaymentRecorded:true,
 reason:'PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT',issued:0};
const ctx=vm.createContext({
 String,Number,Array,Error,console,
 mercadoPagoConfigured:()=>true,
 fetchProviderOrder:async()=>({response:{ok:true},data:providerOrder}),
 billingPixPayment:order=>order.transactions.payments[0],
 moneyToCents:amount=>Math.round(Number(amount)*100),
 json:(body,status=200)=>({body,status})
});
const admin={rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:dbResult,error:null}}};
new vm.Script(snippet+'\nthis.handle=handlePaidCouponOrder;').runInContext(ctx);
const reviewed=await ctx.handle(admin,'provider-order-853',invoice,'APP_USR-synthetic');
assert.equal(reviewed.status,200);
assert.equal(reviewed.body.status,'review_required');
assert.equal(reviewed.body.reviewRequired,true);
assert.equal(reviewed.body.refundReviewRequired,true);
assert.equal(reviewed.body.issuedCoupons,0);
assert.equal(reviewed.body.reason,'PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT');
assert.equal(rpcCalls[0].name,'clube_coupon_paid_payment_verify');
assert.equal(rpcCalls[0].args.p_payment_id,'provider-pix-853');
dbResult={ok:false,reviewRequired:true,providerPaymentRecorded:true,
 reason:'COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT',issued:0};
const refundFirst=await ctx.handle(admin,'provider-order-853',invoice,'APP_USR-synthetic');
assert.equal(refundFirst.body.status,'review_required');
assert.equal(refundFirst.body.issuedCoupons,0);
dbResult={ok:true,replayed:false,issued:3};
const regular=await ctx.handle(admin,'provider-order-853',invoice,'APP_USR-synthetic');
assert.equal(regular.body.status,'paid','normal authorized settlement remains usable');
dbResult={ok:false,reviewRequired:true,providerPaymentRecorded:false,
 reason:'PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT'};
await assert.rejects(ctx.handle(admin,'provider-order-853',invoice,'APP_USR-synthetic'),
 /COUPON_SETTLEMENT_READBACK_UNVERIFIED/);
dbResult={ok:false,reviewRequired:true,providerPaymentRecorded:true,
 reason:'UNRECOGNIZED_FINANCIAL_STATE'};
await assert.rejects(ctx.handle(admin,'provider-order-853',invoice,'APP_USR-synthetic'),
 /COUPON_SETTLEMENT_READBACK_UNVERIFIED/);
assert.equal(rpcCalls.length,5);
assert.ok(webhook.includes('String(r?.transaction_id??"")!==String(pix?.id??"")'),
 'every verified coupon refund must link to the exact Pix transaction');
// #860: a refund with an omitted transaction_id must NEVER close the newly
// reviewed hold, even if the provider Order total matches the purchase.
providerOrder.transactions.refunds=[{id:'refund-no-binding',status:'processed',amount:'8.90'}];
dbResult={ok:false,reviewRequired:true,refunded:false};
const unknownRefund=await ctx.handle(admin,'provider-order-853',
 {...invoice,status:'review_required'},'APP_USR-synthetic');
assert.equal(unknownRefund.body.status,'review_required');
assert.equal(rpcCalls.at(-1).name,'clube_coupon_paid_payment_review',
 'unbound PSP refund requires manual review, never automatic closure');
// Exact matching Pix refund is independently eligible for full-refund RPC.
// This is simulated provider evidence, NOT a real bank transaction.
providerOrder.transactions.refunds=[{id:'refund-bound',status:'processed',
 amount:'8.90',transaction_id:'provider-pix-853'}];
dbResult={ok:true,refunded:true};
const exactRefund=await ctx.handle(admin,'provider-order-853',
 {...invoice,status:'review_required'},'APP_USR-synthetic');
assert.equal(exactRefund.body.status,'refunded');
assert.equal(rpcCalls.at(-1).name,'clube_coupon_paid_payment_refund');
// A payment-specific refund below the purchased amount stays in review.
providerOrder.transactions.refunds=[{id:'refund-partial',status:'processed',
 amount:'5.00',transaction_id:'provider-pix-853'}];
dbResult={ok:false,reviewRequired:true,refunded:false};
await ctx.handle(admin,'provider-order-853',
 {...invoice,status:'review_required'},'APP_USR-synthetic');
assert.equal(rpcCalls.at(-1).name,'clube_coupon_paid_payment_review');

console.log('PASS #853: actual webhook honors DB-held external Pix, rejects inconsistent ACK, preserves regular paid coupon flow, exposes review safely.');
