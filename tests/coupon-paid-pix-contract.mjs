import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261019170000_clube_coupon_paid_pix_financial_foundation.sql');
const billing=read('supabase/functions/merchant-billing-pix/index.ts');
const coupon=read('supabase/functions/coupon-credit-pix/index.ts');
const webhook=read('supabase/functions/billing-payment-webhook-mercadopago/index.ts');
const shared=read('supabase/functions/_shared/mercadopago.js');
for(const table of ['clube_coupon_paid_packages','clube_coupon_paid_invoices','clube_coupon_paid_issuances']){
 assert.match(migration,new RegExp('create table if not exists public\\.'+table));
 assert.match(migration,new RegExp('alter table public\\.'+table+' enable row level security'));
 assert.match(migration,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated'));
}
assert.match(migration,/not sale_enabled or \(funding_verified and legal_terms_verified and redeem_settlement_verified\)/,
 'unsponsored/unsettled coupon cannot be sold');
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
for(const func of ['clube_coupon_paid_payment_verify','clube_coupon_paid_payment_refund']){
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
assert.match(webhook,/merchant_sale_payment_attempts/,
 'merchant-owned payment webhook route must be preserved');
assert.match(webhook,/handlePlatformBillingOrder/,
 'legacy platform billing reconciliation must be preserved');
assert.doesNotMatch(coupon,/create-order|\bstatus:'paid'\b|status:"paid"/i,
 'generating a Pix must not auto-confirm or generate an order');
console.log('PASS: coupon Pix same MP account, signed webhook, idempotent credit, refund, user-scoped billing and sales gate off.');
