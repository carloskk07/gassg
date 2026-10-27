import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {safeMercadoPagoUrl} from '../supabase/functions/_shared/mercadopago.js';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261019170000_clube_coupon_paid_pix_financial_foundation.sql');
const netMigration=read('supabase/migrations/20261019180000_clube_coupon_order_atomic_checkout.sql');
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
assert.ok(netMigration.includes('create or replace function public.clube_coupon_paid_net_proceeds_verify('),
 'reuse the existing settlement verifier; do not create a second financial motor');
assert.match(netMigration,/net_proceeds_reference is null/,
 'the atomic checkout must require independently reconciled provider net evidence');
assert.match(coupon,/paidIds=new Set/,
 'read-only vouchers list must require invoice funding coverage');
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
assert.match(coupon,/mercadoPagoPixDeadline\(order,payment,invoice.created_at\)/,
 'PSP-backed deadline stays immutable');
assert.match(coupon,/function couponOfficialPixTicket\(value:any\)/,
 'original provider ticket must be validated');
assert.match(coupon,/pix_br_code:rawCode\|\|null,payment_url:ticket/,
 'ticket-only issuance may not manufacture a fake BR Code');
assert.match(coupon,/qrImageDataUri:rawCode\?mercadoPagoQrDataUri/,
 'a ticket-only Pix must not show an unbound image');
assert.match(coupon,/mercadoPagoPixDeadline\(order,payment,invoice.created_at\)/,
 'coupon Pix must use durable invoice creation, not retry time, for expiry');
assert.doesNotMatch(coupon,/expires_at:\s*new Date\(Date.now\(\)\s*\+\s*86400000\)/,
 'retry must not invent 24 more hours of Pix validity');
assert.match(coupon,/expires_at:expiresAt/,
 'persist only deadline confirmed by the provider-constrained helper');
assert.match(coupon,/couponProviderPixPayable\(order,payment\)/,
 'processed, refunded or cancelled provider orders cannot issue Pix QR');
assert.match(coupon,/moneyToCents\(payment\?\.amount\)===moneyToCents\(order\?\.total_amount\)/,
 'each coupon Pix must explicitly match its own transaction amount and Order total');
assert.match(webhook,/moneyToCents\(pix\?\.amount\)!==Number\(invoice.sale_price_cents\)/,
 'signed webhook may never issue paid benefits without matching Pix amount');
// Keep the original replay guard contract visible:
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
const h0=coupon.indexOf('function couponOfficialPixTicket(');
const h1=coupon.indexOf('Deno.serve(',h0);
assert.ok(h0>0&&h1>h0,'missing coupon presentation helper boundaries');
const helperCode=coupon.slice(h0,h1).replace(/:any(?=[,)])/g,'');
const now=Date.now();
const iso=offset=>new Date(now+offset).toISOString();
const brCode='00020101021226800014br.gov.bcb.pix1234567890';
const invoice={id:'inv-1',status:'awaiting_payment',sale_price_cents:1500,
 created_at:iso(-3600000),expires_at:iso(1800000),pix_br_code:brCode,
 payment_url:null,provider_order_id:'mp-order-1',
 provider_payment_id:'mp-payment-1',coupons_per_pack:2};
const providerOrder={id:'mp-order-1',external_reference:'inv-1',
 total_amount:'15.00',status:'action_required',
 transactions:{payments:[{id:'mp-payment-1',amount:'15.00',status:'pending',
  payment_method:{id:'pix',type:'bank_transfer',qr_code:brCode}}]}};
