import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const isolation=read('supabase/migrations/20261105184000_welcome_source_isolation_v1_843.sql');
const economy=read('supabase/migrations/20261105185000_partner_funded_product_welcome_v1_843.sql');
const create=read('supabase/functions/create-order/index.ts');
const offers=read('supabase/functions/get-offers/index.ts');
const orders=read('supabase/functions/get-order/index.ts');
const merchant=read('supabase/functions/merchant-orders/index.ts');
const buyer=read('js/customer.js');
const backend=read('js/backend.js');
const merchantUi=read('js/merchant.js');

for(const [name,file] of [['merchant',merchantUi],['buyer',buyer],['backend',backend]])
 new vm.Script(file,{filename:name+'.js'});
for(const required of [
 'platform_cashback_trace_private_v1_261.capture()',
 "'welcomeLotId'",
 'platform_welcome_grants_v1_815',
 'create_order_from_quote(',
 "p_use_cashback and exists(",
 'remaining_cents'
])assert.ok(isolation.includes(required),'welcome lot separation: '+required);
for(const required of [
 'merchant_welcome_order_uses_v1_843',
 'merchant_welcome_order_use_immutable_v1_843',
 'product_welcome_quote_preview_v1_843',
 'create_product_welcome_order_v1_843',
 'ensure_order_settlement_accounting',
 'zzz_merchant_welcome_fee_snapshot_v1_843',
 'PARTNER_WELCOME_LOT_TRACE_UNCONFIRMED',
 'PARTNER_WELCOME_ALREADY_SPENT_OR_RESERVED',
 'PARTNER_WELCOME_CONSENT_CHANGED',
 'benefit_fee_basis_cents_v1_843',
 'v_fee_basis:=v_order.gross_total_cents-v_partner_discount',
 'v_reimbursable:=v_order.cashback_reserved_cents-v_partner_discount',
 'v_order.total_cents<>v_order.gross_total_cents-v_partner_discount',
 'cashback-user:',
 'mobility_welcome_uses_v1_833',
 'clube_coupon_paid_order_applications',
 'wallet_entries',
 "'welcomeReplayed',true",
 'revoke all on function public.create_product_welcome_order_v1_843',
 'grant execute on function public.create_product_welcome_order_v1_843'
])assert.ok(economy.includes(required),'economic requirement: '+required);
assert.ok(!economy.includes('create table public.clube_coupon_paid_order_applications'));
assert.ok(!/update public\.merchant_billing_plans\b/i.test(economy),'cannot silently rewrite all revenda plans');
assert.ok(!/update public\.merchant_cashback_reimbursements\b/i.test(economy),'cannot rewrite old sponsorship obligations');
assert.ok(!/update public\.platform_launch_control\b/i.test(economy),'no global launch mutation');
assert.match(economy,/revoke all on public\.merchant_welcome_order_uses_v1_843 from public,anon,authenticated/);
assert.match(create,/applyWelcome/);
assert.match(create,/create_product_welcome_order_v1_843/);
assert.match(create,/WELCOME_PAID_COUPON_COMBINATION_UNAVAILABLE/);
assert.match(create,/WELCOME_CASHBACK_COMBINATION_UNAVAILABLE/);
assert.match(offers,/product_welcome_quote_preview_v1_843/);
assert.match(offers,/hasMerchantLeak\(safe\)/);
assert.match(orders,/partnerFundedDiscountCents/);
assert.match(orders,/PARTNER_WELCOME_READBACK_MISMATCH/);
assert.match(merchant,/partnerFundedDiscountCents/);
assert.match(merchant,/PARTNER_WELCOME_MERCHANT_READBACK_MISMATCH/);
assert.match(buyer,/toggleWelcomeBonus/);
assert.match(buyer,/presente de boas-vindas/i);
assert.match(buyer,/pagar diretamente à revenda/i);
assert.match(backend,/selected\.welcomeBenefitEligible/);
assert.match(backend,/\.useWelcomeBonus/);
assert.match(backend,/applyWelcome:true/);
assert.match(merchantUi,/Desconto da revenda/);
assert.match(merchantUi,/Sem ressarcimento do TAMÃO/);
console.log('TAMÃO #843: interface, contrato, reembolso antigo, lote financeiro e separação cashback verificados.');
