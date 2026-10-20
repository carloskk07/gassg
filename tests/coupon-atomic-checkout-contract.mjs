import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

const growth=read('js/growth.js');
const customer=read('js/customer.js');
const backend=read('js/backend.js');
const edge=read('supabase/functions/create-order/index.ts');
const invoiceEdge=read('supabase/functions/coupon-credit-pix/index.ts');
const migration=read('supabase/migrations/20261019180000_clube_coupon_order_atomic_checkout.sql');
const receipt=read('supabase/migrations/20261019170000_clube_coupon_paid_pix_financial_foundation.sql');

for(const source of [growth,customer,backend])new vm.Script(source);
assert.match(migration,/function public.clube_coupon_paid_create_order/);
assert.match(migration,/pg_advisory_xact_lock/);
assert.match(migration,/public.create_order_from_quote_v8\(/);
assert.match(migration,/entry_type,\s*amount_cents,idempotency_key/);
assert.match(migration,/cashback_seed/);
assert.match(migration,/v_order.cashback_reserved_cents<>v_after/);
assert.match(migration,/net_proceeds_verified_at is null/);
assert.match(migration,/net_proceeds_cents::bigint</);
assert.match(migration,/insert into public.clube_coupon_paid_order_applications/);
assert.match(migration,/couponAppliedCents/);
assert.match(migration,/quoted_merchant_id/);
assert.match(migration,/clube_coupon_paid_net_proceeds_verify/);
assert.match(receipt,/clube_coupon_paid_quote_reserve/);
assert.match(edge,/CLUBE_COUPON_CHECKOUT_ENABLED/);
assert.match(edge,/clube_coupon_paid_create_order/);
assert.match(edge,/p_voucher_id:couponVoucherId/);
assert.match(edge,/couponVoucherId\?\{couponVoucherId\}:\{\}/);
assert.match(edge,/create_order_from_quote_v8/);
assert.match(invoiceEdge,/couponCheckoutEnabled:/);
assert.match(invoiceEdge,/net_proceeds_verified_at!=null/);
assert.match(invoiceEdge,/net_proceeds_cents>=row.coupon_face_cents\*row.coupons_per_pack/);
assert.match(backend,/couponVoucherId:couponVoucher.voucherId/);
assert.match(backend,/if\(couponIntent&&!couponVoucher\)/);
assert.match(customer,/clubePaidCouponCheckoutPanel\(\)/);

const part=growth.slice(growth.indexOf('const clubePaidCouponView='),growth.indexOf('function club(){'));
assert.ok(part.length>3000);
const a='00000000-0000-0000-0000-000000000011';
const b='00000000-0000-0000-0000-000000000022';
const voucher='77777777-7777-4777-8777-777777777777';
const state={user:{cashback:2},checkout:{useCashback:false}};
let renders=0,toastMessage='',saves=0;
const globalThis={liveRuntime:{session:{user:{id:a}}},liveReady:()=>true};
const sandbox=vm.createContext({globalThis,state,
  BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
  esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  liveReady:()=>true,Date,
  render:()=>renders++,save:()=>saves++,toast:v=>{toastMessage=v},
  route:()=> 'order'
});
vm.runInContext(part+`
this.__coupon={
 view:clubePaidCouponView,selected:clubePaidCheckoutSelection,
 choose:clubeChoosePaidCheckoutVoucher,
 options:clubePaidCouponOptions,
 intent:clubePaidCouponSelectedIntent,
 forQuote:clubePaidCouponVoucherForQuote,
 panel:clubePaidCouponCheckoutPanel,
 clear:clubeClearPaidCheckoutVoucher
};`,sandbox);
const api=sandbox.__coupon;
api.view.userId=a;api.view.status='ready';
api.view.vouchers=[{
  voucherId:voucher,status:'issued',faceCents:500,expiresAt:'2027-02-01T00:00:00Z'
}];
assert.equal(api.options().length,0,'sales-off/checkout-off hides voucher');
api.view.checkoutEnabled=true;
assert.equal(api.options().length,1);
api.choose(voucher);
assert.equal(state.checkout.useCashback,true);
assert.equal(api.intent(),voucher);
assert.equal(api.forQuote(1200).faceCents,500);
assert.equal(api.forQuote(600),null,'combined wallet and voucher exceed basket');
assert.match(api.panel(),/Cupom pré-pago/);
assert.ok(renders>0&&saves>0);
globalThis.liveRuntime.session.user.id=b;
assert.equal(api.intent(),null);
assert.equal(api.forQuote(1200),null);
assert.doesNotMatch(api.panel(),/value="77777777/, 'other account cannot see prior voucher');
globalThis.liveRuntime.session.user.id=a;
api.view.vouchers[0].status='review_required';
assert.equal(api.forQuote(1200),null,'refund holds voucher');
api.choose(voucher);
assert.match(toastMessage,/não está disponível/);
api.view.vouchers[0].status='issued';
api.view.vouchers[0].expiresAt='2020-01-01T00:00:00Z';
assert.equal(api.forQuote(1200),null,'expired voucher blocked');
api.clear();assert.equal(api.intent(),null);

console.log('PASS: paid-coupon order gate, proof of net funds, wallet/order conservation, user-switch, expiry and failure-closed checkout.');