let providerData=structuredClone(providerOrder),deadline=iso(2400000),getCount=0;
const sandbox=vm.createContext({
 Date,String,Number,Array,URL,encodeURIComponent,safeMercadoPagoUrl,
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
const ticketUrl='https://www.mercadopago.com.br/payments/ticket/abc';
const ticketInvoice={...invoice,pix_br_code:null,payment_url:ticketUrl};
assert.equal(sandbox.couponInvoiceCanPresent(ticketInvoice,now),true,
 'a valid official original Pix ticket is payable without a stored QR code');
assert.equal(sandbox.publicInvoice(ticketInvoice).pixCode,null);
assert.equal(sandbox.publicInvoice(ticketInvoice).paymentUrl,ticketUrl);
for(const unsafe of [
 'https://mercadopago.com.br.evil.example/pay',
 'http://www.mercadopago.com.br/payments/ticket',
 'https://www.mercadopago.com.br/sandbox/payments/ticket',
 'https://sandbox.mercadopago.com.br/payments/ticket',
 'javascript:alert(1)'
]){
 assert.equal(sandbox.couponOfficialPixTicket(unsafe),null,
  'unofficial or sandbox ticket must not be clickable');
 assert.equal(sandbox.couponInvoiceCanPresent({...ticketInvoice,payment_url:unsafe},now),false,
  'unofficial ticket must not appear as a payable Pix');
 assert.equal(sandbox.couponInvoiceCanPresent({...invoice,payment_url:unsafe},now),false,
  'unofficial ticket must veto a stored QR as contradictory payment evidence');
}
assert.equal(sandbox.publicInvoice(invoice).issuedCoupons,0);
assert.equal(await sandbox.couponPixStillPayable(invoice),true);
assert.equal(sandbox.couponProviderPixPayable(providerOrder,providerOrder.transactions.payments[0]),true);
const exactPayment=providerOrder.transactions.payments[0];
for(const invalid of [
 {...providerOrder.transactions.payments[0],amount:undefined},
 {...providerOrder.transactions.payments[0],amount:null},
 {...providerOrder.transactions.payments[0],amount:'14.00'},
 {...providerOrder.transactions.payments[0],amount:'0'},
 {...providerOrder.transactions.payments[0],id:''}
]){
 assert.equal(sandbox.couponProviderPixPayable(providerOrder,invalid),false,
  'the original Order total never substitutes an explicit matching Pix amount');
}
assert.equal(sandbox.couponProviderPixPayable({...providerOrder,live_mode:false},exactPayment),false,
 'explicit sandbox Order must not present an alleged real customer Pix');
assert.equal(sandbox.couponProviderPixPayable({...providerOrder,currency_id:'USD'},exactPayment),false);
assert.equal(sandbox.couponProviderPixPayable({...providerOrder,currency:'USD'},exactPayment),false);
assert.equal(getCount,1,'one GET verification on positive replay');
providerData={...providerOrder,transactions:{payments:[
 {...providerOrder.transactions.payments[0],payment_method:{
   id:'pix',type:'bank_transfer',qr_code:'',ticket_url:ticketUrl}}]}};
assert.equal(await sandbox.couponPixStillPayable(ticketInvoice),true,
 'official ticket-only original invoice reopens after PSP GET confirms pending/order/amount');
providerData={...providerOrder,transactions:{payments:[
 {...providerOrder.transactions.payments[0],payment_method:{
   id:'pix',type:'bank_transfer',qr_code:''}}]}};
assert.equal(await sandbox.couponPixStillPayable(ticketInvoice),true,
 'PSP GET may omit both QR and ticket: immutable originally verified link remains when payment pending');
providerData={...providerOrder,transactions:{payments:[
 {...providerOrder.transactions.payments[0],payment_method:{
   id:'pix',type:'bank_transfer',qr_code:'',ticket_url:
      'https://www.mercadopago.com.br/payments/ticket/other'}}]}};
assert.equal(await sandbox.couponPixStillPayable(ticketInvoice),false,
 'changed official ticket must not silently replace original payment');
providerData={...providerOrder,transactions:{payments:[
 {...providerOrder.transactions.payments[0],payment_method:{
   id:'pix',type:'bank_transfer',qr_code:'',ticket_url:
      'https://www.mercadopago.com.br/sandbox/payments/ticket'}}]}};
assert.equal(await sandbox.couponPixStillPayable(ticketInvoice),false,
 'GET sandbox link vetoes saved ticket');
providerData=structuredClone(providerOrder);
assert.equal(await sandbox.couponPixStillPayable(ticketInvoice),true,
 'ticket-only invoice remains valid when PSP confirms same pending Pix with fresh BR Code');

providerData={...providerOrder,status:'processed'};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,'processed order cannot reuse QR');
providerData={...providerOrder,transactions:{payments:[{...providerOrder.transactions.payments[0],status:'processed'}]}};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,'processed payment cannot reuse QR');
providerData={...providerOrder,external_reference:'different'};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,'wrong external reference');
providerData={...providerOrder,total_amount:'20.00'};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,'wrong amount');
providerData={...providerOrder,transactions:{payments:[
 {...providerOrder.transactions.payments[0],amount:undefined}]}};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,
 'missing Pix amount is not payable on a retried invoice');
providerData={...providerOrder,transactions:{payments:[
 {...providerOrder.transactions.payments[0],amount:'14.00'}]}};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,
 'partial Pix amount cannot re-open full-value QR');
providerData={...providerOrder,live_mode:false};
assert.equal(await sandbox.couponPixStillPayable(invoice),false,
 'explicit sandbox order cannot re-open real Pix');
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
const unpaidFunds={...invoice,status:'paid',paid_at:iso(-120000),
 coupon_face_cents:500,coupons_per_pack:2,
 provider_order_id:'mp-order-1',provider_payment_id:'mp-payment-1'};
