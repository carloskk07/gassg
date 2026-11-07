import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261108001000_ads_independent_fixed_fee_checkout_v1_886.sql');
const edge=read('supabase/functions/ads-independent-checkout/index.ts');
const webhook=read('supabase/functions/ads-payment-webhook-mercadopago/index.ts');
const cfg=read('supabase/config.toml');
for(const key of [
 'ads_independent_sales_controls_v1_886','ads_independent_checkouts_v1_886',
 'ads_independent_payment_events_v1_886','ENABLE ROW LEVEL SECURITY',
 'ads_independent_checkout_reserve_v1_886','ADS_APPROVED_OWNER_REQUIRED',
 'ADS_SALES_DISABLED','ADS_FIXED_PLAN_UNAVAILABLE','ADS_PAID_CAMPAIGN_REQUIRED',
 'ads_independent_checkout_attach_v1_886','ADS_CHECKOUT_IDENTITY_MISMATCH',
 'ads_independent_payment_fact_v1_886','ADS_PAYMENT_REFERENCE_MISMATCH',
 'ADS_DIFFERENT_PAYMENT_REVIEW_REQUIRED','netSettlementVerified',
 'payment_reversed',"status='paused'","'autoPublished',false",
 'admin_ads_independent_sales_toggle_v1_886','terms_accepted_at',
 'fixedFeeStatus','fixedFeeSalesEnabled'
])assert.ok(sql.includes(key),'Missing fixed-fee contract '+key);
assert.match(sql,/sales_enabled boolean NOT NULL DEFAULT false/);
assert.match(sql,/REFERENCES public\.ads_independent_campaigns_v1_884/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.ads_independent_payment_fact_v1_886/);
assert.doesNotMatch(sql,/UPDATE public\.merchants|INSERT INTO public\.merchants/i);
for(const k of ['auth.getUser','verifySeller','ADS_MP_CHECKOUT_ENABLED',
 'ADS_MP_WEBHOOK_ENABLED','ADS_MP_ACCESS_TOKEN','ADS_MP_SELLER_ID',
 'ADS_PAYMENT_NOT_CONFIGURED','ADS_SELLER_UNVERIFIED',
 'ads_independent_checkout_reserve_v1_886','ads_independent_checkout_attach_v1_886',
 'external_reference:reference','safeMercadoPagoUrl','acceptFixedFee!==true',
 'p_preference:preference','checkout/preferences'])assert.ok(edge.includes(k),'Missing checkout safeguard '+k);
assert.match(webhook,/ads_independent_payment_fact_v1_886/);
assert.match(webhook,/payment\?\.live_mode!==true/);
assert.match(webhook,/verifyMercadoPagoWebhook/);
assert.match(cfg,/\[functions\.ads-independent-checkout\]\s*verify_jwt = false/);
console.log('V1.886 PASS: no merchant dependency, versioned fixed-fee checkout, PSP-signed money facts and revocation.');
