import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const r=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const edge=r('supabase/functions/coupon-credit-pix/index.ts');
const shop=r('js/clube-coupon-shop.js');
const legal=r('js/legal.js');
const html=r('index.html');
const migration=r('supabase/migrations/20261104170300_clube_coupon_terms_acceptance_v1_813.sql');
new vm.Script(shop);
new vm.Script(legal);
assert.match(edge,/const COUPON_TERMS_VERSION="clube_coupon_terms_v1_813"/);
assert.ok(edge.includes('termsVersion:COUPON_TERMS_VERSION'));
assert.ok(edge.includes('body.termsAccepted!==true||')&&
 edge.includes('body.termsVersion!==(partnerPurchase?PARTNER_BUYER_TERMS_VERSION:COUPON_TERMS_VERSION)'),
 'owner terms cannot be reused as merchant-funded consent');
const accepted=edge.indexOf('if(body.termsAccepted!==true||');
const invoice=edge.indexOf('.from("clube_coupon_paid_invoices").insert(details)');
const provider=edge.indexOf('mercadoPagoFetch("/v1/orders"');
assert.ok(accepted>0&&accepted<invoice&&invoice<provider,'acceptance precedes real invoice/Pix');
assert.ok(edge.includes('terms_accepted_at:new Date().toISOString()')&&edge.includes('terms_version:partnerPurchase?PARTNER_BUYER_TERMS_VERSION:COUPON_TERMS_VERSION'));
assert.ok(shop.includes('<input type="checkbox" id="clube-coupon-terms-')&&
 shop.includes('?.checked')&&shop.includes('termsAccepted:true,termsVersion:p.termsVersion'));
assert.ok(shop.includes('go(\\\'terms\\\')'),'conditions linked before checkout');
assert.match(legal,/tamao-coupon-terms-template/);
assert.match(html,/clube_coupon_terms_v1_813/);
for(const condition of ['pedido elegível','revendas para o CEP','não reserva produto','emissão dos cupons','cancelamento ou reembolso'])
 assert.ok(html.includes(condition),'conditions missing: '+condition);
assert.match(migration,/ADD COLUMN terms_version text/);
assert.match(migration,/ADD COLUMN terms_accepted_at timestamptz/);
assert.match(migration,/CREATE TRIGGER clube_coupon_terms_immutable_v1_813/);
assert.match(migration,/REVOKE ALL ON FUNCTION public.clube_coupon_terms_immutable_v1_813/);
assert.doesNotMatch(migration,/UPDATE public.clube_coupon_paid_packages|UPDATE public.platform_launch_control|INSERT INTO public.clube_coupon_paid_issuances/i);
console.log('V1.813 PASS — explicit opt-in and versioned invoice receipt without pretending legal approval or starting Pix.');
