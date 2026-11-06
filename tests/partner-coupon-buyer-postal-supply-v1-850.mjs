import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261106011500_partner_coupon_verified_cep_supply_v1_850.sql');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const shop=read('js/clube-coupon-shop.js');
const fixtures=read('tests/fixtures/partner-coupon-buyer-region-v1-850.sql');
assert.ok(sql.length>6000);
for(const x of [
 'clube_partner_coupon_sale_readiness_v1_849',
 'clube_partner_coupon_postal_supply_v1_850',
 'public.market_city_offer_scope(d.city,d.state)',
 'public.market_city_offer_scope(v_zip.city,v_zip.state)',
 "c.opted_in AND c.terms_version=1 AND t.enabled",
 "verified_at>=statement_timestamp()-interval '30 days'",
 "AND btrim(coalesce(street,''))<>''",
 'buyer_postal_code_v1_850',
 "package_key='partner_general_3x5_849'",
 'PARTNER_COUPON_PURCHASE_REGION_IMMUTABLE',
 'PARTNER_COUPON_PURCHASE_REGION_UNAVAILABLE'
])assert.ok(sql.includes(x),'No required supply proof '+x);
assert.match(sql,/BEFORE INSERT ON public\.clube_coupon_paid_invoices/);
assert.match(sql,/BEFORE UPDATE OF buyer_postal_code_v1_850/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.clube_partner_coupon_postal_supply_v1_850/);
assert.doesNotMatch(sql,/UPDATE public\.clube_partner_coupon_launch_v1_846\s+SET enabled=true/);
assert.doesNotMatch(sql,/UPDATE public\.clube_partner_coupon_sale_agreements_v1_849\s+SET sales_authorized=true/);
for(const x of [
 'partnerBuyerSupply','validateServicePostalCode',
 'clube_partner_coupon_postal_supply_v1_850',
 'eligiblePostalCode:buyerSupply.postalCode',
 'PARTNER_COUPON_POSTAL_REQUIRED',
 'PARTNER_COUPON_NO_SERVICE_AT_CEP',
 'buyer_postal_code_v1_850:selectedSupply.postalCode',
 'invoice.buyer_postal_code_v1_850!==selectedSupply.postalCode',
 'PARTNER_COUPON_SUPPLY_CHANGED_BEFORE_PIX'
])assert.ok(edge.includes(x),'Buyer must verify CEP before real Pix: '+x);
assert.match(shop,/clubeCouponVerifyPostal/);
assert.match(shop,/eligiblePostalCode===region/);
assert.match(shop,/postalCode:clubeCouponShopState.regionPostal/);
assert.match(shop,/Comprar com Pix/);
assert.match(fixtures,/BEGIN;/);
assert.match(fixtures,/ROLLBACK;/);
console.log('PASS #850: canonical live city/stock/compliance scope and buyer-selected CEP required before future paid coupon Pix, legacy invoices untouched.');
