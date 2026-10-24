import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
assert.match(migration,/net_proceeds_cents integer check\(/,
 'schema must contain net proceeds used by the customer voucher reader');
assert.match(migration,/net_proceeds_verified_at timestamptz/,
 'available funds require an independent verification time');
assert.match(migration,/coupon_net_proceeds_evidence_complete/,
 'net amount without audit evidence is invalid');
assert.match(migration,/create or replace function public\.clube_coupon_paid_funding_finalize\(/);
assert.match(migration,/revoke all on function public\.clube_coupon_paid_funding_finalize/);
assert.match(migration,/grant execute on function public\.clube_coupon_paid_funding_finalize[\s\S]*?to service_role/);
const grossVerify=migration.slice(
 migration.indexOf('create or replace function public.clube_coupon_paid_payment_verify('),
 migration.indexOf('revoke all on function public.clube_coupon_paid_payment_verify('));
assert.ok(grossVerify.length>0);
assert.doesNotMatch(grossVerify,/insert into public\.clube_coupon_paid_issuances/i,
 'gross approved Pix must NEVER automatically issue spendable benefits');
assert.match(grossVerify,/'fundingPending',true/,
 'verified payment must remain pending until net proceeds reconciliation');
assert.match(quotePg,/GROSS_PAYMENT_ISSUED_UNFUNDED_VOUCHERS/);
assert.match(quotePg,/COUPON_UNDERFUNDED_NET_ACCEPTED/);
assert.match(quotePg,/NET_FUNDING_REPLAY_NOT_IDEMPOTENT/);
assert.match(coupon,/row\.net_proceeds_evidence_ref!=null/);
assert.match(webhook,/fundingPending:issued===0/,
 'webhook must not report issued benefits when only gross payment was confirmed');
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
assert.match(migration,/v_invoice.net_proceeds_cents::bigint</,
 'reservation requires provider-verified NET funding, not gross price');
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
assert.match(coupon,/mercadoPagoPixDeadline\(order,payment,invoice.created_at\)/,
 'coupon Pix must use durable invoice creation, not retry time, for expiry');
assert.doesNotMatch(coupon,/expires_at:\s*new Date\(Date.now\(\)\s*\+\s*86400000\)/,
 'retry must not invent 24 more hours of Pix validity');
assert.match(coupon,/expires_at:expiresAt/,
 'persist only deadline confirmed by the provider-constrained helper');
assert.match(coupon,/couponProviderPixPayable\(order,payment\)/,
 'processed, refunded or cancelled provider orders cannot issue Pix QR');
assert.match(coupon,/invoice.status==="awaiting_payment"&&!await couponPixStillPayable\(invoice\)/,
 'idempotent retry must recheck the PSP before returning stored QR');
assert.match(coupon,/COUPON_PIX_REVIEW_REQUIRED/,
 'unverified/processed replay must fail closed without offering another QR');
assert.match(coupon,/pix_br_code:null,payment_url:null/,
 'PSP rejected replay must mask both persisted payment routes');
assert.match(coupon,/recheckRequired:true/,
 'PSP rejected replay must request reconciliation explicitly');
assert.doesNotMatch(coupon,/status:"requires_review"/,
 'never pretend a locally unverified invoice has a new persisted billing status');
assert.match(coupon,/Date.parse\(String\(invoice.expires_at\)\)<=Date.parse\(deadline\)/,
 'never return code after more restrictive current provider expiry');

// Execute the actual small presentation and read-only PSP verification helpers
// with controlled data; do not create Pix or make network requests in CI.
const h0=coupon.indexOf('function couponInvoiceCanPresent(');
const h1=coupon.indexOf('Deno.serve(',h0);
assert.ok(h0>0&&h1>h0,'missing coupon presentation helper boundaries');
const helperCode=coupon.slice(h0,h1).replace(/:any(?=[,)])/g,'');
const now=Date.now();
const iso=offset=>new Date(now+offset).toISOString();
const brCode='00020101021226800014br.gov.bcb.pix1234567890';
const invoice={id:'inv-1',status:'awaiting_payment',sale_price_cents:1500,
 created_at:iso(-3600000),expires_at:iso(1800000),pix_br_code:brCode,
 payment_url:'https://example.invalid/pay',provider_order_id:'mp-order-1',
 provider_payment_id:'mp-payment-1',coupons_per_pack:2};
const providerOrder={id:'mp-order-1',external_reference:'inv-1',
 total_amount:'15.00',status:'action_required',
 transactions:{payments:[{id:'mp-payment-1',status:'pending',
  payment_method:{id:'pix',type:'bank_transfer',qr_code:brCode}}]}};
let providerData=structuredClone(providerOrder),deadline=iso(2400000),getCount=0;
const sandbox=vm.createContext({
 Date,String,Number,Array,encodeURIComponent,
 MP_TOKEN:'synthetic-never-used',
 mercadoPagoFetch:async()=>{getCount++;return {ok:true};},
 readMercadoPagoJson:async()=>providerData,
 findPix:order=>order?.transactions?.payments?.[0]??null,
 mercadoPagoPixDeadline:()=>deadline,
 moneyToCents:value=>Math.round(Number(value)*100),
 validatePixBrCode:()=>({valid:true})
});
new vm.Script(helperCode,{filename:'coupon-credit-pix-helpers.ts'}).runInContext(sandbox);
assert.equal(sandbox.couponInvoiceCanPresent(invoice,now),true);
assert.equal(sandbox.publicInvoice(invoice).pixCode,brCode);
assert.equal(sandbox.publicInvoice(invoice).issuedCoupons,0);
assert.equal(await sandbox.couponPixStillPayable(invoice),true);
assert.equal(getCount,1,'one GET verification on positive replay');
providerData={...providerOrder,status:'processed'};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,'processed order cannot reuse QR');
providerData={...providerOrder,transactions:{payments:[{...providerOrder.transactions.payments[0],status:'processed'}]}};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,'processed payment cannot reuse QR');
providerData={...providerOrder,external_reference:'different'};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,'wrong external reference');
providerData={...providerOrder,total_amount:'20.00'};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,'wrong amount');
providerData=structuredClone(providerOrder);
deadline=iso(1200000);
assert.equal(await sandbox.couponPixStillPayable(invoice),false,'PSP shortened expiry');
assert.equal(sandbox.couponInvoiceCanPresent({...invoice,expires_at:iso(90000000)},now),false,
 'persisted Pix cannot outlive 24h from original invoice');
assert.equal(sandbox.couponInvoiceCanPresent({...invoice,created_at:null},now),false);
assert.equal(sandbox.couponInvoiceCanPresent({...invoice,expires_at:iso(20000)},now),false,
 'near-expired code must be withheld');
assert.equal(sandbox.publicInvoice({...invoice,status:'paid'}).pixCode,null,
 'paid invoice must never be offered for repayment');
assert.equal(sandbox.publicInvoice({...invoice,status:'paid'}).issuedCoupons,2);
assert.equal(sandbox.publicInvoice({...invoice,expires_at:iso(20000)}).pixCode,null);
assert.equal(sandbox.couponInvoiceCanPresent({...invoice,pix_br_code:null},now),false,
 'masked replay cannot offer a QR even if original invoice has remaining time');

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
console.log('PASS: coupon Pix verifies gross payments separately from reconciled net-funded issuance; signed webhook, refund and sales gate remain protected.');
