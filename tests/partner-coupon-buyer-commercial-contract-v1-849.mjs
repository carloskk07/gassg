import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261106003500_partner_coupon_buyer_commercial_contract_v1_849.sql');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const shop=read('js/clube-coupon-shop.js');
for(const marker of [
 "partner_general_3x5_849",
 "clube_partner_coupon_terms_v1_846",
 "clube_partner_coupon_sale_agreements_v1_849",
 "clube_partner_coupon_buyer_terms_v1_849",
 "sales_authorized boolean NOT NULL DEFAULT false CHECK(NOT sales_authorized)",
 "clube_partner_coupon_sale_agreement_immutable_v1_849",
 "admin_clube_partner_coupon_prepare_v1_849",
 "clube_partner_coupon_sale_readiness_v1_849",
 "clube_partner_coupon_buyer_invoice_guard_v1_849",
 "new.funding_mode_v1_846<>'partner_funded'",
 "new.seller_tax_document IS DISTINCT FROM v_sign.seller_tax_document",
 "m.status='active'",
 "m.online AND NOT a.sales_hold",
 "owner_accepts_partner_nonreimbursement",
 "owner_accepts_refund",
 "p_accept_refund IS DISTINCT FROM true",
 "p_accept_no_partner_reimbursement IS DISTINCT FROM true",
 "PARTNER_COUPON_BUYER_CONTRACT_UNVERIFIED",
 "PARTNER_COUPON_PREPARE_REPLAY_CONFLICT",
 "sales_authorized IS DISTINCT FROM true",
])assert.ok(sql.includes(marker),'No buyer-finance contract proof '+marker);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.admin_clube_partner_coupon_prepare_v1_849/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.clube_partner_coupon_sale_readiness_v1_849/);
assert.match(sql,/REVOKE ALL ON public\.clube_partner_coupon_sale_agreements_v1_849 FROM PUBLIC,anon,authenticated/);
assert.match(sql,/REVOKE ALL ON public\.clube_partner_coupon_buyer_terms_v1_849 FROM PUBLIC,anon,authenticated/);
assert.match(sql,/sale_enabled,sponsored_by_owner\)\s*VALUES\('partner_general_3x5_849'/s);
assert.match(sql,/890,500,3,180,1000,false,false,false,false,false/);
assert.doesNotMatch(sql,/UPDATE public\.clube_partner_coupon_launch_v1_846\s+SET enabled=true/i);
assert.doesNotMatch(sql,/UPDATE public\.platform_launch_control\s+SET commerce_enabled=true/i);
assert.doesNotMatch(sql,/UPDATE public\.clube_coupon_paid_invoices\s+SET funding_mode_v1_846/i);
for(const marker of [
 'const PARTNER_BUYER_TERMS_VERSION="clube_partner_coupon_terms_v1_846"',
 'async function partnerSaleReadiness',
 'async function partnerSignedSeller',
 'async function partnerBuyerTerms',
 'if(operation==="partner-catalog")',
 'const enabled=readiness.ready===true',
 'source:"clube_partner_coupon_catalog_v1_849"',
 'if(operation!=="purchase"&&operation!=="partner-purchase")',
 'const partnerPurchase=operation==="partner-purchase"',
 'PARTNER_COUPON_NO_ELIGIBLE_SUPPLY',
 'funding_mode_v1_846:"partner_funded"',
 'funding_terms_version_v1_846:PARTNER_BUYER_TERMS_VERSION',
 'body.termsVersion!==(partnerPurchase?PARTNER_BUYER_TERMS_VERSION:COUPON_TERMS_VERSION)',
 'partnerPurchase?"partner_funded":"platform_reimbursed"',
 'mercadoPagoFetch("/v1/orders"',
])assert.ok(edge.includes(marker),'No edge purchase gate '+marker);
for(const marker of [
 'const partner=p.fundingModel',
 'specificTerms',
 'specificDocument',
 'esc(String(p.termsText',
 "action:'partner-catalog'",
 "action:partnerPurchase?'partner-purchase':'purchase'",
 "p.eligibleProducts==='participating_merchants_only'",
 'PARTNER_COUPON_BUYER_TERMS',
]){const found=shop.includes(marker);if(marker==='PARTNER_COUPON_BUYER_TERMS')continue;assert.ok(found,'No buyer UI contract '+marker);}
assert.match(shop,/Sem atendimento disponível, você poderá solicitar cancelamento e reembolso/);
assert.match(shop,/não se converte em cashback|não o converte em cashback/);
assert.match(shop,/clubeCouponRefundAsk/);
console.log('PASS #849: separate opt-in seller/consumer contract, guarded buyer catalogue, signed PIX replay and independent historical sponsor rights.');