assert.equal(sandbox.publicInvoice(unpaidFunds).issuedCoupons,0,
 'gross-paid receipt must not advertise financially uncovered vouchers');
assert.equal(sandbox.publicInvoice(unpaidFunds).fundingPending,true);
const netFunded={...unpaidFunds,net_proceeds_cents:1200,
 net_proceeds_verified_at:iso(-60000),
 net_proceeds_reference:'mp-released-money:123'};
assert.equal(sandbox.publicInvoice(netFunded).issuedCoupons,2);
assert.equal(sandbox.publicInvoice(netFunded).fundingPending,false);
for(const mutation of [
 {net_proceeds_cents:999}, {net_proceeds_cents:1600},
 {net_proceeds_verified_at:null}, {net_proceeds_reference:null},
 {provider_payment_id:null}, {paid_at:null}
]){
 assert.equal(sandbox.publicInvoice({...netFunded,...mutation}).issuedCoupons,0,
  'missing net proof, insufficient funding or wrong state must hide vouchers');
}
assert.equal(sandbox.publicInvoice({...netFunded,status:'refunded'}).issuedCoupons,0,
 'refund must hide purchased voucher availability');
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
// Exercise the REAL webhook coupon handler in a no-network VM. A PSP may
// mark the PIX payment refunded/disputed while its parent Order still says
// processed and refunds[] is missing: previously this left vouchers spendable.
const couponHandlerStart=webhook.indexOf('async function handlePaidCouponOrder(');
const couponHandlerEnd=webhook.indexOf('async function handleWebhookProbe(',couponHandlerStart);
assert.ok(couponHandlerStart>=0&&couponHandlerEnd>couponHandlerStart);
const couponHandlerJs=webhook.slice(couponHandlerStart,couponHandlerEnd)
 .replace('admin:any,dataId:string,invoice:any,accessToken:string',
  'admin,dataId,invoice,accessToken')
 .replaceAll('(r:any)','(r)')
 .replaceAll('(total:number,r:any)','(total,r)');
let currentPspOrder,calledRpcs=[],providerRpcResult={};
const invoiceForWebhook={id:'invoice-1',status:'paid',sale_price_cents:1500};
const mockAdmin={rpc:async(name)=>{
 calledRpcs.push(name);return {data:providerRpcResult,error:null};
}};
const webhookSandbox=vm.createContext({
  String,Number,Array,Date,
  mercadoPagoConfigured:()=>true,
  fetchProviderOrder:async()=>({response:{ok:true},data:currentPspOrder}),
  billingPixPayment:order=>order.transactions.payments[0],
  moneyToCents:value=>Math.round(Number(value)*100),
  json:(body,status=200)=>({body,status})
});
new vm.Script(couponHandlerJs,{filename:'coupon-webhook-handler.ts'}).runInContext(webhookSandbox);
const decide=async(paymentStatus,orderStatus='processed',refunds=[],priorStatus='paid',
  details={})=>{
  calledRpcs=[];
  currentPspOrder={id:'order-1',external_reference:'invoice-1',
    total_amount:'15.00',status:orderStatus,
    status_detail:details.order??'accredited',
    transactions:{payments:[{id:'payment-1',amount:'15.00',status:paymentStatus,
      status_detail:details.payment??'accredited',
      payment_method:{id:'pix',type:'bank_transfer'}}],refunds}};
  const result=await webhookSandbox.handlePaidCouponOrder(mockAdmin,'order-1',
    {...invoiceForWebhook,status:priorStatus},'test-only-token');
  assert.equal(result.status,200);
  assert.equal(calledRpcs.length,1,'exactly one accounting decision per callback');
  return {route:calledRpcs[0],status:result.body.status};
};
for(const state of ['refunded','partially_refunded','charged_back',
 'disputed','in_mediation','canceled','failed','expired']){
 const result=await decide(state);
 assert.equal(result.route,'clube_coupon_paid_payment_review',
  'PSP payment status must force finance review even if parent order is processed');
 assert.equal(result.status,'review_required');
}
const validRefund=[{id:'refund-1',status:'processed',amount:'15.00'}];
providerRpcResult={ok:true,refunded:true,replayed:false};
const completedRefund=await decide('refunded','processed',validRefund);
assert.equal(completedRefund.route,'clube_coupon_paid_payment_refund',
 'verified full refund may call the existing SQL refund RPC');
assert.equal(completedRefund.status,'refunded',
 'clean reconciled full refund is reported as completed');
