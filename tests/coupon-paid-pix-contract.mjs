import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261019170000_clube_coupon_paid_pix_financial_foundation.sql');
const billing=read('supabase/functions/merchant-billing-pix/index.ts');
const coupon=read('supabase/functions/coupon-credit-pix/index.ts');
const webhook=read('supabase/functions/billing-payment-webhook-mercadopago/index.ts');
const shared=read('supabase/functions/_shared/mercadopago.js');
const quotePg=read('tests/coupon-quote-reservation-postgres-17.sql');
assert.match(quotePg,/set_config\('tamao\.coupon\.isolated_quote_fixture','true',false\)/,
 'quote fixture marker must survive two DO statements in one psql session');
assert.match(quotePg,/COUPON_QUOTE_FIXTURE_FLAG_LOST/,
 'CI must fail instead of silently skipping real coupon reservations');
for(const table of ['clube_coupon_paid_packages','clube_coupon_paid_invoices','clube_coupon_paid_issuances']){
 assert.match(migration,new RegExp('create table if not exists public\\.'+table));
 assert.match(migration,new RegExp('alter table public\\.'+table+' enable row level security'));
 assert.match(migration,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated'));
}
assert.match(migration,/not sale_enabled or \(/,
 'unapproved financial packages must not go on sale');
assert.match(migration,/funding_verified and legal_terms_verified and redeem_settlement_verified/,
 'commercial authorization requires contract, funding and settlement');
assert.match(migration,/sale_price_cents::bigint>=coupon_face_cents::bigint\*coupons_per_pack::bigint/,
 'the cash received must cover all face-value obligations before a sale');
assert.match(coupon,/pkg.sale_price_cents<pkg.coupon_face_cents\*pkg.coupons_per_pack/,
 'the PIX edge must independently check package funding');
assert.doesNotMatch(migration,/insert into public\.clube_coupon_paid_packages/i,
 'migration cannot switch on a live package');
assert.match(migration,/unique\(customer_user_id,request_id\)/,
 'idempotency must isolate customers');
assert.match(migration,/unique\(invoice_id,ordinal\)/,
 'coupon issuance idempotent per ordinal');
assert.match(migration,/where id=p_invoice_id for update/,
 'credit verification and refunds need row locking');
assert.match(migration,/on conflict \(invoice_id,ordinal\) do nothing/,
 'duplicated Mercado Pago webhooks cannot duplicate credits');
assert.match(migration,/create or replace function public.clube_coupon_paid_quote_reserve\(/);
assert.match(migration,/create or replace function public.clube_coupon_paid_quote_release\(/);
assert.match(migration,/reserved_quote_id uuid/);
assert.match(migration,/clube_coupon_one_reservation_per_quote/);
assert.match(migration,/v_invoice.status<>'paid'/,
 'an unpaid voucher cannot be reserved');
assert.match(migration,/v_quote.customer_id<>p_customer_user_id/,
 'a customer may not bind vouchers to another person\'s quote');
assert.match(migration,/v_quote.gross_total_cents<v_voucher.face_cents/,
 'voucher may not exceed current quote');
assert.match(migration,/v_invoice.sale_price_cents::bigint</,
 'reservation requires lastro integral do pacote');
assert.ok(migration.includes("'appliedCents',0"),
 'a reservation is not a redeemed discount');
for(const fn of ['clube_coupon_paid_quote_reserve','clube_coupon_paid_quote_release']){
  assert.match(migration,new RegExp('revoke all on function public\\.'+fn));
  assert.match(migration,new RegExp('grant execute on function public\\.'+fn+'[\\s\\S]*?to service_role'));
}
for(const func of ['clube_coupon_paid_payment_verify','clube_coupon_paid_payment_refund',
 'clube_coupon_paid_payment_review']){
 assert.match(migration,new RegExp('revoke all on function public\\.'+func));
 assert.match(migration,new RegExp('grant execute on function public\\.'+func+'[\\s\\S]*?to service_role'));
}
assert.match(coupon,/Deno\.env\.get\("CLUBE_COUPON_PAID_SALES_ENABLED"\)!=="true"/,
 'hard fail-closed default');
assert.match(coupon,/Deno\.env\.get\("MERCADOPAGO_ACCESS_TOKEN"\)/,
 'use existing platform account');
assert.match(billing,/Deno\.env\.get\("MERCADOPAGO_ACCESS_TOKEN"\)/,
 'same Mercado Pago account is already integrated with billing');
assert.match(coupon,/\.eq\("customer_user_id",user\.id\)\.eq\("request_id",requestId\)/,
 'invoice re-query must be bound to authenticated user');
assert.match(coupon,/sale_price_cents:pkg.sale_price_cents/,
 'price must come from server package, never client request');
assert.match(coupon,/validatePixBrCode\(rawCode,\{expectedAmountCents:invoice.sale_price_cents\}\)/,
 'never return invalid Pix payload');
assert.match(shared,/export async function verifyMercadoPagoWebhook/);
assert.match(webhook,/verifyMercadoPagoWebhook\(req,webhookSecret,dataId\)/,
 'signature must be checked before any financial action');
assert.match(webhook,/handlePaidCouponOrder/);
assert.match(webhook,/COUPON_EARLY_PAYMENT_MISMATCH/,
 'early webhook/reconciliation retry must fail closed');
assert.match(webhook,/clube_coupon_paid_payment_verify/);
assert.match(webhook,/clube_coupon_paid_payment_refund/);
assert.match(webhook,/clube_coupon_paid_payment_review/);
assert.match(migration,/v_invoice.provider_payment_id<>p_payment_id/,
 'a replay with another provider payment id must never issue the same vouchers');
assert.match(webhook,/"charged_back","chargeback"/,
 'confirmed chargeback must suspend unspent benefits');
assert.match(webhook,/refunded===Number\(invoice.sale_price_cents\)/,
 'only exact full refunds may be classified as completed');

assert.match(webhook,/fullRefund\?"clube_coupon_paid_payment_refund"/,
 'partial and inconsistent refunds must follow finance-review route');
assert.match(webhook,/COUPON_EARLY_PAYMENT_MISMATCH/,
 'early Mercado Pago callback must reconcile only verified matching invoices');
assert.match(webhook,/merchant_sale_payment_attempts/,
 'merchant-owned payment webhook route must be preserved');
assert.match(webhook,/handlePlatformBillingOrder/,
 'legacy platform billing reconciliation must be preserved');
assert.doesNotMatch(coupon,/create-order|\bstatus:'paid'\b|status:"paid"/i,
 'generating a Pix must not auto-confirm or generate an order');
console.log('PASS: coupon Pix same MP account, signed webhook, idempotent credit, refund, user-scoped billing and sales gate off.');
