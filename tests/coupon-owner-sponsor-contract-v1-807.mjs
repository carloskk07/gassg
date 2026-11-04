import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ledger=read('supabase/migrations/20261104163000_clube_coupon_owner_sponsorship_v1_807.sql');
const financial=read('supabase/migrations/20261104163100_clube_coupon_owner_sponsored_checkout_v1_807.sql');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const shop=read('js/clube-coupon-shop.js');
const growth=read('js/growth.js');
const bootstrap=read('js/bootstrap.js');
const workflow=read('.github/workflows/isolated-supabase-integration.yml');
for(const x of [
 'authorized_cents=10000','reconciled_cents integer NOT NULL DEFAULT 0',
 'encumbered_cents integer NOT NULL DEFAULT 0',
 'CHECK (encumbered_cents<=reconciled_cents)',
 'clube_coupon_sponsor_invoice_before_v1_807',
 'FOR UPDATE','COUPON_SPONSOR_FUNDS_NOT_VERIFIED_OR_EXHAUSTED',
 'COUPON_SPONSOR_IMMUTABLE_INVOICE',
 'clube_coupon_sponsor_invoice_after_v1_807',
 'clube_coupon_sponsor_invoice_update_v1_807',
 'status IN (\'held\',\'captured\',\'released\')',
 'public.clube_coupon_sponsor_covered_v1_807',
 'admin_clube_sponsor_reconcile_owner_v1_807',
 'COUPON_SPONSOR_REAL_BANK_EVIDENCE_REQUIRED',
 'platform_owner_contributions_v1_246',
 'manual_reconciled','bank_statement_reference',
 'reconciled_cents+c.amount_cents>pool.authorized_cents',
 "('gas_3x5_sponsor'", "('water_5x2_sponsor'",
 'true,false,false,false,false',
 'ENABLE ROW LEVEL SECURITY'
])assert.ok(ledger.includes(x),'missing escrow invariant '+x);
assert.match(ledger,/revoke all on function public\.admin_clube_sponsor_reconcile_owner_v1_807/i);
assert.match(ledger,/grant execute on function public\.admin_clube_sponsor_reconcile_owner_v1_807/i);
assert.doesNotMatch(ledger,/UPDATE public\.platform_launch_control|INSERT INTO public\.wallet_entries|INSERT INTO public\.orders/i,
 'funding schema must never activate commerce, create wallet credits or real orders');
for(const name of ['clube_coupon_paid_net_proceeds_verify',
 'clube_coupon_paid_quote_reserve','clube_coupon_paid_create_order']){
 assert.match(financial,new RegExp('FUNCTION public\\.'+name+'\\('));
}
assert.equal((financial.match(/clube_coupon_sponsor_covered_v1_807/g)||[]).length,4,
 'gross and net coverage must be checked independently');
assert.match(edge,/COUPON_SPONSOR_BUDGET_UNAVAILABLE/);
assert.match(edge,/\.from\("platform_clube_sponsor_pool_v1_807"\)/);
assert.match(edge,/if\(operation==="catalog"\)/);
assert.match(edge,/if\(operation==="invoice-status"\)/);
assert.match(edge,/\.eq\("customer_user_id",user.id\)/);
assert.ok(edge.indexOf('.insert(details)')<edge.indexOf('mercadoPagoFetch("/v1/orders"'),
 'sponsor reservation must precede ANY provider charge');
assert.match(edge,/CLUBE_COUPON_PAID_SALES_ENABLED/);
assert.match(edge,/platformCommerceAllowed\(admin\)/);
assert.match(edge,/couponInvoiceNetCovered\(row:any\)/);
assert.match(edge,/sponsor_covered_cents/);
assert.match(growth,/js\/clube-coupon-shop\.js/);
assert.match(growth,/typeof clubeCouponShopPanel==='function'/);
assert.doesNotMatch(bootstrap,/clubeCouponShopRequestModule/);
assert.match(workflow,/isolated-supabase-coupon-sponsor-v1-807.mjs/);
new vm.Script(shop,{filename:'js/clube-coupon-shop.js'});
const a=edge.indexOf('function couponInvoiceNetCovered(');
const b=edge.indexOf('function publicInvoice(',a);
assert.ok(a>=0&&b>a);
const body=edge.slice(a,b).replace('(row:any)','(row)');
const ctx=vm.createContext({Date,Number,String,Boolean});
new vm.Script(body).runInContext(ctx);
const row={
 status:'paid',paid_at:'2026-11-04T09:00:00Z',
 provider_order_id:'PSP-ORDER',provider_payment_id:'PSP-PIX',
 coupon_face_cents:500,coupons_per_pack:3,
 sale_price_cents:890,net_proceeds_cents:840,
 sponsor_covered_cents:1500,
 net_proceeds_verified_at:'2026-11-04T09:01:00Z',
 net_proceeds_reference:'verified-bank-net-ref'
};
assert.equal(ctx.couponInvoiceNetCovered(row),true,'verified sponsor full face can support net below face');
for(const alteration of [
 {sponsor_covered_cents:0},
 {sponsor_covered_cents:1499},
 {net_proceeds_verified_at:null},
 {net_proceeds_reference:null},
 {provider_payment_id:null},
 {status:'review_required'},
 {net_proceeds_cents:0},
 {net_proceeds_cents:891}
])assert.equal(ctx.couponInvoiceNetCovered({...row,...alteration}),false,
 'sponsor cannot bypass provider net proof and exact full-face escrow');
assert.equal(ctx.couponInvoiceNetCovered({...row,sponsor_covered_cents:0,
 net_proceeds_cents:1500,sale_price_cents:1600}),true,
 'legacy unsponsored net-funded checkout remains permitted');
console.log('V1.807 PASS — founder escrow, lastro, payment-first, isolated coupon shop and conservation.');