providerRpcResult={ok:false,refunded:false,reviewRequired:true};
const heldRefund=await decide('refunded','processed',validRefund);
assert.equal(heldRefund.route,'clube_coupon_paid_payment_refund');
assert.equal(heldRefund.status,'review_required',
 'PSP full refund is NOT financially closed if SQL finds a reserved/redeemed coupon');
providerRpcResult={ok:true,refunded:true,replayed:true};
const idempotentRefund=await decide('refunded','processed',validRefund);
assert.equal(idempotentRefund.status,'refunded',
 'already-settled clean full refund stays idempotent');
providerRpcResult={};
for(const conflict of ['charged_back','partially_refunded','disputed']){
 assert.equal((await decide(conflict,'processed',validRefund)).route,
 'clube_coupon_paid_payment_review','refund amount cannot override contradictory PSP status');
}
assert.equal((await decide('processed','partially_refunded')).route,
 'clube_coupon_paid_payment_review','order-only partial refund must hold the vouchers');
assert.equal((await decide('processing')).route,
 'clube_coupon_paid_payment_review','a previously paid invoice regressing to pending must be held');
assert.equal((await decide('processed','processed',[],'paid',
 {order:'partially_refunded'})).route,
 'clube_coupon_paid_payment_review','order processed + partially_refunded detail is NOT funded');
assert.equal((await decide('processed','processed',[],'paid',
 {payment:'partially_refunded'})).route,
 'clube_coupon_paid_payment_review','payment processed + partially_refunded detail is NOT funded');
assert.equal((await decide('processed','processed',validRefund,'paid',
 {payment:'partially_refunded'})).route,
 'clube_coupon_paid_payment_review','partial detail conflicts with alleged complete refund');
assert.equal((await decide('processed')).route,
 'clube_coupon_paid_payment_verify','fully confirmed PSP payment still verifies normally');

// A test-approved Mercado Pago Order does not prove a production receipt.
// A paid invoice must become review_required rather than remain spendable;
// an unpaid invoice must not issue vouchers from incomplete Pix evidence.
for(const [name,change] of [
 ['explicit sandbox Order',order=>{order.live_mode=false;}],
 ['Pix transaction amount mismatch',order=>{order.transactions.payments[0].amount='14.00';}],
 ['Pix transaction amount omitted',order=>{delete order.transactions.payments[0].amount;}],
 ['Pix transaction amount null',order=>{order.transactions.payments[0].amount=null;}],
 ['Pix transaction missing identity',order=>{order.transactions.payments[0].id='';}]
]){
 calledRpcs=[];
 currentPspOrder={id:'order-1',external_reference:'invoice-1',
  live_mode:true,total_amount:'15.00',status:'processed',
  status_detail:'accredited',
  transactions:{payments:[{id:'payment-1',amount:'15.00',
   status:'processed',status_detail:'accredited',
   payment_method:{id:'pix',type:'bank_transfer'}}],refunds:[]}};
 change(currentPspOrder);
 const protectedPaid=await webhookSandbox.handlePaidCouponOrder(
  mockAdmin,'order-1',{...invoiceForWebhook,status:'paid'},'test-only-token');
 assert.equal(protectedPaid.status,200,name+' must return existing review route');
 assert.equal(protectedPaid.body.status,'review_required',name);
 assert.equal(protectedPaid.body.reviewRequired,true,name);
 assert.deepEqual(calledRpcs,['clube_coupon_paid_payment_review'],
  name+' cannot call payment verification or issue fresh vouchers');

 calledRpcs=[];
 const protectedUnpaid=await webhookSandbox.handlePaidCouponOrder(
  mockAdmin,'order-1',{...invoiceForWebhook,status:'awaiting_payment'},'test-only-token');
 assert.equal(protectedUnpaid.status,409,name+' must reject unproven new purchase');
 assert.equal(protectedUnpaid.body.error,'COUPON_PROVIDER_PROOF_UNVERIFIED',name);
 assert.equal(calledRpcs.length,0,name+' cannot credit');
}
for(const suspectPaymentState of ['approved','accredited']){
 calledRpcs=[];
 currentPspOrder={id:'order-1',external_reference:'invoice-1',
  live_mode:true,total_amount:'15.00',status:'processed',
  status_detail:'accredited',transactions:{payments:[{
   id:'payment-1',amount:'15.00',status:suspectPaymentState,
   status_detail:'accredited',payment_method:{id:'pix',type:'bank_transfer'}
  }],refunds:[]}};
 const paid=await webhookSandbox.handlePaidCouponOrder(
  mockAdmin,'order-1',{...invoiceForWebhook,status:'paid'},'test-only-token');
 assert.equal(paid.body.status,'review_required',
  'non-processed Pix must hold a previously paid invoice');
 assert.deepEqual(calledRpcs,['clube_coupon_paid_payment_review']);
 calledRpcs=[];
 const pending=await webhookSandbox.handlePaidCouponOrder(
  mockAdmin,'order-1',{...invoiceForWebhook,status:'awaiting_payment'},'test-only-token');
 assert.equal(pending.status,200);
 assert.equal(pending.body.pending,true);
 assert.equal(calledRpcs.length,0,'unprocessed Pix cannot issue a coupon');
}
calledRpcs=[];
currentPspOrder={id:'order-1',external_reference:'invoice-1',
 live_mode:true,total_amount:'15.00',status:'processed',
 status_detail:'accredited',transactions:{payments:[{
  id:'payment-1',amount:'15.00',status:'processed',
  status_detail:'accredited',payment_method:{id:'pix',type:'bank_transfer'}
 }],refunds:[]}};
const validPay=await webhookSandbox.handlePaidCouponOrder(
 mockAdmin,'order-1',{...invoiceForWebhook,status:'awaiting_payment'},'test-only-token');
assert.equal(validPay.status,200,'legitimate non-sandbox order must remain issuable');
assert.equal(validPay.body.status,'paid');
assert.deepEqual(calledRpcs,['clube_coupon_paid_payment_verify']);


// Once a clean refund or a refund requiring merchant compensation is
// durably recorded, a stale "processed" PSP snapshot MUST NOT invoke the
// payment-verify RPC (SQL rejects it and the webhook formerly returned 500).
// This is idempotent acknowledgement, never a new issuance or receipt.
for(const terminal of ['review_required','refunded']){
 for(const stale of ['processed','processing','canceled']){
  calledRpcs=[];
  currentPspOrder={id:'order-1',external_reference:'invoice-1',
   total_amount:'15.00',status:stale,status_detail:'accredited',
   transactions:{payments:[{id:'payment-1',amount:'15.00',status:stale,
    status_detail:'accredited',payment_method:{id:'pix',type:'bank_transfer'}}],
    refunds:[]}};
  const response=await webhookSandbox.handlePaidCouponOrder(
   mockAdmin,'order-1',{...invoiceForWebhook,status:terminal},'test-only-token');
  assert.equal(response.status,200,'terminal replay is acknowledged, not retried forever');
  assert.equal(response.body.status,terminal,'durable financial state must win');
  assert.equal(response.body.replayed,true);
  assert.equal(response.body.reviewRequired,terminal==='review_required');
  assert.equal(calledRpcs.length,0,
   'stale PSP replay must not run payment-verification or any finance mutation');
 }
}
// Explicit new reversal proof still takes the normal higher-priority
// accounting path, even when the invoice was already under manual review.
providerRpcResult={ok:false,refunded:false,reviewRequired:true};
const reviewedRefund=await decide('refunded','processed',validRefund,'review_required');
assert.equal(reviewedRefund.route,'clube_coupon_paid_payment_refund');
assert.equal(reviewedRefund.status,'review_required');
providerRpcResult={ok:true,refunded:true,replayed:true};
const settledRefund=await decide('refunded','processed',validRefund,'refunded');
assert.equal(settledRefund.route,'clube_coupon_paid_payment_refund');
assert.equal(settledRefund.status,'refunded');
// An ordinary unpaid canceled order must retain the original lifecycle
// instead of being incorrectly promoted to manual financial review.
currentPspOrder={id:'order-1',external_reference:'invoice-1',
 total_amount:'15.00',status:'canceled',status_detail:'canceled',
 transactions:{payments:[{id:'payment-1',amount:'15.00',status:'canceled',
  status_detail:'canceled',payment_method:{id:'pix',type:'bank_transfer'}}],refunds:[]}};
let unpaidUpdate=null;
const unpaidAdmin={
 rpc:async()=>{throw new Error('unpaid cancellation must not call reversal RPC');},
 from:table=>{
  assert.equal(table,'clube_coupon_paid_invoices');
  return {update:patch=>{
   unpaidUpdate=patch.status;
   return {eq:()=>({in:async()=>({error:null})})};
  }};
 }
};
const unpaidCancellation=await webhookSandbox.handlePaidCouponOrder(unpaidAdmin,'order-1',
 {...invoiceForWebhook,status:'awaiting_payment'},'test-only-token');
assert.equal(unpaidCancellation.body.status,'canceled');
assert.equal(unpaidUpdate,'cancelled',
 'unpaid Pix cancellation must still use the existing local invoice transition');
console.log('PASS: signed coupon Pix, payment-status/detail reversal holds, and unpaid cancellation preserved.');
